import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const COMPANY_PROFILE = {
  name: 'Kaveri Heritage Snacks Pvt. Ltd.',
  tradeName: 'Kaveri Snacks Co.',
  gstin: '33AABCK4521M1Z8',
  stateCode: '33',
  stateName: 'Tamil Nadu',
  address: 'Plot 14, SIDCO Industrial Estate, Perundurai, Erode - 638052',
};

export function initDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      hsn_code TEXT NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 5,
      current_stock REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      reorder_level REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS finished_goods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      pack_grams INTEGER NOT NULL,
      hsn_code TEXT NOT NULL,
      gst_rate REAL NOT NULL DEFAULT 12,
      mrp REAL NOT NULL,
      distributor_rate REAL NOT NULL,
      retailer_rate REAL NOT NULL,
      conversion_cost_per_pkt REAL NOT NULL DEFAULT 3.5,
      current_stock INTEGER NOT NULL DEFAULT 0,
      avg_cost_per_pkt REAL NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finished_good_id INTEGER NOT NULL REFERENCES finished_goods(id) ON DELETE CASCADE,
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      qty_per_100_pkts REAL NOT NULL,
      notes TEXT DEFAULT '',
      UNIQUE(finished_good_id, raw_material_id)
    );

    CREATE TABLE IF NOT EXISTS salesmen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      territory TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('Distributor', 'Retailer')),
      gstin TEXT DEFAULT '',
      state_code TEXT NOT NULL DEFAULT '33',
      state_name TEXT NOT NULL DEFAULT 'Tamil Nadu',
      city TEXT NOT NULL,
      credit_limit REAL NOT NULL DEFAULT 50000,
      credit_days INTEGER NOT NULL DEFAULT 15,
      salesman_id INTEGER REFERENCES salesmen(id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gstin TEXT NOT NULL,
      state_code TEXT NOT NULL DEFAULT '33',
      state_name TEXT NOT NULL DEFAULT 'Tamil Nadu',
      phone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_material_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no TEXT NOT NULL,
      bill_date TEXT NOT NULL,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      qty REAL NOT NULL,
      unit_rate REAL NOT NULL,
      taxable_value REAL NOT NULL,
      gst_rate REAL NOT NULL,
      cgst_amount REAL NOT NULL,
      sgst_amount REAL NOT NULL,
      igst_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raw_material_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      txn_date TEXT NOT NULL,
      txn_type TEXT NOT NULL CHECK(txn_type IN ('OPENING', 'PURCHASE', 'ISSUE_TO_PROD', 'RETURN_FROM_PROD', 'AUDIT_ADJUST')),
      qty_in REAL NOT NULL DEFAULT 0,
      qty_out REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      value_amount REAL NOT NULL DEFAULT 0,
      balance_after REAL NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no TEXT NOT NULL UNIQUE,
      batch_date TEXT NOT NULL,
      finished_good_id INTEGER NOT NULL REFERENCES finished_goods(id),
      target_packets INTEGER NOT NULL,
      actual_good_packets INTEGER,
      rejected_packets INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
      conversion_cost_total REAL NOT NULL DEFAULT 0,
      total_material_cost REAL NOT NULL DEFAULT 0,
      total_batch_cost REAL NOT NULL DEFAULT 0,
      actual_cost_per_pkt REAL NOT NULL DEFAULT 0,
      standard_cost_per_pkt REAL NOT NULL DEFAULT 0,
      total_variance_cost REAL NOT NULL DEFAULT 0,
      yield_pct REAL NOT NULL DEFAULT 0,
      supervisor_notes TEXT DEFAULT '',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_batch_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      planned_qty_for_target REAL NOT NULL,
      issued_qty REAL NOT NULL DEFAULT 0,
      returned_qty REAL NOT NULL DEFAULT 0,
      actual_consumed_qty REAL NOT NULL DEFAULT 0,
      std_qty_for_actual_output REAL NOT NULL DEFAULT 0,
      variance_qty REAL NOT NULL DEFAULT 0,
      unit_cost_snapshot REAL NOT NULL DEFAULT 0,
      variance_cost REAL NOT NULL DEFAULT 0,
      variance_pct REAL NOT NULL DEFAULT 0,
      variance_reason TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS finished_goods_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finished_good_id INTEGER NOT NULL REFERENCES finished_goods(id),
      txn_date TEXT NOT NULL,
      txn_type TEXT NOT NULL CHECK(txn_type IN ('OPENING', 'PRODUCTION_IN', 'SALES_DISPATCH', 'AUDIT_ADJUST')),
      qty_in INTEGER NOT NULL DEFAULT 0,
      qty_out INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      value_amount REAL NOT NULL DEFAULT 0,
      balance_after INTEGER NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      order_date TEXT NOT NULL,
      salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING_VERIFICATION', 'VERIFIED', 'DISPATCHED', 'CANCELLED')),
      notes TEXT DEFAULT '',
      verified_by TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      finished_good_id INTEGER NOT NULL REFERENCES finished_goods(id),
      requested_qty INTEGER NOT NULL,
      approved_qty INTEGER NOT NULL,
      unit_rate REAL NOT NULL,
      gst_rate REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      invoice_date TEXT NOT NULL,
      order_id INTEGER NOT NULL UNIQUE REFERENCES sales_orders(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      salesman_id INTEGER NOT NULL REFERENCES salesmen(id),
      supply_type TEXT NOT NULL CHECK(supply_type IN ('INTRA', 'INTER')),
      gst_category TEXT NOT NULL CHECK(gst_category IN ('B2B', 'B2C')),
      taxable_amount REAL NOT NULL,
      cgst_amount REAL NOT NULL,
      sgst_amount REAL NOT NULL,
      igst_amount REAL NOT NULL,
      round_off REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('UNPAID', 'PARTIAL', 'PAID')),
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      finished_good_id INTEGER NOT NULL REFERENCES finished_goods(id),
      hsn_code TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_rate REAL NOT NULL,
      taxable_amount REAL NOT NULL,
      gst_rate REAL NOT NULL,
      cgst_amount REAL NOT NULL,
      sgst_amount REAL NOT NULL,
      igst_amount REAL NOT NULL,
      line_total REAL NOT NULL,
      cogs_unit_cost REAL NOT NULL DEFAULT 0,
      cogs_total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      payment_date TEXT NOT NULL,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      amount REAL NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('UPI', 'NEFT', 'CASH', 'CHEQUE')),
      reference_no TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_time TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      summary TEXT NOT NULL
    );
  `);

  return db;
}
