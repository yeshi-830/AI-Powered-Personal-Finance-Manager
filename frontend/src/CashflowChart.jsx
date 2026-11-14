import { ChevronDown } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function CashflowChart({ period, periodData, data, onChangePeriod, money }) {
  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Cash flow</h2>
          <p>Track your income and expenses</p>
        </div>

        <button className="select-button" onClick={onChangePeriod}>
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
            data={data}
            margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
          >
            <defs>
              <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8170f5" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#8170f5" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#39b99a" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#39b99a" stopOpacity={0.01} />
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
    </article>
  );
}

export default CashflowChart;
