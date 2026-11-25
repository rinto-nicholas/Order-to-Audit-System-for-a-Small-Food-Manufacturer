import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Factory,
  PackagePlus,
  Play,
  Scale,
  X,
} from 'lucide-react';
import type { BootstrapData, ProductionBatch } from '../types';
import { formatINR, postJson, putJson } from '../api';

interface Props {
  data: BootstrapData;
  preselectedFgId?: number;
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export function ProductionLoopTab({ data, preselectedFgId, onRefresh, notify }: Props) {
  const today = '2026-11-25';

  // Purchase (GRN) State
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? 1);
  const [rmId, setRmId] = useState(data.rawMaterials[0]?.id ?? 1);
  const [billNo, setBillNo] = useState('SUP/26/901');
  const [billDate, setBillDate] = useState(today);
  const [purchaseQty, setPurchaseQty] = useState('100');
  const [purchaseRate, setPurchaseRate] = useState('135');

  // Start Production Batch State
  const [selectedFgId, setSelectedFgId] = useState<number>(
    preselectedFgId || data.finishedGoods[0]?.id || 1
  );
  const [batchDate, setBatchDate] = useState(today);
  const [targetPackets, setTargetPackets] = useState(400);
  const [batchNotes, setBatchNotes] = useState('');

  useEffect(() => {
    if (preselectedFgId) setSelectedFgId(preselectedFgId);
  }, [preselectedFgId]);

  // Complete Batch Modal State
  const [completingBatch, setCompletingBatch] = useState<ProductionBatch | null>(null);
  const [actualGood, setActualGood] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [completionDate, setCompletionDate] = useState(today);
  const [actualConsumedMap, setActualConsumedMap] = useState<Record<number, string>>({});
  const [reasonMap, setReasonMap] = useState<Record<number, string>>({});

  // Expandable Batch Variance Rows
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(
    data.batches.find((b) => b.status === 'COMPLETED')?.id ?? null
  );

  // BOM Editor Modal
  const [editingBomFgId, setEditingBomFgId] = useState<number | null>(null);
  const [bomDraft, setBomDraft] = useState<Array<{ raw_material_id: number; qty_per_100_pkts: number; notes: string }>>([]);

  const selectedFg = useMemo(
    () => data.finishedGoods.find((f) => f.id === selectedFgId),
    [data.finishedGoods, selectedFgId]
  );

  // Live planned materials preview for targetPackets
  const plannedPreview = useMemo(() => {
    if (!selectedFg) return [];
    return selectedFg.bom.map((item) => {
      const needed = Math.round(((item.qty_per_100_pkts * targetPackets) / 100) * 1000) / 1000;
      const enough = item.current_stock + 1e-6 >= needed;
      return {
        ...item,
        needed,
        enough,
        estCost: needed * item.avg_cost,
      };
    });
  }, [selectedFg, targetPackets]);

  const canStartBatch =
    targetPackets > 0 && plannedPreview.length > 0 && plannedPreview.every((p) => p.enough);

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await postJson('/api/purchases', {
        billNo,
        billDate,
        supplierId,
        rawMaterialId: rmId,
        qty: Number(purchaseQty),
        unitRate: Number(purchaseRate),
      });
      notify(
        `Purchase ${billNo} recorded. Stock: ${res.newStock}, Moving Avg Cost: ${formatINR(res.newAvgCost)}, Input ITC: ${formatINR(res.itc)}`
      );
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleStartBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await postJson('/api/batches', {
        batchDate,
        finishedGoodId: selectedFgId,
        targetPackets: Number(targetPackets),
        supervisorNotes: batchNotes,
      });
      notify(`Batch ${res.batchNo} started and BOM raw materials issued from store!`);
      setBatchNotes('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const openCompleteModal = (batch: ProductionBatch) => {
    setCompletingBatch(batch);
    setActualGood(batch.target_packets);
    setRejected(0);
    setCompletionDate(today);
    const cMap: Record<number, string> = {};
    const rMap: Record<number, string> = {};
    for (const m of batch.materials) {
      cMap[m.raw_material_id] = String(m.issued_qty);
      rMap[m.raw_material_id] = '';
    }
    setActualConsumedMap(cMap);
    setReasonMap(rMap);
  };

