import { COMPANY_PROFILE } from './db.js';

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback error if transaction wasn't active
    }
    throw err;
  }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function nextSequenceNumber(db, table, col, prefix) {
  const row = db
    .prepare(`SELECT ${col} as val FROM ${table} WHERE ${col} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}%`);
  if (!row || !row.val) return `${prefix}001`;
  const parts = row.val.split('-');
  const lastNum = Number(parts[parts.length - 1]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
}

function nextInvoiceNumber(db, dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  const fyStart = month >= 4 ? year % 100 : (year - 1) % 100;
  const fyEnd = (fyStart + 1) % 100;
  const prefix = `INV/${String(fyStart).padStart(2, '0')}-${String(fyEnd).padStart(2, '0')}/`;
  const row = db
    .prepare(`SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}%`);
  if (!row) return `${prefix}0001`;
  const last = Number(row.invoice_no.split('/').pop()) || 0;
  return `${prefix}${String(last + 1).padStart(4, '0')}`;
}

export function logAudit(db, actor, action, entityType, entityId, summary) {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?)`
  ).run(actor, action, entityType, entityId ?? null, summary);
}

/**
 * Compute current standard material & total cost per packet for a finished good
 * using current raw material moving average costs and active BOM.
 */
export function getStandardCostBreakdown(db, finishedGoodId) {
  const fg = db.prepare(`SELECT * FROM finished_goods WHERE id = ?`).get(finishedGoodId);
  if (!fg) throw new Error(`Finished good ${finishedGoodId} not found`);
  const bom = db
    .prepare(
      `SELECT b.*, rm.code, rm.name, rm.unit, rm.avg_cost, rm.current_stock
       FROM bom_items b
       JOIN raw_materials rm ON rm.id = b.raw_material_id
       WHERE b.finished_good_id = ?
       ORDER BY rm.id`
    )
    .all(finishedGoodId);

  let materialCostPer100 = 0;
  for (const item of bom) {
    materialCostPer100 += item.qty_per_100_pkts * item.avg_cost;
  }
  const stdMaterialCostPerPkt = round2(materialCostPer100 / 100);
  const stdConversionPerPkt = round2(fg.conversion_cost_per_pkt);
  const stdTotalCostPerPkt = round2(stdMaterialCostPerPkt + stdConversionPerPkt);

  return {
    finishedGood: fg,
    bom,
    stdMaterialCostPerPkt,
    stdConversionPerPkt,
    stdTotalCostPerPkt,
  };
}

/**
 * Record a Raw Material Purchase (GRN / Supplier Bill).
 * Single entry updates: Purchase record, Raw Material stock & Moving Weighted Avg Cost,
 * Raw Material Ledger (IN), Input Tax Credit (ITC), and Audit Log.
 */
export function recordRawMaterialPurchase(
  db,
  { billNo, billDate, supplierId, rawMaterialId, qty, unitRate, notes = '', actor = 'Admin Desk' }
) {
  if (qty <= 0 || unitRate <= 0) {
    throw new Error('Quantity and unit rate must be positive');
  }

  return withTransaction(db, () => {
    const supplier = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplierId);
    if (!supplier) throw new Error('Supplier not found');
    const rm = db.prepare(`SELECT * FROM raw_materials WHERE id = ?`).get(rawMaterialId);
    if (!rm) throw new Error('Raw material not found');

    const taxableValue = round2(qty * unitRate);
    const isIntra = supplier.state_code === COMPANY_PROFILE.stateCode;
    const gstTotal = round2((taxableValue * rm.gst_rate) / 100);
    const cgst = isIntra ? round2(gstTotal / 2) : 0;
    const sgst = isIntra ? round2(gstTotal - cgst) : 0;
    const igst = isIntra ? 0 : gstTotal;
    const totalAmount = round2(taxableValue + cgst + sgst + igst);

    const existingVal = round2(rm.current_stock * rm.avg_cost);
    const newStock = round3(rm.current_stock + qty);
    const newAvgCost = newStock > 0 ? round2((existingVal + taxableValue) / newStock) : round2(unitRate);

    const purchaseRes = db
      .prepare(
        `INSERT INTO raw_material_purchases
         (bill_no, bill_date, supplier_id, raw_material_id, qty, unit_rate, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        billNo,
        billDate,
        supplierId,
        rawMaterialId,
        round3(qty),
        round2(unitRate),
        taxableValue,
        rm.gst_rate,
        cgst,
        sgst,
        igst,
        totalAmount,
        notes
      );
    const purchaseId = Number(purchaseRes.lastInsertRowid);

    db.prepare(`UPDATE raw_materials SET current_stock = ?, avg_cost = ? WHERE id = ?`).run(
      newStock,
      newAvgCost,
      rawMaterialId
    );

    db.prepare(
      `INSERT INTO raw_material_ledger
       (raw_material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
       VALUES (?, ?, 'PURCHASE', ?, 0, ?, ?, ?, 'PURCHASE', ?, ?)`
    ).run(
      rawMaterialId,
      billDate,
      round3(qty),
      round2(unitRate),
      taxableValue,
      newStock,
      purchaseId,
      `Bill ${billNo} from ${supplier.name}`
    );

    logAudit(
      db,
      actor,
      'RAW_MATERIAL_PURCHASE',
      'raw_material_purchases',
      purchaseId,
      `Purchased ${qty} ${rm.unit} ${rm.name} @ ₹${unitRate} (Bill ${billNo}); WAC updated to ₹${newAvgCost}`
    );

    return {
      purchaseId,
      newStock,
      newAvgCost,
      taxableValue,
      totalAmount,
      itc: round2(cgst + sgst + igst),
    };
  });
}

