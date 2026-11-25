export interface CompanyProfile {
  name: string;
  tradeName: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  address: string;
}

export interface RawMaterial {
  id: number;
  code: string;
  name: string;
  unit: string;
  hsn_code: string;
  gst_rate: number;
  current_stock: number;
  avg_cost: number;
  reorder_level: number;
}

export interface BomItem {
  id: number;
  finished_good_id: number;
  raw_material_id: number;
  qty_per_100_pkts: number;
  notes: string;
  code: string;
  name: string;
  unit: string;
  avg_cost: number;
  current_stock: number;
}

export interface FinishedGood {
  id: number;
  sku: string;
  name: string;
  category: string;
  pack_grams: number;
  hsn_code: string;
  gst_rate: number;
  mrp: number;
  distributor_rate: number;
  retailer_rate: number;
  conversion_cost_per_pkt: number;
  current_stock: number;
  avg_cost_per_pkt: number;
  reorder_level: number;
  stdMaterialCostPerPkt: number;
  stdTotalCostPerPkt: number;
  committedQty: number;
  freeStock: number;
  bom: BomItem[];
}

export interface Salesman {
  id: number;
  name: string;
  phone: string;
  territory: string;
}

export interface Customer {
  id: number;
  name: string;
  type: 'Distributor' | 'Retailer';
  gstin: string;
  state_code: string;
  state_name: string;
  city: string;
  credit_limit: number;
  credit_days: number;
  salesman_id: number;
  salesman_name: string;
  outstanding: number;
}

export interface Supplier {
  id: number;
  name: string;
  gstin: string;
  state_code: string;
  state_name: string;
  phone: string;
}

export interface SalesOrderItem {
  id: number;
  order_id: number;
  finished_good_id: number;
  requested_qty: number;
  approved_qty: number;
  unit_rate: number;
  gst_rate: number;
  sku: string;
  fg_name: string;
  available_stock: number;
}

export interface SalesOrder {
  id: number;
  order_no: string;
  order_date: string;
  salesman_id: number;
  customer_id: number;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'DISPATCHED' | 'CANCELLED';
  notes: string;
  verified_by: string | null;
  verified_at: string | null;
  salesman_name: string;
  customer_name: string;
  customer_type: 'Distributor' | 'Retailer';
  customer_city: string;
  state_code: string;
  customer_gstin: string;
  invoice_id: number | null;
  invoice_no: string | null;
  invoice_total: number | null;
  items: SalesOrderItem[];
  shortStock: boolean;
}

export interface BatchMaterial {
  id: number;
  batch_id: number;
  raw_material_id: number;
  planned_qty_for_target: number;
  issued_qty: number;
  returned_qty: number;
  actual_consumed_qty: number;
  std_qty_for_actual_output: number;
  variance_qty: number;
  unit_cost_snapshot: number;
  variance_cost: number;
  variance_pct: number;
  variance_reason: string;
  code: string;
  rm_name: string;
  unit: string;
  store_stock: number;
}

export interface ProductionBatch {
  id: number;
  batch_no: string;
  batch_date: string;
  finished_good_id: number;
  target_packets: number;
  actual_good_packets: number | null;
  rejected_packets: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  conversion_cost_total: number;
  total_material_cost: number;
  total_batch_cost: number;
  actual_cost_per_pkt: number;
  standard_cost_per_pkt: number;
  total_variance_cost: number;
  yield_pct: number;
  supervisor_notes: string;
  completed_at: string | null;
  sku: string;
  fg_name: string;
  conversion_cost_per_pkt: number;
  materials: BatchMaterial[];
}

export interface Purchase {
  id: number;
  bill_no: string;
  bill_date: string;
  supplier_id: number;
  raw_material_id: number;
  qty: number;
  unit_rate: number;
  taxable_value: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  notes: string;
  supplier_name: string;
  rm_code: string;
  rm_name: string;
  unit: string;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  invoice_date: string;
  order_id: number;
  customer_id: number;
  salesman_id: number;
  supply_type: 'INTRA' | 'INTER';
  gst_category: 'B2B' | 'B2C';
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  due_date: string;
  customer_name: string;
  customer_type: string;
  customer_gstin: string;
  state_name: string;
  salesman_name: string;
  balance_due: number;
}