  // Live variance preview inside Complete Batch Modal!
  const completionVariancePreview = useMemo(() => {
    if (!completingBatch || actualGood <= 0) return null;
    const fg = data.finishedGoods.find((f) => f.id === completingBatch.finished_good_id);
    if (!fg) return null;

    let matCost = 0;
    let varCost = 0;
    const lines = completingBatch.materials.map((m) => {
      const bomItem = fg.bom.find((b) => b.raw_material_id === m.raw_material_id);
      const stdForActual = bomItem
        ? Math.round(((bomItem.qty_per_100_pkts * actualGood) / 100) * 1000) / 1000
        : m.planned_qty_for_target;
      const actualConsumed = Number(actualConsumedMap[m.raw_material_id] ?? m.issued_qty);
      const varianceQty = Math.round((actualConsumed - stdForActual) * 1000) / 1000;
      const lineVarCost = Math.round(varianceQty * m.unit_cost_snapshot * 100) / 100;
      const lineMatCost = Math.round(actualConsumed * m.unit_cost_snapshot * 100) / 100;
      const returnedOrExtra = Math.round((m.issued_qty - actualConsumed) * 1000) / 1000;
      matCost += lineMatCost;
      varCost += lineVarCost;
      return {
        ...m,
        stdForActual,
        actualConsumed,
        varianceQty,
        lineVarCost,
        returnedOrExtra,
      };
    });

    const convCost = actualGood * fg.conversion_cost_per_pkt;
    const totalCost = matCost + convCost;
    const actualPerPkt = totalCost / actualGood;
    return {
      lines,
      matCost,
      convCost,
      totalCost,
      actualPerPkt,
      varCost,
      stdPerPkt: completingBatch.standard_cost_per_pkt,
    };
  }, [completingBatch, actualGood, actualConsumedMap, data.finishedGoods]);