/**
 * Create a Production Batch & Issue Raw Materials to Production Floor against BOM.
 * If issueOverrides is provided ([{ rawMaterialId, issuedQty }]), uses those exact issued quantities;
 * otherwise issues exact BOM planned quantities for targetPackets.
 */
export function createAndIssueProductionBatch(
  db,
  {
    batchDate,
    finishedGoodId,
    targetPackets,
    issueOverrides = null,
    supervisorNotes = '',
    actor = 'Production Supervisor',
  }
) {
  if (!Number.isInteger(targetPackets) || targetPackets <= 0) {
    throw new Error('Target packets must be a positive integer');
  }

  return withTransaction(db, () => {
    const std = getStandardCostBreakdown(db, finishedGoodId);
    if (std.bom.length === 0) {
      throw new Error(`No Bill of Materials (recipe) configured for ${std.finishedGood.name}`);
    }

    const prefix = `BATCH-${batchDate.slice(0, 7).replace('-', '')}-`;
    const batchNo = nextSequenceNumber(db, 'production_batches', 'batch_no', prefix);

    const overrideMap = new Map();
    if (Array.isArray(issueOverrides)) {
      for (const o of issueOverrides) {
        overrideMap.set(Number(o.rawMaterialId), Number(o.issuedQty));
      }
    }

    const batchRes = db
      .prepare(
        `INSERT INTO production_batches
         (batch_no, batch_date, finished_good_id, target_packets, status, standard_cost_per_pkt, supervisor_notes)
         VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, ?)`
      )
      .run(batchNo, batchDate, finishedGoodId, targetPackets, std.stdTotalCostPerPkt, supervisorNotes);
    const batchId = Number(batchRes.lastInsertRowid);

    for (const item of std.bom) {
      const plannedQty = round3((item.qty_per_100_pkts * targetPackets) / 100);
      const issuedQty = round3(
        overrideMap.has(item.raw_material_id) ? overrideMap.get(item.raw_material_id) : plannedQty
      );
      if (issuedQty < 0) {
        throw new Error(`Issued quantity for ${item.name} cannot be negative`);
      }

      const rm = db.prepare(`SELECT * FROM raw_materials WHERE id = ?`).get(item.raw_material_id);
      if (rm.current_stock + 1e-6 < issuedQty) {
        throw new Error(
          `Insufficient raw material stock for ${rm.name}: available ${rm.current_stock} ${rm.unit}, requested ${issuedQty} ${rm.unit}`
        );
      }

      const newStock = round3(Math.max(0, rm.current_stock - issuedQty));
      const issueValue = round2(issuedQty * rm.avg_cost);

      db.prepare(`UPDATE raw_materials SET current_stock = ? WHERE id = ?`).run(
        newStock,
        item.raw_material_id
      );

      db.prepare(
        `INSERT INTO raw_material_ledger
         (raw_material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
         VALUES (?, ?, 'ISSUE_TO_PROD', 0, ?, ?, ?, ?, 'BATCH', ?, ?)`
      ).run(
        item.raw_material_id,
        batchDate,
        issuedQty,
        rm.avg_cost,
        issueValue,
        newStock,
        batchId,
        `Issued to ${batchNo} (${std.finishedGood.sku})`
      );

      db.prepare(
        `INSERT INTO production_batch_materials
         (batch_id, raw_material_id, planned_qty_for_target, issued_qty, unit_cost_snapshot)
         VALUES (?, ?, ?, ?, ?)`
      ).run(batchId, item.raw_material_id, plannedQty, issuedQty, rm.avg_cost);
    }

    logAudit(
      db,
      actor,
      'PRODUCTION_BATCH_ISSUED',
      'production_batches',
      batchId,
      `Started ${batchNo} for ${targetPackets} pkts of ${std.finishedGood.name} and issued BOM raw materials`
    );

    return { batchId, batchNo };
  });
}