export interface Collection {
  id: number;
  receipt_no: string;
  payment_date: string;
  invoice_id: number;
  customer_id: number;
  amount: number;
  mode: 'UPI' | 'NEFT' | 'CASH' | 'CHEQUE';
  reference_no: string;
  notes: string;
  invoice_no: string;
  customer_name: string;
}

export interface AuditLog {
  id: number;
  event_time: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string;
}

export interface BootstrapData {
  company: CompanyProfile;
  rawMaterials: RawMaterial[];
  finishedGoods: FinishedGood[];
  salesmen: Salesman[];
  customers: Customer[];
  suppliers: Supplier[];
  orders: SalesOrder[];
  batches: ProductionBatch[];
  purchases: Purchase[];
  invoices: Invoice[];
  collections: Collection[];
  auditLogs: AuditLog[];
}

export interface LedgerEntry {
  id: number;
  txn_date: string;
  txn_type: string;
  qty_in: number;
  qty_out: number;
  unit_cost: number;
  value_amount: number;
  balance_after: number;
  ref_type: string;
  ref_id: number | null;
  notes: string;
}

export interface MonthlyAuditReport {
  month: string;
  monthStart: string;
  nextMonthStart: string;
  kpis: {
    netRevenueExGst: number;
    grossBilledInclGst: number;
    totalCogs: number;
    grossProfit: number;
    grossProfitPct: number;
    totalProducedPkts: number;
    totalRejectedPkts: number;
    totalProductionCost: number;
    totalMaterialVarianceCost: number;
    outputGstTotal: number;
    inputItcTotal: number;
    netGstPayable: number;
    totalCollectedInMonth: number;
    totalReceivableOutstanding: number;
    closingFgValue: number;
    closingRmValue: number;
  };
  fgReconciliation: Array<{
    id: number;
    sku: string;
    name: string;
    category: string;
    openingQty: number;
    productionInQty: number;
    productionInValue: number;
    salesOutQty: number;
    cogsValue: number;
    auditAdjustQty: number;
    expectedClosingQty: number;
    liveCurrentStock: number;
    avgCostPerPkt: number;
    closingStockValue: number;
  }>;
  rmReconciliation: Array<{
    id: number;
    code: string;
    name: string;
    unit: string;
    openingQty: number;
    purchasedQty: number;
    purchasedValue: number;
    issuedQty: number;
    returnedQty: number;
    netConsumedQty: number;
    expectedClosingQty: number;
    liveCurrentStock: number;
    avgCost: number;
    closingStockValue: number;
  }>;
  batches: Array<ProductionBatch>;
  materialVariances: Array<{
    code: string;
    name: string;
    unit: string;
    total_std_qty: number;
    total_actual_qty: number;
    total_variance_qty: number;
    total_variance_cost: number;
  }>;
  skuCosting: Array<{
    sku: string;
    name: string;
    mrp: number;
    distributorRate: number;
    retailerRate: number;
    producedPktsInMonth: number;
    actualCostPerPkt: number;
    soldPktsInMonth: number;
    revenueExGst: number;
    cogsTotal: number;
    avgSellingPrice: number;
    grossMarginPerPkt: number;
    grossMarginPct: number;
  }>;
  gst: {
    outputGst: {
      invoiceCount: number;
      b2bCount: number;
      b2cCount: number;
      taxableAmount: number;
      cgst: number;
      sgst: number;
      igst: number;
      grandTotal: number;
      totalGst: number;
    };
    inputItc: {
      billCount: number;
      taxableAmount: number;
      cgst: number;
      sgst: number;
      igst: number;
      totalPurchaseValue: number;
      totalItc: number;
    };
    netGstPayable: number;
    hsnSummary: Array<{
      hsn_code: string;
      gst_rate: number;
      total_qty: number;
      taxable_value: number;
      cgst: number;
      sgst: number;
      igst: number;
      total_value: number;
    }>;
    invoices: Invoice[];
    purchases: Purchase[];
  };
  collections: Collection[];
  openReceivables: Array<{
    id: number;
    invoice_no: string;
    invoice_date: string;
    due_date: string;
    grand_total: number;
    paid_amount: number;
    balance_due: number;
    status: string;
    customer_name: string;
    customer_type: string;
    salesman_name: string;
  }>;
  salesmanPerformance: Array<{
    id: number;
    name: string;
    territory: string;
    invoice_count: number;
    net_sales: number;
    gross_billed: number;
    collected_in_month: number;
  }>;
}
