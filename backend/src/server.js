const express = require("express");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const categories = ["Food & Dining", "Transportation", "Shopping", "Healthcare", "Other"];
const allowedTypes = ["income", "expense"];

function createDatabase(databasePath = path.join(__dirname, "..", "data", "finora.sqlite")) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      transaction_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(transaction_date);
    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_limit_cents INTEGER NOT NULL CHECK (monthly_limit_cents > 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return database;
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}

function parseAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const rawCents = value * 100;
  const cents = Math.round(rawCents);
  if (Math.abs(rawCents - cents) > 1e-7) return null;
  return Number.isSafeInteger(cents) ? cents : null;
}

function validateTransaction(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A transaction object is required." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category;
  const type = body.type;
  const transactionDate = body.date;
  const amountCents = parseAmount(body.amount);

  if (!name || name.length > 80) return { error: "Name must be between 1 and 80 characters." };
  if (!allowedTypes.includes(type)) return { error: "Type must be income or expense." };
  if (type === "expense" && !categories.includes(category)) {
    return { error: "Choose a valid expense category." };
  }
  if (type === "income" && category !== "Income") {
    return { error: "Income transactions must use the Income category." };
  }
  if (!amountCents) return { error: "Amount must be a positive number with no more than two decimal places." };
  if (!validDate(transactionDate)) return { error: "Date must be a valid YYYY-MM-DD date." };

  return {
    value: {
      name,
      category,
      amountCents,
      type,
      transactionDate,
    },
  };
}

function transactionRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    amount: row.amount_cents / 100,
    type: row.type,
    date: row.transaction_date,
  };
}

function budgetRows(database, monthStart, monthEnd) {
  return database.prepare(`
    SELECT budgets.category, budgets.monthly_limit_cents,
      COALESCE(SUM(CASE WHEN transactions.type = 'expense'
        THEN transactions.amount_cents ELSE 0 END), 0) AS spent_cents
    FROM budgets
    LEFT JOIN transactions
      ON transactions.category = budgets.category
      AND transactions.transaction_date BETWEEN ? AND ?
    GROUP BY budgets.category
    ORDER BY budgets.category
  `).all(monthStart, monthEnd).map((row) => ({
    category: row.category,
    limit: row.monthly_limit_cents / 100,
    spent: row.spent_cents / 100,
  }));
}

