import type { BootstrapData, LedgerEntry, MonthlyAuditReport } from './types';

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchBootstrap(): Promise<BootstrapData> {
  return handleResponse(await fetch('/api/bootstrap'));
}

export async function fetchMonthlyReport(month: string): Promise<MonthlyAuditReport> {
  return handleResponse(await fetch(`/api/reports/monthly?month=${encodeURIComponent(month)}`));
}

export async function fetchInvoiceDetail(id: number) {
  return handleResponse<any>(await fetch(`/api/invoices/${id}`));
}

export async function fetchStockLedger(kind: 'finished' | 'raw', id: number): Promise<LedgerEntry[]> {
  return handleResponse(await fetch(`/api/ledgers/${kind}/${id}`));
}

export async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  return handleResponse(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function putJson<T = any>(url: string, body: unknown): Promise<T> {
  return handleResponse(
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
