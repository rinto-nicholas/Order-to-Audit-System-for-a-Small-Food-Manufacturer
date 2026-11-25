import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { initDatabase } from '../server/db.js';
import { seedDatabase } from '../server/seed.js';
import { createApp } from '../server/app.js';
import {
  recordRawMaterialPurchase,
  createAndIssueProductionBatch,
  completeProductionBatch,
  createSalesOrder,
  verifySalesOrder,
  dispatchAndInvoiceOrder,
  recordCollection,
  round2,
  round3,
} from '../server/ledger.js';
import { buildMonthlyAuditReport } from '../server/reports.js';

function setupTestDb() {
  const db = initDatabase(':memory:');
  seedDatabase(db);
  return db;
}

test('Seeded database satisfies Opening + In - Out = Closing for both loops', () => {
  const db = setupTestDb();
  const report = buildMonthlyAuditReport(db, '2026-11');

  for (const fg of report.fgReconciliation) {
    assert.equal(
      fg.openingQty + fg.productionInQty - fg.salesOutQty + fg.auditAdjustQty,
      fg.expectedClosingQty,
      `FG equation mismatch for ${fg.sku}`
    );
    assert.equal(fg.expectedClosingQty, fg.liveCurrentStock, `FG live stock mismatch for ${fg.sku}`);
  }

  for (const rm of report.rmReconciliation) {
    const computed = round3(rm.openingQty + rm.purchasedQty - rm.issuedQty + rm.returnedQty);
    assert.equal(computed, rm.expectedClosingQty, `RM equation mismatch for ${rm.code}`);
    assert.ok(
      Math.abs(rm.expectedClosingQty - rm.liveCurrentStock) < 0.01,
      `RM live stock mismatch for ${rm.code}`
    );
  }
});

test('Production loop: Purchase updates WAC, batch variance & cost per packet flow into FG stock', () => {
  const db = setupTestDb();
  const rmOilBefore = db.prepare(`SELECT * FROM raw_materials WHERE code = 'RM-OIL'`).get();
  const fgMrkBefore = db.prepare(`SELECT * FROM finished_goods WHERE sku = 'MRK-200'`).get();
  const supplier = db.prepare(`SELECT id FROM suppliers LIMIT 1`).get();

  // 1. Purchase 100L oil @ 150/L -> WAC should increase
  const p = recordRawMaterialPurchase(db, {
    billNo: 'TEST/OIL/01',
    billDate: '2026-11-25',
    supplierId: supplier.id,
    rawMaterialId: rmOilBefore.id,
    qty: 100,
    unitRate: 150,
  });

  const expectedOilStock = round3(rmOilBefore.current_stock + 100);
  const expectedOilWac = round2(
    (rmOilBefore.current_stock * rmOilBefore.avg_cost + 100 * 150) / expectedOilStock
  );
  assert.equal(p.newStock, expectedOilStock);
  assert.equal(p.newAvgCost, expectedOilWac);
  assert.equal(p.itc, 750); // 5% GST on 15,000

  // 2. Start batch of 200 pkts Kai Murukku (BOM oil = 4.2L / 100 pkts => 8.4L planned)
  const batch = createAndIssueProductionBatch(db, {
    batchDate: '2026-11-25',
    finishedGoodId: fgMrkBefore.id,
    targetPackets: 200,
  });

  const rmOilMid = db.prepare(`SELECT * FROM raw_materials WHERE id = ?`).get(rmOilBefore.id);
  assert.equal(rmOilMid.current_stock, round3(expectedOilStock - 8.4));

  // 3. Complete batch: 190 good pkts, 10 rejected.
  // Oil actual consumed = 9.5L (std for 190 pkts = 4.2 * 1.9 = 7.98L => +1.52L adverse variance!)
  // Rice flour returned = 1.5kg unused (issued 27kg for 200, std for 190 = 25.65kg, consumed 25.5kg => -0.15kg favorable!)
  const rmRice = db.prepare(`SELECT * FROM raw_materials WHERE code = 'RM-RICE'`).get();
  const done = completeProductionBatch(db, batch.batchId, {
    completionDate: '2026-11-25',
    actualGoodPackets: 190,
    rejectedPackets: 10,
    materialActuals: [
      { rawMaterialId: rmOilBefore.id, actualConsumedQty: 9.5, reason: 'Fryer temperature spike' },
      { rawMaterialId: rmRice.id, returnedQty: 1.5, reason: 'Unused flour returned to store' },
    ],
  });

  assert.equal(done.newFinishedStock, fgMrkBefore.current_stock + 190);
  assert.equal(done.yieldPct, 95);
  assert.ok(done.actualCostPerPkt > 0);
  assert.ok(done.totalVarianceCost > 0, 'Overall variance should be adverse due to extra oil');

  const oilMatRow = db
    .prepare(
      `SELECT * FROM production_batch_materials WHERE batch_id = ? AND raw_material_id = ?`
    )
    .get(batch.batchId, rmOilBefore.id);
  assert.equal(oilMatRow.std_qty_for_actual_output, 7.98);
  assert.equal(oilMatRow.actual_consumed_qty, 9.5);
  assert.equal(oilMatRow.variance_qty, 1.52);
});

