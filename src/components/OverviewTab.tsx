import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  IndianRupee,
  Package,
  ShoppingCart,
  TrendingDown,
  Truck,
} from 'lucide-react';
import type { BootstrapData, MonthlyAuditReport } from '../types';
import { formatINR } from '../api';

export type TabKey = 'overview' | 'sales' | 'production' | 'stock' | 'auditor';

interface Props {
  data: BootstrapData;
  report: MonthlyAuditReport | null;
  onNavigate: (tab: TabKey) => void;
}

export function OverviewTab({ data, report, onNavigate }: Props) {
  const pendingOrders = data.orders.filter((o) => o.status === 'PENDING_VERIFICATION');
  const verifiedOrders = data.orders.filter((o) => o.status === 'VERIFIED');
  const inProgressBatches = data.batches.filter((b) => b.status === 'IN_PROGRESS');
  const shortOrders = data.orders.filter(
    (o) => (o.status === 'PENDING_VERIFICATION' || o.status === 'VERIFIED') && o.shortStock
  );
  const lowRawMaterials = data.rawMaterials.filter((r) => r.current_stock <= r.reorder_level);
  const lowFinishedGoods = data.finishedGoods.filter((f) => f.freeStock <= f.reorder_level);
  const unpaidInvoices = data.invoices.filter((i) => i.status !== 'PAID');
  const totalOutstanding = unpaidInvoices.reduce((s, i) => s + i.balance_due, 0);

  const highVarianceBatches = data.batches.filter(
    (b) => b.status === 'COMPLETED' && b.total_variance_cost > 150
  );

  return (
    <div className="space-y-6">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-stone-500 uppercase tracking-wide">
            <span>Nov Net Sales (Ex-GST)</span>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-stone-900">
            {formatINR(report?.kpis.netRevenueExGst ?? 0)}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Gross Profit: {formatINR(report?.kpis.grossProfit ?? 0)} ({report?.kpis.grossProfitPct ?? 0}%)
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-stone-500 uppercase tracking-wide">
            <span>Finished Goods Stock</span>
            <Package className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-stone-900">
            {data.finishedGoods.reduce((s, f) => s + f.current_stock, 0).toLocaleString('en-IN')} pkts
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Book Value: {formatINR(report?.kpis.closingFgValue ?? 0)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-stone-500 uppercase tracking-wide">
            <span>Production Variance (Nov)</span>
            <TrendingDown className="w-4 h-4 text-rose-600" />
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${
              (report?.kpis.totalMaterialVarianceCost ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {(report?.kpis.totalMaterialVarianceCost ?? 0) > 0 ? '+' : ''}
            {formatINR(report?.kpis.totalMaterialVarianceCost ?? 0)}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {(report?.kpis.totalProducedPkts ?? 0).toLocaleString('en-IN')} good pkts ·{' '}
            {report?.kpis.totalRejectedPkts ?? 0} rejected
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-stone-500 uppercase tracking-wide">
            <span>Open Receivables</span>
            <ClipboardList className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-stone-900">{formatINR(totalOutstanding)}</div>
          <div className="mt-1 text-xs text-stone-500">
            {unpaidInvoices.length} open invoices · Net GST {formatINR(report?.kpis.netGstPayable ?? 0)}
          </div>
        </div>
      </div>

      {/* Interactive Two-Loop Architecture Diagram */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Single-Entry Factory Flow: Two Loops Meeting at Finished-Goods Stock
            </h2>
            <p className="text-xs text-stone-500">
              Every transaction is entered once at source and posts automatically to stock, costing, GST, and audit books.
            </p>
          </div>
          <button
            onClick={() => onNavigate('auditor')}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Open Auditor Pack
          </button>
        </div>

        <div className="space-y-4">
          {/* Sales Loop Row */}
          <div className="rounded-xl bg-sky-50/60 border border-sky-200/80 p-3.5">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-800 mb-2.5 flex items-center gap-1.5">
              <ShoppingCart className="w-3.5 h-3.5" /> Sales Loop (Order → Verify → GST Invoice → Dispatch → Collect)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
              <button
                onClick={() => onNavigate('sales')}
                className="text-left bg-white border border-sky-200 hover:border-sky-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-sky-700">1. Salesman Order</div>
                <div className="text-lg font-bold text-stone-900">{pendingOrders.length} pending</div>
                <div className="text-[11px] text-stone-500">Entered on route</div>
              </button>

              <button
                onClick={() => onNavigate('sales')}
                className="text-left bg-white border border-sky-200 hover:border-sky-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-sky-700">2. Admin Verified</div>
                <div className="text-lg font-bold text-stone-900">{verifiedOrders.length} ready</div>
                <div className="text-[11px] text-stone-500">Stock checked, no re-typing</div>
              </button>

              <button
                onClick={() => onNavigate('sales')}
                className="text-left bg-white border border-sky-200 hover:border-sky-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-sky-700">3. GST Invoice & Dispatch</div>
                <div className="text-lg font-bold text-stone-900">
                  {report?.gst.outputGst.invoiceCount ?? 0} in Nov
                </div>
                <div className="text-[11px] text-stone-500">Deducts FG stock ↓</div>
              </button>

              <button
                onClick={() => onNavigate('stock')}
                className="text-left bg-amber-50 border-2 border-amber-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-bold text-amber-900">★ Finished Goods Hub</div>
                <div className="text-lg font-bold text-amber-950">
                  {data.finishedGoods.reduce((s, f) => s + f.current_stock, 0)} pkts
                </div>
                <div className="text-[11px] text-amber-800">Both loops reconcile here</div>
              </button>

              <button
                onClick={() => onNavigate('sales')}
                className="text-left bg-white border border-sky-200 hover:border-sky-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-sky-700">4. Collections & AR</div>
                <div className="text-lg font-bold text-stone-900">
                  {formatINR(report?.kpis.totalCollectedInMonth ?? 0)}
                </div>
                <div className="text-[11px] text-stone-500">Collected in Nov</div>
              </button>
            </div>
          </div>

          {/* Production Loop Row */}
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-200/80 p-3.5">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-2.5 flex items-center gap-1.5">
              <Factory className="w-3.5 h-3.5" /> Production Loop (RM Purchase → Issue via BOM → Produce & Variance → FG Stock ↑)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
              <button
                onClick={() => onNavigate('production')}
                className="text-left bg-white border border-emerald-200 hover:border-emerald-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-emerald-700">1. RM Purchases (GRN)</div>
                <div className="text-lg font-bold text-stone-900">
                  {report?.gst.inputItc.billCount ?? 0} bills (Nov)
                </div>
                <div className="text-[11px] text-stone-500">Updates WAC + Input ITC</div>
              </button>

              <button
                onClick={() => onNavigate('production')}
                className="text-left bg-white border border-emerald-200 hover:border-emerald-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-emerald-700">2. Recipe (BOM) Issue</div>
                <div className="text-lg font-bold text-stone-900">{inProgressBatches.length} active</div>
                <div className="text-[11px] text-stone-500">Auto-scales per 100 pkts</div>
              </button>

              <button
                onClick={() => onNavigate('production')}
                className="text-left bg-white border border-emerald-200 hover:border-emerald-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-emerald-700">3. Actuals & Variance</div>
                <div className="text-lg font-bold text-stone-900">
                  {report?.batches.filter((b) => b.status === 'COMPLETED').length ?? 0} batches
                </div>
                <div className="text-[11px] text-stone-500">Planned vs Actual + Cost/Pkt</div>
              </button>

              <button
                onClick={() => onNavigate('stock')}
                className="text-left bg-amber-50 border-2 border-amber-400 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-bold text-amber-900">★ Finished Stock IN</div>
                <div className="text-lg font-bold text-amber-950">
                  +{report?.kpis.totalProducedPkts ?? 0} pkts
                </div>
                <div className="text-[11px] text-amber-800">Priced at actual batch cost</div>
              </button>

              <button
                onClick={() => onNavigate('auditor')}
                className="text-left bg-stone-900 text-white hover:bg-stone-800 rounded-lg p-3 transition cursor-pointer"
              >
                <div className="text-[11px] font-semibold text-amber-300">Month-End Auditor Pack</div>
                <div className="text-lg font-bold">100% Reconciled</div>
                <div className="text-[11px] text-stone-300 flex items-center gap-1">
                  GSTR-1/3B, Stock, P&L <ArrowRight className="w-3 h-3" />
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Actionable Exceptions & Audit Trail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <h3 className="text-sm font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Factory Exceptions & Action Queue
          </h3>
          <div className="space-y-2.5 text-sm">
            {shortOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200"
              >
                <div>
                  <div className="font-medium text-rose-900">
                    Short Stock on {o.order_no} ({o.customer_name})
                  </div>
                  <div className="text-xs text-rose-700">
                    {o.items
                      .filter((i) => i.approved_qty > i.available_stock)
                      .map((i) => `${i.sku}: need ${i.approved_qty}, have ${i.available_stock}`)
                      .join(' · ')}
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('production')}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded bg-rose-700 text-white hover:bg-rose-800 cursor-pointer"
                >
                  Produce
                </button>
              </div>
            ))}

            {inProgressBatches.map((b) => (
              <div
                key={b.id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200"
              >
                <div>
                  <div className="font-medium text-amber-950">
                    Batch On Floor: {b.batch_no} — {b.fg_name}
                  </div>
                  <div className="text-xs text-amber-800">
                    Target: {b.target_packets} pkts · Raw materials issued; awaiting output & wastage entry
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('production')}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded bg-amber-700 text-white hover:bg-amber-800 cursor-pointer"
                >
                  Complete
                </button>
              </div>
            ))}

            {highVarianceBatches.slice(0, 2).map((b) => (
              <div
                key={b.id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-orange-50 border border-orange-200"
              >
                <div>
                  <div className="font-medium text-orange-950">
                    Wastage Alert: {b.batch_no} ({b.sku})
                  </div>
                  <div className="text-xs text-orange-800">
                    Adverse material variance: +{formatINR(b.total_variance_cost)} · Yield {b.yield_pct}%
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('production')}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded border border-orange-300 bg-white text-orange-900 hover:bg-orange-100 cursor-pointer"
                >
                  Inspect
                </button>
              </div>
            ))}

            {lowRawMaterials.length > 0 && (
              <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-stone-100 border border-stone-200">
                <div>
                  <div className="font-medium text-stone-900">
                    Raw Materials Near Reorder Level ({lowRawMaterials.length})
                  </div>
                  <div className="text-xs text-stone-600">
                    {lowRawMaterials.map((r) => `${r.name} (${r.current_stock} ${r.unit})`).join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('production')}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded bg-stone-800 text-white hover:bg-stone-900 cursor-pointer"
                >
                  Purchase
                </button>
              </div>
            )}

            {lowFinishedGoods.length > 0 && (
              <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-sky-50 border border-sky-200">
                <div>
                  <div className="font-medium text-sky-900">
                    Low Free Stock SKUs (after pending orders)
                  </div>
                  <div className="text-xs text-sky-800">
                    {lowFinishedGoods.map((f) => `${f.sku}: ${f.freeStock} free pkts`).join(' · ')}
                  </div>
                </div>
                <Truck className="w-4 h-4 text-sky-700 shrink-0 mt-1" />
              </div>
            )}

            {shortOrders.length === 0 && inProgressBatches.length === 0 && lowRawMaterials.length === 0 && (
              <div className="flex items-center gap-2 text-emerald-700 p-3 bg-emerald-50 rounded-lg">
                <CheckCircle2 className="w-4 h-4" /> All orders stocked and no open floor batches.
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">
            Live Single-Entry Audit Trail (Latest Events)
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {data.auditLogs.slice(0, 15).map((log) => (
              <div
                key={log.id}
                className="text-xs border-l-2 border-amber-500 pl-3 py-1 bg-stone-50/60 rounded-r"
              >
                <div className="flex items-center justify-between text-stone-500">
                  <span className="font-semibold text-stone-700">{log.actor}</span>
                  <span>{log.action}</span>
                </div>
                <div className="text-stone-800 mt-0.5">{log.summary}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
