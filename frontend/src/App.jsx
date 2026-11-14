
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, ArrowLeftRight, Wallet, Target, Settings,
  Bell, Search, Plus, ArrowUpRight, ArrowDownRight,
  CreditCard, PiggyBank, TrendingUp, Menu, X, ChevronDown,
  Utensils, Car, ShoppingBag, Briefcase, HeartPulse,
  Pencil, Trash2, Download, Sparkles, CalendarRange,
  MoonStar, SunMedium, FileUp, FileText, History
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import "./App.css";

const categories = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Healthcare",
  "Other",
];

const defaultWidgets = {
  stats: true,
  insights: true,
  analytics: true,
  recommendations: true,
  activity: true,
};

function readDashboardWidgets() {
  const saved = window.localStorage.getItem("finora-dashboard-widgets");
  if (!saved) return { ...defaultWidgets };
  try {
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...defaultWidgets };
    }
    return Object.fromEntries(
      Object.keys(defaultWidgets).map((key) => [key, parsed[key] !== false])
    );
  } catch (error) {
    if (error instanceof SyntaxError) return { ...defaultWidgets };
    throw error;
  }
}

const categoryIcons = {
  "Food & Dining": Utensils,
  Transportation: Car,
  Shopping: ShoppingBag,
  Healthcare: HeartPulse,
  Income: Briefcase,
  Other: Wallet,
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysISO(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function displayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function displayTimestamp(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function parseTransactionsCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === '"') {
      throw new Error("The CSV file contains a quote inside an unquoted field.");
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("The CSV file contains an unfinished quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  if (rows.length < 2) throw new Error("The CSV file needs a header row and at least one transaction.");

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase());
  const columns = ["date", "name", "category", "type", "amount"].map((header) => headers.indexOf(header));
  if (columns.some((column) => column < 0)) {
    throw new Error("CSV headers must include Date, Name, Category, Type, and Amount.");
  }

  const transactions = rows.slice(1).map((values) => ({
    date: values[columns[0]]?.trim() ?? "",
    name: values[columns[1]]?.trim() ?? "",
    category: values[columns[2]]?.trim() ?? "",
    type: values[columns[3]]?.trim().toLowerCase() ?? "",
    amount: Number(values[columns[4]]?.trim()),
  }));

  if (transactions.length > 500) {
    throw new Error("A maximum of 500 transactions can be imported at once.");
  }

  return transactions;
}

// Empty by default for local development.
// Set VITE_API_URL to the deployed backend URL for production.
const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }

  return response.status === 204 ? null : response.json();
}

async function fetchAppData(period) {
  const [transactions, dashboard, goals, recurring, activity] = await Promise.all([
    request("/api/transactions"),
    request(`/api/dashboard?period=${period}`),
    request("/api/goals"),
    request("/api/recurring"),
    request("/api/activity?limit=50"),
  ]);

  return { transactions, dashboard, goals, recurring, activity };
}

