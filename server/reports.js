import { round2, round3 } from './ledger.js';

/**
 * Generates the Month-End Auditor & Management Report for a given YYYY-MM month.
 * Every number is derived directly from immutable ledgers and transaction tables.
 */
export function buildMonthlyAuditReport(db, month /* e.g. '2026-11' */) {
  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const nextMonthDate = new Date(Date.UTC(y, m, 1));
  const nextMonthStart = nextMonthDate.toISOString().slice(0, 10);

  // 1. Finished Goods Monthly Stock Reconciliation: Opening + Production IN - Sales Dispatch = Closing
  const fgList = db.prepare(`SELECT * FROM finished_goods ORDER BY id`).all();
  const fgReconciliation = fgList.map((fg) => {
    const before = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in - qty_out), 0) as qty
         FROM finished_goods_ledger
         WHERE finished_good_id = ? AND txn_date < ?`
      )
      .get(fg.id, monthStart).qty;

    const prodIn = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in), 0) as qty, COALESCE(SUM(value_amount), 0) as val
         FROM finished_goods_ledger
         WHERE finished_good_id = ? AND txn_type = 'PRODUCTION_IN' AND txn_date >= ? AND txn_date < ?`
      )
      .get(fg.id, monthStart, nextMonthStart);

    const salesOut = db
      .prepare(
        `SELECT COALESCE(SUM(qty_out), 0) as qty, COALESCE(SUM(value_amount), 0) as val
         FROM finished_goods_ledger
         WHERE finished_good_id = ? AND txn_type = 'SALES_DISPATCH' AND txn_date >= ? AND txn_date < ?`
      )
      .get(fg.id, monthStart, nextMonthStart);

    const adjust = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in - qty_out), 0) as qty
         FROM finished_goods_ledger
         WHERE finished_good_id = ? AND txn_type = 'AUDIT_ADJUST' AND txn_date >= ? AND txn_date < ?`
      )
      .get(fg.id, monthStart, nextMonthStart).qty;

    const closingQty = before + prodIn.qty - salesOut.qty + adjust;
    const closingValue = round2(closingQty * fg.avg_cost_per_pkt);

    return {
      id: fg.id,
      sku: fg.sku,
      name: fg.name,
      category: fg.category,
      openingQty: before,
      productionInQty: prodIn.qty,
      productionInValue: round2(prodIn.val),
      salesOutQty: salesOut.qty,
      cogsValue: round2(salesOut.val),
      auditAdjustQty: adjust,
      expectedClosingQty: closingQty,
      liveCurrentStock: fg.current_stock,
      avgCostPerPkt: fg.avg_cost_per_pkt,
      closingStockValue: closingValue,
    };
  });

  // 2. Raw Materials Monthly Stock Reconciliation: Opening + Purchases - Issued + Returned = Closing
  const rmList = db.prepare(`SELECT * FROM raw_materials ORDER BY id`).all();
  const rmReconciliation = rmList.map((rm) => {
    const opening = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in - qty_out), 0) as qty
         FROM raw_material_ledger
         WHERE raw_material_id = ? AND txn_date < ?`
      )
      .get(rm.id, monthStart).qty;

    const purchased = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in), 0) as qty, COALESCE(SUM(value_amount), 0) as val
         FROM raw_material_ledger
         WHERE raw_material_id = ? AND txn_type = 'PURCHASE' AND txn_date >= ? AND txn_date < ?`
      )
      .get(rm.id, monthStart, nextMonthStart);

    const issued = db
      .prepare(
        `SELECT COALESCE(SUM(qty_out), 0) as qty, COALESCE(SUM(value_amount), 0) as val
         FROM raw_material_ledger
         WHERE raw_material_id = ? AND txn_type = 'ISSUE_TO_PROD' AND txn_date >= ? AND txn_date < ?`
      )
      .get(rm.id, monthStart, nextMonthStart);

    const returned = db
      .prepare(
        `SELECT COALESCE(SUM(qty_in), 0) as qty, COALESCE(SUM(value_amount), 0) as val
         FROM raw_material_ledger
         WHERE raw_material_id = ? AND txn_type = 'RETURN_FROM_PROD' AND txn_date >= ? AND txn_date < ?`
      )
      .get(rm.id, monthStart, nextMonthStart);

    const closingQty = round3(opening + purchased.qty - issued.qty + returned.qty);
    const closingValue = round2(closingQty * rm.avg_cost);

    return {
      id: rm.id,
      code: rm.code,
      name: rm.name,
      unit: rm.unit,
      openingQty: round3(opening),
      purchasedQty: round3(purchased.qty),
      purchasedValue: round2(purchased.val),
      issuedQty: round3(issued.qty),
      returnedQty: round3(returned.qty),
      netConsumedQty: round3(issued.qty - returned.qty),
      expectedClosingQty: closingQty,
      liveCurrentStock: round3(rm.current_stock),
      avgCost: rm.avg_cost,
      closingStockValue: closingValue,
    };
  });

  // 3. Production & Variance Summary for the Month
  const batches = db
    .prepare(
      `SELECT pb.*, fg.sku, fg.name as fg_name, fg.distributor_rate, fg.retailer_rate
       FROM production_batches pb
       JOIN finished_goods fg ON fg.id = pb.finished_good_id
       WHERE pb.batch_date >= ? AND pb.batch_date < ?
       ORDER BY pb.batch_date DESC, pb.id DESC`
    )
    .all(monthStart, nextMonthStart);

  const completedBatches = batches.filter((b) => b.status === 'COMPLETED');
  const totalProducedPkts = completedBatches.reduce((s, b) => s + (b.actual_good_packets || 0), 0);
  const totalRejectedPkts = completedBatches.reduce((s, b) => s + (b.rejected_packets || 0), 0);
  const totalProductionCost = round2(
    completedBatches.reduce((s, b) => s + (b.total_batch_cost || 0), 0)
  );
  const totalMaterialVarianceCost = round2(
    completedBatches.reduce((s, b) => s + (b.total_variance_cost || 0), 0)
  );

  // Material-level variance rollup across completed batches in the month
  const materialVariances = db
    .prepare(
      `SELECT rm.code, rm.name, rm.unit,
              ROUND(SUM(pbm.std_qty_for_actual_output), 3) as total_std_qty,
              ROUND(SUM(pbm.actual_consumed_qty), 3) as total_actual_qty,
              ROUND(SUM(pbm.variance_qty), 3) as total_variance_qty,
              ROUND(SUM(pbm.variance_cost), 2) as total_variance_cost
       FROM production_batch_materials pbm
       JOIN production_batches pb ON pb.id = pbm.batch_id
       JOIN raw_materials rm ON rm.id = pbm.raw_material_id
       WHERE pb.status = 'COMPLETED' AND pb.batch_date >= ? AND pb.batch_date < ?
       GROUP BY rm.id
       ORDER BY total_variance_cost DESC`
    )
    .all(monthStart, nextMonthStart);

  // SKU Costing & Margin Summary
  const skuCosting = fgList.map((fg) => {
    const skuBatches = completedBatches.filter((b) => b.finished_good_id === fg.id);
    const produced = skuBatches.reduce((s, b) => s + (b.actual_good_packets || 0), 0);
    const totalCost = skuBatches.reduce((s, b) => s + (b.total_batch_cost || 0), 0);
    const avgBatchCost = produced > 0 ? round2(totalCost / produced) : fg.avg_cost_per_pkt;

    const salesRow = db
      .prepare(
        `SELECT COALESCE(SUM(ii.qty), 0) as sold_qty,
                COALESCE(SUM(ii.taxable_amount), 0) as revenue,
                COALESCE(SUM(ii.cogs_total), 0) as cogs
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         WHERE ii.finished_good_id = ? AND inv.invoice_date >= ? AND inv.invoice_date < ?`
      )
      .get(fg.id, monthStart, nextMonthStart);

    const avgSellingPrice =
      salesRow.sold_qty > 0 ? round2(salesRow.revenue / salesRow.sold_qty) : fg.distributor_rate;
    const grossMarginPerPkt = round2(avgSellingPrice - avgBatchCost);
    const grossMarginPct =
      avgSellingPrice > 0 ? round2((grossMarginPerPkt / avgSellingPrice) * 100) : 0;

    return {
      sku: fg.sku,
      name: fg.name,
      mrp: fg.mrp,
      distributorRate: fg.distributor_rate,
      retailerRate: fg.retailer_rate,
      producedPktsInMonth: produced,
      actualCostPerPkt: avgBatchCost,
      soldPktsInMonth: salesRow.sold_qty,
      revenueExGst: round2(salesRow.revenue),
      cogsTotal: round2(salesRow.cogs),
      avgSellingPrice,
      grossMarginPerPkt,
      grossMarginPct,
    };
  });

  // 4. GST Summary (GSTR-1 Output GST & GSTR-3B Input Tax Credit)
  const invoiceRows = db
    .prepare(
      `SELECT inv.*, c.name as customer_name, c.gstin as customer_gstin, c.state_name, s.name as salesman_name
       FROM invoices inv
       JOIN customers c ON c.id = inv.customer_id
       JOIN salesmen s ON s.id = inv.salesman_id
       WHERE inv.invoice_date >= ? AND inv.invoice_date < ?
       ORDER BY inv.invoice_date, inv.id`
    )
    .all(monthStart, nextMonthStart);

  const outputGst = {
    invoiceCount: invoiceRows.length,
    b2bCount: invoiceRows.filter((i) => i.gst_category === 'B2B').length,
    b2cCount: invoiceRows.filter((i) => i.gst_category === 'B2C').length,
    taxableAmount: round2(invoiceRows.reduce((s, i) => s + i.taxable_amount, 0)),
    cgst: round2(invoiceRows.reduce((s, i) => s + i.cgst_amount, 0)),
    sgst: round2(invoiceRows.reduce((s, i) => s + i.sgst_amount, 0)),
    igst: round2(invoiceRows.reduce((s, i) => s + i.igst_amount, 0)),
    grandTotal: round2(invoiceRows.reduce((s, i) => s + i.grand_total, 0)),
  };
  outputGst.totalGst = round2(outputGst.cgst + outputGst.sgst + outputGst.igst);

  const hsnSummary = db
    .prepare(
      `SELECT ii.hsn_code, ii.gst_rate,
              SUM(ii.qty) as total_qty,
              ROUND(SUM(ii.taxable_amount), 2) as taxable_value,
              ROUND(SUM(ii.cgst_amount), 2) as cgst,
              ROUND(SUM(ii.sgst_amount), 2) as sgst,
              ROUND(SUM(ii.igst_amount), 2) as igst,
              ROUND(SUM(ii.line_total), 2) as total_value
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       WHERE inv.invoice_date >= ? AND inv.invoice_date < ?
       GROUP BY ii.hsn_code, ii.gst_rate`
    )
    .all(monthStart, nextMonthStart);

  const purchaseRows = db
    .prepare(
      `SELECT p.*, sup.name as supplier_name, sup.gstin as supplier_gstin, rm.name as material_name, rm.unit
       FROM raw_material_purchases p
       JOIN suppliers sup ON sup.id = p.supplier_id
       JOIN raw_materials rm ON rm.id = p.raw_material_id
       WHERE p.bill_date >= ? AND p.bill_date < ?
       ORDER BY p.bill_date, p.id`
    )
    .all(monthStart, nextMonthStart);

  const inputItc = {
    billCount: purchaseRows.length,
    taxableAmount: round2(purchaseRows.reduce((s, p) => s + p.taxable_value, 0)),
    cgst: round2(purchaseRows.reduce((s, p) => s + p.cgst_amount, 0)),
    sgst: round2(purchaseRows.reduce((s, p) => s + p.sgst_amount, 0)),
    igst: round2(purchaseRows.reduce((s, p) => s + p.igst_amount, 0)),
    totalPurchaseValue: round2(purchaseRows.reduce((s, p) => s + p.total_amount, 0)),
  };
  inputItc.totalItc = round2(inputItc.cgst + inputItc.sgst + inputItc.igst);

  const netGstPayable = round2(outputGst.totalGst - inputItc.totalItc);

  // 5. Collections & Receivables Summary
  const collectionRows = db
    .prepare(
      `SELECT col.*, inv.invoice_no, c.name as customer_name
       FROM collections col
       JOIN invoices inv ON inv.id = col.invoice_id
       JOIN customers c ON c.id = col.customer_id
       WHERE col.payment_date >= ? AND col.payment_date < ?
       ORDER BY col.payment_date DESC, col.id DESC`
    )
    .all(monthStart, nextMonthStart);

  const totalCollectedInMonth = round2(collectionRows.reduce((s, c) => s + c.amount, 0));

  // Overall open receivables (as of end of report / current)
  const openReceivables = db
    .prepare(
      `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.due_date, inv.grand_total, inv.paid_amount,
              ROUND(inv.grand_total - inv.paid_amount, 2) as balance_due,
              inv.status, c.name as customer_name, c.type as customer_type, s.name as salesman_name
       FROM invoices inv
       JOIN customers c ON c.id = inv.customer_id
       JOIN salesmen s ON s.id = inv.salesman_id
       WHERE inv.status != 'PAID'
       ORDER BY inv.due_date ASC`
    )
    .all();

  const totalReceivableOutstanding = round2(
    openReceivables.reduce((s, r) => s + r.balance_due, 0)
  );

  // Salesman-wise performance for the month
  const salesmanPerformance = db
    .prepare(
      `SELECT s.id, s.name, s.territory,
              COUNT(DISTINCT inv.id) as invoice_count,
              ROUND(COALESCE(SUM(inv.taxable_amount), 0), 2) as net_sales,
              ROUND(COALESCE(SUM(inv.grand_total), 0), 2) as gross_billed,
              ROUND(COALESCE((
                SELECT SUM(col.amount)
                FROM collections col
                JOIN invoices i2 ON i2.id = col.invoice_id
                WHERE i2.salesman_id = s.id AND col.payment_date >= ? AND col.payment_date < ?
              ), 0), 2) as collected_in_month
       FROM salesmen s
       LEFT JOIN invoices inv ON inv.salesman_id = s.id AND inv.invoice_date >= ? AND inv.invoice_date < ?
       GROUP BY s.id
       ORDER BY gross_billed DESC`
    )
    .all(monthStart, nextMonthStart, monthStart, nextMonthStart);

  // 6. P&L Snapshot for Month
  const totalCogs = round2(
    db
      .prepare(
        `SELECT COALESCE(SUM(ii.cogs_total), 0) as cogs
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         WHERE inv.invoice_date >= ? AND inv.invoice_date < ?`
      )
      .get(monthStart, nextMonthStart).cogs
  );
  const grossProfit = round2(outputGst.taxableAmount - totalCogs);
  const grossProfitPct =
    outputGst.taxableAmount > 0 ? round2((grossProfit / outputGst.taxableAmount) * 100) : 0;

  return {
    month,
    monthStart,
    nextMonthStart,
    kpis: {
      netRevenueExGst: outputGst.taxableAmount,
      grossBilledInclGst: outputGst.grandTotal,
      totalCogs,
      grossProfit,
      grossProfitPct,
      totalProducedPkts,
      totalRejectedPkts,
      totalProductionCost,
      totalMaterialVarianceCost,
      outputGstTotal: outputGst.totalGst,
      inputItcTotal: inputItc.totalItc,
      netGstPayable,
      totalCollectedInMonth,
      totalReceivableOutstanding,
      closingFgValue: round2(fgReconciliation.reduce((s, r) => s + r.closingStockValue, 0)),
      closingRmValue: round2(rmReconciliation.reduce((s, r) => s + r.closingStockValue, 0)),
    },
    fgReconciliation,
    rmReconciliation,
    batches,
    materialVariances,
    skuCosting,
    gst: {
      outputGst,
      inputItc,
      netGstPayable,
      hsnSummary,
      invoices: invoiceRows,
      purchases: purchaseRows,
    },
    collections: collectionRows,
    openReceivables,
    salesmanPerformance,
  };
}