/**
 * Complete a Production Batch:
 * Records actual good packets produced, rejected packets, returned unused materials (or extra consumed),
 * calculates Standard vs Actual Variance per ingredient (qty, ₹, %, reason),
 * computes True Actual Cost per Packet, and adds Good Packets to Finished Goods Stock!
 */
export function completeProductionBatch(
  db,
  batchId,
  {
    completionDate,
    actualGoodPackets,
    rejectedPackets = 0,
    conversionCostOverride = null,
    materialActuals = [], // [{ rawMaterialId, returnedQty?, actualConsumedQty?, extraIssuedQty?, reason? }]
    supervisorNotes = '',
    actor = 'Production Supervisor',
  }
) {
  if (!Number.isInteger(actualGoodPackets) || actualGoodPackets <= 0) {
    throw new Error('Actual good packets must be a positive integer');
  }
  if (!Number.isInteger(rejectedPackets) || rejectedPackets < 0) {
    throw new Error('Rejected packets must be zero or positive');
  }

  return withTransaction(db, () => {
    const batch = db.prepare(`SELECT * FROM production_batches WHERE id = ?`).get(batchId);
    if (!batch) throw new Error('Production batch not found');
    if (batch.status === 'COMPLETED') {
      throw new Error(`Batch ${batch.batch_no} is already completed`);
    }

    const fg = db.prepare(`SELECT * FROM finished_goods WHERE id = ?`).get(batch.finished_good_id);
    const bomRows = db
      .prepare(`SELECT * FROM bom_items WHERE finished_good_id = ?`)
      .all(batch.finished_good_id);
    const bomMap = new Map(bomRows.map((b) => [b.raw_material_id, b]));

    const batchMaterials = db
      .prepare(
        `SELECT pbm.*, rm.name, rm.unit, rm.current_stock, rm.avg_cost
         FROM production_batch_materials pbm
         JOIN raw_materials rm ON rm.id = pbm.raw_material_id
         WHERE pbm.batch_id = ?`
      )
      .all(batchId);

    const actualsMap = new Map();
    for (const m of materialActuals) {
      actualsMap.set(Number(m.rawMaterialId), m);
    }

    let totalMaterialCost = 0;
    let totalVarianceCost = 0;
    let stdMaterialCostForActualOutput = 0;

    for (const pbm of batchMaterials) {
      const input = actualsMap.get(pbm.raw_material_id) || {};
      let returnedQty = round3(Number(input.returnedQty ?? 0));
      let extraIssuedQty = 0;
      let actualConsumed = pbm.issued_qty;

      if (input.actualConsumedQty !== undefined && input.actualConsumedQty !== null) {
        actualConsumed = round3(Number(input.actualConsumedQty));
        if (actualConsumed < 0) {
          throw new Error(`Actual consumed for ${pbm.name} cannot be negative`);
        }
        if (actualConsumed < pbm.issued_qty) {
          returnedQty = round3(pbm.issued_qty - actualConsumed);
        } else if (actualConsumed > pbm.issued_qty) {
          extraIssuedQty = round3(actualConsumed - pbm.issued_qty);
          returnedQty = 0;
        } else {
          returnedQty = 0;
        }
      } else {
        if (returnedQty < 0 || returnedQty > pbm.issued_qty) {
          throw new Error(`Returned qty for ${pbm.name} must be between 0 and issued qty (${pbm.issued_qty})`);
        }
        actualConsumed = round3(pbm.issued_qty - returnedQty);
      }

      // If more was consumed on the floor than originally issued, pull the extra from store stock
      if (extraIssuedQty > 0) {
        const rmNow = db.prepare(`SELECT * FROM raw_materials WHERE id = ?`).get(pbm.raw_material_id);
        if (rmNow.current_stock + 1e-6 < extraIssuedQty) {
          throw new Error(
            `Insufficient store stock for extra ${pbm.name} usage: need ${extraIssuedQty} ${pbm.unit}, available ${rmNow.current_stock}`
          );
        }
        const balAfter = round3(Math.max(0, rmNow.current_stock - extraIssuedQty));
        db.prepare(`UPDATE raw_materials SET current_stock = ? WHERE id = ?`).run(
          balAfter,
          pbm.raw_material_id
        );
        db.prepare(
          `INSERT INTO raw_material_ledger
           (raw_material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
           VALUES (?, ?, 'ISSUE_TO_PROD', 0, ?, ?, ?, ?, 'BATCH', ?, ?)`
        ).run(
          pbm.raw_material_id,
          completionDate,
          extraIssuedQty,
          pbm.unit_cost_snapshot,
          round2(extraIssuedQty * pbm.unit_cost_snapshot),
          balAfter,
          batchId,
          `Additional issue on completion of ${batch.batch_no}`
        );
      }

      // If unused material returned to store, credit raw material stock
      if (returnedQty > 0) {
        const rmNow = db.prepare(`SELECT * FROM raw_materials WHERE id = ?`).get(pbm.raw_material_id);
        const balAfter = round3(rmNow.current_stock + returnedQty);
        db.prepare(`UPDATE raw_materials SET current_stock = ? WHERE id = ?`).run(
          balAfter,
          pbm.raw_material_id
        );
        db.prepare(
          `INSERT INTO raw_material_ledger
           (raw_material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
           VALUES (?, ?, 'RETURN_FROM_PROD', ?, 0, ?, ?, ?, 'BATCH', ?, ?)`
        ).run(
          pbm.raw_material_id,
          completionDate,
          returnedQty,
          pbm.unit_cost_snapshot,
          round2(returnedQty * pbm.unit_cost_snapshot),
          balAfter,
          batchId,
          `Returned unused from ${batch.batch_no}`
        );
      }

      const bomItem = bomMap.get(pbm.raw_material_id);
      const stdQtyForActual = bomItem
        ? round3((bomItem.qty_per_100_pkts * actualGoodPackets) / 100)
        : pbm.planned_qty_for_target;

      const varianceQty = round3(actualConsumed - stdQtyForActual);
      const varianceCost = round2(varianceQty * pbm.unit_cost_snapshot);
      const variancePct =
        stdQtyForActual > 0 ? round2((varianceQty / stdQtyForActual) * 100) : 0;

      const matCost = round2(actualConsumed * pbm.unit_cost_snapshot);
      totalMaterialCost = round2(totalMaterialCost + matCost);
      stdMaterialCostForActualOutput = round2(
        stdMaterialCostForActualOutput + round2(stdQtyForActual * pbm.unit_cost_snapshot)
      );
      totalVarianceCost = round2(totalVarianceCost + varianceCost);

      db.prepare(
        `UPDATE production_batch_materials
         SET issued_qty = ?, returned_qty = ?, actual_consumed_qty = ?,
             std_qty_for_actual_output = ?, variance_qty = ?, variance_cost = ?,
             variance_pct = ?, variance_reason = ?
         WHERE id = ?`
      ).run(
        round3(pbm.issued_qty + extraIssuedQty),
        returnedQty,
        actualConsumed,
        stdQtyForActual,
        varianceQty,
        varianceCost,
        variancePct,
        input.reason || '',
        pbm.id
      );
    }

    const conversionCostTotal =
      conversionCostOverride !== null && conversionCostOverride !== undefined
        ? round2(Number(conversionCostOverride))
        : round2(actualGoodPackets * fg.conversion_cost_per_pkt);

    const totalBatchCost = round2(totalMaterialCost + conversionCostTotal);
    const actualCostPerPkt = round2(totalBatchCost / actualGoodPackets);
    const stdCostPerPkt = round2(
      stdMaterialCostForActualOutput / actualGoodPackets + fg.conversion_cost_per_pkt
    );
    const yieldPct = round2((actualGoodPackets / batch.target_packets) * 100);

    // Update Finished Goods stock & moving weighted average cost
    const existingFgValue = round2(fg.current_stock * fg.avg_cost_per_pkt);
    const newFgStock = fg.current_stock + actualGoodPackets;
    const newFgAvgCost =
      newFgStock > 0 ? round2((existingFgValue + totalBatchCost) / newFgStock) : actualCostPerPkt;

    db.prepare(
      `UPDATE finished_goods SET current_stock = ?, avg_cost_per_pkt = ? WHERE id = ?`
    ).run(newFgStock, newFgAvgCost, fg.id);

    db.prepare(
      `INSERT INTO finished_goods_ledger
       (finished_good_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
       VALUES (?, ?, 'PRODUCTION_IN', ?, 0, ?, ?, ?, 'BATCH', ?, ?)`
    ).run(
      fg.id,
      completionDate,
      actualGoodPackets,
      actualCostPerPkt,
      totalBatchCost,
      newFgStock,
      batchId,
      `Batch ${batch.batch_no} completed (${actualGoodPackets} good, ${rejectedPackets} rejected)`
    );

    db.prepare(
      `UPDATE production_batches
       SET status = 'COMPLETED',
           actual_good_packets = ?,
           rejected_packets = ?,
           conversion_cost_total = ?,
           total_material_cost = ?,
           total_batch_cost = ?,
           actual_cost_per_pkt = ?,
           standard_cost_per_pkt = ?,
           total_variance_cost = ?,
           yield_pct = ?,
           supervisor_notes = CASE WHEN ? != '' THEN ? ELSE supervisor_notes END,
           completed_at = ?
       WHERE id = ?`
    ).run(
      actualGoodPackets,
      rejectedPackets,
      conversionCostTotal,
      totalMaterialCost,
      totalBatchCost,
      actualCostPerPkt,
      stdCostPerPkt,
      totalVarianceCost,
      yieldPct,
      supervisorNotes,
      supervisorNotes,
      completionDate,
      batchId
    );

    logAudit(
      db,
      actor,
      'PRODUCTION_BATCH_COMPLETED',
      'production_batches',
      batchId,
      `Completed ${batch.batch_no}: +${actualGoodPackets} pkts ${fg.sku} into stock @ ₹${actualCostPerPkt}/pkt (std ₹${stdCostPerPkt}, variance ₹${totalVarianceCost})`
    );

    return {
      batchId,
      batchNo: batch.batch_no,
      actualGoodPackets,
      actualCostPerPkt,
      standardCostPerPkt: stdCostPerPkt,
      totalVarianceCost,
      yieldPct,
      newFinishedStock: newFgStock,
    };
  });
}

