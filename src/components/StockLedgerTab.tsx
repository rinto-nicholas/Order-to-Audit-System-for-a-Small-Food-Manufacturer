import React, { useState } from 'react';
import { BookOpen, Box, Layers, X } from 'lucide-react';
import type { BootstrapData, LedgerEntry } from '../types';
import { fetchStockLedger, formatINR } from '../api';

interface Props {
  data: BootstrapData;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export function StockLedgerTab({ data, notify }: Props) {
  const [ledgerModal, setLedgerModal] = useState<{
    title: string;
    unit: string;
    entries: LedgerEntry[];
  } | null>(null);

  const openLedger = async (kind: 'finished' | 'raw', id: number, title: string, unit: string) => {
    try {
      const entries = await fetchStockLedger(kind, id);
      setLedgerModal({ title, unit, entries });
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Finished Goods Stock Hub */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-stone-900 flex items-center gap-2">
            <Box className="w-4 h-4 text-amber-600" />
            Finished Goods Stock Hub (Where Production IN & Sales Dispatch Meet)
          </h2>
          <p className="text-xs text-stone-500">
            Free Stock = Physical Stock minus Pending/Verified Sales Orders not yet dispatched. Click "Stock Card" for full immutable movement ledger.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Physical Stock</th>
                <th className="px-3 py-2 text-right">Committed Orders</th>
                <th className="px-3 py-2 text-right">Free Stock</th>
                <th className="px-3 py-2 text-right">Std Cost/Pkt</th>
                <th className="px-3 py-2 text-right">Avg Book Cost/Pkt</th>
                <th className="px-3 py-2 text-right">Dist. Rate</th>
                <th className="px-3 py-2 text-right">Stock Value</th>
                <th className="px-3 py-2 text-right">Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.finishedGoods.map((fg) => (
                <tr key={fg.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2.5 font-semibold text-stone-900">{fg.sku}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-stone-900">{fg.name}</div>
                    <div className="text-[11px] text-stone-500">
                      HSN {fg.hsn_code} · GST {fg.gst_rate}% · MRP {formatINR(fg.mrp)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-stone-900">
                    {fg.current_stock} pkts
                  </td>
                  <td className="px-3 py-2.5 text-right text-amber-700 font-medium">
                    {fg.committedQty} pkts
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-bold ${
                      fg.freeStock < 0
                        ? 'text-rose-700'
                        : fg.freeStock <= fg.reorder_level
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {fg.freeStock} pkts
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-600">
                    {formatINR(fg.stdTotalCostPerPkt)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">
                    {formatINR(fg.avg_cost_per_pkt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatINR(fg.distributor_rate)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">
                    {formatINR(fg.current_stock * fg.avg_cost_per_pkt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => openLedger('finished', fg.id, `${fg.sku} — ${fg.name}`, 'pkts')}
                      className="px-2.5 py-1 rounded border border-stone-300 hover:bg-stone-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <BookOpen className="w-3 h-3" /> Stock Card
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Materials Store */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-stone-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-700" />
            Raw Materials Store & Moving Weighted Average Cost (WAC)
          </h2>
          <p className="text-xs text-stone-500">
            Updated automatically on every Purchase Bill (GRN), Batch Issue, and Floor Return.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">HSN / GST</th>
                <th className="px-3 py-2 text-right">Current Stock</th>
                <th className="px-3 py-2 text-right">Reorder Level</th>
                <th className="px-3 py-2 text-right">Moving Avg Cost</th>
                <th className="px-3 py-2 text-right">Stock Value</th>
                <th className="px-3 py-2 text-right">Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.rawMaterials.map((rm) => {
                const low = rm.current_stock <= rm.reorder_level;
                return (
                  <tr key={rm.id} className={low ? 'bg-amber-50/40' : 'hover:bg-stone-50'}>
                    <td className="px-3 py-2.5 font-semibold text-stone-900">{rm.code}</td>
                    <td className="px-3 py-2.5 font-medium text-stone-900">{rm.name}</td>
                    <td className="px-3 py-2.5 text-stone-500">
                      {rm.hsn_code} · {rm.gst_rate}%
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-bold ${
                        low ? 'text-amber-800' : 'text-stone-900'
                      }`}
                    >
                      {rm.current_stock} {rm.unit}
                    </td>
                    <td className="px-3 py-2.5 text-right text-stone-500">
                      {rm.reorder_level} {rm.unit}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {formatINR(rm.avg_cost)} / {rm.unit}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">
                      {formatINR(rm.current_stock * rm.avg_cost)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => openLedger('raw', rm.id, `${rm.code} — ${rm.name}`, rm.unit)}
                        className="px-2.5 py-1 rounded border border-stone-300 hover:bg-stone-100 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <BookOpen className="w-3 h-3" /> Stock Card
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Card Ledger Modal */}
      {ledgerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-semibold text-stone-900">Stock Card Ledger — {ledgerModal.title}</h3>
              <button
                onClick={() => setLedgerModal(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs text-left">
                <thead className="bg-stone-100 text-stone-600 uppercase sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">In</th>
                    <th className="px-3 py-2 text-right">Out</th>
                    <th className="px-3 py-2 text-right">Unit Cost</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2">Reference / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {ledgerModal.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{e.txn_date}</td>
                      <td className="px-3 py-2 font-medium">{e.txn_type}</td>
                      <td className="px-3 py-2 text-right text-emerald-700 font-semibold">
                        {e.qty_in > 0 ? `+${e.qty_in}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-700 font-semibold">
                        {e.qty_out > 0 ? `-${e.qty_out}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{formatINR(e.unit_cost)}</td>
                      <td className="px-3 py-2 text-right">{formatINR(e.value_amount)}</td>
                      <td className="px-3 py-2 text-right font-bold">
                        {e.balance_after} {ledgerModal.unit}
                      </td>
                      <td className="px-3 py-2 text-stone-600">{e.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
