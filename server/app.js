import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { COMPANY_PROFILE } from './db.js';
import {
  getStandardCostBreakdown,
  recordRawMaterialPurchase,
  createAndIssueProductionBatch,
  completeProductionBatch,
  createSalesOrder,
  verifySalesOrder,
  dispatchAndInvoiceOrder,
  recordCollection,
  cancelSalesOrder,
  round2,
} from './ledger.js';
import { buildMonthlyAuditReport } from './reports.js';

export function createApp(db, options = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const wrap = (fn) => (req, res, next) => {
    try {
      Promise.resolve(fn(req, res, next)).catch((err) => {
        res.status(400).json({ error: err.message || 'Operation failed' });
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Operation failed' });
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, company: COMPANY_PROFILE });
  });

  // Master Data & Live Dashboard State
  app.get(
    '/api/bootstrap',
    wrap((_req, res) => {
      const rawMaterials = db.prepare(`SELECT * FROM raw_materials ORDER BY id`).all();
      const finishedGoods = db.prepare(`SELECT * FROM finished_goods ORDER BY id`).all();
      const finishedGoodsWithCost = finishedGoods.map((fg) => {
        const std = getStandardCostBreakdown(db, fg.id);
        const pendingRow = db
          .prepare(
            `SELECT COALESCE(SUM(soi.approved_qty), 0) as reserved
             FROM sales_order_items soi
             JOIN sales_orders so ON so.id = soi.order_id
             WHERE soi.finished_good_id = ? AND so.status IN ('PENDING_VERIFICATION', 'VERIFIED')`
          )
          .get(fg.id);
        return {
          ...fg,
          stdMaterialCostPerPkt: std.stdMaterialCostPerPkt,
          stdTotalCostPerPkt: std.stdTotalCostPerPkt,
          committedQty: pendingRow.reserved,
          freeStock: fg.current_stock - pendingRow.reserved,
          bom: std.bom,
        };
      });

      const salesmen = db.prepare(`SELECT * FROM salesmen ORDER BY id`).all();
      const customers = db
        .prepare(
          `SELECT c.*, s.name as salesman_name,
                  COALESCE((SELECT SUM(grand_total - paid_amount) FROM invoices WHERE customer_id = c.id AND status != 'PAID'), 0) as outstanding
           FROM customers c
           LEFT JOIN salesmen s ON s.id = c.salesman_id
           ORDER BY c.id`
        )
        .all();
      const suppliers = db.prepare(`SELECT * FROM suppliers ORDER BY id`).all();

      const orders = db
        .prepare(
          `SELECT so.*, s.name as salesman_name, c.name as customer_name, c.type as customer_type,
                  c.city as customer_city, c.state_code, c.gstin as customer_gstin,
                  inv.id as invoice_id, inv.invoice_no, inv.grand_total as invoice_total
           FROM sales_orders so
           JOIN salesmen s ON s.id = so.salesman_id
           JOIN customers c ON c.id = so.customer_id
           LEFT JOIN invoices inv ON inv.order_id = so.id
           ORDER BY so.id DESC`
        )
        .all();

      const orderItems = db
        .prepare(
          `SELECT soi.*, fg.sku, fg.name as fg_name, fg.current_stock as available_stock
           FROM sales_order_items soi
           JOIN finished_goods fg ON fg.id = soi.finished_good_id`
        )
        .all();
      const itemsByOrder = new Map();
      for (const item of orderItems) {
        if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
        itemsByOrder.get(item.order_id).push(item);
      }
      for (const o of orders) {
        o.items = itemsByOrder.get(o.id) || [];
        o.shortStock = o.items.some((it) => it.approved_qty > it.available_stock);
      }

      const batches = db
        .prepare(
          `SELECT pb.*, fg.sku, fg.name as fg_name, fg.conversion_cost_per_pkt
           FROM production_batches pb
           JOIN finished_goods fg ON fg.id = pb.finished_good_id
           ORDER BY pb.id DESC`
        )
        .all();
      const batchMaterials = db
        .prepare(
          `SELECT pbm.*, rm.code, rm.name as rm_name, rm.unit, rm.current_stock as store_stock
           FROM production_batch_materials pbm
           JOIN raw_materials rm ON rm.id = pbm.raw_material_id`
        )
        .all();
      const matByBatch = new Map();
      for (const m of batchMaterials) {
        if (!matByBatch.has(m.batch_id)) matByBatch.set(m.batch_id, []);
        matByBatch.get(m.batch_id).push(m);
      }
      for (const b of batches) {
        b.materials = matByBatch.get(b.id) || [];
      }

      const purchases = db
        .prepare(
          `SELECT p.*, sup.name as supplier_name, rm.code as rm_code, rm.name as rm_name, rm.unit
           FROM raw_material_purchases p
           JOIN suppliers sup ON sup.id = p.supplier_id
           JOIN raw_materials rm ON rm.id = p.raw_material_id
           ORDER BY p.id DESC`
        )
        .all();

      const invoices = db
        .prepare(
          `SELECT inv.*, c.name as customer_name, c.type as customer_type, c.gstin as customer_gstin,
                  c.state_name, s.name as salesman_name,
                  ROUND(inv.grand_total - inv.paid_amount, 2) as balance_due
           FROM invoices inv
           JOIN customers c ON c.id = inv.customer_id
           JOIN salesmen s ON s.id = inv.salesman_id
           ORDER BY inv.id DESC`
        )
        .all();

      const collections = db
        .prepare(
          `SELECT col.*, inv.invoice_no, c.name as customer_name
           FROM collections col
           JOIN invoices inv ON inv.id = col.invoice_id
           JOIN customers c ON c.id = col.customer_id
           ORDER BY col.id DESC`
        )
        .all();

      const auditLogs = db
        .prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 60`)
        .all();

      res.json({
        company: COMPANY_PROFILE,
        rawMaterials,
        finishedGoods: finishedGoodsWithCost,
        salesmen,
        customers,
        suppliers,
        orders,
        batches,
        purchases,
        invoices,
        collections,
        auditLogs,
      });
    })
  );

  // Raw Material Purchases
  app.post(
    '/api/purchases',
    wrap((req, res) => {
      const result = recordRawMaterialPurchase(db, req.body);
      res.status(201).json(result);
    })
  );

  // Update BOM recipe item (allow updating recipe standards)
  app.put(
    '/api/bom/:finishedGoodId',
    wrap((req, res) => {
      const fgId = Number(req.params.finishedGoodId);
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('BOM must have at least one ingredient');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`DELETE FROM bom_items WHERE finished_good_id = ?`).run(fgId);
        const ins = db.prepare(
          `INSERT INTO bom_items (finished_good_id, raw_material_id, qty_per_100_pkts, notes) VALUES (?, ?, ?, ?)`
        );
        for (const it of items) {
          if (Number(it.qty_per_100_pkts) <= 0) {
            throw new Error('Ingredient quantity per 100 packets must be positive');
          }
          ins.run(fgId, Number(it.raw_material_id), Number(it.qty_per_100_pkts), it.notes || '');
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      res.json(getStandardCostBreakdown(db, fgId));
    })
  );

  // Production Batches
  app.post(
    '/api/batches',
    wrap((req, res) => {
      const result = createAndIssueProductionBatch(db, req.body);
      res.status(201).json(result);
    })
  );

  app.post(
    '/api/batches/:id/complete',
    wrap((req, res) => {
      const result = completeProductionBatch(db, Number(req.params.id), req.body);
      res.json(result);
    })
  );

  // Sales Orders -> Verification -> Invoice & Dispatch -> Collections
  app.post(
    '/api/orders',
    wrap((req, res) => {
      const result = createSalesOrder(db, req.body);
      res.status(201).json(result);
    })
  );

  app.post(
    '/api/orders/:id/verify',
    wrap((req, res) => {
      const result = verifySalesOrder(db, Number(req.params.id), req.body || {});
      res.json(result);
    })
  );

  app.post(
    '/api/orders/:id/dispatch',
    wrap((req, res) => {
      const invoiceDate = req.body?.invoiceDate || new Date().toISOString().slice(0, 10);
      const result = dispatchAndInvoiceOrder(db, Number(req.params.id), {
        invoiceDate,
        actor: req.body?.actor,
      });
      res.json(result);
    })
  );

  app.post(
    '/api/orders/:id/cancel',
    wrap((req, res) => {
      const result = cancelSalesOrder(db, Number(req.params.id), req.body?.actor);
      res.json(result);
    })
  );

  app.get(
    '/api/invoices/:id',
    wrap((req, res) => {
      const inv = db
        .prepare(
          `SELECT inv.*, c.name as customer_name, c.type as customer_type, c.gstin as customer_gstin,
                  c.city, c.state_name, c.state_code, s.name as salesman_name, so.order_no
           FROM invoices inv
           JOIN customers c ON c.id = inv.customer_id
           JOIN salesmen s ON s.id = inv.salesman_id
           JOIN sales_orders so ON so.id = inv.order_id
           WHERE inv.id = ?`
        )
        .get(Number(req.params.id));
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
      const items = db
        .prepare(
          `SELECT ii.*, fg.sku, fg.name as fg_name, fg.pack_grams
           FROM invoice_items ii
           JOIN finished_goods fg ON fg.id = ii.finished_good_id
           WHERE ii.invoice_id = ?`
        )
        .all(inv.id);
      const payments = db
        .prepare(`SELECT * FROM collections WHERE invoice_id = ? ORDER BY payment_date, id`)
        .all(inv.id);
      res.json({ company: COMPANY_PROFILE, invoice: inv, items, payments });
    })
  );

  app.post(
    '/api/collections',
    wrap((req, res) => {
      const result = recordCollection(db, req.body);
      res.status(201).json(result);
    })
  );

  // Stock Ledgers (Raw Material & Finished Goods drilldown)
  app.get(
    '/api/ledgers/finished/:id',
    wrap((req, res) => {
      const rows = db
        .prepare(
          `SELECT * FROM finished_goods_ledger WHERE finished_good_id = ? ORDER BY txn_date DESC, id DESC`
        )
        .all(Number(req.params.id));
      res.json(rows);
    })
  );

  app.get(
    '/api/ledgers/raw/:id',
    wrap((req, res) => {
      const rows = db
        .prepare(
          `SELECT * FROM raw_material_ledger WHERE raw_material_id = ? ORDER BY txn_date DESC, id DESC`
        )
        .all(Number(req.params.id));
      res.json(rows);
    })
  );

  // Monthly Auditor Report
  app.get(
    '/api/reports/monthly',
    wrap((req, res) => {
      const month = String(req.query.month || '2026-11');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new Error('month query parameter must be YYYY-MM');
      }
      res.json(buildMonthlyAuditReport(db, month));
    })
  );

  // CSV Exports for Auditor (GSTR-1 Sales, Stock Reconciliation, Production Variance)
  app.get(
    '/api/reports/export',
    wrap((req, res) => {
      const month = String(req.query.month || '2026-11');
      const type = String(req.query.type || 'gstr1');
      const report = buildMonthlyAuditReport(db, month);

      const esc = (v) => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const toCsv = (headers, rows) =>
        [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');

      let csv = '';
      let filename = `audit-${type}-${month}.csv`;

      if (type === 'gstr1') {
        csv = toCsv(
          [
            'Invoice No',
            'Date',
            'Customer',
            'GSTIN',
            'Category',
            'Supply Type',
            'Taxable Value',
            'CGST',
            'SGST',
            'IGST',
            'Grand Total',
            'Paid',
            'Status',
          ],
          report.gst.invoices.map((i) => [
            i.invoice_no,
            i.invoice_date,
            i.customer_name,
            i.customer_gstin || 'UNREGISTERED',
            i.gst_category,
            i.supply_type,
            i.taxable_amount,
            i.cgst_amount,
            i.sgst_amount,
            i.igst_amount,
            i.grand_total,
            i.paid_amount,
            i.status,
          ])
        );
      } else if (type === 'stock') {
        csv = toCsv(
          [
            'Type',
            'Code/SKU',
            'Item Name',
            'Opening',
            'Inward (Purchase/Prod)',
            'Outward (Issue/Sales)',
            'Return/Adjust',
            'Expected Closing',
            'Unit/Avg Cost',
            'Closing Value',
          ],
          [
            ...report.fgReconciliation.map((f) => [
              'Finished Good',
              f.sku,
              f.name,
              f.openingQty,
              f.productionInQty,
              f.salesOutQty,
              f.auditAdjustQty,
              f.expectedClosingQty,
              f.avgCostPerPkt,
              f.closingStockValue,
            ]),
            ...report.rmReconciliation.map((r) => [
              'Raw Material',
              r.code,
              r.name,
              r.openingQty,
              r.purchasedQty,
              r.issuedQty,
              r.returnedQty,
              r.expectedClosingQty,
              r.avgCost,
              r.closingStockValue,
            ]),
          ]
        );
      } else if (type === 'variance') {
        csv = toCsv(
          [
            'Batch No',
            'Date',
            'SKU',
            'Target Pkts',
            'Actual Good Pkts',
            'Rejected Pkts',
            'Yield %',
            'Std Cost/Pkt',
            'Actual Cost/Pkt',
            'Material Variance (INR)',
            'Total Batch Cost',
          ],
          report.batches.map((b) => [
            b.batch_no,
            b.batch_date,
            b.sku,
            b.target_packets,
            b.actual_good_packets ?? '',
            b.rejected_packets,
            b.yield_pct,
            b.standard_cost_per_pkt,
            b.actual_cost_per_pkt,
            b.total_variance_cost,
            b.total_batch_cost,
          ])
        );
      } else {
        throw new Error('Unknown export type. Use gstr1, stock, or variance.');
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    })
  );

  // Serve built frontend in production if present
  if (options.distDir && fs.existsSync(options.distDir)) {
    app.use(express.static(options.distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(options.distDir, 'index.html'));
    });
  }

  return app;
}
