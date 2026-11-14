# Finora

Finora is a local-first personal finance manager for tracking transactions, monthly budgets, and savings goals. It stores financial records in a SQLite database on your computer and calculates balances, cash flow, and budget progress from that data.

## Features

- Record, edit, search, and delete income and expense transactions
- Search across transactions, budgets, savings goals, and recurring schedules
- Filter transactions by date, category, and type; sort, paginate, and bulk-delete up to 100 records at a time
- Import up to 500 transactions from a validated CSV file and export CSV reports with spreadsheet-formula injection protection
- Create and manage monthly category budgets
- Set savings goals, track progress, and record contributions
- Review your lifetime balance, weekly or monthly totals, and daily cash flow
- Create recurring income and expense schedules and apply the next occurrence automatically
- Get smart budget and goal recommendations based on your current spending pattern
- Review budget and upcoming-payment notifications and an audit activity timeline
- Follow a first-run guide, customize dashboard widgets, switch themes, and download a portable JSON backup
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

Open the Vite URL shown in the frontend terminal (usually `http://localhost:5173`). During development, the frontend starts the backend automatically and forwards `/api` requests to whichever port is available, starting from `4000` when it is free.

The backend creates `backend/data/finora.sqlite` on first run. This database is excluded from Git because it may contain personal financial records. Back it up regularly if you need to preserve your data.

## Configuration

Backend settings can be provided through environment variables or a `backend/.env` file.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Preferred port for the API server; if it is occupied, the server will automatically select the next available port |
| `HOST` | `127.0.0.1` | Network interface used by the API server |
| `DB_PATH` | `backend/data/finora.sqlite` | Path to the SQLite database |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Comma-separated list of allowed browser origins |

The default binds the API to loopback so it is not exposed to other devices on your network. Do not set `HOST` to a public or LAN interface unless you have added suitable authentication, transport security, and network protections.

Example `backend/.env` for local use:

```dotenv
PORT=4000
HOST=127.0.0.1
FRONTEND_ORIGIN=http://localhost:5173
```

`DB_PATH` can be set to an absolute path when the database should live outside the default `backend/data` directory.

The API accepts JSON requests up to 256 KB. Transaction import validates all rows before writing and commits the batch atomically. CSV files must contain `Date,Name,Category,Type,Amount` columns and use the app's supported categories; imports are additive and do not deduplicate existing records. The JSON backup is a portable export, but restore/import of a full backup is not currently supported.

## API

All routes are prefixed with `/api`.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Check API availability |
| `GET` | `/transactions` | List transactions |
| `POST` | `/transactions` | Create a transaction |
| `POST` | `/transactions/import` | Atomically import up to 500 validated transactions |
| `POST` | `/transactions/bulk-delete` | Atomically delete 1–100 existing transactions |
| `PUT` | `/transactions/:id` | Update a transaction |
| `DELETE` | `/transactions/:id` | Delete a transaction |
| `GET` | `/activity?limit=50` | List recent audit events (limit 1–100) |
| `GET` | `/dashboard?period=week\|month` | Retrieve balances, period totals, cash flow, and budgets |
| `GET` | `/budgets` | List monthly budgets |
| `PUT` | `/budgets/:category` | Create or update a category budget |
| `DELETE` | `/budgets/:category` | Delete a category budget |
| `GET` | `/goals` | List savings goals |
| `POST` | `/goals` | Create a savings goal |
| `PUT` | `/goals/:id` | Update a savings goal |
| `DELETE` | `/goals/:id` | Delete a savings goal |
| `POST` | `/goals/:id/contributions` | Add to a savings goal |
| `GET` | `/recurring` | List recurring income and expense schedules |
| `POST` | `/recurring` | Create a recurring schedule |
| `PUT` | `/recurring/:id` | Update a recurring schedule |
| `DELETE` | `/recurring/:id` | Remove a recurring schedule |
| `POST` | `/recurring/:id/apply` | Create the next scheduled transaction and advance the date |

Transaction amounts, budget limits, savings targets, and contributions are in USD. Savings goals use `name`, `targetAmount`, and `savedAmount`, with an optional `targetDate` in `YYYY-MM-DD` format. Contribution requests contain an `amount`.

### Architecture and security model

- `frontend/src/App.jsx` and `frontend/src/App.css` implement the responsive React dashboard and its local preferences.
- `frontend/src/CashflowChart.jsx` isolates the chart library behind a lazy-loaded boundary to reduce the initial JavaScript bundle.
- `backend/src/server.js` exposes the Express API and stores money values as integer cents in SQLite.
- SQLite triggers append an activity record for transaction, budget, goal, and recurring-schedule changes. The UI displays the latest 50 entries; the API supports up to 100 per request.
- The app is designed for one trusted local user. It does not implement sign-in, sessions, role-based access, cloud sync, encryption-at-rest, or concurrent-user isolation. CORS is not authentication. Keep the database file private, back it up securely, and leave the API bound to loopback for local use.
- API input validation, parameterized SQL, a bounded JSON body size, no-store responses, security headers, consistent JSON errors, and loopback binding reduce local attack surface. A remote or multi-user deployment requires an authentication/authorization layer and TLS before exposing the API.
- There is no server-push transport: this local app refreshes data after write operations and on page load. WebSockets/SSE and email integrations are intentionally omitted because there is no remote or multi-user workflow to justify them.
- Transaction pagination currently happens in the browser over the locally loaded dataset. For very large ledgers or remote hosting, add server-side filtered pagination before deployment.

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
