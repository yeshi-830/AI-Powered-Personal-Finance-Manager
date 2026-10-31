const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp, createDatabase } = require("../src/server");

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function startServer(database, testContext) {
  const server = createApp(database).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  testContext.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("transaction, budget, and dashboard APIs validate and calculate real data", async (t) => {
  const database = createDatabase(":memory:");
  t.after(() => database.close());
  const baseUrl = await startServer(database, t);
  const date = localDate();

  const health = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await health.json(), { status: "ok", database: "connected" });

  const invalid = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", category: "Other", type: "expense", amount: 0, date }),
  });
  assert.equal(invalid.status, 400);
  const invalidPrecision = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Invalid amount", category: "Other", type: "expense", amount: 1.001, date }),
  });
  assert.equal(invalidPrecision.status, 400);

  const incomeResponse = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Paycheck", category: "Income", type: "income", amount: 3200, date }),
  });
  assert.equal(incomeResponse.status, 201);
  const income = await incomeResponse.json();

  const expenseResponse = await fetch(`${baseUrl}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Groceries", category: "Food & Dining", type: "expense", amount: 49.99, date }),
  });
  assert.equal(expenseResponse.status, 201);
  const expense = await expenseResponse.json();
  assert.equal(expense.amount, 49.99);

  const budgetResponse = await fetch(`${baseUrl}/api/budgets/Food%20%26%20Dining`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 500 }),
  });
  assert.equal(budgetResponse.status, 200);
  assert.deepEqual(await budgetResponse.json(), {
    category: "Food & Dining",
    limit: 500,
    spent: 49.99,
  });

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard?period=month`);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.balance, 3150.01);
  assert.equal(dashboard.period.income, 3200);
  assert.equal(dashboard.period.expenses, 49.99);
  assert.equal(dashboard.period.savings, 3150.01);
  assert.ok(dashboard.cashflow.some((day) => day.date === date && day.expenses === 49.99));

  const updateResponse = await fetch(`${baseUrl}/api/transactions/${expense.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Weekly groceries", category: "Food & Dining", type: "expense", amount: 59.99, date }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).name, "Weekly groceries");

  const deleteResponse = await fetch(`${baseUrl}/api/transactions/${expense.id}`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 204);
  const listResponse = await fetch(`${baseUrl}/api/transactions`);
  assert.deepEqual((await listResponse.json()).map((transaction) => transaction.name), ["Paycheck"]);
});

test("savings goal API validates, updates, lists, and deletes goals", async (t) => {
  const database = createDatabase(":memory:");
  t.after(() => database.close());
  const baseUrl = await startServer(database, t);
  const headers = { "Content-Type": "application/json" };

  const invalid = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Trip", targetAmount: 0, savedAmount: 0 }),
  });
  assert.equal(invalid.status, 400);

  const invalidDate = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Trip",
      targetAmount: 1000,
      savedAmount: 0,
      targetDate: "2026-02-30",
    }),
  });
  assert.equal(invalidDate.status, 400);

  const invalidSavedAmount = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Trip",
      targetAmount: 1000,
      savedAmount: -1,
    }),
  });
  assert.equal(invalidSavedAmount.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Emergency fund",
      targetAmount: 5000,
      savedAmount: 0,
      targetDate: localDate(),
    }),
  });
  assert.equal(createResponse.status, 201);
  const goal = await createResponse.json();
  assert.equal(goal.name, "Emergency fund");
  assert.equal(goal.targetAmount, 5000);
  assert.equal(goal.savedAmount, 0);

  const invalidContribution = await fetch(`${baseUrl}/api/goals/${goal.id}/contributions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amount: 0 }),
  });
  assert.equal(invalidContribution.status, 400);

  const contributionResponse = await fetch(`${baseUrl}/api/goals/${goal.id}/contributions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amount: 125.5 }),
  });
  assert.equal(contributionResponse.status, 200);
  assert.equal((await contributionResponse.json()).savedAmount, 125.5);

  const updateResponse = await fetch(`${baseUrl}/api/goals/${goal.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      name: "Rainy day fund",
      targetAmount: 6000,
      savedAmount: 750,
      targetDate: "",
    }),
  });
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), {
    id: goal.id,
    name: "Rainy day fund",
    targetAmount: 6000,
    savedAmount: 750,
    targetDate: null,
  });

  const listResponse = await fetch(`${baseUrl}/api/goals`);
  assert.deepEqual(await listResponse.json(), [{
    id: goal.id,
    name: "Rainy day fund",
    targetAmount: 6000,
    savedAmount: 750,
    targetDate: null,
  }]);

  const deleteResponse = await fetch(`${baseUrl}/api/goals/${goal.id}`, {
    method: "DELETE",
  });
  assert.equal(deleteResponse.status, 204);
  const missingResponse = await fetch(`${baseUrl}/api/goals/${goal.id}`, {
    method: "DELETE",
  });
  assert.equal(missingResponse.status, 404);
  const missingGoalContribution = await fetch(`${baseUrl}/api/goals/${goal.id}/contributions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amount: 1 }),
  });
  assert.equal(missingGoalContribution.status, 404);
});

test("recurring transaction API creates, advances, and removes schedules", async (t) => {
  const database = createDatabase(":memory:");
  t.after(() => database.close());
  const baseUrl = await startServer(database, t);
  const nextDate = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 5));

  const createResponse = await fetch(`${baseUrl}/api/recurring`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Gym membership",
      category: "Healthcare",
      type: "expense",
      amount: 59.99,
      frequency: "monthly",
      nextDate,
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, "Gym membership");
  assert.equal(created.amount, 59.99);

  const applyResponse = await fetch(`${baseUrl}/api/recurring/${created.id}/apply`, {
    method: "POST",
  });
  assert.equal(applyResponse.status, 201);
  const applied = await applyResponse.json();
  const expectedNext = new Date(`${nextDate}T12:00:00`);
  expectedNext.setMonth(expectedNext.getMonth() + 1);
  assert.equal(applied.transaction.name, "Gym membership");
  assert.equal(applied.transaction.type, "expense");
  assert.equal(applied.nextDate, localDate(expectedNext));

  const listResponse = await fetch(`${baseUrl}/api/recurring`);
  const recurring = await listResponse.json();
  assert.equal(recurring.length, 1);
  assert.equal(recurring[0].nextDate, applied.nextDate);

  const deleteResponse = await fetch(`${baseUrl}/api/recurring/${created.id}`, {
    method: "DELETE",
  });
  assert.equal(deleteResponse.status, 204);
  const emptyResponse = await fetch(`${baseUrl}/api/recurring`);
  assert.deepEqual(await emptyResponse.json(), []);
});

test("database records remain available after reopening the SQLite file", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "finora-test-"));
  const databasePath = path.join(folder, "finora.sqlite");
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));

  const firstConnection = createDatabase(databasePath);
  firstConnection.prepare(`
    INSERT INTO transactions (name, category, amount_cents, type, transaction_date)
    VALUES (?, ?, ?, ?, ?)
  `).run("Persisted entry", "Other", 1250, "expense", localDate());
  firstConnection.prepare(`
    INSERT INTO savings_goals (name, target_cents, saved_cents, target_date)
    VALUES (?, ?, ?, ?)
  `).run("Persisted goal", 10000, 2500, null);
  firstConnection.close();

  const secondConnection = createDatabase(databasePath);
  assert.equal(secondConnection.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 1);
  assert.equal(secondConnection.prepare("SELECT COUNT(*) AS count FROM savings_goals").get().count, 1);
  secondConnection.close();
});