function createApp(database) {
  const app = express();
  const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",");
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", database: "connected" });
  });

  app.get("/api/transactions", (_request, response) => {
    const rows = database.prepare(`
      SELECT id, name, category, amount_cents, type, transaction_date
      FROM transactions
      ORDER BY transaction_date DESC, id DESC
    `).all();
    response.json(rows.map(transactionRow));
  });

  app.post("/api/transactions", (request, response) => {
    const result = validateTransaction(request.body);
    if (result.error) return response.status(400).json({ error: result.error });

    const { name, category, amountCents, type, transactionDate } = result.value;
    const inserted = database.prepare(`
      INSERT INTO transactions (name, category, amount_cents, type, transaction_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, category, amountCents, type, transactionDate);
    const row = database.prepare(`
      SELECT id, name, category, amount_cents, type, transaction_date
      FROM transactions WHERE id = ?
    `).get(Number(inserted.lastInsertRowid));
    response.status(201).json(transactionRow(row));
  });

  app.put("/api/transactions/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Transaction ID must be a positive integer." });
    }

    const result = validateTransaction(request.body);
    if (result.error) return response.status(400).json({ error: result.error });
    const { name, category, amountCents, type, transactionDate } = result.value;
    const update = database.prepare(`
      UPDATE transactions
      SET name = ?, category = ?, amount_cents = ?, type = ?, transaction_date = ?
      WHERE id = ?
    `).run(name, category, amountCents, type, transactionDate, id);
    if (update.changes === 0) return response.status(404).json({ error: "Transaction not found." });

    const row = database.prepare(`
      SELECT id, name, category, amount_cents, type, transaction_date
      FROM transactions WHERE id = ?
    `).get(id);
    response.json(transactionRow(row));
  });

  app.delete("/api/transactions/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Transaction ID must be a positive integer." });
    }

    const result = database.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    if (result.changes === 0) return response.status(404).json({ error: "Transaction not found." });
    response.status(204).end();
  });

  app.get("/api/budgets", (_request, response) => {
    const now = new Date();
    const monthStart = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    response.json(budgetRows(database, monthStart, monthEnd));
  });

  app.put("/api/budgets/:category", (request, response) => {
    const category = request.params.category;
    const limitCents = parseAmount(request.body?.limit);
    if (!categories.includes(category)) {
      return response.status(400).json({ error: "Choose a valid expense category." });
    }
    if (!limitCents) {
      return response.status(400).json({ error: "Monthly limit must be a positive number with no more than two decimal places." });
    }

    database.prepare(`
      INSERT INTO budgets (category, monthly_limit_cents)
      VALUES (?, ?)
      ON CONFLICT(category) DO UPDATE SET
        monthly_limit_cents = excluded.monthly_limit_cents,
        updated_at = datetime('now')
    `).run(category, limitCents);
    const now = new Date();
    const monthStart = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const budget = budgetRows(database, monthStart, monthEnd).find((row) => row.category === category);
    response.json(budget);
  });

  app.delete("/api/budgets/:category", (request, response) => {
    if (!categories.includes(request.params.category)) {
      return response.status(400).json({ error: "Choose a valid expense category." });
    }
    const result = database.prepare("DELETE FROM budgets WHERE category = ?").run(request.params.category);
    if (result.changes === 0) return response.status(404).json({ error: "Budget not found." });
    response.status(204).end();
  });

  app.get("/api/dashboard", (request, response) => {
    const period = request.query.period === "month" ? "month" : "week";
    const now = new Date();
    let start;
    let end;
    let dates;

    if (period === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    dates = [];
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      dates.push(localDate(date));
    }

    const startDate = localDate(start);
    const endDate = localDate(end);
    const totals = database.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents
      FROM transactions
    `).get();
    const periodTotals = database.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ?
    `).get(startDate, endDate);
    const dailyRows = database.prepare(`
      SELECT transaction_date,
        SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END) AS expense_cents
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ?
      GROUP BY transaction_date
    `).all(startDate, endDate);
    const dailyTotals = new Map(dailyRows.map((row) => [row.transaction_date, row]));
    const monthStart = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const budgets = budgetRows(database, monthStart, monthEnd);

    response.json({
      balance: (totals.income_cents - totals.expense_cents) / 100,
      period: {
        type: period,
        start: startDate,
        end: endDate,
        income: periodTotals.income_cents / 100,
        expenses: periodTotals.expense_cents / 100,
        savings: (periodTotals.income_cents - periodTotals.expense_cents) / 100,
      },
      cashflow: dates.map((date) => {
        const row = dailyTotals.get(date);
        return {
          date,
          label: period === "week"
            ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })
            : String(Number(date.slice(-2))),
          income: (row?.income_cents ?? 0) / 100,
          expenses: (row?.expense_cents ?? 0) / 100,
        };
      }),
      budgets,
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      return response.status(400).json({ error: "Request body must contain valid JSON." });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({ error: "Request body is too large." });
    }
    console.error("API request failed:", error);
    response.status(500).json({ error: "An unexpected server error occurred." });
  });

  return app;
}

if (require.main === module) {
  const database = createDatabase(process.env.DB_PATH || path.join(__dirname, "..", "data", "finora.sqlite"));
  const app = createApp(database);
  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || "127.0.0.1";
  const server = app.listen(port, host, () => {
    console.log(`Finora API listening at http://${host}:${port}`);
  });
  server.on("error", (error) => {
    console.error("Unable to start the API server:", error);
    database.close();
    process.exitCode = 1;
  });
}

module.exports = { createApp, createDatabase };
