# Finora

Finora is a local-first personal finance manager. It stores transactions and monthly budgets in a SQLite database on your computer, then calculates balances, cash flow, and budget progress from those saved records.

## Requirements

- Node.js 22.13 or newer (the backend uses Node's built-in SQLite module)
- npm

## Run locally

Open two terminals from the project root:

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the frontend terminal (normally `http://localhost:5173`). The Vite development server proxies `/api` requests to the backend at `http://127.0.0.1:4000`.

The backend creates `backend/data/finora.sqlite` automatically. This database is intentionally ignored by Git because it contains personal financial records. Backend settings can be supplied through environment variables or a `backend/.env` file: set `PORT` to change the API port, `HOST` to change its bind address, `DB_PATH` to choose another database file, and `FRONTEND_ORIGIN` to configure allowed browser origins (comma-separated). The API binds to `127.0.0.1` by default.

## Features

- Add, edit, delete, search, and CSV-export income and expense transactions
- Set and manage monthly category budgets
- View lifetime balance, week/month totals, daily cash flow, and budget progress
- Persist data across restarts in SQLite

## API

- `GET /api/health`
- `GET /api/transactions`
- `POST`, `PUT /api/transactions/:id`, `DELETE /api/transactions/:id`
- `GET /api/dashboard?period=week|month`
- `GET /api/budgets`
- `PUT`, `DELETE /api/budgets/:category`

The app is currently a single-user local application and does not include sign-in or cloud synchronization. Keep a backup of `backend/data/finora.sqlite` if you need to preserve your records.

## Verify

```powershell
cd backend
npm test
```

```powershell
cd frontend
npm run lint
npm run build
```