function App() {
  const [transactions, setTransactions] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [activity, setActivity] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [activeNav, setActiveNav] = useState("Overview");
  const [period, setPeriod] = useState("week");
  const [referenceDate] = useState(todayISO);
  const [widgets, setWidgets] = useState(readDashboardWidgets);
  const [showOnboarding, setShowOnboarding] = useState(
    () => window.localStorage.getItem("finora-onboarding-complete") !== "true"
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState("date-desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("finora-theme");
    return savedTheme || "light";
  });
  const [modal, setModal] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [transactionForm, setTransactionForm] = useState({
    name: "",
    category: categories[0],
    amount: "",
    type: "expense",
    date: todayISO(),
  });

  const [budgetForm, setBudgetForm] = useState({
    category: categories[0],
    limit: "",
  });

  const [goalForm, setGoalForm] = useState({
    name: "",
    targetAmount: "",
    savedAmount: "0",
    targetDate: "",
  });
  const [recurringForm, setRecurringForm] = useState({
    name: "",
    category: categories[0],
    amount: "",
    type: "expense",
    frequency: "monthly",
    nextDate: todayISO(),
  });
  const [contributionAmount, setContributionAmount] = useState("");

  const refreshData = useCallback(async () => {
    try {
      const {
        transactions: nextTransactions,
        dashboard: nextDashboard,
        goals: nextGoals,
        recurring: nextRecurring,
        activity: nextActivity,
      } = await fetchAppData(period);

      setTransactions(nextTransactions);
      setDashboardData(nextDashboard);
      setGoals(nextGoals);
      setRecurring(nextRecurring);
      setActivity(nextActivity);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    fetchAppData(period)
      .then(({ transactions: nextTransactions, dashboard: nextDashboard, goals: nextGoals, recurring: nextRecurring, activity: nextActivity }) => {
        if (cancelled) return;

        setTransactions(nextTransactions);
        setDashboardData(nextDashboard);
        setGoals(nextGoals);
        setRecurring(nextRecurring);
        setActivity(nextActivity);
        setError("");
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("finora-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("finora-dashboard-widgets", JSON.stringify(widgets));
  }, [widgets]);

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((item) =>
        `${item.name} ${item.category} ${item.type}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ).filter((item) =>
        (categoryFilter === "all" || item.category === categoryFilter) &&
        (typeFilter === "all" || item.type === typeFilter) &&
        (!dateFrom || item.date >= dateFrom) &&
        (!dateTo || item.date <= dateTo)
      ),
    [transactions, search, categoryFilter, typeFilter, dateFrom, dateTo]
  );

  const sortedTransactions = useMemo(() => {
    const byDate = [...filteredTransactions].sort((first, second) => {
      const dateDelta = new Date(second.date) - new Date(first.date);
      return dateDelta || second.id - first.id;
    });

    switch (sortKey) {
      case "date-asc":
        return [...filteredTransactions].sort((first, second) => new Date(first.date) - new Date(second.date));
      case "amount-desc":
        return [...filteredTransactions].sort((first, second) => second.amount - first.amount);
      case "amount-asc":
        return [...filteredTransactions].sort((first, second) => first.amount - second.amount);
      case "name":
        return [...filteredTransactions].sort((first, second) => first.name.localeCompare(second.name));
      case "date-desc":
      default:
        return byDate;
    }
  }, [filteredTransactions, sortKey]);

  const budgets = useMemo(
    () => dashboardData?.budgets ?? [],
    [dashboardData]
  );
  const recurringSummary = useMemo(
    () => recurring.reduce((total, item) => {
      total[item.type === "income" ? "income" : "expense"] += item.amount;
      return total;
    }, { income: 0, expense: 0 }),
    [recurring]
  );
  const periodData = dashboardData?.period;

  const totalBudget = budgets.reduce(
    (sum, budget) => sum + budget.limit,
    0
  );

  const totalBudgetSpent = budgets.reduce(
    (sum, budget) => sum + budget.spent,
    0
  );

  const budgetPercent =
    totalBudget > 0
      ? Math.min(100, (totalBudgetSpent / totalBudget) * 100)
      : 0;

  const insights = useMemo(() => {
    const income = dashboardData?.period?.income ?? 0;
    const savings = dashboardData?.period?.savings ?? 0;
    const largestBudget = [...budgets].sort((first, second) => second.spent - first.spent)[0] ?? null;
    const nextGoal = [...goals]
      .filter((goal) => goal.savedAmount < goal.targetAmount)
      .sort((first, second) => (first.targetAmount - first.savedAmount) - (second.targetAmount - second.savedAmount))[0] ?? null;
    const savingsRate = income > 0 ? (savings / income) * 100 : 0;
    const budgetAlerts = budgets.filter((budget) => budget.limit > 0 && budget.spent >= budget.limit * 0.8).length;

    return {
      savingsRate,
      largestBudget,
      nextGoal,
      budgetAlerts,
      headline:
        nextGoal
          ? `${nextGoal.name} still needs ${money(nextGoal.targetAmount - nextGoal.savedAmount)}`
          : "Every goal is fully funded.",
    };
  }, [budgets, dashboardData, goals]);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map();

    transactions.forEach((transaction) => {
      if (transaction.type !== "expense") return;

      const current = totals.get(transaction.category) ?? 0;
      totals.set(transaction.category, current + transaction.amount);
    });

    return [...totals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((first, second) => second.amount - first.amount)
      .slice(0, 4);
  }, [transactions]);

  const recurringUpNext = useMemo(
    () => [...recurring].sort((first, second) => new Date(first.nextDate) - new Date(second.nextDate)).slice(0, 3),
    [recurring]
  );

  const notificationItems = useMemo(() => {
    const items = [];
    const lastDate = addDaysISO(referenceDate, 7);

    budgets.forEach((budget) => {
      if (budget.limit > 0 && budget.spent >= budget.limit) {
        items.push({
          id: `budget-${budget.category}`,
          title: `${budget.category} budget reached`,
          detail: `${money(budget.spent - budget.limit)} over its monthly limit`,
          tone: "warning",
        });
      } else if (budget.limit > 0 && budget.spent >= budget.limit * 0.8) {
        items.push({
          id: `budget-${budget.category}`,
          title: `${budget.category} budget is nearly full`,
          detail: `${money(budget.limit - budget.spent)} remaining this month`,
          tone: "warning",
        });
      }
    });

    recurring
    .filter((entry) => entry.nextDate <= lastDate)
      .forEach((entry) => {
        items.push({
          id: `recurring-${entry.id}`,
          title: `${entry.name} is due`,
        detail: `${entry.nextDate < referenceDate ? "Overdue" : `Due ${displayDate(entry.nextDate)}`} · ${money(entry.amount)}`,
          tone: "info",
        });
      });

    return items.slice(0, 6);
  }, [budgets, recurring, referenceDate]);

  const projectedBalance = useMemo(() => {
    const scheduledImpact = recurring.reduce((sum, entry) => sum + (entry.type === "income" ? entry.amount : -entry.amount), 0);
    return (dashboardData?.balance ?? 0) + scheduledImpact;
  }, [dashboardData, recurring]);

  const recommendations = useMemo(() => {
    const items = [];
    const overBudget = totalBudget > 0 && totalBudgetSpent > totalBudget;
    const activeBudgets = budgets.filter((budget) => budget.limit > 0);
    const nearLimit = activeBudgets.filter((budget) => budget.spent >= budget.limit * 0.8 && budget.spent < budget.limit);

    if (overBudget) {
      items.push({
        tone: "warning",
        badge: "Priority",
        title: "Budget is running high",
        description: `You are ${money(totalBudgetSpent - totalBudget)} over your monthly budget. Trim discretionary spending or rebalance a few categories this week.`,
        action: "Review budgets",
        target: "Budgets",
      });
    } else if (nearLimit.length > 0) {
      const topCategory = nearLimit.sort((first, second) => second.spent - first.spent)[0];
      items.push({
        tone: "warning",
        badge: "Watch",
        title: `${topCategory.category} is close to its cap`,
        description: `${money(topCategory.limit - topCategory.spent)} left before you hit the budget ceiling. Consider moving planned purchases elsewhere.`,
        action: "Review budgets",
        target: "Budgets",
      });
    } else {
      items.push({
        tone: "success",
        badge: "Healthy",
        title: "Budget health is on track",
        description: `You still have ${money(Math.max(0, totalBudget - totalBudgetSpent))} available across your monthly budgets.`,
        action: "Check budget plan",
        target: "Budgets",
      });
    }

    if (insights.nextGoal) {
      const remaining = insights.nextGoal.targetAmount - insights.nextGoal.savedAmount;
      items.push({
        tone: "info",
        badge: "Goal",
        title: `Keep ${insights.nextGoal.name} moving`,
        description: `You are ${money(remaining)} away from the target. A small extra contribution this week could close the gap faster.`,
        action: "Add savings",
        target: "Savings goals",
      });
    } else {
      items.push({
        tone: "success",
        badge: "Goal",
        title: "Your saving goals are on pace",
        description: "You've covered all active targets. Consider creating a new milestone or adding extra buffer to cash flow.",
        action: "Create new goal",
        target: "Savings goals",
      });
    }

    if (budgets.length === 0) {
      items.push({
        tone: "neutral",
        badge: "Start",
        title: "Build your budget foundation",
        description: "Set category caps for essentials like Food & Dining, Shopping, and Transportation so your spending stays intentional.",
        action: "Set budget",
        target: "Budgets",
      });
    } else if (insights.budgetAlerts > 1) {
      items.push({
        tone: "warning",
        badge: "Alert",
        title: "Multiple categories are trending high",
        description: `${insights.budgetAlerts} categories are at or above 80% of their monthly limit. Keeping an eye on them will protect your surplus.`,
        action: "Review categories",
        target: "Budgets",
      });
    } else {
      items.push({
        tone: "neutral",
        badge: "Energy",
        title: "Your financial system is stable",
        description: "You are balancing spending and saving well. Keep monitoring the categories that move the most. ",
        action: "View overview",
        target: "Overview",
      });
    }

    return items.slice(0, 3);
  }, [budgets, insights, totalBudget, totalBudgetSpent]);

  function openTransaction(transaction = null) {
    setError("");

    setTransactionForm(
      transaction
        ? {
            name: transaction.name,
            category:
              transaction.category === "Income"
                ? categories[0]
                : transaction.category,
            amount: String(transaction.amount),
            type: transaction.type,
            date: transaction.date,
          }
        : {
            name: "",
            category: categories[0],
            amount: "",
            type: "expense",
            date: todayISO(),
          }
    );

    setModal({
      type: "transaction",
      transactionId: transaction?.id ?? null,
    });
  }

  function changePeriod() {
    setLoading(true);
    setPeriod(period === "week" ? "month" : "week");
  }

  function retryLoad() {
    setLoading(true);
    refreshData();
  }

  function openBudget(budget = null) {
    setError("");

    setBudgetForm({
      category: budget?.category ?? categories[0],
      limit: budget ? String(budget.limit) : "",
    });

    setModal({ type: "budget" });
  }

  function openGoal(goal = null) {
    setError("");
    setGoalForm(
      goal
        ? {
            name: goal.name,
            targetAmount: String(goal.targetAmount),
            savedAmount: String(goal.savedAmount),
            targetDate: goal.targetDate ?? "",
          }
        : {
            name: "",
            targetAmount: "",
            savedAmount: "0",
            targetDate: "",
          }
    );
    setModal({ type: "goal", goalId: goal?.id ?? null });
  }

  function openRecurring(entry = null) {
    setError("");
    setRecurringForm(
      entry
        ? {
            name: entry.name,
            category: entry.category,
            amount: String(entry.amount),
            type: entry.type,
            frequency: entry.frequency,
            nextDate: entry.nextDate,
          }
        : {
            name: "",
            category: categories[0],
            amount: "",
            type: "expense",
            frequency: "monthly",
            nextDate: todayISO(),
          }
    );
    setModal({ type: "recurring", recurringId: entry?.id ?? null });
  }

  function openContribution(goal) {
    setError("");
    setContributionAmount("");
    setModal({ type: "contribution", goalId: goal.id, goalName: goal.name });
  }

  function openCsvImport() {
    setError("");
    setCsvPreview(null);
    setModal({ type: "csv-import" });
  }

  async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setCsvPreview(null);
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("CSV files must be smaller than 1 MB.");
      return;
    }

    try {
      const transactionsToImport = parseTransactionsCsv(await file.text());
      setCsvPreview({
        fileName: file.name,
        transactions: transactionsToImport,
      });
    } catch (parseError) {
      setError(parseError.message);
    }
  }

  async function submitTransaction(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const transaction = {
      ...transactionForm,
      category:
        transactionForm.type === "income"
          ? "Income"
          : transactionForm.category,
      amount: Number(transactionForm.amount),
    };

    try {
      await request(
        modal.transactionId
          ? `/api/transactions/${modal.transactionId}`
          : "/api/transactions",
        {
          method: modal.transactionId ? "PUT" : "POST",
          body: JSON.stringify(transaction),
        }
      );

      setModal(null);

      setNotice(
        modal.transactionId
          ? "Transaction updated."
          : "Transaction saved."
      );

      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitCsvImport(event) {
    event.preventDefault();
    if (!csvPreview?.transactions.length) return;

    setSaving(true);
    setError("");

    try {
      const result = await request("/api/transactions/import", {
        method: "POST",
        body: JSON.stringify({ transactions: csvPreview.transactions }),
      });

      setModal(null);
      setCsvPreview(null);
      setNotice(`${result.imported} transaction${result.imported === 1 ? "" : "s"} imported.`);
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitBudget(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await request(
        `/api/budgets/${encodeURIComponent(budgetForm.category)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            limit: Number(budgetForm.limit),
          }),
        }
      );

      setModal(null);
      setNotice(`${budgetForm.category} budget saved.`);

      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitGoal(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const goal = {
      ...goalForm,
      targetAmount: Number(goalForm.targetAmount),
      savedAmount: Number(goalForm.savedAmount),
    };

    try {
      await request(
        modal.goalId ? `/api/goals/${modal.goalId}` : "/api/goals",
        {
          method: modal.goalId ? "PUT" : "POST",
          body: JSON.stringify(goal),
        }
      );

      setModal(null);
      setNotice(modal.goalId ? "Savings goal updated." : "Savings goal created.");
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitContribution(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await request(`/api/goals/${modal.goalId}/contributions`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(contributionAmount) }),
      });

      setModal(null);
      setNotice(`Contribution added to ${modal.goalName}.`);
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitRecurring(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await request(
        modal.recurringId
          ? `/api/recurring/${modal.recurringId}`
          : "/api/recurring",
        {
          method: modal.recurringId ? "PUT" : "POST",
          body: JSON.stringify({
            ...recurringForm,
            amount: Number(recurringForm.amount),
          }),
        }
      );

      setModal(null);
      setNotice(
        modal.recurringId
          ? "Recurring schedule updated."
          : "Recurring schedule saved."
      );
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction(transaction) {
    if (
      !window.confirm(
        `Delete "${transaction.name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await request(`/api/transactions/${transaction.id}`, {
        method: "DELETE",
      });

      setNotice("Transaction deleted.");
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteBudget(budget) {
    if (
      !window.confirm(
        `Remove the ${budget.category} budget?`
      )
    ) {
      return;
    }

    try {
      await request(
        `/api/budgets/${encodeURIComponent(budget.category)}`,
        { method: "DELETE" }
      );

      setNotice(`${budget.category} budget removed.`);
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteGoal(goal) {
    if (!window.confirm(`Delete the "${goal.name}" savings goal?`)) {
      return;
    }

    try {
      await request(`/api/goals/${goal.id}`, { method: "DELETE" });
      setNotice("Savings goal deleted.");
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteRecurring(entry) {
    if (!window.confirm(`Remove the recurring schedule for "${entry.name}"?`)) {
      return;
    }

    try {
      await request(`/api/recurring/${entry.id}`, { method: "DELETE" });
      setNotice("Recurring schedule removed.");
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function applyRecurring(entry) {
    try {
      await request(`/api/recurring/${entry.id}/apply`, { method: "POST" });
      setNotice(`Applied the next ${entry.frequency} payment for ${entry.name}.`);
      await refreshData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function exportTransactions() {
    const rows = [
      ["Date", "Name", "Category", "Type", "Amount"],
      ...sortedTransactions.map((transaction) => [
        transaction.date,
        transaction.name,
        transaction.category,
        transaction.type,
        transaction.amount.toFixed(2),
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) =>
            `"${String(value).replaceAll('"', '""')}"`
          )
          .join(",")
      )
      .join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = "finora-transactions.csv";
    link.click();

    URL.revokeObjectURL(url);
  }

  function exportBackup() {
    const backup = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      currency: "USD",
      transactions,
      budgets,
      goals,
      recurring,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `finora-backup-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Your data backup was downloaded.");
  }

  const navItems = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Transactions", icon: ArrowLeftRight },
    { label: "Budgets", icon: Wallet },
    { label: "Savings goals", icon: Target },
    { label: "Recurring", icon: CalendarRange },
    { label: "Activity", icon: History },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Wallet size={23} />
          </div>

          <span>
            Finora<span className="brand-dot">.</span>
          </span>

          <button
            className="icon-button close-menu"
            onClick={() => setMobileMenu(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-link ${activeNav === label ? "active" : ""}`}
              aria-current={activeNav === label ? "page" : undefined}
              onClick={() => {
                setActiveNav(label);
                setMobileMenu(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>

              {label === "Transactions" && (
                <span className="nav-count">
                  {transactions.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-promo">
          <div className="promo-icon">
            <Sparkles size={19} />
          </div>

          <h3>
            Make money
            <br />
            work for you.
          </h3>

          <p>
            Set budgets and track where your money goes.
          </p>

          <button onClick={() => {
            setActiveNav("Budgets");
            setMobileMenu(false);
          }}>
            Review budgets <ArrowUpRight size={15} />
          </button>
        </div>

        <div className="sidebar-bottom">
          <button
            className={`nav-link ${activeNav === "Settings" ? "active" : ""}`}
            aria-current={activeNav === "Settings" ? "page" : undefined}
            onClick={() => {
              setActiveNav("Settings");
              setMobileMenu(false);
            }}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="avatar">MY</div>

            <div className="profile-info">
              <strong>Your account</strong>
              <span>Personal plan</span>
            </div>
          </div>
        </div>
      </aside>

      {mobileMenu && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button mobile-menu-button"
            onClick={() => setMobileMenu(true)}
            aria-label="Open menu"
          >
            <Menu />
          </button>

          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{activeNav}</strong>
          </div>

          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />

              <input
                aria-label="Search transactions"
                placeholder="Search transactions..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveNav("Transactions");
                }}
              />
            </label>

            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                aria-label={`Notifications${notificationItems.length ? `, ${notificationItems.length} updates` : ""}`}
                aria-expanded={notificationsOpen}
                aria-controls="notification-panel"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell size={19} />
                {notificationItems.length > 0 && (
                  <span className="notification-count">
                    {notificationItems.length > 9 ? "9+" : notificationItems.length}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="notification-panel" id="notification-panel" role="region" aria-label="Financial notifications">
                  <div className="notification-panel-heading">
                    <strong>Financial updates</strong>
                    <button
                      className="notification-dismiss"
                      onClick={() => setNotificationsOpen(false)}
                      aria-label="Close notifications"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {notificationItems.length ? (
                    <div className="notification-list">
                      {notificationItems.map((item) => (
                        <article className={`notification-item ${item.tone}`} key={item.id}>
                          <strong>{item.title}</strong>
                          <span>{item.detail}</span>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="notification-empty">No budget alerts or upcoming scheduled payments.</p>
                  )}
                </div>
              )}
            </div>

            <button
              className="icon-button theme-button"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
            </button>

            <div className="top-avatar">MY</div>
          </div>
        </header>

        <div className="dashboard">
          {(error || notice) && (
            <div
              className={`notice ${error ? "notice-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <span>{error || notice}</span>

              <div className="notice-actions">
                {error && (
                  <button onClick={retryLoad}>Retry</button>
                )}

                <button
                  onClick={() => {
                    setNotice("");
                    setError("");
                  }}
                  aria-label="Dismiss notification"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="live-dot" />
                YOUR FINANCIAL OVERVIEW
              </div>

              <h1>
                {activeNav === "Overview"
                  ? "Good morning"
                  : activeNav}
                <span className="heading-period">.</span>
              </h1>

              <p className="subtitle">
                {activeNav === "Overview"
                  ? "Here's what's happening with your money."
                  : `Manage and review your ${activeNav.toLowerCase()}.`}
              </p>
            </div>

            <div className="welcome-actions">
              {(activeNav === "Overview" || activeNav === "Transactions") && (
                <>
                  <button
                    className="button-secondary"
                    onClick={exportTransactions}
                  >
                    <Download size={16} /> Export CSV
                  </button>

                  <button
                    className="button-primary"
                    onClick={() => openTransaction()}
                  >
                    <Plus size={18} /> Add transaction
                  </button>
                </>
              )}
              {activeNav === "Budgets" && (
                <button className="button-primary" onClick={() => openBudget()}>
                  <Plus size={18} /> Set budget
                </button>
              )}
              {activeNav === "Savings goals" && (
                <button className="button-primary" onClick={() => openGoal()}>
                  <Plus size={18} /> Create a goal
                </button>
              )}
            </div>
          </section>

          {activeNav === "Overview" && showOnboarding && !loading && !error &&
            transactions.length === 0 && goals.length === 0 && recurring.length === 0 && (
              <section className="onboarding-card" aria-label="Getting started">
                <div>
                  <p className="eyebrow">WELCOME TO FINORA</p>
                  <h2>Start with a clear picture of your finances</h2>
                  <p>Add a transaction, set a category budget, then create a savings goal. Your records stay in your local database.</p>
                  <div className="onboarding-actions">
                    <button className="button-primary" onClick={() => openTransaction()}>
                      <Plus size={16} /> Add your first transaction
                    </button>
                    <button className="button-secondary" onClick={() => setActiveNav("Budgets")}>
                      Set a budget
                    </button>
                  </div>
                </div>
                <button
                  className="onboarding-dismiss"
                  onClick={() => {
                    window.localStorage.setItem("finora-onboarding-complete", "true");
                    setShowOnboarding(false);
                  }}
                  aria-label="Dismiss getting started guide"
                >
                  <X size={17} />
                </button>
              </section>
            )}

          {activeNav === "Overview" && widgets.stats && <section className="stat-grid">
            <article className="stat-card balance-card">
              <div className="stat-top">
                <span>Total balance</span>
                <div className="stat-icon violet">
                  <Wallet size={19} />
                </div>
              </div>

              <div className="stat-value">
                {loading
                  ? "—"
                  : money(dashboardData?.balance ?? 0)}
              </div>

              <div className="stat-footer">
                <span>Lifetime net</span>
                <span>All transactions</span>
              </div>

              <div className="balance-decoration" />
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>Income</span>
                <div className="stat-icon green">
                  <ArrowDownRight size={19} />
                </div>
              </div>

              <div className="stat-value">
                {loading
                  ? "—"
                  : money(periodData?.income ?? 0)}
              </div>

              <div className="stat-footer">
                <span className="trend positive">
                  <ArrowUpRight size={15} /> Recorded
                </span>
                <span>
                  This {period === "week" ? "week" : "month"}
                </span>
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>Expenses</span>
                <div className="stat-icon orange">
                  <CreditCard size={19} />
                </div>
              </div>

              <div className="stat-value">
                {loading
                  ? "—"
                  : money(periodData?.expenses ?? 0)}
              </div>

              <div className="stat-footer">
                <span className="trend negative">
                  <ArrowUpRight size={15} /> Recorded
                </span>
                <span>
                  This {period === "week" ? "week" : "month"}
                </span>
              </div>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span>Net savings</span>
                <div className="stat-icon blue">
                  <PiggyBank size={19} />
                </div>
              </div>

              <div className="stat-value">
                {loading
                  ? "—"
                  : money(periodData?.savings ?? 0)}
              </div>

              <div className="stat-footer">
                <span className="trend positive">
                  <TrendingUp size={15} /> Income less expenses
                </span>
                <span>
                  This {period === "week" ? "week" : "month"}
                </span>
              </div>
            </article>
          </section>}

          {activeNav === "Overview" && (
            <>
              {widgets.insights && (
              <section className="insights-section" aria-label="Financial insights">
                <div className="insights-header">
                  <div>
                    <p className="eyebrow insight-label">
                      <span className="live-dot" /> SMART INSIGHTS
                    </p>
                    <h2>Financial pulse</h2>
                  </div>
                </div>

                <div className="insights-grid">
                  <article className="insight-card primary">
                    <div className="insight-icon">
                      <TrendingUp size={18} />
                    </div>
                    <div>
                      <span>Savings rate</span>
                      <strong>{Math.round(insights.savingsRate)}%</strong>
                      <small>
                        {insights.savingsRate >= 20
                          ? "Healthy target"
                          : insights.savingsRate > 0
                            ? "Room to grow"
                            : "Start building momentum"}
                      </small>
                    </div>
                  </article>

                  <article className="insight-card">
                    <div className="insight-icon">
                      <Wallet size={18} />
                    </div>
                    <div>
                      <span>Biggest spend</span>
                      <strong>
                        {insights.largestBudget
                          ? insights.largestBudget.category
                          : "No budgets set"}
                      </strong>
                      <small>
                        {insights.largestBudget
                          ? money(insights.largestBudget.spent)
                          : "Set a category budget to compare spend"}
                      </small>
                    </div>
                  </article>

                  <article className="insight-card">
                    <div className="insight-icon">
                      <Target size={18} />
                    </div>
                    <div>
                      <span>Next goal</span>
                      <strong>
                        {insights.nextGoal ? insights.nextGoal.name : "All funded"}
                      </strong>
                      <small>{insights.headline}</small>
                    </div>
                  </article>
                </div>
              </section>
              )}

              {widgets.analytics && (
              <section className="analytics-section" aria-label="Spending analytics">
                <div className="insights-header">
                  <div>
                    <p className="eyebrow insight-label">
                      <span className="live-dot" /> SPENDING ANALYTICS
                    </p>
                    <h2>Money in motion</h2>
                  </div>
                </div>

                <div className="analytics-grid">
                  <article className="panel analytics-card">
                    <div className="analytics-card-header">
                      <h3>Top spending categories</h3>
                    </div>

                    {categoryBreakdown.length ? (
                      <div className="category-breakdown">
                        {categoryBreakdown.map(({ category, amount }) => {
                          const maxAmount = Math.max(...categoryBreakdown.map((item) => item.amount), 1);
                          const width = Math.max((amount / maxAmount) * 100, 14);

                          return (
                            <div key={category} className="breakdown-row">
                              <div className="breakdown-label-row">
                                <span>{category}</span>
                                <strong>{money(amount)}</strong>
                              </div>
                              <div className="breakdown-track">
                                <span style={{ width: `${width}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="analytics-empty">No spending data yet. Add an expense to start tracking your categories.</p>
                    )}
                  </article>

                  <article className="panel analytics-card">
                    <div className="analytics-card-header">
                      <h3>Projected balance</h3>
                    </div>

                    <div className="projected-balance">
                      <strong>{money(projectedBalance)}</strong>
                      <span>Based on current balance and scheduled cash flow</span>
                    </div>

                    <div className="upcoming-list">
                      {recurringUpNext.length ? (
                        recurringUpNext.map((entry) => (
                          <div key={entry.id} className="upcoming-item">
                            <div>
                              <strong>{entry.name}</strong>
                              <span>{entry.frequency}</span>
                            </div>
                            <em className={entry.type === "income" ? "income" : "expense"}>
                              {entry.type === "income" ? "+" : "−"}
                              {money(entry.amount)}
                            </em>
                          </div>
                        ))
                      ) : (
                        <p className="analytics-empty">No recurring money movement scheduled.</p>
                      )}
                    </div>
                  </article>
                </div>
              </section>
              )}

              {widgets.recommendations && (
              <section className="recommendations-section" aria-label="Money recommendations">
                <div className="insights-header">
                  <div>
                    <p className="eyebrow insight-label">
                      <span className="live-dot" /> MONEY MOVES
                    </p>
                    <h2>Smart recommendations</h2>
                  </div>
                </div>

                <div className="recommendation-list">
                  {recommendations.map((recommendation) => (
                    <article
                      key={`${recommendation.title}-${recommendation.badge}`}
                      className={`recommendation-card ${recommendation.tone}`}
                    >
                      <div className="recommendation-badge">{recommendation.badge}</div>

                      <div className="recommendation-copy">
                        <h3>{recommendation.title}</h3>
                        <p>{recommendation.description}</p>
                      </div>

                      <button
                        className="button-secondary small-button recommendation-action"
                        onClick={() => setActiveNav(recommendation.target)}
                        type="button"
                      >
                        {recommendation.action}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
              )}

              {widgets.activity && (
                <section className="panel activity-overview" aria-label="Recent activity">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>Audited changes across your financial records</p>
                    </div>
                    <button className="text-action" onClick={() => setActiveNav("Activity")}>
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {activity.length ? (
                    <div className="activity-list">
                      {activity.slice(0, 5).map((item) => (
                        <article className="activity-item" key={item.id}>
                          <span className={`activity-mark ${item.action}`}><History size={15} /></span>
                          <div>
                            <strong>{item.summary}</strong>
                            <span>{item.entityType} · {displayTimestamp(item.occurredAt)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="activity-empty">Record changes will appear here as you use Finora.</p>
                  )}
                </section>
              )}
            </>
          )}

          {(activeNav === "Overview" || activeNav === "Budgets") && (
          <section className={`middle-grid ${activeNav === "Budgets" ? "single-panel" : ""}`}>
            {activeNav === "Overview" && <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <h2>Cash flow</h2>
                  <p>Track your income and expenses</p>
                </div>

                <button
                  className="select-button"
                  onClick={changePeriod}
                >
                  {period === "week" ? "This week" : "This month"}
                  <ChevronDown size={15} />
                </button>
              </div>

              <div className="chart-legend">
                <span>
                  <i className="legend-dot income-dot" /> Income{" "}
                  <strong>{money(periodData?.income ?? 0)}</strong>
                </span>

                <span>
                  <i className="legend-dot expense-dot" /> Expenses{" "}
                  <strong>{money(periodData?.expenses ?? 0)}</strong>
                </span>
              </div>

              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={dashboardData?.cashflow ?? []}
                    margin={{
                      top: 12,
                      right: 8,
                      left: -16,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="incomeGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#8170f5"
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="100%"
                          stopColor="#8170f5"
                          stopOpacity={0.01}
                        />
                      </linearGradient>

                      <linearGradient
                        id="expenseGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#39b99a"
                          stopOpacity={0.15}
                        />
                        <stop
                          offset="100%"
                          stopColor="#39b99a"
                          stopOpacity={0.01}
                        />
                      </linearGradient>
                    </defs>

                    <CartesianGrid
                      stroke="#edf0f5"
                      strokeDasharray="4 5"
                      vertical={false}
                    />

                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#9298a8", fontSize: 12 }}
                      dy={10}
                    />

                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#9298a8", fontSize: 11 }}
                      tickFormatter={(value) => `$${value}`}
                    />

                    <Tooltip
                      formatter={(value) => money(value)}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #ececf4",
                        fontSize: 12,
                      }}
                    />

                    <Area
                      type="monotone"
                      dataKey="income"
                      name="Income"
                      stroke="#8170f5"
                      strokeWidth={2.5}
                      fill="url(#incomeGradient)"
                    />

                    <Area
                      type="monotone"
                      dataKey="expenses"
                      name="Expenses"
                      stroke="#39b99a"
                      strokeWidth={2.5}
                      fill="url(#expenseGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>}

            <article className="panel budget-panel">
              <div className="panel-heading">
                <div>
                  <h2>Budget overview</h2>
                  <p>Your monthly spending limits</p>
                </div>

                <button
                  className="text-action"
                  onClick={() => openBudget()}
                >
                  <Plus size={15} /> Set budget
                </button>
              </div>

              <div className="budget-total">
                <div>
                  <span>Monthly budget</span>
                  <strong>
                    {money(totalBudgetSpent)}{" "}
                    <small>of {money(totalBudget)}</small>
                  </strong>
                </div>

                <div className="budget-percent">
                  {Math.round(budgetPercent)}%
                </div>
              </div>

              <div className="overall-progress">
                <span style={{ width: `${budgetPercent}%` }} />
              </div>

              <div className="budget-list">
                {budgets.length ? (
                  budgets.map((budget, index) => {
                    const Icon =
                      categoryIcons[budget.category] ?? Wallet;

                    const percentage =
                      budget.limit > 0
                        ? Math.min(
                            100,
                            (budget.spent / budget.limit) * 100
                          )
                        : 0;

                    return (
                      <div
                        className="budget-item"
                        key={budget.category}
                      >
                        <div className="budget-line">
                          <span>
                            <Icon size={14} /> {budget.category}
                          </span>

                          <span>
                            <strong>{money(budget.spent)}</strong>
                            <small> / {money(budget.limit)}</small>
                          </span>
                        </div>

                        <div className="budget-progress">
                          <span
                            className={
                              ["purple", "blue", "orange", "green"][
                                index % 4
                              ]
                            }
                            style={{ width: `${percentage}%` }}
                          />
                        </div>

                        <div className="budget-actions">
                          <button
                            onClick={() => openBudget(budget)}
                            aria-label={`Edit ${budget.category} budget`}
                          >
                            <Pencil size={13} /> Edit
                          </button>

                          <button
                            onClick={() => deleteBudget(budget)}
                            aria-label={`Remove ${budget.category} budget`}
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="budget-empty">
                    No budgets yet. Set a monthly limit to keep
                    spending on track.
                  </p>
                )}
              </div>

              {budgets.length > 0 && (
                <div className="budget-tip">
                  <Sparkles size={16} />
                  <span>
                    {totalBudgetSpent > totalBudget ? (
                      <>
                        <strong>Over budget</strong> — Spending is
                        above your monthly limits.
                      </>
                    ) : (
                      <>
                        <strong>Budget check-in</strong> —{" "}
                        {money(
                          Math.max(0, totalBudget - totalBudgetSpent)
                        )}{" "}
                        remaining across your budgets.
                      </>
                    )}
                  </span>
                </div>
              )}
            </article>
          </section>
          )}

          {(activeNav === "Overview" || activeNav === "Transactions") && <section className="panel transactions-panel">
            <div className="panel-heading transactions-heading">
              <div>
                <h2>Transactions</h2>
                <p>{activeNav === "Transactions" ? "All of your financial activity" : "Your latest financial activity"}</p>
              </div>

              <div className="transaction-panel-actions">
                <button
                  className="text-action"
                  onClick={() => openTransaction()}
                >
                  <Plus size={15} /> Add new
                </button>
                <button
                  className="text-action"
                  onClick={openCsvImport}
                >
                  <FileUp size={15} /> Import CSV
                </button>
              </div>
            </div>

            <div className="transaction-filters" aria-label="Filter transactions">
              <label>
                <span>Type</span>
                <select
                  aria-label="Filter by transaction type"
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                >
                  <option value="all">All activity</option>
                  <option value="income">Income</option>
                  <option value="expense">Expenses</option>
                </select>
              </label>
              <label>
                <span>Category</span>
                <select
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All categories</option>
                  <option value="Income">Income</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select
                  aria-label="Sort transactions"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value)}
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="amount-desc">Highest amount</option>
                  <option value="amount-asc">Lowest amount</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <label>
                <span>From</span>
                <input
                  type="date"
                  aria-label="Filter from date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  aria-label="Filter to date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
              {(categoryFilter !== "all" || typeFilter !== "all" || search || dateFrom || dateTo) && (
                <button
                  className="clear-filters"
                  onClick={() => {
                    setSearch("");
                    setTypeFilter("all");
                    setCategoryFilter("all");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Clear filters
                </button>
              )}
              {dateFrom && dateTo && dateFrom > dateTo && (
                <span className="date-filter-error" role="alert">Start date must be on or before end date.</span>
              )}
              <span className="filter-result-count">
                {sortedTransactions.length} {sortedTransactions.length === 1 ? "result" : "results"}
              </span>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>TRANSACTION</th>
                    <th>CATEGORY</th>
                    <th>DATE</th>
                    <th>AMOUNT</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="5" className="empty-state">
                        Loading your transactions…
                      </td>
                    </tr>
                  ) : sortedTransactions.length ? (
                    sortedTransactions
                      .slice(
                        0,
                        activeNav === "Transactions"
                          ? sortedTransactions.length
                          : 6
                      )
                      .map((item) => {
                        const Icon =
                          categoryIcons[item.category] ?? Wallet;

                        return (
                          <tr key={item.id}>
                            <td>
                              <div className="transaction-name">
                                <div
                                  className={`transaction-icon ${item.type}`}
                                >
                                  <Icon size={17} />
                                </div>
                                <strong>{item.name}</strong>
                              </div>
                            </td>

                            <td>
                              <span className="category-pill">
                                {item.category}
                              </span>
                            </td>

                            <td className="date-cell">
                              {displayDate(item.date)}
                            </td>

                            <td
                              className={`amount-cell ${item.type}`}
                            >
                              {item.type === "income" ? "+" : "−"}
                              {money(item.amount)}
                            </td>

                            <td>
                              <div className="row-actions">
                                <button
                                  className="row-menu"
                                  aria-label={`Edit ${item.name}`}
                                  onClick={() => openTransaction(item)}
                                >
                                  <Pencil size={16} />
                                </button>

                                <button
                                  className="row-menu danger"
                                  aria-label={`Delete ${item.name}`}
                                  onClick={() => deleteTransaction(item)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan="5" className="empty-state">
                        {search || categoryFilter !== "all" || typeFilter !== "all"
                          ? "No transactions match these filters."
                          : "No transactions yet. Add one to start tracking your finances."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span>
                Showing{" "}
                {Math.min(
                  sortedTransactions.length,
                  activeNav === "Transactions"
                    ? sortedTransactions.length
                    : 6
                )}{" "}
                of {sortedTransactions.length} transactions
              </span>

              <button
                className="button-secondary small-button"
                onClick={() => openTransaction()}
              >
                <Plus size={15} /> Add new
              </button>
            </div>
          </section>}

          {activeNav === "Savings goals" && (
            <section className="goals-section" aria-label="Savings goals">
              <div className="goals-summary">
                <article className="panel goals-summary-card">
                  <span>Active goals</span>
                  <strong>{goals.length}</strong>
                </article>
                <article className="panel goals-summary-card">
                  <span>Total saved</span>
                  <strong>{money(goals.reduce((sum, goal) => sum + goal.savedAmount, 0))}</strong>
                </article>
                <article className="panel goals-summary-card">
                  <span>Total target</span>
                  <strong>{money(goals.reduce((sum, goal) => sum + goal.targetAmount, 0))}</strong>
                </article>
              </div>

              {goals.length ? (
                <div className="goal-grid">
                  {goals.map((goal) => {
                    const progress = Math.min(100, (goal.savedAmount / goal.targetAmount) * 100);
                    const completed = goal.savedAmount >= goal.targetAmount;

                    return (
                      <article className="panel goal-card" key={goal.id}>
                        <div className="goal-card-heading">
                          <div className="goal-icon"><Target size={19} /></div>
                          <div className="goal-actions">
                            <button
                              className="row-menu"
                              aria-label={`Edit ${goal.name}`}
                              onClick={() => openGoal(goal)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="row-menu danger"
                              aria-label={`Delete ${goal.name}`}
                              onClick={() => deleteGoal(goal)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <h2>{goal.name}</h2>
                        <p className="goal-target">
                          {completed ? "Goal reached" : `${money(goal.targetAmount - goal.savedAmount)} to go`}
                          {goal.targetDate && <span>Target date · {displayDate(goal.targetDate)}</span>}
                        </p>
                        <div
                          className="goal-progress"
                          role="progressbar"
                          aria-label={`${goal.name} progress`}
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={Math.round(progress)}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        <div className="goal-amounts">
                          <strong>{money(goal.savedAmount)} saved</strong>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        {!completed && (
                          <button
                            className="goal-contribute-button"
                            onClick={() => openContribution(goal)}
                          >
                            <Plus size={15} /> Add savings
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="panel goals-empty">
                  <div className="goal-icon"><Target size={22} /></div>
                  <h2>Start with a goal</h2>
                  <p>Give your savings a purpose. Set a target, track your progress, and update it as you save.</p>
                  <button className="button-primary" onClick={() => openGoal()}>
                    <Plus size={16} /> Create your first goal
                  </button>
                </div>
              )}
            </section>
          )}

          {activeNav === "Recurring" && (
            <section className="recurring-section" aria-label="Recurring transactions">
              <div className="recurring-summary">
                <article className="panel recurring-summary-card">
                  <span>Active schedules</span>
                  <strong>{recurring.length}</strong>
                </article>
                <article className="panel recurring-summary-card">
                  <span>Income scheduled</span>
                  <strong>{money(recurringSummary.income)}</strong>
                </article>
                <article className="panel recurring-summary-card">
                  <span>Expense scheduled</span>
                  <strong>{money(recurringSummary.expense)}</strong>
                </article>
              </div>

              {recurring.length ? (
                <div className="recurring-grid">
                  {recurring.map((entry) => (
                    <article className="panel recurring-card" key={entry.id}>
                      <div className="recurring-card-top">
                        <div className="goal-icon recurring-icon"><CalendarRange size={18} /></div>
                        <div className="goal-actions">
                          <button
                            className="row-menu"
                            aria-label={`Edit ${entry.name}`}
                            onClick={() => openRecurring(entry)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="row-menu danger"
                            aria-label={`Delete ${entry.name}`}
                            onClick={() => deleteRecurring(entry)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="recurring-card-body">
                        <div>
                          <h2>{entry.name}</h2>
                          <span className="category-pill">{entry.category}</span>
                        </div>
                        <p className="recurring-amount">
                          {entry.type === "income" ? "+" : "−"}
                          {money(entry.amount)}
                        </p>
                      </div>

                      <div className="recurring-meta">
                        <span>{entry.frequency}</span>
                        <span>Next due · {displayDate(entry.nextDate)}</span>
                      </div>

                      <button className="button-primary recurring-button" onClick={() => applyRecurring(entry)}>
                        <Plus size={15} /> Apply next
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel goals-empty">
                  <div className="goal-icon"><CalendarRange size={22} /></div>
                  <h2>Set recurring cash flow</h2>
                  <p>Track subscriptions, salary, rent, or other repeating payments so your budget stays realistic.</p>
                  <button className="button-primary" onClick={() => openRecurring()}>
                    <Plus size={16} /> Add recurring schedule
                  </button>
                </div>
              )}
            </section>
          )}

          {activeNav === "Settings" && (
            <section className="settings-page" aria-label="Application settings">
              <article className="panel settings-card">
                <div className="settings-card-heading">
                  <div className="settings-icon"><Settings size={19} /></div>
                  <div>
                    <h2>Appearance</h2>
                    <p>Choose the theme used on this device.</p>
                  </div>
                </div>
                <div className="theme-options" role="group" aria-label="Color theme">
                  <button
                    className={theme === "light" ? "selected" : ""}
                    aria-pressed={theme === "light"}
                    onClick={() => setTheme("light")}
                  >
                    <SunMedium size={17} /> Light
                  </button>
                  <button
                    className={theme === "dark" ? "selected" : ""}
                    aria-pressed={theme === "dark"}
                    onClick={() => setTheme("dark")}
                  >
                    <MoonStar size={17} /> Dark
                  </button>
                </div>
              </article>

              <article className="panel settings-card">
                <div className="settings-card-heading">
                  <div className="settings-icon"><FileText size={19} /></div>
                  <div>
                    <h2>Your data</h2>
                    <p>Export a portable copy of your financial records.</p>
                  </div>
                </div>
                <div className="settings-data-summary">
                  <span>{transactions.length} transactions</span>
                  <span>{budgets.length} budgets</span>
                  <span>{goals.length} savings goals</span>
                  <span>{recurring.length} recurring schedules</span>
                </div>
                <button className="button-primary" onClick={exportBackup}>
                  <Download size={16} /> Download JSON backup
                </button>
                <p className="settings-note">
                  Finora stores data in a local SQLite database. This app does not provide sign-in, cloud sync, or multi-user access.
                </p>
              </article>
            </section>
          )}

          <footer className="footer">
            <span>© 2026 Finora Finance</span>
            <span>
              <span className="footer-dot" /> Your money, in perspective.
            </span>
          </footer>
        </div>
      </main>

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !saving
            ) {
              setModal(null);
            }
          }}
        >
          {modal.type === "transaction" ? (
            <form
              className="transaction-modal"
              onSubmit={submitTransaction}
            >
              <div className="modal-heading">
                <div>
                  <h2>
                    {modal.transactionId
                      ? "Edit transaction"
                      : "Add transaction"}
                  </h2>
                  <p>
                    Keep your financial records up to date.
                  </p>
                </div>

                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                Transaction name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="e.g. Grocery shopping"
                  value={transactionForm.name}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      name: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Amount (USD)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={transactionForm.amount}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      amount: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Transaction type
                <select
                  value={transactionForm.type}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      type: event.target.value,
                    })
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>

              {transactionForm.type === "expense" && (
                <label>
                  Category
                  <select
                    value={transactionForm.category}
                    onChange={(event) =>
                      setTransactionForm({
                        ...transactionForm,
                        category: event.target.value,
                      })
                    }
                  >
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                Date
                <input
                  required
                  type="date"
                  value={transactionForm.date}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      date: event.target.value,
                    })
                  }
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="button-primary"
                  disabled={saving}
                >
                  {saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <Plus size={16} /> Save transaction
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : modal.type === "budget" ? (
            <form
              className="transaction-modal"
              onSubmit={submitBudget}
            >
              <div className="modal-heading">
                <div>
                  <h2>Monthly budget</h2>
                  <p>
                    Set a spending limit for a category.
                  </p>
                </div>

                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                Category
                <select
                  value={budgetForm.category}
                  onChange={(event) =>
                    setBudgetForm({
                      ...budgetForm,
                      category: event.target.value,
                    })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                Monthly limit (USD)
                <input
                  autoFocus
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={budgetForm.limit}
                  onChange={(event) =>
                    setBudgetForm({
                      ...budgetForm,
                      limit: event.target.value,
                    })
                  }
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="button-primary"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save budget"}
                </button>
              </div>
            </form>
          ) : modal.type === "recurring" ? (
            <form className="transaction-modal" onSubmit={submitRecurring}>
              <div className="modal-heading">
                <div>
                  <h2>{modal.recurringId ? "Edit recurring schedule" : "Add recurring schedule"}</h2>
                  <p>Plan income and expenses that repeat.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                Schedule name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="e.g. Rent payment"
                  value={recurringForm.name}
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, name: event.target.value })
                  }
                />
              </label>

              <label>
                Type
                <select
                  value={recurringForm.type}
                  onChange={(event) =>
                    setRecurringForm({
                      ...recurringForm,
                      type: event.target.value,
                      category: event.target.value === "income" ? "Income" : recurringForm.category === "Income" ? categories[0] : recurringForm.category,
                    })
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>

              <label>
                Category
                <select
                  value={recurringForm.category}
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, category: event.target.value })
                  }
                >
                  {recurringForm.type === "income" ? (
                    <option value="Income">Income</option>
                  ) : (
                    categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))
                  )}
                </select>
              </label>

              <label>
                Amount (USD)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={recurringForm.amount}
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, amount: event.target.value })
                  }
                />
              </label>

              <label>
                Frequency
                <select
                  value={recurringForm.frequency}
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, frequency: event.target.value })
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>

              <label>
                Next due date
                <input
                  required
                  type="date"
                  value={recurringForm.nextDate}
                  onChange={(event) =>
                    setRecurringForm({ ...recurringForm, nextDate: event.target.value })
                  }
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="button-primary" disabled={saving}>
                  {saving ? "Saving…" : modal.recurringId ? "Save schedule" : "Create schedule"}
                </button>
              </div>
            </form>
          ) : modal.type === "goal" ? (
            <form className="transaction-modal" onSubmit={submitGoal}>
              <div className="modal-heading">
                <div>
                  <h2>{modal.goalId ? "Edit savings goal" : "Create a savings goal"}</h2>
                  <p>Choose a target and keep track of your progress.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                Goal name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="e.g. Emergency fund"
                  value={goalForm.name}
                  onChange={(event) =>
                    setGoalForm({ ...goalForm, name: event.target.value })
                  }
                />
              </label>

              <label>
                Target amount (USD)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={goalForm.targetAmount}
                  onChange={(event) =>
                    setGoalForm({ ...goalForm, targetAmount: event.target.value })
                  }
                />
              </label>

              <label>
                Amount saved (USD)
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={goalForm.savedAmount}
                  onChange={(event) =>
                    setGoalForm({ ...goalForm, savedAmount: event.target.value })
                  }
                />
              </label>

              <label>
                Target date (optional)
                <input
                  type="date"
                  value={goalForm.targetDate}
                  onChange={(event) =>
                    setGoalForm({ ...goalForm, targetDate: event.target.value })
                  }
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button-primary"
                  disabled={saving}
                >
                  {saving ? "Saving…" : modal.goalId ? "Save changes" : "Create goal"}
                </button>
              </div>
            </form>
          ) : modal.type === "csv-import" ? (
            <form className="transaction-modal csv-import-modal" onSubmit={submitCsvImport}>
              <div className="modal-heading">
                <div>
                  <h2>Import transactions</h2>
                  <p>Import up to 500 records from a Finora-compatible CSV file.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                  disabled={saving}
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Choose transactions CSV file"
                  onChange={handleCsvFile}
                  disabled={saving}
                />
              </label>

              <p className="csv-format-hint">
                Required columns: Date, Name, Category, Type, Amount. Expenses use the app’s categories; income uses the Income category.
              </p>

              {csvPreview && (
                <div className="csv-preview" aria-live="polite">
                  <strong>{csvPreview.fileName}</strong>
                  <span>{csvPreview.transactions.length} records ready to import</span>
                  <ul>
                    {csvPreview.transactions.slice(0, 3).map((transaction, index) => (
                      <li key={`${transaction.date}-${transaction.name}-${index}`}>
                        <span>{transaction.name || "Unnamed transaction"}</span>
                        <span>{transaction.date} · {money(Number.isFinite(transaction.amount) ? transaction.amount : 0)}</span>
                      </li>
                    ))}
                    {csvPreview.transactions.length > 3 && (
                      <li>and {csvPreview.transactions.length - 3} more…</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button-primary"
                  disabled={saving || !csvPreview?.transactions.length}
                >
                  {saving ? "Importing…" : <><FileUp size={16} /> Import transactions</>}
                </button>
              </div>
            </form>
          ) : (
            <form className="transaction-modal" onSubmit={submitContribution}>
              <div className="modal-heading">
                <div>
                  <h2>Add to your savings</h2>
                  <p>Make progress on {modal.goalName}.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>

              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}

              <label>
                Contribution amount (USD)
                <input
                  autoFocus
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={contributionAmount}
                  onChange={(event) => setContributionAmount(event.target.value)}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="button-primary" disabled={saving}>
                  {saving ? "Adding…" : "Add contribution"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
