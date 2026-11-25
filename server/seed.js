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
} from './ledger.js';

/**
 * Seeds a realistic South Indian Packaged Snacks Factory ("Kaveri Heritage Snacks Pvt. Ltd.")
 * across October 2026 (prior month opening/history) and November 2026 (active month),
 * leaving live pending orders, verified orders, an in-progress batch, unpaid receivables,
 * and rich variance examples ready for inspection.
 */
export function seedDatabase(db) {
  const existing = db.prepare(`SELECT COUNT(*) as c FROM raw_materials`).get().c;
  if (existing > 0) return;

  // 1. Raw Materials (Initial Opening Stock as of 2026-10-01)
  const rawMaterials = [
    { code: 'RM-RICE', name: 'Idli/Murukku Rice Flour', unit: 'kg', hsn: '11029090', gst: 5, stock: 450, cost: 48, reorder: 200 },
    { code: 'RM-URAD', name: 'Urad Dal Flour', unit: 'kg', hsn: '11061000', gst: 5, stock: 180, cost: 135, reorder: 80 },
    { code: 'RM-BESAN', name: 'Besan (Gram Flour)', unit: 'kg', hsn: '11061000', gst: 5, stock: 320, cost: 92, reorder: 120 },
    { code: 'RM-PNUT', name: 'Raw Groundnuts (Peanuts)', unit: 'kg', hsn: '12024210', gst: 5, stock: 140, cost: 118, reorder: 60 },
    { code: 'RM-OIL', name: 'Refined Sunflower/Palmolein Oil', unit: 'L', hsn: '15121910', gst: 5, stock: 350, cost: 128, reorder: 150 },
    { code: 'RM-BANA', name: 'Raw Nendran Banana', unit: 'kg', hsn: '08039010', gst: 0, stock: 260, cost: 58, reorder: 100 },
    { code: 'RM-GHEE', name: 'Agmark Cow Ghee', unit: 'kg', hsn: '04059020', gst: 12, stock: 85, cost: 580, reorder: 30 },
    { code: 'RM-SUGR', name: 'Fine Cane Sugar', unit: 'kg', hsn: '17019990', gst: 5, stock: 200, cost: 44, reorder: 80 },
    { code: 'RM-SPIC', name: 'Spices, Curry Leaves & Asafoetida', unit: 'kg', hsn: '09109100', gst: 5, stock: 60, cost: 260, reorder: 20 },
    { code: 'RM-POUCH', name: 'Printed BOPP Laminated Pouches', unit: 'pcs', hsn: '39232990', gst: 18, stock: 4200, cost: 2.1, reorder: 1500 },
  ];

  const rmIdByCode = {};
  const insertRm = db.prepare(
    `INSERT INTO raw_materials (code, name, unit, hsn_code, gst_rate, current_stock, avg_cost, reorder_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRmOpening = db.prepare(
    `INSERT INTO raw_material_ledger
     (raw_material_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
     VALUES (?, '2026-10-01', 'OPENING', ?, 0, ?, ?, ?, 'OPENING', NULL, 'Opening inventory Oct 2026')`
  );

  for (const rm of rawMaterials) {
    const res = insertRm.run(rm.code, rm.name, rm.unit, rm.hsn, rm.gst, rm.stock, rm.cost, rm.reorder);
    const id = Number(res.lastInsertRowid);
    rmIdByCode[rm.code] = id;
    insertRmOpening.run(id, rm.stock, rm.cost, round2(rm.stock * rm.cost), rm.stock);
  }

  // 2. Finished Goods (SKUs)
  const finishedGoods = [
    {
      sku: 'MRK-200',
      name: 'Kai Murukku (200g)',
      category: 'Murukku',
      grams: 200,
      hsn: '21069099',
      gst: 12,
      mrp: 75,
      distRate: 48,
      retRate: 56,
      convCost: 3.4,
      stock: 420,
      avgCost: 27.6,
      reorder: 250,
    },
    {
      sku: 'MIX-250',
      name: 'Madras Mixture (250g)',
      category: 'Mixture',
      grams: 250,
      hsn: '21069099',
      gst: 12,
      mrp: 90,
      distRate: 58,
      retRate: 67,
      convCost: 3.8,
      stock: 360,
      avgCost: 35.9,
      reorder: 250,
    },
    {
      sku: 'CHP-150',
      name: 'Nendran Banana Chips (150g)',
      category: 'Chips',
      grams: 150,
      hsn: '21069099',
      gst: 12,
      mrp: 85,
      distRate: 54,
      retRate: 63,
      convCost: 4.1,
      stock: 280,
      avgCost: 37.2,
      reorder: 200,
    },
    {
      sku: 'MPK-200',
      name: 'Ghee Mysore Pak (200g)',
      category: 'Sweets',
      grams: 200,
      hsn: '21069099',
      gst: 5,
      mrp: 130,
      distRate: 86,
      retRate: 98,
      convCost: 4.5,
      stock: 180,
      avgCost: 59.5,
      reorder: 150,
    },
  ];

  const fgIdBySku = {};
  const insertFg = db.prepare(
    `INSERT INTO finished_goods
     (sku, name, category, pack_grams, hsn_code, gst_rate, mrp, distributor_rate, retailer_rate, conversion_cost_per_pkt, current_stock, avg_cost_per_pkt, reorder_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFgOpening = db.prepare(
    `INSERT INTO finished_goods_ledger
     (finished_good_id, txn_date, txn_type, qty_in, qty_out, unit_cost, value_amount, balance_after, ref_type, ref_id, notes)
     VALUES (?, '2026-10-01', 'OPENING', ?, 0, ?, ?, ?, 'OPENING', NULL, 'Opening stock Oct 2026')`
  );

  for (const fg of finishedGoods) {
    const res = insertFg.run(
      fg.sku, fg.name, fg.category, fg.grams, fg.hsn, fg.gst,
      fg.mrp, fg.distRate, fg.retRate, fg.convCost, fg.stock, fg.avgCost, fg.reorder
    );
    const id = Number(res.lastInsertRowid);
    fgIdBySku[fg.sku] = id;
    insertFgOpening.run(id, fg.stock, fg.avgCost, round2(fg.stock * fg.avgCost), fg.stock);
  }

  // 3. Bill of Materials (Standard Recipe per 100 packets)
  const boms = [
    // MRK-200: 100 pkts (20 kg net)
    ['MRK-200', 'RM-RICE', 13.5, 'Base rice flour'],
    ['MRK-200', 'RM-URAD', 4.5, 'Crispness binder'],
    ['MRK-200', 'RM-OIL', 4.2, 'Standard frying oil absorption'],
    ['MRK-200', 'RM-SPIC', 0.6, 'Jeera, sesame, salt & hing'],
    ['MRK-200', 'RM-POUCH', 100, '1 pouch per packet'],

    // MIX-250: 100 pkts (25 kg net)
    ['MIX-250', 'RM-BESAN', 14.0, 'Omapodi & boondi base'],
    ['MIX-250', 'RM-PNUT', 5.0, 'Roasted peanuts'],
    ['MIX-250', 'RM-RICE', 2.0, 'Aval / rice flakes'],
    ['MIX-250', 'RM-OIL', 5.5, 'Standard oil absorption'],
    ['MIX-250', 'RM-SPIC', 1.1, 'Chilli, curry leaves, salt'],
    ['MIX-250', 'RM-POUCH', 100, '1 pouch per packet'],

    // CHP-150: 100 pkts (15 kg net chips — ~40 kg raw peeled/unpeeled Nendran yield)
    ['CHP-150', 'RM-BANA', 36.0, 'Raw Nendran banana (~41% chip yield)'],
    ['CHP-150', 'RM-OIL', 6.0, 'Deep-frying oil absorption'],
    ['CHP-150', 'RM-SPIC', 0.45, 'Turmeric & rock salt'],
    ['CHP-150', 'RM-POUCH', 100, 'Nitrogen-flushed pouch'],

    // MPK-200: 100 pkts (20 kg net sweet)
    ['MPK-200', 'RM-BESAN', 5.5, 'Roasted gram flour'],
    ['MPK-200', 'RM-GHEE', 7.2, 'Pure cow ghee'],
    ['MPK-200', 'RM-SUGR', 9.0, 'Sugar syrup base'],
    ['MPK-200', 'RM-POUCH', 100, 'Tray + outer pouch'],
  ];

  const insertBom = db.prepare(
    `INSERT INTO bom_items (finished_good_id, raw_material_id, qty_per_100_pkts, notes) VALUES (?, ?, ?, ?)`
  );
  for (const [sku, rmCode, qty, notes] of boms) {
    insertBom.run(fgIdBySku[sku], rmIdByCode[rmCode], qty, notes);
  }

  // 4. Salesmen
  const salesmenData = [
    ['Karthik Sundaram', '98422-11201', 'Chennai & Kanchipuram'],
    ['Muthuvel Raj', '98422-11202', 'Coimbatore & Erode'],
    ['Senthil Nathan', '98422-11203', 'Madurai & Trichy'],
    ['Aravind Krishnan', '98422-11204', 'Bengaluru (Inter-state)'],
    ['Priya Dharshini', '98422-11205', 'Salem & Namakkal'],
  ];
  const salesmanIds = [];
  const insertSalesman = db.prepare(`INSERT INTO salesmen (name, phone, territory) VALUES (?, ?, ?)`);
  for (const s of salesmenData) {
    salesmanIds.push(Number(insertSalesman.run(...s).lastInsertRowid));
  }

  // 5. Customers (Retailers & Distributors, B2B + B2C, Intra-state TN + Inter-state KA)
  const customersData = [
    ['Sri Murugan Agencies', 'Distributor', '33AAACS8812K1Z5', '33', 'Tamil Nadu', 'Chennai', 200000, 15, salesmanIds[0]],
    ['Annapoorna Super Market', 'Retailer', '33AABFA2190P1Z2', '33', 'Tamil Nadu', 'Coimbatore', 75000, 10, salesmanIds[1]],
    ['Meenakshi Provision Stores', 'Retailer', '', '33', 'Tamil Nadu', 'Madurai', 35000, 7, salesmanIds[2]],
    ['Nandini Sweets & Bakery', 'Distributor', '29AAACN4410R1Z9', '29', 'Karnataka', 'Bengaluru', 180000, 21, salesmanIds[3]],
    ['Kovai Pazhamudir Nilayam', 'Distributor', '33AABCK9912E1Z1', '33', 'Tamil Nadu', 'Erode', 150000, 15, salesmanIds[1]],
    ['Lakshmi Mini Mart', 'Retailer', '', '33', 'Tamil Nadu', 'Salem', 25000, 7, salesmanIds[4]],
  ];
  const customerIds = [];
  const insertCust = db.prepare(
    `INSERT INTO customers (name, type, gstin, state_code, state_name, city, credit_limit, credit_days, salesman_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of customersData) {
    customerIds.push(Number(insertCust.run(...c).lastInsertRowid));
  }

  // 6. Suppliers
  const suppliersData = [
    ['Erode Agro Flour Mills', '33AAAFE1029L1Z4', '33', 'Tamil Nadu', '94430-22101'],
    ['Cauvery Edible Oils Pvt Ltd', '33AAACC7732M1Z1', '33', 'Tamil Nadu', '94430-22102'],
    ['Pollachi Banana & Farm Co-op', '33AABCP3104G1Z8', '33', 'Tamil Nadu', '94430-22103'],
    ['Sivakasi FlexiPack Industries', '33AAACS6541H1Z2', '33', 'Tamil Nadu', '94430-22104'],
  ];
  const supplierIds = [];
  const insertSup = db.prepare(
    `INSERT INTO suppliers (name, gstin, state_code, state_name, phone) VALUES (?, ?, ?, ?, ?)`
  );
  for (const s of suppliersData) {
    supplierIds.push(Number(insertSup.run(...s).lastInsertRowid));
  }

  // --- OCTOBER 2026 HISTORICAL TRANSACTIONS (so Opening/Closing Nov works cleanly!) ---
  recordRawMaterialPurchase(db, {
    billNo: 'EAM/26/412',
    billDate: '2026-10-05',
    supplierId: supplierIds[0],
    rawMaterialId: rmIdByCode['RM-RICE'],
    qty: 300,
    unitRate: 49,
    notes: 'Oct restock',
  });
  recordRawMaterialPurchase(db, {
    billNo: 'CEO/26/188',
    billDate: '2026-10-08',
    supplierId: supplierIds[1],
    rawMaterialId: rmIdByCode['RM-OIL'],
    qty: 200,
    unitRate: 130,
    notes: '200L oil drums',
  });

  const octB1 = createAndIssueProductionBatch(db, {
    batchDate: '2026-10-12',
    finishedGoodId: fgIdBySku['MRK-200'],
    targetPackets: 600,
    supervisorNotes: 'Oct festive run',
  });
  completeProductionBatch(db, octB1.batchId, {
    completionDate: '2026-10-12',
    actualGoodPackets: 590,
    rejectedPackets: 10,
    materialActuals: [
      { rawMaterialId: rmIdByCode['RM-OIL'], actualConsumedQty: 26.2, reason: 'Slightly higher fryer temp' },
      { rawMaterialId: rmIdByCode['RM-POUCH'], actualConsumedQty: 605, reason: '15 pouches damaged during sealing' },
    ],
  });

  const octOrd1 = createSalesOrder(db, {
    orderDate: '2026-10-18',
    salesmanId: salesmanIds[0],
    customerId: customerIds[0],
    items: [
      { finishedGoodId: fgIdBySku['MRK-200'], qty: 400 },
      { finishedGoodId: fgIdBySku['MIX-250'], qty: 150 },
    ],
  });
  verifySalesOrder(db, octOrd1.orderId, {});
  const octInv1 = dispatchAndInvoiceOrder(db, octOrd1.orderId, { invoiceDate: '2026-10-19' });
  recordCollection(db, {
    invoiceId: octInv1.invoiceId,
    paymentDate: '2026-10-28',
    amount: octInv1.grandTotal,
    mode: 'NEFT',
    referenceNo: 'HDFCN263019881',
  });

  // --- NOVEMBER 2026 ACTIVE MONTH TRANSACTIONS ---
  // Raw Material Purchases (with slight price changes so Moving WAC shifts!)
  recordRawMaterialPurchase(db, {
    billNo: 'EAM/26/509',
    billDate: '2026-11-02',
    supplierId: supplierIds[0],
    rawMaterialId: rmIdByCode['RM-BESAN'],
    qty: 250,
    unitRate: 96,
    notes: 'Fresh besan lot',
  });
  recordRawMaterialPurchase(db, {
    billNo: 'CEO/26/241',
    billDate: '2026-11-03',
    supplierId: supplierIds[1],
    rawMaterialId: rmIdByCode['RM-OIL'],
    qty: 250,
    unitRate: 134,
    notes: 'November cooking oil supply',
  });
  recordRawMaterialPurchase(db, {
    billNo: 'PBC/26/089',
    billDate: '2026-11-05',
    supplierId: supplierIds[2],
    rawMaterialId: rmIdByCode['RM-BANA'],
    qty: 300,
    unitRate: 62,
    notes: 'Grade-A Nendran bunch',
  });
  recordRawMaterialPurchase(db, {
    billNo: 'SFP/26/312',
    billDate: '2026-11-06',
    supplierId: supplierIds[3],
    rawMaterialId: rmIdByCode['RM-POUCH'],
    qty: 3000,
    unitRate: 2.25,
    notes: 'BOPP pouch batch',
  });

  // Completed Batch 1 in Nov: Madras Mixture (shows favorable flour return + slight oil variance)
  const novB1 = createAndIssueProductionBatch(db, {
    batchDate: '2026-11-07',
    finishedGoodId: fgIdBySku['MIX-250'],
    targetPackets: 500,
    supervisorNotes: 'Morning shift mixture line',
  });
  completeProductionBatch(db, novB1.batchId, {
    completionDate: '2026-11-07',
    actualGoodPackets: 495,
    rejectedPackets: 5,
    materialActuals: [
      { rawMaterialId: rmIdByCode['RM-BESAN'], returnedQty: 1.8, reason: 'Leftover boondi batter returned' },
      { rawMaterialId: rmIdByCode['RM-OIL'], actualConsumedQty: 29.4, reason: 'Oil over-absorption during second fry' },
      { rawMaterialId: rmIdByCode['RM-POUCH'], actualConsumedQty: 508, reason: '13 pouches wasted in FFS machine start' },
    ],
  });

  // Completed Batch 2 in Nov: Nendran Banana Chips (higher banana & oil wastage alert!)
  const novB2 = createAndIssueProductionBatch(db, {
    batchDate: '2026-11-11',
    finishedGoodId: fgIdBySku['CHP-150'],
    targetPackets: 400,
    supervisorNotes: 'Banana chips batch - humid weather',
  });
  completeProductionBatch(db, novB2.batchId, {
    completionDate: '2026-11-11',
    actualGoodPackets: 380,
    rejectedPackets: 20,
    materialActuals: [
      { rawMaterialId: rmIdByCode['RM-BANA'], actualConsumedQty: 152, reason: 'Higher peel/bruised trim loss on raw lot' },
      { rawMaterialId: rmIdByCode['RM-OIL'], actualConsumedQty: 25.8, reason: 'Over-frying & oil carryover' },
      { rawMaterialId: rmIdByCode['RM-POUCH'], actualConsumedQty: 392, reason: '12 pouches rejected at weight check' },
    ],
  });

  // Completed Batch 3 in Nov: Ghee Mysore Pak (clean tight batch)
  const novB3 = createAndIssueProductionBatch(db, {
    batchDate: '2026-11-14',
    finishedGoodId: fgIdBySku['MPK-200'],
    targetPackets: 300,
    supervisorNotes: 'Sweet kitchen batch',
  });
  completeProductionBatch(db, novB3.batchId, {
    completionDate: '2026-11-14',
    actualGoodPackets: 298,
    rejectedPackets: 2,
    materialActuals: [
      { rawMaterialId: rmIdByCode['RM-GHEE'], actualConsumedQty: 21.8, reason: 'Pan coating loss' },
      { rawMaterialId: rmIdByCode['RM-POUCH'], actualConsumedQty: 302, reason: '4 trays cracked' },
    ],
  });

  // In-progress Batch 4 in Nov (live on production floor right now!)
  createAndIssueProductionBatch(db, {
    batchDate: '2026-11-24',
    finishedGoodId: fgIdBySku['MRK-200'],
    targetPackets: 500,
    supervisorNotes: 'Afternoon Murukku run - currently frying & packing',
  });

  // November Sales Loop: Dispatched Invoices + Partial/Unpaid Receivables
  const novOrd1 = createSalesOrder(db, {
    orderDate: '2026-11-08',
    salesmanId: salesmanIds[1],
    customerId: customerIds[4], // Kovai Pazhamudir (TN Distributor - Intra B2B)
    items: [
      { finishedGoodId: fgIdBySku['MIX-250'], qty: 260 },
      { finishedGoodId: fgIdBySku['MRK-200'], qty: 200 },
    ],
    notes: 'Weekly Erode distributor van load',
  });
  verifySalesOrder(db, novOrd1.orderId, {});
  const novInv1 = dispatchAndInvoiceOrder(db, novOrd1.orderId, { invoiceDate: '2026-11-09' });
  recordCollection(db, {
    invoiceId: novInv1.invoiceId,
    paymentDate: '2026-11-18',
    amount: 15000,
    mode: 'UPI',
    referenceNo: 'UPI4321980012',
    notes: 'Part payment received',
  });

  const novOrd2 = createSalesOrder(db, {
    orderDate: '2026-11-12',
    salesmanId: salesmanIds[3],
    customerId: customerIds[3], // Nandini Sweets Bengaluru (KA Distributor - Inter-state IGST B2B)
    items: [
      { finishedGoodId: fgIdBySku['CHP-150'], qty: 240 },
      { finishedGoodId: fgIdBySku['MPK-200'], qty: 180 },
    ],
    notes: 'Inter-state Bengaluru dispatch',
  });
  verifySalesOrder(db, novOrd2.orderId, {});
  dispatchAndInvoiceOrder(db, novOrd2.orderId, { invoiceDate: '2026-11-15' });

  const novOrd3 = createSalesOrder(db, {
    orderDate: '2026-11-16',
    salesmanId: salesmanIds[2],
    customerId: customerIds[2], // Meenakshi Provision (Unregistered Retailer - B2C Intra)
    items: [
      { finishedGoodId: fgIdBySku['MIX-250'], qty: 90 },
      { finishedGoodId: fgIdBySku['CHP-150'], qty: 60 },
    ],
    notes: 'Retail route order',
  });
  verifySalesOrder(db, novOrd3.orderId, {});
  const novInv3 = dispatchAndInvoiceOrder(db, novOrd3.orderId, { invoiceDate: '2026-11-17' });
  recordCollection(db, {
    invoiceId: novInv3.invoiceId,
    paymentDate: '2026-11-20',
    amount: novInv3.grandTotal,
    mode: 'CASH',
    referenceNo: 'CASH-MDR-112',
    notes: 'Full cash settled with salesman',
  });

  // A VERIFIED order waiting for Admin Billing/Dispatch right now
  const novOrd4 = createSalesOrder(db, {
    orderDate: '2026-11-23',
    salesmanId: salesmanIds[1],
    customerId: customerIds[1], // Annapoorna Super Market
    items: [
      { finishedGoodId: fgIdBySku['MRK-200'], qty: 150 },
      { finishedGoodId: fgIdBySku['MIX-250'], qty: 120 },
    ],
    notes: 'Ready for billing desk dispatch',
  });
  verifySalesOrder(db, novOrd4.orderId, {});

  // A PENDING_VERIFICATION salesman order waiting for Admin Verification right now
  createSalesOrder(db, {
    orderDate: '2026-11-25',
    salesmanId: salesmanIds[0],
    customerId: customerIds[0], // Sri Murugan Agencies
    items: [
      { finishedGoodId: fgIdBySku['MRK-200'], qty: 320 },
      { finishedGoodId: fgIdBySku['MPK-200'], qty: 100 },
    ],
    notes: 'Chennai urgent weekend demand — check Murukku stock!',
  });
}
