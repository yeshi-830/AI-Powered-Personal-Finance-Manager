# Finora

Finora is a local-first personal finance manager for tracking transactions, monthly budgets, and savings goals. It stores financial records in a SQLite database on your computer and calculates balances, cash flow, and budget progress from that data.

## Features

- Record, edit, search, and delete income and expense transactions
- Export transactions as CSV
- Create and manage monthly category budgets
- Set savings goals, track progress, and record contributions
- Review your lifetime balance, weekly or monthly totals, and daily cash flow
- Keep data in a local SQLite database between app restarts

## Requirements

- Node.js 22.13 or newer (the backend uses Node's built-in SQLite module)
- npm

## Run locally

Install dependencies in both projects, then start the frontend from its directory. The frontend command starts the backend API and Vite together.

**Install dependencies**

```powershell
cd backend
npm install
cd frontend
npm install
```

**Start the app**

```powershell
cd frontend
npm run dev
```

Open the Vite URL shown in the frontend terminal (usually `http://localhost:5173`). During development, Vite forwards `/api` requests to the backend at `http://127.0.0.1:4000`.

The backend creates `backend/data/finora.sqlite` on first run. This database is excluded from Git because it may contain personal financial records. Back it up regularly if you need to preserve your data.

## Configuration

Backend settings can be provided through environment variables or a `backend/.env` file.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Port used by the API server |
| `HOST` | `0.0.0.0` | Network interface used by the API server |
| `DB_PATH` | `backend/data/finora.sqlite` | Path to the SQLite database |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Comma-separated list of allowed browser origins |

The default `HOST` makes the API listen on all network interfaces. For a local-only setup, set `HOST=127.0.0.1` in `backend/.env`.

## API

All routes are prefixed with `/api`.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Check API availability |
| `GET` | `/transactions` | List transactions |
| `POST` | `/transactions` | Create a transaction |
| `PUT` | `/transactions/:id` | Update a transaction |
| `DELETE` | `/transactions/:id` | Delete a transaction |
| `GET` | `/dashboard?period=week\|month` | Retrieve balances, period totals, cash flow, and budgets |
| `GET` | `/budgets` | List monthly budgets |
| `PUT` | `/budgets/:category` | Create or update a category budget |
| `DELETE` | `/budgets/:category` | Delete a category budget |
| `GET` | `/goals` | List savings goals |
| `POST` | `/goals` | Create a savings goal |
| `PUT` | `/goals/:id` | Update a savings goal |
| `DELETE` | `/goals/:id` | Delete a savings goal |
| `POST` | `/goals/:id/contributions` | Add to a savings goal |

Transaction amounts, budget limits, savings targets, and contributions are in USD. Savings goals use `name`, `targetAmount`, and `savedAmount`, with an optional `targetDate` in `YYYY-MM-DD` format. Contribution requests contain an `amount`.

## Verification

Run the backend tests:

```powershell
cd backend
npm test
```

Check and build the frontend:

```powershell
cd frontend
npm run lint
npm run build
```

## Data and account model

Finora is currently a single-user local application. It does not provide sign-in or cloud synchronization. Financial records remain in the configured SQLite database; protect and back up that file as appropriate.
