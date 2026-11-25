import React, { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  Factory,
  FileSpreadsheet,
  LayoutDashboard,
  RefreshCw,
  ShoppingCart,
} from 'lucide-react';
import { fetchBootstrap, fetchMonthlyReport } from './api';
import type { BootstrapData, MonthlyAuditReport } from './types';
import { OverviewTab, type TabKey } from './components/OverviewTab';
import { SalesLoopTab } from './components/SalesLoopTab';
import { ProductionLoopTab } from './components/ProductionLoopTab';
import { StockLedgerTab } from './components/StockLedgerTab';
import { AuditorReportTab } from './components/AuditorReportTab';

export function App() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [month, setMonth] = useState('2026-11');
  const [data, setData] = useState<BootstrapData | null>(null);
  const [report, setReport] = useState<MonthlyAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [preselectedFgId, setPreselectedFgId] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const refresh = useCallback(async () => {
    const [b, r] = await Promise.all([fetchBootstrap(), fetchMonthlyReport(month)]);
    setData(b);
    setReport(r);
  }, [month]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((err) => notify(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [refresh, notify]);

  const handleJumpToProduction = (fgId?: number) => {
    setPreselectedFgId(fgId);
    setTab('production');
  };

  const navItems: Array<{ key: TabKey; label: string; icon: React.ReactNode; badge?: number }> = [
    { key: 'overview', label: 'Two-Loop Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    {
      key: 'sales',
      label: 'Sales Loop (Orders → GST → AR)',
      icon: <ShoppingCart className="w-4 h-4" />,
      badge: data?.orders.filter((o) => o.status === 'PENDING_VERIFICATION' || o.status === 'VERIFIED').length,
    },
    {
      key: 'production',
      label: 'Production Loop (BOM & Variance)',
      icon: <Factory className="w-4 h-4" />,
      badge: data?.batches.filter((b) => b.status === 'IN_PROGRESS').length,
    },
    { key: 'stock', label: 'Stock Hub & Ledgers', icon: <Boxes className="w-4 h-4" /> },
    { key: 'auditor', label: 'Month-End Auditor Pack', icon: <FileSpreadsheet className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Top Factory Header */}
      <header className="bg-stone-900 text-white border-b border-stone-800 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 text-stone-950 font-black flex items-center justify-center text-sm">
              KS
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight">
                {data?.company.name || 'Kaveri Heritage Snacks Pvt. Ltd.'}
              </h1>
              <p className="text-[11px] text-stone-400">
                Order-to-Audit ERP · Single-Entry Sales, BOM Production & GST Ledger · GSTIN:{' '}
                {data?.company.gstin || '33AABCK4521M1Z8'}
              </p>
            </div>
          </div>
          <button
            onClick={() => refresh().then(() => notify('Synced with ledger database'))}
            className="text-xs px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {navItems.map((n) => {
            const active = tab === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setTab(n.key)}
                className={`px-3.5 py-2.5 text-xs font-medium inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition cursor-pointer ${
                  active
                    ? 'border-amber-400 text-amber-300 bg-stone-800/70'
                    : 'border-transparent text-stone-300 hover:text-white hover:bg-stone-800/40'
                }`}
              >
                {n.icon}
                {n.label}
                {n.badge !== undefined && n.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-stone-950">
                    {n.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 no-print">
          <div
            className={`px-4 py-3 rounded-xl shadow-lg text-xs font-semibold border max-w-md ${
              toast.type === 'error'
                ? 'bg-rose-900 text-white border-rose-700'
                : 'bg-emerald-900 text-white border-emerald-700'
            }`}
          >
            {toast.msg}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading && !data ? (
          <div className="bg-white rounded-xl border border-stone-200 p-10 text-center text-sm text-stone-500">
            Loading factory ledgers...
          </div>
        ) : data ? (
          <>
            {tab === 'overview' && <OverviewTab data={data} report={report} onNavigate={setTab} />}
            {tab === 'sales' && (
              <SalesLoopTab
                data={data}
                onRefresh={refresh}
                onJumpToProduction={handleJumpToProduction}
                notify={notify}
              />
            )}
            {tab === 'production' && (
              <ProductionLoopTab
                data={data}
                preselectedFgId={preselectedFgId}
                onRefresh={refresh}
                notify={notify}
              />
            )}
            {tab === 'stock' && <StockLedgerTab data={data} notify={notify} />}
            {tab === 'auditor' && (
              <AuditorReportTab month={month} onMonthChange={setMonth} report={report} />
            )}
          </>
        ) : (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-sm text-rose-800">
            Could not connect to backend API. Ensure `npm run dev` or `node server/index.js` is running.
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