  const handleCompleteBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingBatch) return;
    try {
      const res = await postJson(`/api/batches/${completingBatch.id}/complete`, {
        completionDate,
        actualGoodPackets: Number(actualGood),
        rejectedPackets: Number(rejected),
        materialActuals: completingBatch.materials.map((m) => ({
          rawMaterialId: m.raw_material_id,
          actualConsumedQty: Number(actualConsumedMap[m.raw_material_id] ?? m.issued_qty),
          reason: reasonMap[m.raw_material_id] || '',
        })),
      });
      notify(
        `Batch ${res.batchNo} completed! +${res.actualGoodPackets} pkts added to Finished Stock @ ${formatINR(res.actualCostPerPkt)}/pkt`
      );
      setCompletingBatch(null);
      setExpandedBatchId(res.batchId);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const openBomEditor = (fgId: number) => {
    const fg = data.finishedGoods.find((f) => f.id === fgId);
    if (!fg) return;
    setEditingBomFgId(fgId);
    setBomDraft(
      fg.bom.map((b) => ({
        raw_material_id: b.raw_material_id,
        qty_per_100_pkts: b.qty_per_100_pkts,
        notes: b.notes || '',
      }))
    );
  };

  const handleSaveBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBomFgId) return;
    try {
      await putJson(`/api/bom/${editingBomFgId}`, { items: bomDraft });
      notify('Recipe (BOM) updated; standard cost recalculated');
      setEditingBomFgId(null);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const inProgressBatches = data.batches.filter((b) => b.status === 'IN_PROGRESS');
  const completedBatches = data.batches.filter((b) => b.status === 'COMPLETED');

  return (
    <div className="space-y-6">
      {/* Row 1: Recipe (BOM) Costing Card + Start & Issue Production Batch */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Start Production Batch (BOM-Driven Issue) */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-stone-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-900 flex items-center gap-2">
                <Factory className="w-4 h-4 text-emerald-700" />
                1. Issue Raw Materials & Start Production Batch
              </h2>
              <p className="text-xs text-stone-500">
                Select SKU & target packets — system auto-computes BOM issue from store stock.
              </p>
            </div>
            {selectedFg && (
              <button
                type="button"
                onClick={() => openBomEditor(selectedFg.id)}
                className="text-xs px-2.5 py-1 rounded border border-stone-300 hover:bg-stone-100 inline-flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Edit Recipe
              </button>
            )}
          </div>

          <form onSubmit={handleStartBatch} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-700 mb-1">Snack SKU</label>
                <select
                  value={selectedFgId}
                  onChange={(e) => setSelectedFgId(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm bg-white"
                >
                  {data.finishedGoods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.sku} — {f.name} (Stock: {f.current_stock}, Free: {f.freeStock})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Target Packets</label>
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={targetPackets}
                  onChange={(e) => setTargetPackets(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm text-right"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Batch Date</label>
                <input
                  type="date"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Floor Shift / Note</label>
                <input
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder="e.g. Fryer Line 1"
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Live BOM Requirement Table */}
            <div className="rounded-lg border border-stone-200 overflow-hidden">
              <div className="bg-stone-100 px-3 py-1.5 text-[11px] font-semibold text-stone-600 uppercase flex justify-between">
                <span>Recipe (BOM) Issue Preview for {targetPackets} pkts</span>
                {selectedFg && (
                  <span>Std Cost: {formatINR(selectedFg.stdTotalCostPerPkt)} / pkt</span>
                )}
              </div>
              <table className="w-full text-xs">
                <thead className="bg-stone-50 text-stone-500">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Ingredient</th>
                    <th className="px-2.5 py-1.5 text-right">Per 100</th>
                    <th className="px-2.5 py-1.5 text-right">Planned Issue</th>
                    <th className="px-2.5 py-1.5 text-right">Store Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {plannedPreview.map((p) => (
                    <tr key={p.raw_material_id} className={p.enough ? '' : 'bg-rose-50'}>
                      <td className="px-2.5 py-1.5 font-medium text-stone-800">{p.name}</td>
                      <td className="px-2.5 py-1.5 text-right text-stone-500">
                        {p.qty_per_100_pkts} {p.unit}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-semibold">
                        {p.needed} {p.unit}
                      </td>
                      <td
                        className={`px-2.5 py-1.5 text-right font-medium ${
                          p.enough ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {p.current_stock} {p.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="submit"
              disabled={!canStartBatch}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {canStartBatch
                ? 'Issue Raw Materials & Start Batch'
                : 'Insufficient Raw Material Stock — Record Purchase First'}
            </button>
          </form>
        </div>

        {/* Right: Active Batches on Floor + Raw Material Purchase (GRN) */}
        <div className="lg:col-span-6 space-y-5">
          {/* Active In-Progress Batches */}
          <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-xs">
            <h2 className="text-base font-semibold text-stone-900 mb-3 flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-600" />
              2. Production Floor — Active Batches ({inProgressBatches.length})
            </h2>
            {inProgressBatches.length === 0 ? (
              <p className="text-xs text-stone-500">No batches currently running on the floor.</p>
            ) : (
              <div className="space-y-3">
                {inProgressBatches.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-lg border border-amber-300 bg-amber-50/50 p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm text-stone-900">
                          {b.batch_no} · {b.fg_name} ({b.sku})
                        </div>
                        <div className="text-xs text-stone-600">
                          Target: <strong>{b.target_packets} pkts</strong> · Started: {b.batch_date}
                          {b.supervisor_notes ? ` · ${b.supervisor_notes}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => openCompleteModal(b)}
                        className="px-3.5 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Record Output & Variance
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {b.materials.map((m) => (
                        <span
                          key={m.id}
                          className="px-2 py-0.5 rounded bg-white border border-amber-200 text-stone-700"
                        >
                          {m.rm_name.split(' ')[0]}: <strong>{m.issued_qty}</strong> {m.unit} issued
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Raw Material Purchase (GRN) */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
            <h2 className="text-base font-semibold text-stone-900 mb-3 flex items-center gap-2">
              <PackagePlus className="w-4 h-4 text-sky-700" />
              Raw Material Purchase (GRN & Moving Avg Cost)
            </h2>
            <form onSubmit={handleRecordPurchase} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Supplier</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(Number(e.target.value))}
                    className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    {data.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Raw Material</label>
                  <select
                    value={rmId}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setRmId(id);
                      const rm = data.rawMaterials.find((r) => r.id === id);
                      if (rm) setPurchaseRate(String(rm.avg_cost));
                    }}
                    className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    {data.rawMaterials.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.current_stock} {r.unit})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Bill #</label>
                  <input
                    type="text"
                    required
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                    className="w-full rounded border border-stone-300 px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    className="w-full rounded border border-stone-300 px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Qty</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="w-full rounded border border-stone-300 px-2 py-1.5 text-xs text-right"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Rate (₹ ex-GST)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={purchaseRate}
                    onChange={(e) => setPurchaseRate(e.target.value)}
                    className="w-full rounded border border-stone-300 px-2 py-1.5 text-xs text-right"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 px-3 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold cursor-pointer"
              >
                Post Purchase Bill → Update Store Stock, WAC & Input ITC
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Completed Batches: Planned vs Actual Variance & Cost Per Packet */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-stone-900">
            3. Completed Production Batches — Planned vs Actual Consumption & Cost Per Packet
          </h2>
          <p className="text-xs text-stone-500">
            Click any batch to inspect ingredient-by-ingredient standard qty (for actual good output) vs actual consumed, wastage ₹, and reasons.
          </p>
        </div>

        <div className="space-y-2.5">
          {completedBatches.map((b) => {
            const expanded = expandedBatchId === b.id;
            const adverse = b.total_variance_cost > 0;
            return (
              <div key={b.id} className="rounded-xl border border-stone-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedBatchId(expanded ? null : b.id)}
                  className="w-full px-4 py-3 bg-stone-50 hover:bg-stone-100 flex flex-wrap items-center justify-between gap-3 text-left cursor-pointer"
                >
                  <div>
                    <div className="font-semibold text-sm text-stone-900 flex items-center gap-2">
                      {b.batch_no} — {b.fg_name}
                      {b.total_variance_cost > 150 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-rose-100 text-rose-800">
                          <AlertTriangle className="w-3 h-3" /> Wastage Alert
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {b.batch_date} · Output: <strong>{b.actual_good_packets}</strong> / {b.target_packets} pkts (
                      {b.yield_pct}% yield, {b.rejected_packets} rejected)
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <div className="text-stone-500">Actual vs Std Cost/Pkt</div>
                      <div className="font-bold text-stone-900">
                        {formatINR(b.actual_cost_per_pkt)}{' '}
                        <span className="font-normal text-stone-500">
                          (std {formatINR(b.standard_cost_per_pkt)})
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-stone-500">Material Variance</div>
                      <div className={`font-bold ${adverse ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {adverse ? '+' : ''}
                        {formatINR(b.total_variance_cost)}
                      </div>
                    </div>
                    {expanded ? <ChevronUp className="w-4 h-4 text-stone-500" /> : <ChevronDown className="w-4 h-4 text-stone-500" />}
                  </div>
                </button>

                {expanded && (
                  <div className="p-4 bg-white border-t border-stone-200 overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-stone-50 text-stone-600 uppercase">
                        <tr>
                          <th className="px-2.5 py-2">Ingredient</th>
                          <th className="px-2.5 py-2 text-right">Issued</th>
                          <th className="px-2.5 py-2 text-right">Returned</th>
                          <th className="px-2.5 py-2 text-right">Actual Used</th>
                          <th className="px-2.5 py-2 text-right">Std for {b.actual_good_packets} pkts</th>
                          <th className="px-2.5 py-2 text-right">Variance Qty</th>
                          <th className="px-2.5 py-2 text-right">Variance %</th>
                          <th className="px-2.5 py-2 text-right">Variance ₹</th>
                          <th className="px-2.5 py-2">Floor Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {b.materials.map((m) => {
                          const isBad = m.variance_qty > 0.001;
                          const isGood = m.variance_qty < -0.001;
                          return (
                            <tr key={m.id}>
                              <td className="px-2.5 py-2 font-medium text-stone-900">{m.rm_name}</td>
                              <td className="px-2.5 py-2 text-right">
                                {m.issued_qty} {m.unit}
                              </td>
                              <td className="px-2.5 py-2 text-right text-sky-700">
                                {m.returned_qty > 0 ? `${m.returned_qty} ${m.unit}` : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-semibold">
                                {m.actual_consumed_qty} {m.unit}
                              </td>
                              <td className="px-2.5 py-2 text-right text-stone-600">
                                {m.std_qty_for_actual_output} {m.unit}
                              </td>
                              <td
                                className={`px-2.5 py-2 text-right font-semibold ${
                                  isBad ? 'text-rose-700' : isGood ? 'text-emerald-700' : 'text-stone-600'
                                }`}
                              >
                                {m.variance_qty > 0 ? '+' : ''}
                                {m.variance_qty} {m.unit}
                              </td>
                              <td
                                className={`px-2.5 py-2 text-right ${
                                  Math.abs(m.variance_pct) > 3 ? 'font-bold text-rose-700' : 'text-stone-600'
                                }`}
                              >
                                {m.variance_pct > 0 ? '+' : ''}
                                {m.variance_pct}%
                              </td>
                              <td
                                className={`px-2.5 py-2 text-right font-semibold ${
                                  m.variance_cost > 0 ? 'text-rose-700' : 'text-emerald-700'
                                }`}
                              >
                                {m.variance_cost > 0 ? '+' : ''}
                                {formatINR(m.variance_cost)}
                              </td>
                              <td className="px-2.5 py-2 text-stone-500">{m.variance_reason || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-3 pt-2 border-t border-stone-100 flex flex-wrap justify-between text-xs text-stone-600">
                      <span>
                        Material Cost: <strong>{formatINR(b.total_material_cost)}</strong> + Conversion/Overheads:{' '}
                        <strong>{formatINR(b.conversion_cost_total)}</strong> = Total Batch Cost:{' '}
                        <strong className="text-stone-900">{formatINR(b.total_batch_cost)}</strong>
                      </span>
                      <span>
                        Posted <strong>+{b.actual_good_packets} pkts</strong> to Finished Goods Stock @{' '}
                        <strong>{formatINR(b.actual_cost_per_pkt)}/pkt</strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Complete Production Batch Modal (with Live Planned-vs-Actual Variance Calculator) */}
      {completingBatch && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCompleteBatch}
            className="bg-white rounded-xl max-w-4xl w-full p-6 shadow-2xl space-y-4 my-8"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-base text-stone-900">
                  Complete Production Batch — {completingBatch.batch_no} ({completingBatch.fg_name})
                </h3>
                <p className="text-xs text-stone-500">
                  Enter actual packets produced and actual raw materials consumed. Unused material is automatically returned to Store Stock.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompletingBatch(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Actual Good Packets (Target: {completingBatch.target_packets})
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={actualGood}
                  onChange={(e) => setActualGood(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Rejected / Damaged Packets
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={rejected}
                  onChange={(e) => setRejected(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Completion Date</label>
                <input
                  type="date"
                  required
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-stone-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-stone-100 text-stone-600 uppercase">
                  <tr>
                    <th className="px-3 py-2">Ingredient</th>
                    <th className="px-3 py-2 text-right">Issued</th>
                    <th className="px-3 py-2 text-right">Std for {actualGood} pkts</th>
                    <th className="px-3 py-2 text-right">Actual Consumed</th>
                    <th className="px-3 py-2 text-right">Return / Extra</th>
                    <th className="px-3 py-2 text-right">Variance ₹</th>
                    <th className="px-3 py-2">Reason (if variance)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {(completionVariancePreview?.lines || []).map((line) => (
                    <tr key={line.raw_material_id}>
                      <td className="px-3 py-2 font-medium text-stone-900">{line.rm_name}</td>
                      <td className="px-3 py-2 text-right">
                        {line.issued_qty} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right text-stone-600">
                        {line.stdForActual} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={actualConsumedMap[line.raw_material_id] ?? ''}
                          onChange={(e) =>
                            setActualConsumedMap((prev) => ({
                              ...prev,
                              [line.raw_material_id]: e.target.value,
                            }))
                          }
                          className="w-24 rounded border border-stone-300 px-2 py-1 text-right font-semibold"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-[11px]">
                        {line.returnedOrExtra > 0 ? (
                          <span className="text-sky-700">Return {line.returnedOrExtra}</span>
                        ) : line.returnedOrExtra < 0 ? (
                          <span className="text-amber-700">Extra {Math.abs(line.returnedOrExtra)}</span>
                        ) : (
                          'Exact'
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          line.lineVarCost > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {line.lineVarCost > 0 ? '+' : ''}
                        {formatINR(line.lineVarCost)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={reasonMap[line.raw_material_id] ?? ''}
                          onChange={(e) =>
                            setReasonMap((prev) => ({
                              ...prev,
                              [line.raw_material_id]: e.target.value,
                            }))
                          }
                          placeholder="e.g. Oil absorption / tear"
                          className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {completionVariancePreview && (
              <div className="grid grid-cols-3 gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200 text-xs">
                <div>
                  <div className="text-stone-500">Total Batch Cost</div>
                  <div className="text-base font-bold text-stone-900">
                    {formatINR(completionVariancePreview.totalCost)}
                  </div>
                </div>
                <div>
                  <div className="text-stone-500">Actual Cost / Packet</div>
                  <div className="text-base font-bold text-stone-900">
                    {formatINR(completionVariancePreview.actualPerPkt)}{' '}
                    <span className="text-xs font-normal text-stone-500">
                      (Std {formatINR(completionVariancePreview.stdPerPkt)})
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-stone-500">Total Material Variance</div>
                  <div
                    className={`text-base font-bold ${
                      completionVariancePreview.varCost > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {completionVariancePreview.varCost > 0 ? '+' : ''}
                    {formatINR(completionVariancePreview.varCost)}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompletingBatch(null)}
                className="px-4 py-2 rounded-lg border border-stone-300 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold cursor-pointer"
              >
                Complete Batch & Add +{actualGood} Pkts to Finished Stock
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BOM Editor Modal */}
      {editingBomFgId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveBom} className="bg-white rounded-xl max-w-xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-stone-900">
                Edit Recipe (BOM) per 100 Packets —{' '}
                {data.finishedGoods.find((f) => f.id === editingBomFgId)?.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingBomFgId(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {bomDraft.map((item, idx) => {
                const rm = data.rawMaterials.find((r) => r.id === item.raw_material_id);
                return (
                  <div key={idx} className="flex items-center gap-2 bg-stone-50 p-2 rounded">
                    <span className="flex-1 text-xs font-medium">{rm?.name}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={item.qty_per_100_pkts}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBomDraft((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, qty_per_100_pkts: v } : x))
                        );
                      }}
                      className="w-24 rounded border border-stone-300 px-2 py-1 text-xs text-right"
                    />
                    <span className="text-xs text-stone-500 w-10">{rm?.unit}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingBomFgId(null)}
                className="px-3 py-1.5 rounded border border-stone-300 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-stone-900 text-white text-sm font-medium cursor-pointer"
              >
                Save Recipe
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
