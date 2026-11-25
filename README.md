# Order-to-Audit System for Small Food Manufactuing Companies

A single-entry ERP prototype for a small-scale South Indian packaged snacks factory (murukku, mixture, banana chips, sweets) linking the **Sales Loop** and **Production Loop** through a unified **Finished-Goods Stock Hub** into a **Month-End Accountant & Auditor Pack**.

## Architecture: Two Loops, One Source of Truth

- **Sales Loop**: Field Salesman Order → Admin Verification (stock check, no re-typing) → One-Click GST Invoice (CGST+SGST intra-state or IGST inter-state, B2B/B2C) & Dispatch (`finished_goods_ledger` OUT + COGS + AR) → Collections (`UPI`/`NEFT`/`CASH`/`CHEQUE`).
- **Production Loop**: Raw Material Purchase (GRN updating Moving Weighted Average Cost + Input Tax Credit) → BOM-Driven Material Issue → Batch Completion with Actual Good/Rejected Output, Unused Material Returns & Excess Consumption → Ingredient-level **Planned vs Actual Variance** (Qty, %, ₹, Reason) & **Actual Cost per Packet** → `finished_goods_ledger` IN.
- **Month-End Auditor Pack**: Automatically computes `Opening + In - Out = Closing` stock reconciliations, GSTR-1 & GSTR-3B summaries, HSN summaries, SKU unit margins, salesman collections, open receivables, and CSV/Print exports.

## Running Locally

```bash
npm install
npm run dev
```

- Frontend (Vite): `http://localhost:5173`
- Backend API (Express + SQLite via `node:sqlite`): `http://localhost:3001`

## Tests & Production Build

```bash
npm test
npm run build
npm start
```
