const express = require("express");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
require("dotenv").config();

const categories = ["Food & Dining", "Transportation", "Shopping", "Healthcare", "Other"];
const allowedTypes = ["income", "expense"];
const recurringFrequencies = ["weekly", "monthly", "yearly"];

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
    CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      target_cents INTEGER NOT NULL CHECK (target_cents > 0),
      saved_cents INTEGER NOT NULL CHECK (saved_cents >= 0),
      target_date TEXT
    );
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
      next_date TEXT NOT NULL,
      last_generated TEXT,
      active INTEGER NOT NULL DEFAULT 1
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

function parseNonNegativeAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const rawCents = value * 100;
  const cents = Math.round(rawCents);
  if (Math.abs(rawCents - cents) > 1e-7) return null;
  return Number.isSafeInteger(cents) ? cents : null;
}

function validateGoal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A savings goal object is required." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const targetCents = parseAmount(body.targetAmount);
  const savedCents = parseNonNegativeAmount(body.savedAmount);
  const targetDate = body.targetDate === "" || body.targetDate == null
    ? null
    : body.targetDate;

  if (!name || name.length > 80) return { error: "Name must be between 1 and 80 characters." };
  if (!targetCents) return { error: "Target amount must be a positive number with no more than two decimal places." };
  if (savedCents === null) return { error: "Saved amount must be zero or a positive number with no more than two decimal places." };
  if (targetDate !== null && !validDate(targetDate)) {
    return { error: "Target date must be a valid YYYY-MM-DD date." };
  }

  return { value: { name, targetCents, savedCents, targetDate } };
}

function goalRow(row) {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_cents / 100,
    savedAmount: row.saved_cents / 100,
    targetDate: row.target_date,
  };
}

function addDateInterval(dateString, frequency) {
  const current = new Date(`${dateString}T00:00:00`);
  const amount = frequency === "weekly" ? 7 : frequency === "monthly" ? 1 : 12;
  const next = new Date(current);
  if (frequency === "weekly") {
    next.setDate(current.getDate() + 7);
  } else if (frequency === "monthly") {
    next.setMonth(current.getMonth() + 1);
  } else {
    next.setFullYear(current.getFullYear() + 1);
  }
  return localDate(next);
}

function validateRecurringTransaction(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A recurring transaction object is required." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category;
  const type = body.type;
  const frequency = body.frequency;
  const nextDate = body.nextDate;
  const amountCents = parseAmount(body.amount);

  if (!name || name.length > 80) return { error: "Name must be between 1 and 80 characters." };
  if (!allowedTypes.includes(type)) return { error: "Type must be income or expense." };
  if (type === "expense" && !categories.includes(category)) {
    return { error: "Choose a valid expense category." };
  }
  if (type === "income" && category !== "Income") {
    return { error: "Income recurring transactions must use the Income category." };
  }
  if (!recurringFrequencies.includes(frequency)) return { error: "Frequency must be weekly, monthly, or yearly." };
  if (!amountCents) return { error: "Amount must be a positive number with no more than two decimal places." };
  if (!validDate(nextDate)) return { error: "Next date must be a valid YYYY-MM-DD date." };

  return {
    value: {
      name,
      category,
      amountCents,
      type,
      frequency,
      nextDate,
    },
  };
}

function recurringRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    amount: row.amount_cents / 100,
    type: row.type,
    frequency: row.frequency,
    nextDate: row.next_date,
  };
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