/**
 * Step 1 of Sales Loop: Field Salesman creates an order.
 * Does NOT deduct stock yet; enters verification queue.
 */
export function createSalesOrder(
  db,
  { orderDate, salesmanId, customerId, items, notes = '', actor = 'Field Salesman' }
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  return withTransaction(db, () => {
    const salesman = db.prepare(`SELECT * FROM salesmen WHERE id = ?`).get(salesmanId);
    if (!salesman) throw new Error('Salesman not found');
    const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId);
    if (!customer) throw new Error('Customer not found');

    const prefix = `ORD-${orderDate.slice(0, 7).replace('-', '')}-`;
    const orderNo = nextSequenceNumber(db, 'sales_orders', 'order_no', prefix);

    const orderRes = db
      .prepare(
        `INSERT INTO sales_orders (order_no, order_date, salesman_id, customer_id, status, notes)
         VALUES (?, ?, ?, ?, 'PENDING_VERIFICATION', ?)`
      )
      .run(orderNo, orderDate, salesmanId, customerId, notes);
    const orderId = Number(orderRes.lastInsertRowid);

    for (const item of items) {
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error('Item quantity must be a positive integer');
      }
      const fg = db.prepare(`SELECT * FROM finished_goods WHERE id = ?`).get(item.finishedGoodId);
      if (!fg) throw new Error(`SKU ${item.finishedGoodId} not found`);

      const defaultRate =
        customer.type === 'Distributor' ? fg.distributor_rate : fg.retailer_rate;
      const unitRate =
        item.unitRate !== undefined && item.unitRate !== null
          ? round2(Number(item.unitRate))
          : defaultRate;

      db.prepare(
        `INSERT INTO sales_order_items
         (order_id, finished_good_id, requested_qty, approved_qty, unit_rate, gst_rate)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(orderId, fg.id, qty, qty, unitRate, fg.gst_rate);
    }

    logAudit(
      db,
      salesman.name || actor,
      'SALES_ORDER_CREATED',
      'sales_orders',
      orderId,
      `Order ${orderNo} submitted for ${customer.name} (${items.length} line items)`
    );

    return { orderId, orderNo };
  });
}

/**
 * Step 2 of Sales Loop: Admin Desk verifies order (can adjust approved quantities or rates).
 */
export function verifySalesOrder(
  db,
  orderId,
  { approvedItems = null, notes = '', verifiedBy = 'Admin Desk' }
) {
  return withTransaction(db, () => {
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ?`).get(orderId);
    if (!order) throw new Error('Sales order not found');
    if (order.status !== 'PENDING_VERIFICATION') {
      throw new Error(`Order ${order.order_no} cannot be verified from status ${order.status}`);
    }

    if (Array.isArray(approvedItems)) {
      for (const ai of approvedItems) {
        const qty = Number(ai.approvedQty);
        if (!Number.isInteger(qty) || qty < 0) {
          throw new Error('Approved quantity must be a non-negative integer');
        }
        db.prepare(
          `UPDATE sales_order_items
           SET approved_qty = ?, unit_rate = COALESCE(?, unit_rate)
           WHERE order_id = ? AND finished_good_id = ?`
        ).run(qty, ai.unitRate ?? null, orderId, ai.finishedGoodId);
      }
    }

    const totalApproved = db
      .prepare(`SELECT COALESCE(SUM(approved_qty), 0) as total FROM sales_order_items WHERE order_id = ?`)
      .get(orderId).total;
    if (totalApproved <= 0) {
      throw new Error('Cannot verify an order with zero total approved quantity');
    }

    db.prepare(
      `UPDATE sales_orders
       SET status = 'VERIFIED',
           verified_by = ?,
           verified_at = datetime('now'),
           notes = CASE WHEN ? != '' THEN ? ELSE notes END
       WHERE id = ?`
    ).run(verifiedBy, notes, notes, orderId);

    logAudit(
      db,
      verifiedBy,
      'SALES_ORDER_VERIFIED',
      'sales_orders',
      orderId,
      `Verified order ${order.order_no} for invoicing & dispatch`
    );

    return { orderId, orderNo: order.order_no, status: 'VERIFIED' };
  });
}

