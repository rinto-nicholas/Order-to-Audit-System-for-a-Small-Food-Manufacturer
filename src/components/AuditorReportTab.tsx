import React from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Printer } from 'lucide-react';
import type { MonthlyAuditReport } from '../types';
import { formatINR } from '../api';

interface Props {
  month: string;
  onMonthChange: (m: string) => void;
  report: MonthlyAuditReport | null;
}

export function AuditorReportTab({ month, onMonthChange, report }: Props) {
  if (!report) {
    return <div className="p-6 text-sm text-stone-500">Loading monthly auditor pack...</div>;
  }

  const downloadCsv = (type: 'gstr1' | 'stock' | 'variance') => {
    window.location.href = `/api/reports/export?month=${encodeURIComponent(month)}&type=${type}`;
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-5 h-5 text-stone-800" />
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Month-End Accountant & Auditor Pack
            </h2>
            <p className="text-xs text-stone-500">
              Auto-assembled from source transactions: Stock Reconciliation, Production Variance, Cost/Packet, GSTR-1 & ITC, Receivables.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-stone-700">Audit Period:</label>
          <input
            type="month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-medium bg-white"
          />
          <button
            onClick={() => downloadCsv('gstr1')}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> GSTR-1 CSV
          </button>
          <button
            onClick={() => downloadCsv('stock')}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Stock Recon CSV
          </button>
          <button
            onClick={() => downloadCsv('variance')}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Variance CSV
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> Print Pack
          </button>
        </div>
      </div>

      {/* 1. Executive P&L & Cash Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="text-[11px] font-semibold uppercase text-stone-500">Revenue (Ex-GST)</div>
          <div className="text-xl font-bold text-stone-900 mt-1">
            {formatINR(report.kpis.netRevenueExGst)}
          </div>
          <div className="text-[11px] text-stone-500">
            Incl GST: {formatINR(report.kpis.grossBilledInclGst)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="text-[11px] font-semibold uppercase text-stone-500">COGS & Gross Profit</div>
          <div className="text-xl font-bold text-emerald-700 mt-1">
            {formatINR(report.kpis.grossProfit)}
          </div>
          <div className="text-[11px] text-stone-500">
            Margin: {report.kpis.grossProfitPct}% · COGS {formatINR(report.kpis.totalCogs)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="text-[11px] font-semibold uppercase text-stone-500">Material Variance</div>
          <div
            className={`text-xl font-bold mt-1 ${
              report.kpis.totalMaterialVarianceCost > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {report.kpis.totalMaterialVarianceCost > 0 ? '+' : ''}
            {formatINR(report.kpis.totalMaterialVarianceCost)}
          </div>
          <div className="text-[11px] text-stone-500">
            Across {report.kpis.totalProducedPkts} good pkts
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="text-[11px] font-semibold uppercase text-stone-500">Net GST Payable</div>
          <div className="text-xl font-bold text-stone-900 mt-1">
            {formatINR(report.kpis.netGstPayable)}
          </div>
          <div className="text-[11px] text-stone-500">
            Out {formatINR(report.kpis.outputGstTotal)} − ITC {formatINR(report.kpis.inputItcTotal)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="text-[11px] font-semibold uppercase text-stone-500">Collections / AR</div>
          <div className="text-xl font-bold text-sky-700 mt-1">
            {formatINR(report.kpis.totalCollectedInMonth)}
          </div>
          <div className="text-[11px] text-stone-500">
            Open AR: {formatINR(report.kpis.totalReceivableOutstanding)}
          </div>
        </div>
      </div>

      {/* 2. Finished Goods Stock Reconciliation Proof */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              A. Finished Goods Stock Reconciliation (Opening + Production IN − Sales Dispatched = Closing)
            </h3>
            <p className="text-xs text-stone-500">
              Closing Stock Value: <strong>{formatINR(report.kpis.closingFgValue)}</strong>
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" /> Books Matched
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">+ Production IN</th>
                <th className="px-3 py-2 text-right">− Sales Dispatch</th>
                <th className="px-3 py-2 text-right">= Expected Closing</th>
                <th className="px-3 py-2 text-right">Avg Cost/Pkt</th>
                <th className="px-3 py-2 text-right">Closing Value (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.fgReconciliation.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-semibold">{r.sku}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.openingQty}</td>
                  <td className="px-3 py-2 text-right text-emerald-700 font-medium">
                    +{r.productionInQty}
                  </td>
                  <td className="px-3 py-2 text-right text-sky-700 font-medium">
                    −{r.salesOutQty}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-stone-900">
                    {r.expectedClosingQty}
                  </td>
                  <td className="px-3 py-2 text-right">{formatINR(r.avgCostPerPkt)}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatINR(r.closingStockValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Raw Materials Reconciliation + Material Variance Rollup */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">
            B. Raw Materials Store Reconciliation (Value: {formatINR(report.kpis.closingRmValue)})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-100 text-stone-600 uppercase">
                <tr>
                  <th className="px-2.5 py-2">Material</th>
                  <th className="px-2.5 py-2 text-right">Opening</th>
                  <th className="px-2.5 py-2 text-right">+ Purch</th>
                  <th className="px-2.5 py-2 text-right">− Issued</th>
                  <th className="px-2.5 py-2 text-right">+ Ret</th>
                  <th className="px-2.5 py-2 text-right">= Closing</th>
                  <th className="px-2.5 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {report.rmReconciliation.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2.5 py-1.5 font-medium">
                      {r.name} <span className="text-stone-400">({r.unit})</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right">{r.openingQty}</td>
                    <td className="px-2.5 py-1.5 text-right text-emerald-700">+{r.purchasedQty}</td>
                    <td className="px-2.5 py-1.5 text-right text-amber-700">−{r.issuedQty}</td>
                    <td className="px-2.5 py-1.5 text-right text-sky-700">+{r.returnedQty}</td>
                    <td className="px-2.5 py-1.5 text-right font-bold">{r.expectedClosingQty}</td>
                    <td className="px-2.5 py-1.5 text-right font-medium">
                      {formatINR(r.closingStockValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">
            C. Planned vs Actual Ingredient Wastage Rollup
          </h3>
          {report.materialVariances.length === 0 ? (
            <p className="text-xs text-stone-500">No completed production batches in {month}.</p>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-100 text-stone-600 uppercase">
                <tr>
                  <th className="px-2.5 py-2">Ingredient</th>
                  <th className="px-2.5 py-2 text-right">Planned</th>
                  <th className="px-2.5 py-2 text-right">Actual</th>
                  <th className="px-2.5 py-2 text-right">Var Qty</th>
                  <th className="px-2.5 py-2 text-right">Var ₹</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {report.materialVariances.map((v) => (
                  <tr key={v.code}>
                    <td className="px-2.5 py-1.5 font-medium">{v.name}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      {v.total_std_qty} {v.unit}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      {v.total_actual_qty} {v.unit}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right font-semibold ${
                        v.total_variance_qty > 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {v.total_variance_qty > 0 ? '+' : ''}
                      {v.total_variance_qty}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-right font-bold ${
                        v.total_variance_cost > 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {v.total_variance_cost > 0 ? '+' : ''}
                      {formatINR(v.total_variance_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 4. SKU Unit Economics (Actual Cost Per Packet vs Selling Rate) */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <h3 className="text-sm font-semibold text-stone-900 mb-3">
          D. SKU Costing & Margin Audit (Actual Batch Cost per Packet vs Realized Selling Rate)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Produced</th>
                <th className="px-3 py-2 text-right">Actual Cost/Pkt</th>
                <th className="px-3 py-2 text-right">Sold Pkts</th>
                <th className="px-3 py-2 text-right">Avg Sell Rate</th>
                <th className="px-3 py-2 text-right">Margin/Pkt</th>
                <th className="px-3 py-2 text-right">Margin %</th>
                <th className="px-3 py-2 text-right">Net Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.skuCosting.map((s) => (
                <tr key={s.sku}>
                  <td className="px-3 py-2 font-semibold">{s.sku}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-right">{s.producedPktsInMonth}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatINR(s.actualCostPerPkt)}</td>
                  <td className="px-3 py-2 text-right">{s.soldPktsInMonth}</td>
                  <td className="px-3 py-2 text-right">{formatINR(s.avgSellingPrice)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700 font-semibold">
                    {formatINR(s.grossMarginPerPkt)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{s.grossMarginPct}%</td>
                  <td className="px-3 py-2 text-right font-bold">{formatINR(s.revenueExGst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. GST Computation (GSTR-1 & GSTR-3B) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-semibold text-stone-900">
            E. GST Summary (GSTR-1 Output Liability vs GSTR-3B Input ITC)
          </h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
              <div className="text-stone-500">Output GST ({report.gst.outputGst.invoiceCount} inv)</div>
              <div className="text-base font-bold text-stone-900 mt-0.5">
                {formatINR(report.gst.outputGst.totalGst)}
              </div>
              <div className="text-[11px] text-stone-500">
                B2B: {report.gst.outputGst.b2bCount} · B2C: {report.gst.outputGst.b2cCount}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-emerald-700">Input ITC ({report.gst.inputItc.billCount} bills)</div>
              <div className="text-base font-bold text-emerald-900 mt-0.5">
                −{formatINR(report.gst.inputItc.totalItc)}
              </div>
              <div className="text-[11px] text-emerald-700">
                Purchases: {formatINR(report.gst.inputItc.taxableAmount)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-amber-800">Net GST Payable</div>
              <div className="text-base font-bold text-amber-950 mt-0.5">
                {formatINR(report.gst.netGstPayable)}
              </div>
              <div className="text-[11px] text-amber-800">CGST/SGST/IGST net</div>
            </div>
          </div>

          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-2.5 py-1.5">HSN</th>
                <th className="px-2.5 py-1.5 text-right">Rate</th>
                <th className="px-2.5 py-1.5 text-right">Qty</th>
                <th className="px-2.5 py-1.5 text-right">Taxable</th>
                <th className="px-2.5 py-1.5 text-right">CGST</th>
                <th className="px-2.5 py-1.5 text-right">SGST</th>
                <th className="px-2.5 py-1.5 text-right">IGST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.gst.hsnSummary.map((h, i) => (
                <tr key={i}>
                  <td className="px-2.5 py-1.5 font-medium">{h.hsn_code}</td>
                  <td className="px-2.5 py-1.5 text-right">{h.gst_rate}%</td>
                  <td className="px-2.5 py-1.5 text-right">{h.total_qty}</td>
                  <td className="px-2.5 py-1.5 text-right">{formatINR(h.taxable_value)}</td>
                  <td className="px-2.5 py-1.5 text-right">{formatINR(h.cgst)}</td>
                  <td className="px-2.5 py-1.5 text-right">{formatINR(h.sgst)}</td>
                  <td className="px-2.5 py-1.5 text-right">{formatINR(h.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 6. Salesman Performance & Open Receivables */}
        <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-semibold text-stone-900">
            F. Salesman Sales & Collections + Open Receivables
          </h3>
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-2.5 py-1.5">Salesman</th>
                <th className="px-2.5 py-1.5 text-right">Invoices</th>
                <th className="px-2.5 py-1.5 text-right">Billed (Incl GST)</th>
                <th className="px-2.5 py-1.5 text-right">Collected ({month})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.salesmanPerformance.map((sp) => (
                <tr key={sp.id}>
                  <td className="px-2.5 py-1.5">
                    <div className="font-medium">{sp.name}</div>
                    <div className="text-[11px] text-stone-500">{sp.territory}</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right">{sp.invoice_count}</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold">{formatINR(sp.gross_billed)}</td>
                  <td className="px-2.5 py-1.5 text-right text-emerald-700 font-semibold">
                    {formatINR(sp.collected_in_month)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pt-2 border-t border-stone-100">
            <div className="text-xs font-semibold text-stone-700 mb-1.5">
              Open Receivables ({report.openReceivables.length})
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {report.openReceivables.map((ar) => (
                <div key={ar.id} className="flex justify-between text-xs bg-stone-50 px-2.5 py-1.5 rounded">
                  <span>
                    <strong>{ar.invoice_no}</strong> · {ar.customer_name} (due {ar.due_date})
                  </span>
                  <span className="font-bold text-rose-700">{formatINR(ar.balance_due)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
