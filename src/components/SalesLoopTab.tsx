import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  FileText,
  Plus,
  Printer,
  Send,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import type { BootstrapData, Invoice, SalesOrder } from '../types';
import { fetchInvoiceDetail, formatINR, postJson } from '../api';

interface Props {
  data: BootstrapData;
  onRefresh: () => Promise<void>;
  onJumpToProduction: (fgId?: number) => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export function SalesLoopTab({ data, onRefresh, onJumpToProduction, notify }: Props) {
  const today = '2026-11-25';

  // Salesman Order Form State
  const [salesmanId, setSalesmanId] = useState<number>(data.salesmen[0]?.id ?? 1);
  const [customerId, setCustomerId] = useState<number>(data.customers[0]?.id ?? 1);
  const [orderDate, setOrderDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<Array<{ finishedGoodId: number; qty: number }>>([
    { finishedGoodId: data.finishedGoods[0]?.id ?? 1, qty: 100 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Admin Verify Modal / Inline Edit
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [approvedQtyMap, setApprovedQtyMap] = useState<Record<number, number>>({});

  // Collection Modal State
  const [collectingInv, setCollectingInv] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<'UPI' | 'NEFT' | 'CASH' | 'CHEQUE'>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(today);

  // Printable Tax Invoice Modal State
  const [invoiceModal, setInvoiceModal] = useState<any | null>(null);

  const selectedCustomer = useMemo(
    () => data.customers.find((c) => c.id === customerId),
    [data.customers, customerId]
  );

  // When salesman changes, auto-suggest their primary customer
  const handleSalesmanChange = (id: number) => {
    setSalesmanId(id);
    const matchingCust = data.customers.find((c) => c.salesman_id === id);
    if (matchingCust) setCustomerId(matchingCust.id);
  };

  const orderPreview = useMemo(() => {
    let taxable = 0;
    let gst = 0;
    for (const li of lineItems) {
      const fg = data.finishedGoods.find((f) => f.id === li.finishedGoodId);
      if (!fg || !li.qty) continue;
      const rate =
        selectedCustomer?.type === 'Distributor' ? fg.distributor_rate : fg.retailer_rate;
      const lineTaxable = rate * li.qty;
      taxable += lineTaxable;
      gst += (lineTaxable * fg.gst_rate) / 100;
    }
    return { taxable, gst, total: Math.round(taxable + gst) };
  }, [lineItems, data.finishedGoods, selectedCustomer]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await postJson('/api/orders', {
        orderDate,
        salesmanId,
        customerId,
        notes,
        items: lineItems.filter((l) => l.qty > 0),
      });
      notify(`Order ${res.orderNo} submitted to Admin Verification queue`);
      setNotes('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openVerify = (order: SalesOrder) => {
    setEditingOrder(order);
    const map: Record<number, number> = {};
    for (const it of order.items) {
      map[it.finished_good_id] = it.approved_qty;
    }
    setApprovedQtyMap(map);
  };

  const handleVerifyOrder = async (orderId: number, useModalMap = false) => {
    try {
      const payload = useModalMap
        ? {
            approvedItems: Object.entries(approvedQtyMap).map(([fgId, qty]) => ({
              finishedGoodId: Number(fgId),
              approvedQty: Number(qty),
            })),
          }
        : {};
      const res = await postJson(`/api/orders/${orderId}/verify`, payload);
      notify(`Order ${res.orderNo} verified and ready for GST billing`);
      setEditingOrder(null);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleDispatch = async (order: SalesOrder) => {
    try {
      const res = await postJson(`/api/orders/${order.id}/dispatch`, {
        invoiceDate: today,
      });
      notify(
        `Dispatched! ${res.invoiceNo} (${res.gstCategory}/${res.supplyType}) for ${formatINR(res.grandTotal)}. Stock deducted.`
      );
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleCancelOrder = async (order: SalesOrder) => {
    try {
      await postJson(`/api/orders/${order.id}/cancel`, {});
      notify(`Order ${order.order_no} cancelled`);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleOpenInvoice = async (invoiceId: number) => {
    try {
      const detail = await fetchInvoiceDetail(invoiceId);
      setInvoiceModal(detail);
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectingInv) return;
    try {
      const res = await postJson('/api/collections', {
        invoiceId: collectingInv.id,
        paymentDate: payDate,
        amount: Number(payAmount),
        mode: payMode,
        referenceNo: payRef,
      });
      notify(`Receipt ${res.receiptNo} recorded (${res.status})`);
      setCollectingInv(null);
      setPayAmount('');
      setPayRef('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const pendingOrders = data.orders.filter((o) => o.status === 'PENDING_VERIFICATION');
  const verifiedOrders = data.orders.filter((o) => o.status === 'VERIFIED');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Field Salesman Mobile-Style Order Entry */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-stone-900 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-sky-600" />
                1. Field Salesman Order Entry
              </h2>
              <p className="text-xs text-stone-500">
                Entered once by salesman; flows directly to Admin Billing without re-typing.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmitOrder} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Salesman</label>
                <select
                  value={salesmanId}
                  onChange={(e) => handleSalesmanChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm bg-white"
                >
                  {data.salesmen.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.territory.split(' ')[0]})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">Order Date</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Customer (Retailer / Distributor)
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(Number(e.target.value))}
                className="w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm bg-white"
              >
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.type} ({c.city})
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-stone-600">
                  <span className="px-2 py-0.5 rounded bg-stone-100">
                    Price Tier: <strong>{selectedCustomer.type}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-stone-100">
                    GST:{' '}
                    <strong>
                      {selectedCustomer.state_code === data.company.stateCode
                        ? 'CGST + SGST (Intra-TN)'
                        : 'IGST (Inter-State)'}
                    </strong>{' '}
                    · {selectedCustomer.gstin ? 'B2B' : 'B2C'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-stone-100">
                    Due: <strong>{formatINR(selectedCustomer.outstanding)}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-stone-700">Order Items (Packets)</label>
                <button
                  type="button"
                  onClick={() =>
                    setLineItems((prev) => [
                      ...prev,
                      { finishedGoodId: data.finishedGoods[0]?.id ?? 1, qty: 50 },
                    ])
                  }
                  className="text-xs text-sky-700 hover:text-sky-900 font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add SKU
                </button>
              </div>

              {lineItems.map((li, idx) => {
                const fg = data.finishedGoods.find((f) => f.id === li.finishedGoodId);
                const rate =
                  selectedCustomer?.type === 'Distributor'
                    ? fg?.distributor_rate ?? 0
                    : fg?.retailer_rate ?? 0;
                const isShort = fg ? li.qty > fg.freeStock : false;
                return (
                  <div key={idx} className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 space-y-1.5">
                    <div className="flex gap-2 items-center">
                      <select
                        value={li.finishedGoodId}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLineItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, finishedGoodId: val } : x))
                          );
                        }}
                        className="flex-1 rounded border border-stone-300 px-2 py-1.5 text-xs bg-white"
                      >
                        {data.finishedGoods.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.sku} — {f.name} (Stock: {f.current_stock}, Free: {f.freeStock})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={li.qty}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLineItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, qty: val } : x))
                          );
                        }}
                        className="w-20 rounded border border-stone-300 px-2 py-1.5 text-xs text-right bg-white"
                      />
                      {lineItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-stone-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-stone-500">
                      <span>
                        Rate: {formatINR(rate)} + {fg?.gst_rate}% GST
                      </span>
                      {isShort ? (
                        <span className="text-amber-700 font-medium">
                          Exceeds free stock ({fg?.freeStock} free) — needs batch
                        </span>
                      ) : (
                        <span className="text-emerald-700">Stock available</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">Route / Delivery Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Morning van dispatch, urgency note"
                className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 flex items-center justify-between text-xs">
              <div>
                <div className="text-sky-900 font-medium">Estimated Order Total</div>
                <div className="text-sky-700">
                  Taxable {formatINR(orderPreview.taxable)} + GST {formatINR(orderPreview.gst)}
                </div>
              </div>
              <div className="text-lg font-bold text-sky-950">{formatINR(orderPreview.total)}</div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting...' : 'Submit Salesman Order'}
            </button>
          </form>
        </div>

        {/* Right: Admin Verification & Billing/Dispatch Queue */}
        <div className="lg:col-span-7 space-y-5">
          {/* Pending Verification Queue */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
            <h2 className="text-base font-semibold text-stone-900 mb-3">
              2. Admin Verification Queue ({pendingOrders.length})
            </h2>
            {pendingOrders.length === 0 ? (
              <p className="text-xs text-stone-500 py-3">No orders awaiting verification.</p>
            ) : (
              <div className="space-y-3">
                {pendingOrders.map((o) => (
                  <div
                    key={o.id}
                    className={`rounded-lg border p-3.5 ${
                      o.shortStock ? 'border-amber-300 bg-amber-50/40' : 'border-stone-200 bg-stone-50/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm text-stone-900">
                          {o.order_no} · {o.customer_name}{' '}
                          <span className="text-xs font-normal text-stone-500">
                            ({o.customer_type}, {o.customer_city})
                          </span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          Salesman: {o.salesman_name} · Date: {o.order_date}
                          {o.notes ? ` · "${o.notes}"` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openVerify(o)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-stone-300 bg-white hover:bg-stone-100 font-medium cursor-pointer"
                        >
                          Adjust Qty
                        </button>
                        <button
                          onClick={() => handleVerifyOrder(o.id, false)}
                          className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verify
                        </button>
                        <button
                          onClick={() => handleCancelOrder(o)}
                          className="text-xs px-2 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {o.items.map((it) => {
                        const short = it.approved_qty > it.available_stock;
                        return (
                          <div
                            key={it.id}
                            className={`text-xs px-2.5 py-1.5 rounded border flex items-center justify-between ${
                              short
                                ? 'bg-rose-50 border-rose-200 text-rose-900'
                                : 'bg-white border-stone-200 text-stone-700'
                            }`}
                          >
                            <span>
                              <strong>{it.sku}</strong> × {it.approved_qty} pkts @ {formatINR(it.unit_rate)}
                            </span>
                            {short ? (
                              <button
                                onClick={() => onJumpToProduction(it.finished_good_id)}
                                className="underline font-semibold text-rose-700 cursor-pointer"
                              >
                                Have {it.available_stock} → Produce
                              </button>
                            ) : (
                              <span className="text-emerald-700">Stock: {it.available_stock}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ready for GST Invoice & Dispatch */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
            <h2 className="text-base font-semibold text-stone-900 mb-3">
              3. Verified Orders — Ready for GST Invoice & Dispatch ({verifiedOrders.length})
            </h2>
            {verifiedOrders.length === 0 ? (
              <p className="text-xs text-stone-500 py-3">No verified orders waiting for dispatch.</p>
            ) : (
              <div className="space-y-3">
                {verifiedOrders.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-lg border border-sky-200 bg-sky-50/30 p-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-sm text-stone-900">
                        {o.order_no} → {o.customer_name}
                      </div>
                      <div className="text-xs text-stone-600 mt-0.5">
                        {o.items.map((i) => `${i.sku}: ${i.approved_qty} pkts`).join(' · ')}
                      </div>
                      {o.shortStock && (
                        <div className="text-xs text-rose-700 font-medium mt-1">
                          Blocked: Finished stock insufficient. Run a production batch first!
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {o.shortStock && (
                        <button
                          onClick={() => onJumpToProduction(o.items[0]?.finished_good_id)}
                          className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 font-medium cursor-pointer"
                        >
                          Go to Production
                        </button>
                      )}
                      <button
                        onClick={() => handleDispatch(o)}
                        className="text-xs px-3.5 py-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Generate GST Invoice & Dispatch
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invoices & Collections Ledger */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              4. GST Invoices, Receivables & Collections
            </h2>
            <p className="text-xs text-stone-500">
              Dispatching an invoice automatically deducts Finished Goods stock and creates Customer Receivable.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-100 text-stone-600 uppercase">
              <tr>
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">GST Type</th>
                <th className="px-3 py-2 text-right">Taxable</th>
                <th className="px-3 py-2 text-right">GST</th>
                <th className="px-3 py-2 text-right">Grand Total</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance Due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.invoices.map((inv) => {
                const gstSum = inv.cgst_amount + inv.sgst_amount + inv.igst_amount;
                return (
                  <tr key={inv.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2.5 font-semibold text-stone-900">{inv.invoice_no}</td>
                    <td className="px-3 py-2.5 text-stone-600">{inv.invoice_date}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-stone-900">{inv.customer_name}</div>
                      <div className="text-[11px] text-stone-500">{inv.salesman_name}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-stone-100 font-medium">
                        {inv.gst_category} · {inv.supply_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatINR(inv.taxable_amount)}</td>
                    <td className="px-3 py-2.5 text-right">{formatINR(gstSum)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{formatINR(inv.grand_total)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-700">{formatINR(inv.paid_amount)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-rose-700">
                      {formatINR(inv.balance_due)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          inv.status === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : inv.status === 'PARTIAL'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => handleOpenInvoice(inv.id)}
                        className="px-2 py-1 rounded border border-stone-300 hover:bg-stone-100 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3 h-3" /> Tax Invoice
                      </button>
                      {inv.status !== 'PAID' && (
                        <button
                          onClick={() => {
                            setCollectingInv(inv);
                            setPayAmount(String(inv.balance_due));
                          }}
                          className="px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CreditCard className="w-3 h-3" /> Collect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust & Verify Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-stone-900">
                Verify & Adjust Quantities — {editingOrder.order_no}
              </h3>
              <button onClick={() => setEditingOrder(null)} className="text-stone-400 hover:text-stone-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {editingOrder.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 p-2.5 rounded bg-stone-50">
                  <div className="text-xs">
                    <div className="font-semibold">{it.fg_name}</div>
                    <div className="text-stone-500">
                      Requested: {it.requested_qty} · Available Stock: {it.available_stock}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={approvedQtyMap[it.finished_good_id] ?? it.approved_qty}
                    onChange={(e) =>
                      setApprovedQtyMap((prev) => ({
                        ...prev,
                        [it.finished_good_id]: Number(e.target.value),
                      }))
                    }
                    className="w-24 rounded border border-stone-300 px-2 py-1 text-sm text-right"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingOrder(null)}
                className="px-3 py-1.5 rounded border border-stone-300 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleVerifyOrder(editingOrder.id, true)}
                className="px-4 py-1.5 rounded bg-emerald-700 text-white text-sm font-medium cursor-pointer"
              >
                Save & Verify Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {collectingInv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordCollection}
            className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-stone-900">
                Record Collection — {collectingInv.invoice_no}
              </h3>
              <button
                type="button"
                onClick={() => setCollectingInv(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-stone-600 bg-stone-50 p-3 rounded-lg">
              Customer: <strong>{collectingInv.customer_name}</strong> · Balance Due:{' '}
              <strong className="text-rose-700">{formatINR(collectingInv.balance_due)}</strong>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  max={collectingInv.balance_due}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Payment Date</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as any)}
                  className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-sm bg-white"
                >
                  <option value="UPI">UPI</option>
                  <option value="NEFT">NEFT / RTGS</option>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Reference / UTR</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR / Receipt #"
                  className="w-full rounded border border-stone-300 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCollectingInv(null)}
                className="px-3 py-1.5 rounded border border-stone-300 text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
              >
                Post Receipt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable GST Tax Invoice Modal */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3 no-print">
              <h3 className="font-semibold text-stone-900">Tax Invoice Preview</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded bg-stone-900 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button
                  onClick={() => setInvoiceModal(null)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-base font-bold text-stone-900">{invoiceModal.company.name}</div>
                  <div className="text-stone-600">{invoiceModal.company.address}</div>
                  <div className="font-medium mt-0.5">
                    GSTIN: {invoiceModal.company.gstin} · State: {invoiceModal.company.stateName} (
                    {invoiceModal.company.stateCode})
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold uppercase text-amber-800">TAX INVOICE</div>
                  <div className="font-semibold">{invoiceModal.invoice.invoice_no}</div>
                  <div>Date: {invoiceModal.invoice.invoice_date}</div>
                  <div>Order Ref: {invoiceModal.invoice.order_no}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-stone-50 p-3 rounded border border-stone-200">
                <div>
                  <div className="font-semibold text-stone-700">Billed To:</div>
                  <div className="font-bold text-stone-900">{invoiceModal.invoice.customer_name}</div>
                  <div>
                    {invoiceModal.invoice.city}, {invoiceModal.invoice.state_name} (
                    {invoiceModal.invoice.state_code})
                  </div>
                  <div>
                    GSTIN: {invoiceModal.invoice.customer_gstin || 'Unregistered (B2C)'}
                  </div>
                </div>
                <div className="text-right">
                  <div>Supply Type: {invoiceModal.invoice.supply_type}</div>
                  <div>Salesman: {invoiceModal.invoice.salesman_name}</div>
                  <div>Due Date: {invoiceModal.invoice.due_date}</div>
                </div>
              </div>

              <table className="w-full border border-stone-200">
                <thead className="bg-stone-100">
                  <tr>
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2">HSN</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 text-right">Taxable</th>
                    <th className="p-2 text-right">GST %</th>
                    <th className="p-2 text-right">Tax Amt</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {invoiceModal.items.map((it: any) => (
                    <tr key={it.id}>
                      <td className="p-2 font-medium">
                        {it.fg_name} ({it.sku})
                      </td>
                      <td className="p-2 text-center">{it.hsn_code}</td>
                      <td className="p-2 text-right">{it.qty}</td>
                      <td className="p-2 text-right">{formatINR(it.unit_rate)}</td>
                      <td className="p-2 text-right">{formatINR(it.taxable_amount)}</td>
                      <td className="p-2 text-right">{it.gst_rate}%</td>
                      <td className="p-2 text-right">
                        {formatINR(it.cgst_amount + it.sgst_amount + it.igst_amount)}
                      </td>
                      <td className="p-2 text-right font-semibold">{formatINR(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-right">
                  <div className="flex justify-between">
                    <span>Taxable Value:</span>
                    <span>{formatINR(invoiceModal.invoice.taxable_amount)}</span>
                  </div>
                  {invoiceModal.invoice.supply_type === 'INTRA' ? (
                    <>
                      <div className="flex justify-between">
                        <span>CGST:</span>
                        <span>{formatINR(invoiceModal.invoice.cgst_amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>SGST:</span>
                        <span>{formatINR(invoiceModal.invoice.sgst_amount)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span>IGST:</span>
                      <span>{formatINR(invoiceModal.invoice.igst_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Round Off:</span>
                    <span>{formatINR(invoiceModal.invoice.round_off)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-1">
                    <span>Grand Total:</span>
                    <span>{formatINR(invoiceModal.invoice.grand_total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