test('Sales loop: Order -> Verify -> Dispatch enforces stock check, calculates GST (INTRA vs INTER), and records collection', () => {
  const db = setupTestDb();
  const salesman = db.prepare(`SELECT id FROM salesmen LIMIT 1`).get();
  const intraCust = db.prepare(`SELECT * FROM customers WHERE state_code = '33' AND gstin != '' LIMIT 1`).get();
  const interCust = db.prepare(`SELECT * FROM customers WHERE state_code = '29' LIMIT 1`).get();
  const fg = db.prepare(`SELECT * FROM finished_goods WHERE sku = 'MIX-250'`).get();

  // Attempt to dispatch more than available stock must fail cleanly without mutating stock
  const hugeOrd = createSalesOrder(db, {
    orderDate: '2026-11-25',
    salesmanId: salesman.id,
    customerId: intraCust.id,
    items: [{ finishedGoodId: fg.id, qty: fg.current_stock + 500 }],
  });
  verifySalesOrder(db, hugeOrd.orderId, {});
  assert.throws(
    () => dispatchAndInvoiceOrder(db, hugeOrd.orderId, { invoiceDate: '2026-11-25' }),
    /Insufficient finished stock/
  );

  // Valid inter-state order -> IGST (no CGST/SGST)
  const ord = createSalesOrder(db, {
    orderDate: '2026-11-25',
    salesmanId: salesman.id,
    customerId: interCust.id,
    items: [{ finishedGoodId: fg.id, qty: 50 }],
  });
  verifySalesOrder(db, ord.orderId, {
    approvedItems: [{ finishedGoodId: fg.id, approvedQty: 40 }],
  });
  const inv = dispatchAndInvoiceOrder(db, ord.orderId, { invoiceDate: '2026-11-25' });

  assert.equal(inv.supplyType, 'INTER');
  assert.equal(inv.gstCategory, 'B2B');

  const invRow = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(inv.invoiceId);
  assert.equal(invRow.cgst_amount, 0);
  assert.equal(invRow.sgst_amount, 0);
  assert.ok(invRow.igst_amount > 0);

  const fgAfter = db.prepare(`SELECT current_stock FROM finished_goods WHERE id = ?`).get(fg.id);
  assert.equal(fgAfter.current_stock, fg.current_stock - 40);

  // Partial & full collection
  const part = recordCollection(db, {
    invoiceId: inv.invoiceId,
    paymentDate: '2026-11-25',
    amount: 1000,
    mode: 'NEFT',
  });
  assert.equal(part.status, 'PARTIAL');

  const full = recordCollection(db, {
    invoiceId: inv.invoiceId,
    paymentDate: '2026-11-26',
    amount: round2(invRow.grand_total - 1000),
    mode: 'UPI',
  });
  assert.equal(full.status, 'PAID');
});

function invokeExpress(app, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const rawBody = body !== null ? Buffer.from(JSON.stringify(body)) : null;
    const req = Readable.from(rawBody ? [rawBody] : []);
    req.method = method;
    req.url = url;
    req.headers = rawBody
      ? { 'content-type': 'application/json', 'content-length': String(rawBody.length) }
      : {};
    req.connection = {};

    const chunks = [];
    const headers = {};
    const res = new EventEmitter();
    res.statusCode = 200;
    res.locals = {};
    res.setHeader = (k, v) => {
      headers[k.toLowerCase()] = v;
    };
    res.getHeader = (k) => headers[k.toLowerCase()];
    res.removeHeader = (k) => {
      delete headers[k.toLowerCase()];
    };
    res.hasHeader = (k) => k.toLowerCase() in headers;
    res.writeHead = (code, hdrs) => {
      res.statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = v;
      }
      return res;
    };
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      res.finished = true;
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers,
        text: Buffer.concat(chunks).toString('utf8'),
      });
    };

    app(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

test('Express API endpoints: bootstrap, monthly report, and CSV export', async () => {
  const db = setupTestDb();
  const app = createApp(db);

  const bootRes = await invokeExpress(app, 'GET', '/api/bootstrap');
  assert.equal(bootRes.status, 200, bootRes.text);
  const boot = JSON.parse(bootRes.text);
  assert.ok(boot.rawMaterials.length >= 10);
  assert.ok(boot.finishedGoods.length >= 4);
  assert.ok(boot.orders.length > 0);
  assert.ok(boot.batches.length > 0);

  const repRes = await invokeExpress(app, 'GET', '/api/reports/monthly?month=2026-11');
  assert.equal(repRes.status, 200, repRes.text);
  const rep = JSON.parse(repRes.text);
  assert.equal(rep.month, '2026-11');
  assert.ok(rep.kpis.netRevenueExGst > 0);
  assert.ok(rep.gst.hsnSummary.length > 0);

  const csvRes = await invokeExpress(app, 'GET', '/api/reports/export?month=2026-11&type=gstr1');
  assert.equal(csvRes.status, 200, csvRes.text);
  assert.match(csvRes.text, /Invoice No,Date,Customer/);
});
