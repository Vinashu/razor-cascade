import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ProviderName = "openai" | "anthropic" | "xai" | "gemini";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface DashboardDatum {
  label: string;
  meanCostUsd: number;
  meanTokens: number;
  meanQuality: number;
  costSavingsVsBaselinePct?: number | null;
  tokenSavingsVsBaselinePct?: number | null;
}

export interface NumericSummary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number;
}

const PRICE_BOOK: Record<ProviderName, Record<string, ModelPricing>> = {
  openai: {
    "gpt-5.4": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 },
    "gpt-5-mini": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
    "gpt-5-nano": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 },
  },
  anthropic: {
    "claude-4-sonnet": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-4-haiku": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  },
  xai: {
    "grok-4": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
    "grok-code-fast": { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1 },
    "grok-4.20-beta": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
    "grok-4-fast": { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.5 },
  },
  gemini: {
    "gemini-2.5-pro": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
    "gemini-2.5-flash": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  },
};

export function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

export function resolvePricing(provider: ProviderName, model: string): ModelPricing {
  const catalog = PRICE_BOOK[provider];
  if (catalog[model]) {
    return catalog[model];
  }

  const normalized = model.toLowerCase();
  const prefixMatch = Object.entries(catalog).find(([known]) => normalized.startsWith(known.toLowerCase()));
  if (prefixMatch) {
    return prefixMatch[1];
  }

  const values = Object.values(catalog);
  return values[0];
}

export function estimateCostUsd(provider: ProviderName, model: string, usage: TokenUsage): number {
  const pricing = resolvePricing(provider, model);
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return roundNumber(inputCost + outputCost, 8);
}

export function roundNumber(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  return sorted[midpoint];
}

export function standardDeviation(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function summarizeNumbers(values: number[]): NumericSummary {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      stddev: 0,
    };
  }

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean: roundNumber(avg, 4),
    median: roundNumber(median(values), 4),
    min: roundNumber(Math.min(...values), 4),
    max: roundNumber(Math.max(...values), 4),
    stddev: roundNumber(standardDeviation(values), 4),
  };
}

export function percentSavings(baseline: number, candidate: number): number | null {
  if (baseline <= 0) {
    return null;
  }

  return roundNumber(((baseline - candidate) / baseline) * 100, 2);
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) {
        set.add(key);
      }

      return set;
    }, new Set<string>()),
  );

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

export async function writeCsv(filePath: string, rows: Array<Record<string, unknown>>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, toCsv(rows));
}

export function renderTextBarChart(
  data: DashboardDatum[],
  metric: "meanCostUsd" | "meanTokens" | "meanQuality",
): string {
  if (data.length === 0) {
    return "";
  }

  const values = data.map((item) => item[metric]);
  const maxValue = Math.max(...values, 1);
  return data
    .map((item) => {
      const width = Math.max(1, Math.round((item[metric] / maxValue) * 24));
      const bar = "#".repeat(width);
      return `${item.label.padEnd(14)} ${bar.padEnd(24)} ${roundNumber(item[metric], 2)}`;
    })
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function writeHtmlDashboard(filePath: string, data: DashboardDatum[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const maxCost = Math.max(...data.map((item) => item.meanCostUsd), 1);
  const maxTokens = Math.max(...data.map((item) => item.meanTokens), 1);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RazorCascade Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3ea;
        --card: rgba(255, 255, 255, 0.86);
        --ink: #14213d;
        --muted: #5e6472;
        --accent: #cc5803;
        --accent-soft: #f4a259;
        --quality: #2a9d8f;
        --border: rgba(20, 33, 61, 0.12);
        --shadow: 0 18px 40px rgba(20, 33, 61, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 48px 24px;
        background:
          radial-gradient(circle at top left, rgba(244, 162, 89, 0.28), transparent 38%),
          radial-gradient(circle at bottom right, rgba(42, 157, 143, 0.2), transparent 36%),
          var(--bg);
        color: var(--ink);
        font-family: "Segoe UI", "Aptos", sans-serif;
      }

      main {
        max-width: 1080px;
        margin: 0 auto;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 4vw, 3.2rem);
        letter-spacing: -0.04em;
      }

      p {
        color: var(--muted);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 18px;
        margin-top: 28px;
      }

      .card {
        padding: 20px;
        border-radius: 20px;
        border: 1px solid var(--border);
        background: var(--card);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }

      .bars {
        display: grid;
        gap: 14px;
        margin-top: 26px;
      }

      .label {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        font-weight: 600;
      }

      .bar-shell {
        margin-top: 8px;
        border-radius: 999px;
        height: 14px;
        overflow: hidden;
        background: rgba(20, 33, 61, 0.08);
      }

      .bar {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent), var(--accent-soft));
      }

      .bar.tokens {
        background: linear-gradient(90deg, #264653, #2a9d8f);
      }

      .bar.quality {
        background: linear-gradient(90deg, #588157, #bcce98);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 28px;
      }

      th, td {
        padding: 12px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>RazorCascade Dashboard</h1>
      <p>Mean cost, tokens, and quality by configuration.</p>
      <section class="grid">
        ${data
          .map(
            (item) => `<article class="card">
          <div class="label"><span>${escapeHtml(item.label)}</span><span>${item.costSavingsVsBaselinePct ?? "n/a"}% cost savings</span></div>
          <p>$${item.meanCostUsd.toFixed(4)} mean cost</p>
          <p>${Math.round(item.meanTokens).toLocaleString()} mean tokens</p>
          <p>${item.meanQuality.toFixed(2)} / 10 mean quality</p>
        </article>`,
          )
          .join("")}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Mean Cost</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div>
            <div class="label"><span>${escapeHtml(item.label)}</span><span>$${item.meanCostUsd.toFixed(4)}</span></div>
            <div class="bar-shell"><div class="bar" style="width:${Math.max(4, (item.meanCostUsd / maxCost) * 100)}%"></div></div>
          </div>`,
            )
            .join("")}
        </div>
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Mean Tokens</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div>
            <div class="label"><span>${escapeHtml(item.label)}</span><span>${Math.round(item.meanTokens).toLocaleString()}</span></div>
            <div class="bar-shell"><div class="bar tokens" style="width:${Math.max(4, (item.meanTokens / maxTokens) * 100)}%"></div></div>
          </div>`,
            )
            .join("")}
        </div>
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Quality</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div>
            <div class="label"><span>${escapeHtml(item.label)}</span><span>${item.meanQuality.toFixed(2)}</span></div>
            <div class="bar-shell"><div class="bar quality" style="width:${Math.max(4, (item.meanQuality / 10) * 100)}%"></div></div>
          </div>`,
            )
            .join("")}
        </div>
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Config</th>
              <th>Mean Cost</th>
              <th>Mean Tokens</th>
              <th>Mean Quality</th>
              <th>Cost Savings</th>
              <th>Token Savings</th>
            </tr>
          </thead>
          <tbody>
            ${data
              .map(
                (item) => `<tr>
              <td>${escapeHtml(item.label)}</td>
              <td>$${item.meanCostUsd.toFixed(4)}</td>
              <td>${Math.round(item.meanTokens).toLocaleString()}</td>
              <td>${item.meanQuality.toFixed(2)}</td>
              <td>${item.costSavingsVsBaselinePct ?? "n/a"}%</td>
              <td>${item.tokenSavingsVsBaselinePct ?? "n/a"}%</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;

  await Bun.write(filePath, html);
}