/**
 * Step 3 of Sales Loop: Generate GST Invoice & Dispatch.
 * Atomically checks finished-goods stock, generates GST invoice (CGST+SGST or IGST),
 * deducts finished-goods stock with COGS valuation, creates Finished Goods Ledger (OUT),
 * and posts customer receivable.
 */
export function dispatchAndInvoiceOrder(
  db,
  orderId,
  { invoiceDate, actor = 'Billing & Dispatch Desk' }
) {
  return withTransaction(db, () => {
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ?`).get(orderId);
    if (!order) throw new Error('Sales order not found');
    if (order.status !== 'VERIFIED') {
      throw new Error(`Order ${order.order_no} must be VERIFIED before dispatch (current: ${order.status})`);
    }

    const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(order.customer_id);
    const items = db
      .prepare(
        `SELECT soi.*, fg.sku, fg.name, fg.hsn_code, fg.current_stock, fg.avg_cost_per_pkt
         FROM sales_order_items soi
         JOIN finished_goods fg ON fg.id = soi.finished_good_id
         WHERE soi.order_id = ? AND soi.approved_qty > 0`
      )
      .all(orderId);

    if (items.length === 0) throw new Error('No approved items to dispatch');

    // Verify finished-goods stock before any mutation
    for (const item of items) {
      if (item.current_stock < item.approved_qty) {
        throw new Error(
          `Insufficient finished stock for ${item.name} (${item.sku}): available ${item.current_stock} pkts, required ${item.approved_qty} pkts. Run a production batch first.`
        );
      }
    }

    const supplyType = customer.state_code === COMPANY_PROFILE.stateCode ? 'INTRA' : 'INTER';
    const gstCategory = customer.gstin && customer.gstin.trim().length >= 15 ? 'B2B' : 'B2C';
    const invoiceNo = nextInvoiceNumber(db, invoiceDate);
    const dueDate = addDays(invoiceDate, customer.credit_days || 15);

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const computedLines = items.map((item) => {
      const taxable = round2(item.approved_qty * item.unit_rate);
      const gstTotal = round2((taxable * item.gst_rate) / 100);
      const cgst = supplyType === 'INTRA' ? round2(gstTotal / 2) : 0;
      const sgst = supplyType === 'INTRA' ? round2(gstTotal - cgst) : 0;
      const igst = supplyType === 'INTER' ? gstTotal : 0;
      const lineTotal = round2(taxable + cgst + sgst + igst);
      const cogsUnit = round2(item.avg_cost_per_pkt);
      const cogsTotal = round2(item.approved_qty * cogsUnit);

      totalTaxable = round2(totalTaxable + taxable);
      totalCgst = round2(totalCgst + cgst);
      totalSgst = round2(totalSgst + sgst);
      totalIgst = round2(totalIgst + igst);

      return {
        ...item,
        taxable,
        cgst,
        sgst,
        igst,
        lineTotal,
        cogsUnit,
        cogsTotal,
      };
    });

    const exactTotal = round2(totalTaxable + totalCgst + totalSgst + totalIgst);
    const grandTotal = Math.round(exactTotal);
    const roundOff = round2(grandTotal - exactTotal);

    const invRes = db
      .prepare(
        `INSERT INTO invoices
         (invoice_no, invoice_date, order_id, customer_id, salesman_id, supply_type, gst_category,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off, grand_total, paid_amount, status, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNPAID', ?)`
      )
      .run(
        invoiceNo,
        invoiceDate,
        orderId,
        customer.id,
        order.salesman_id,
        supplyType,
        gstCategory,
        totalTaxable,
        totalCgst,
        totalSgst,
        totalIgst,
        roundOff,
        grandTotal,
        dueDate
      );
    const invoiceId = Number(invRes.lastInsertRowid);

    for (const line of computedLines) {
      db.prepare(
        `INSERT INTO invoice_items
         (invoice_id, finished_good_id, hsn_code, qty, unit_rate, taxable_amount, gst_rate,
          cgst_amount, sgst_amount, igst_amount, line_total, cogs_unit_cost, cogs_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invoiceId,
        line.finished_good_id,
        line.hsn_code,
        line.approved_qty,
        line.unit_rate,
        line.taxable,
        line.gst_rate,
        line.cgst,
        line.sgst,
        line.igst,
        line.lineTotal,
        line.cogsUnit,
        line.cogsTotal
      );

      const newFgStock = line.current_stock - line.approved_qty;
      db.prepare(`UPDATE finished_goods SET current_stock = ? WHERE id = ?`).run(
        newFgStock,
        line.finished_good_id
      );

      db.prepare(
        `INSERT INTO finished_goods_ledger
         (finished_good_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
         VALUES (?, ?, 'SALES_DISPATCH', 0, ?, ?, ?, ?, 'INVOICE', ?, ?)`
      ).run(
        line.finished_good_id,
        invoiceDate,
        line.approved_qty,
        line.cogsUnit,
        line.cogsTotal,
        newFgStock,
        invoiceId,
        `${invoiceNo} to ${customer.name}`
      );
    }

    db.prepare(`UPDATE sales_orders SET status = 'DISPATCHED' WHERE id = ?`).run(orderId);

    logAudit(
      db,
      actor,
      'INVOICE_DISPATCHED',
      'invoices',
      invoiceId,
      `Generated ${invoiceNo} (${gstCategory}/${supplyType}) ₹${grandTotal} for ${customer.name} & deducted finished stock`
    );

    return {
      invoiceId,
      invoiceNo,
      grandTotal,
      taxableAmount: totalTaxable,
      gstTotal: round2(totalCgst + totalSgst + totalIgst),
      supplyType,
      gstCategory,
    };
  });
}

/**
 * Step 4 of Sales Loop: Record Payment / Collection against an Invoice.
 */
export function recordCollection(
  db,
  { invoiceId, paymentDate, amount, mode, referenceNo = '', notes = '', actor = 'Accounts Desk' }
) {
  const amt = round2(Number(amount));
  if (amt <= 0) throw new Error('Payment amount must be positive');

  return withTransaction(db, () => {
    const inv = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);
    if (!inv) throw new Error('Invoice not found');

    const outstanding = round2(inv.grand_total - inv.paid_amount);
    if (amt > outstanding + 0.01) {
      throw new Error(`Payment ₹${amt} exceeds invoice balance due ₹${outstanding}`);
    }

    const prefix = `RCPT-${paymentDate.slice(0, 7).replace('-', '')}-`;
    const receiptNo = nextSequenceNumber(db, 'collections', 'receipt_no', prefix);

    const colRes = db
      .prepare(
        `INSERT INTO collections (receipt_no, payment_date, invoice_id, customer_id, amount, mode, reference_no, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(receiptNo, paymentDate, invoiceId, inv.customer_id, amt, mode, referenceNo, notes);
    const collectionId = Number(colRes.lastInsertRowid);

    const newPaid = round2(inv.paid_amount + amt);
    const newStatus = newPaid >= inv.grand_total - 0.01 ? 'PAID' : 'PARTIAL';

    db.prepare(`UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?`).run(
      newPaid,
      newStatus,
      invoiceId
    );

    logAudit(
      db,
      actor,
      'COLLECTION_RECORDED',
      'collections',
      collectionId,
      `Collected ₹${amt} via ${mode} (${receiptNo}) against ${inv.invoice_no}; status: ${newStatus}`
    );

    return { collectionId, receiptNo, newPaid, status: newStatus };
  });
}

/**
 * Cancel a pending or verified (un-dispatched) order.
 */
export function cancelSalesOrder(db, orderId, actor = 'Admin Desk') {
  return withTransaction(db, () => {
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ?`).get(orderId);
    if (!order) throw new Error('Sales order not found');
    if (order.status === 'DISPATCHED') {
      throw new Error('Cannot cancel an order that has already been dispatched and invoiced');
    }
    db.prepare(`UPDATE sales_orders SET status = 'CANCELLED' WHERE id = ?`).run(orderId);
    logAudit(db, actor, 'SALES_ORDER_CANCELLED', 'sales_orders', orderId, `Cancelled ${order.order_no}`);
    return { orderId, status: 'CANCELLED' };
  });
}