function findAvailablePort(port = Number(process.env.PORT || 4000)) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(findAvailablePort(port + 1));
        return;
      }
      reject(error);
    });

    tester.listen(port, "0.0.0.0", () => {
      tester.close(() => resolve(port));
    });
  });
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

  app.get("/api/goals", (_request, response) => {
    const goals = database.prepare(`
      SELECT id, name, target_cents, saved_cents, target_date
      FROM savings_goals
      ORDER BY target_date IS NULL, target_date, id
    `).all();
    response.json(goals.map(goalRow));
  });

  app.get("/api/recurring", (_request, response) => {
    const recurring = database.prepare(`
      SELECT id, name, category, amount_cents, type, frequency, next_date
      FROM recurring_transactions
      WHERE active = 1
      ORDER BY next_date ASC, id ASC
    `).all();
    response.json(recurring.map(recurringRow));
  });

  app.post("/api/recurring", (request, response) => {
    const result = validateRecurringTransaction(request.body);
    if (result.error) return response.status(400).json({ error: result.error });

    const { name, category, amountCents, type, frequency, nextDate } = result.value;
    const inserted = database.prepare(`
      INSERT INTO recurring_transactions (name, category, amount_cents, type, frequency, next_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, category, amountCents, type, frequency, nextDate);
    const row = database.prepare(`
      SELECT id, name, category, amount_cents, type, frequency, next_date
      FROM recurring_transactions WHERE id = ?
    `).get(Number(inserted.lastInsertRowid));
    response.status(201).json(recurringRow(row));
  });

  app.put("/api/recurring/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Recurring transaction ID must be a positive integer." });
    }

    const result = validateRecurringTransaction(request.body);
    if (result.error) return response.status(400).json({ error: result.error });
    const { name, category, amountCents, type, frequency, nextDate } = result.value;
    const update = database.prepare(`
      UPDATE recurring_transactions
      SET name = ?, category = ?, amount_cents = ?, type = ?, frequency = ?, next_date = ?
      WHERE id = ?
    `).run(name, category, amountCents, type, frequency, nextDate, id);
    if (update.changes === 0) return response.status(404).json({ error: "Recurring transaction not found." });

    const row = database.prepare(`
      SELECT id, name, category, amount_cents, type, frequency, next_date
      FROM recurring_transactions WHERE id = ?
    `).get(id);
    response.json(recurringRow(row));
  });

  app.post("/api/recurring/:id/apply", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Recurring transaction ID must be a positive integer." });
    }

    const recurring = database.prepare(`
      SELECT id, name, category, amount_cents, type, frequency, next_date
      FROM recurring_transactions WHERE id = ? AND active = 1
    `).get(id);
    if (!recurring) return response.status(404).json({ error: "Recurring transaction not found." });

    const inserted = database.prepare(`
      INSERT INTO transactions (name, category, amount_cents, type, transaction_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(recurring.name, recurring.category, recurring.amount_cents, recurring.type, recurring.next_date);

    const nextDate = addDateInterval(recurring.next_date, recurring.frequency);
    database.prepare(`
      UPDATE recurring_transactions
      SET next_date = ?, last_generated = ?
      WHERE id = ?
    `).run(nextDate, localDate(new Date()), id);

    const row = database.prepare(`
      SELECT id, name, category, amount_cents, type, transaction_date
      FROM transactions WHERE id = ?
    `).get(Number(inserted.lastInsertRowid));
    response.status(201).json({
      transaction: transactionRow(row),
      nextDate,
    });
  });

  app.delete("/api/recurring/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Recurring transaction ID must be a positive integer." });
    }

    const result = database.prepare("UPDATE recurring_transactions SET active = 0 WHERE id = ?").run(id);
    if (result.changes === 0) return response.status(404).json({ error: "Recurring transaction not found." });
    response.status(204).end();
  });

  app.post("/api/goals", (request, response) => {
    const result = validateGoal(request.body);
    if (result.error) return response.status(400).json({ error: result.error });

    const { name, targetCents, savedCents, targetDate } = result.value;
    const inserted = database.prepare(`
      INSERT INTO savings_goals (name, target_cents, saved_cents, target_date)
      VALUES (?, ?, ?, ?)
    `).run(name, targetCents, savedCents, targetDate);
    const row = database.prepare(`
      SELECT id, name, target_cents, saved_cents, target_date
      FROM savings_goals WHERE id = ?
    `).get(Number(inserted.lastInsertRowid));
    response.status(201).json(goalRow(row));
  });

  app.post("/api/goals/:id/contributions", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Goal ID must be a positive integer." });
    }

    const amountCents = parseAmount(request.body?.amount);
    if (!amountCents) {
      return response.status(400).json({ error: "Contribution must be a positive number with no more than two decimal places." });
    }

    const goal = database.prepare("SELECT saved_cents FROM savings_goals WHERE id = ?").get(id);
    if (!goal) return response.status(404).json({ error: "Savings goal not found." });
    if (!Number.isSafeInteger(goal.saved_cents + amountCents)) {
      return response.status(400).json({ error: "Contribution exceeds the supported savings amount." });
    }

    database.prepare(`
      UPDATE savings_goals SET saved_cents = saved_cents + ? WHERE id = ?
    `).run(amountCents, id);
    const row = database.prepare(`
      SELECT id, name, target_cents, saved_cents, target_date
      FROM savings_goals WHERE id = ?
    `).get(id);
    response.json(goalRow(row));
  });

  app.put("/api/goals/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Goal ID must be a positive integer." });
    }

    const result = validateGoal(request.body);
    if (result.error) return response.status(400).json({ error: result.error });
    const { name, targetCents, savedCents, targetDate } = result.value;
    const update = database.prepare(`
      UPDATE savings_goals
      SET name = ?, target_cents = ?, saved_cents = ?, target_date = ?
      WHERE id = ?
    `).run(name, targetCents, savedCents, targetDate, id);
    if (update.changes === 0) return response.status(404).json({ error: "Savings goal not found." });

    const row = database.prepare(`
      SELECT id, name, target_cents, saved_cents, target_date
      FROM savings_goals WHERE id = ?
    `).get(id);
    response.json(goalRow(row));
  });

  app.delete("/api/goals/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(400).json({ error: "Goal ID must be a positive integer." });
    }

    const result = database.prepare("DELETE FROM savings_goals WHERE id = ?").run(id);
    if (result.changes === 0) return response.status(404).json({ error: "Savings goal not found." });
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
  const requestedPort = Number(process.env.PORT || 4000);
  const host = process.env.HOST || "0.0.0.0";

  findAvailablePort(requestedPort)
    .then((port) => {
      process.env.PORT = String(port);
      const server = app.listen(port, host, () => {
        console.log(`Finora API listening at http://${host}:${port}`);
      });

      server.on("error", (error) => {
        console.error("Unable to start the API server:", error);
        database.close();
        process.exitCode = 1;
      });
    })
    .catch((error) => {
      console.error("Unable to find an available API port:", error);
      database.close();
      process.exitCode = 1;
    });
}

module.exports = { createApp, createDatabase };
