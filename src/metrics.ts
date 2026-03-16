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
  meanDriftScore: number;
  costSavingsVsBaselinePct?: number | null;
  tokenSavingsVsBaselinePct?: number | null;
}

export interface DashboardCurveDatum {
  label: string;
  stepNumber: number;
  meanCostUsd: number;
  meanDriftScore: number;
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
  metric: "meanCostUsd" | "meanTokens" | "meanQuality" | "meanDriftScore",
): string {
  if (data.length === 0) {
    return "";
  }

  const values = data.map((item) => item[metric]);
  const maxValue = Math.max(...values);
  const allZero = maxValue === 0;
  return data
    .map((item) => {
      const width = allZero ? 0 : Math.max(1, Math.round((item[metric] / maxValue) * 24));
      const bar = "#".repeat(width);
      const suffix = metric === "meanDriftScore" && allZero ? " stable" : "";
      return `${item.label.padEnd(14)} ${bar.padEnd(24)} ${roundNumber(item[metric], 2)}${suffix}`;
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

interface ChartScale {
  min: number;
  max: number;
  ticks: number[];
  allZero: boolean;
}

function metricDescription(metric: "meanCostUsd" | "meanDriftScore"): string {
  return metric === "meanCostUsd"
    ? "Mean spend per iteration across runs."
    : "Mean drift score per iteration across runs.";
}

function metricUnit(metric: "meanCostUsd" | "meanDriftScore"): string {
  return metric === "meanCostUsd" ? "USD" : "score";
}

function formatMetricValue(metric: "meanCostUsd" | "meanDriftScore", value: number, withUnit = false): string {
  if (metric === "meanCostUsd") {
    return withUnit ? `$${value.toFixed(4)}` : value.toFixed(4);
  }

  return value.toFixed(2);
}

function buildTickValues(min: number, max: number, tickCount = 5): number[] {
  if (tickCount <= 1) {
    return [max];
  }

  const step = (max - min) / (tickCount - 1);
  return Array.from({ length: tickCount }, (_, index) => max - step * index);
}

function resolveChartScale(
  data: DashboardCurveDatum[],
  metric: "meanCostUsd" | "meanDriftScore",
): ChartScale {
  const values = data.map((item) => item[metric]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (maxValue === 0 && minValue === 0) {
    return {
      min: 0,
      max: 0,
      ticks: [0],
      allZero: true,
    };
  }

  if (maxValue === minValue) {
    const padding = metric === "meanCostUsd"
      ? Math.max(maxValue * 0.2, 0.001)
      : Math.max(maxValue * 0.2, 0.25);
    const min = Math.max(0, minValue - padding);
    const max = maxValue + padding;
    return {
      min,
      max,
      ticks: buildTickValues(min, max),
      allZero: false,
    };
  }

  const range = maxValue - minValue;
  let min = minValue - range * 0.18;
  let max = maxValue + range * 0.18;

  if (minValue >= 0) {
    min = Math.max(0, min);
  }

  if (metric === "meanDriftScore" && minValue === 0) {
    min = 0;
  }

  return {
    min,
    max,
    ticks: buildTickValues(min, max),
    allZero: false,
  };
}

function renderChartLegend(
  series: Array<{ label: string }>,
  palette: string[][],
): string {
  return series
    .map((entry, index) => {
      const [start] = palette[index % palette.length];
      return `<span><i style="background:${start}"></i>${escapeHtml(entry.label)}</span>`;
    })
    .join("");
}

function renderZeroStateLineChart(
  data: DashboardCurveDatum[],
  metric: "meanCostUsd" | "meanDriftScore",
  palette: string[][],
): string {
  const grouped = new Map<string, DashboardCurveDatum[]>();
  for (const item of data) {
    const existing = grouped.get(item.label) ?? [];
    existing.push(item);
    grouped.set(item.label, existing);
  }

  const series = Array.from(grouped.entries()).map(([label, items]) => ({
    label,
    items: items.sort((left, right) => left.stepNumber - right.stepNumber),
  }));
  const allSteps = Array.from(new Set(data.map((item) => item.stepNumber))).sort((left, right) => left - right);
  const maxStep = Math.max(...allSteps, 1);
  const width = 920;
  const height = 260;
  const padding = 42;
  const baselineY = 136;
  const xForStep = (step: number): number =>
    padding + ((step - 1) / Math.max(maxStep - 1, 1)) * (width - padding * 2);

  const seriesMarkup = series
    .map((entry, index) => {
      const [start, end] = palette[index % palette.length];
      const points = entry.items.map((item) => `${xForStep(item.stepNumber)},${baselineY}`).join(" ");
      const gradientId = `chart-${metric}-zero-${index}`;
      const pointMarkup = entry.items
        .map(
          (item) => `<circle cx="${xForStep(item.stepNumber)}" cy="${baselineY}" r="5" fill="${end}" stroke="white" stroke-width="1.5">
            <title>${escapeHtml(entry.label)} step ${item.stepNumber}: ${formatMetricValue(metric, item[metric], false)}</title>
          </circle>`,
        )
        .join("");

      return `<g>
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${start}" />
            <stop offset="100%" stop-color="${end}" />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke="url(#${gradientId})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
        ${pointMarkup}
      </g>`;
    })
    .join("");

  const xLabels = allSteps
    .map((step) => `<text x="${xForStep(step)}" y="${height - 12}" text-anchor="middle" fill="#5e6472" font-size="11">${step}</text>`)
    .join("");

  const zeroMessage = metric === "meanDriftScore"
    ? "No drift detected across compared iterations."
    : "No variation detected across compared iterations.";
  const zeroExplanation = metric === "meanDriftScore"
    ? "Every recorded step stayed at drift score 0, so the timeline is shown as a stable zero baseline."
    : "Every recorded step landed on the same value, so the timeline is shown as a stable baseline.";

  return `<div class="chart-wrap">
    <div class="chart-meta">
      <span>${escapeHtml(metricDescription(metric))}</span>
      <span>All values = 0 ${escapeHtml(metricUnit(metric))}</span>
    </div>
    <div class="chart-note stable">
      <strong>${zeroMessage}</strong>
      <span>${zeroExplanation}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric === "meanCostUsd" ? "Iteration cost curve" : "Iteration drift curve"} zero state">
      <line x1="${padding}" y1="${baselineY}" x2="${width - padding}" y2="${baselineY}" stroke="rgba(20, 33, 61, 0.14)" stroke-dasharray="8 8" />
      <text x="${padding - 10}" y="${baselineY + 4}" text-anchor="end" fill="#5e6472" font-size="11">0</text>
      ${seriesMarkup}
      ${xLabels}
    </svg>
    <div class="legend">${renderChartLegend(series, palette)}</div>
  </div>`;
}

function renderLineChart(
  data: DashboardCurveDatum[],
  metric: "meanCostUsd" | "meanDriftScore",
): string {
  if (data.length === 0) {
    return "<p>No step data available.</p>";
  }

  const grouped = new Map<string, DashboardCurveDatum[]>();
  for (const item of data) {
    const existing = grouped.get(item.label) ?? [];
    existing.push(item);
    grouped.set(item.label, existing);
  }

  const series = Array.from(grouped.entries()).map(([label, items]) => ({
    label,
    items: items.sort((left, right) => left.stepNumber - right.stepNumber),
  }));
  const allSteps = Array.from(new Set(data.map((item) => item.stepNumber))).sort((left, right) => left - right);
  const maxStep = Math.max(...allSteps, 1);
  const scale = resolveChartScale(data, metric);
  const width = 920;
  const height = 280;
  const padding = 42;
  const palette = [
    ["#cc5803", "#f4a259"],
    ["#264653", "#2a9d8f"],
    ["#8f2d56", "#d46a6a"],
    ["#3a86ff", "#7cc6fe"],
    ["#6a4c93", "#b8a1d9"],
  ];

  if (scale.allZero) {
    return renderZeroStateLineChart(data, metric, palette);
  }

  const xForStep = (step: number): number =>
    padding + ((step - 1) / Math.max(maxStep - 1, 1)) * (width - padding * 2);
  const yForValue = (value: number): number =>
    height - padding - ((value - scale.min) / Math.max(scale.max - scale.min, 0.000001)) * (height - padding * 2);

  const gridLines = scale.ticks.map((value) => {
    const y = yForValue(value);
    return `<g>
      <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="rgba(20, 33, 61, 0.1)" stroke-dasharray="4 6" />
      <text x="${padding - 10}" y="${y + 4}" text-anchor="end" fill="#5e6472" font-size="11">${formatMetricValue(metric, value, false)}</text>
    </g>`;
  }).join("");

  const xLabels = allSteps
    .map((step) => `<text x="${xForStep(step)}" y="${height - 12}" text-anchor="middle" fill="#5e6472" font-size="11">${step}</text>`)
    .join("");

  const seriesMarkup = series
    .map((entry, index) => {
      const [start, end] = palette[index % palette.length];
      const points = entry.items.map((item) => `${xForStep(item.stepNumber)},${yForValue(item[metric])}`).join(" ");
      const gradientId = `chart-${metric}-${index}`;
      const pointMarkup = entry.items
        .map(
          (item) => `<circle cx="${xForStep(item.stepNumber)}" cy="${yForValue(item[metric])}" r="4.5" fill="${end}">
            <title>${escapeHtml(entry.label)} step ${item.stepNumber}: ${formatMetricValue(metric, item[metric], true)}</title>
          </circle>`,
        )
        .join("");

      return `<g>
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${start}" />
            <stop offset="100%" stop-color="${end}" />
          </linearGradient>
        </defs>
        <polyline fill="none" stroke="url(#${gradientId})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
        ${pointMarkup}
      </g>`;
    })
    .join("");

  return `<div class="chart-wrap">
    <div class="chart-meta">
      <span>${escapeHtml(metricDescription(metric))}</span>
      <span>Zoomed range: ${formatMetricValue(metric, scale.min, false)} to ${formatMetricValue(metric, scale.max, false)} ${escapeHtml(metricUnit(metric))}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric === "meanCostUsd" ? "Iteration cost curve" : "Iteration drift curve"}">
      ${gridLines}
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(20, 33, 61, 0.18)" />
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(20, 33, 61, 0.18)" />
      ${seriesMarkup}
      ${xLabels}
    </svg>
    <div class="legend">${renderChartLegend(series, palette)}</div>
  </div>`;
}

function renderDriftPanel(data: DashboardDatum[]): string {
  if (data.length === 0) {
    return "<p>No drift data available.</p>";
  }

  const allZero = data.every((item) => item.meanDriftScore === 0);
  if (allZero) {
    return `<div class="drift-panel">
      <div class="chart-note stable">
        <strong>No drift observed across compared configurations.</strong>
        <span>Every configuration finished with mean drift 0.00, so memory remained stable for this experiment window.</span>
      </div>
      <div class="drift-grid">
        ${data
          .map(
            (item) => `<article class="drift-stat">
          <div>
            <h3>${escapeHtml(item.label)}</h3>
            <p>Mean drift score</p>
          </div>
          <div class="drift-value">0.00</div>
          <span class="status-pill stable">Stable memory</span>
        </article>`,
          )
          .join("")}
      </div>
    </div>`;
  }

  const maxDrift = Math.max(...data.map((item) => item.meanDriftScore), 0.000001);
  return `<div class="drift-panel">
    <p class="metric-hint">Higher is worse. Drift combines missing invariants and detected contradictions.</p>
    <div class="bars">
      ${data
        .map(
          (item) => `<div>
        <div class="label"><span>${escapeHtml(item.label)}</span><span>${item.meanDriftScore.toFixed(2)}</span></div>
        <div class="drift-row-meta">
          <span class="status-pill ${item.meanDriftScore === 0 ? "stable" : "warning"}">${item.meanDriftScore === 0 ? "Stable memory" : "Drift detected"}</span>
        </div>
        <div class="bar-shell"><div class="bar drift" style="width:${Math.max(0, (item.meanDriftScore / maxDrift) * 100)}%"></div></div>
      </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

export async function writeHtmlDashboard(
  filePath: string,
  data: DashboardDatum[],
  curveData: DashboardCurveDatum[],
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const maxCost = Math.max(...data.map((item) => item.meanCostUsd));
  const maxTokens = Math.max(...data.map((item) => item.meanTokens));
  const costScaleMax = maxCost > 0 ? maxCost : 1;
  const tokenScaleMax = maxTokens > 0 ? maxTokens : 1;
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

      .chart-wrap {
        margin-top: 18px;
      }

      .chart-meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .chart-note {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        margin-bottom: 14px;
        border-radius: 16px;
        border: 1px solid rgba(42, 157, 143, 0.18);
        background: linear-gradient(135deg, rgba(42, 157, 143, 0.08), rgba(255, 255, 255, 0.7));
      }

      .chart-note strong {
        font-size: 1rem;
      }

      .chart-note.stable {
        border-color: rgba(42, 157, 143, 0.2);
      }

      svg {
        width: 100%;
        height: auto;
        display: block;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .legend i {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        display: inline-block;
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

      .bar.drift {
        background: linear-gradient(90deg, #8f2d56, #d46a6a);
      }

      .drift-panel {
        display: grid;
        gap: 18px;
      }

      .drift-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
      }

      .drift-stat {
        display: grid;
        gap: 10px;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.75);
      }

      .drift-stat h3 {
        margin: 0;
        font-size: 1.05rem;
      }

      .drift-stat p {
        margin: 4px 0 0;
        font-size: 0.92rem;
      }

      .drift-value {
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: fit-content;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 700;
      }

      .status-pill.stable {
        background: rgba(42, 157, 143, 0.14);
        color: #1f6f66;
      }

      .status-pill.warning {
        background: rgba(212, 106, 106, 0.15);
        color: #8f2d56;
      }

      .metric-hint {
        margin: 0;
      }

      .drift-row-meta {
        margin-top: 8px;
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
      <p>Mean cost, drift, tokens, and quality by configuration.</p>
      <section class="grid">
        ${data
          .map(
            (item) => `<article class="card">
          <div class="label"><span>${escapeHtml(item.label)}</span><span>${item.costSavingsVsBaselinePct ?? "n/a"}% cost savings</span></div>
          <p>$${item.meanCostUsd.toFixed(4)} mean cost</p>
          <p>${item.meanDriftScore.toFixed(2)} mean drift</p>
          <p>${Math.round(item.meanTokens).toLocaleString()} mean tokens</p>
          <p>${item.meanQuality.toFixed(2)} / 10 mean quality</p>
        </article>`,
          )
          .join("")}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Iteration Cost Curve</h2>
        ${renderLineChart(curveData, "meanCostUsd")}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Iteration Drift Curve</h2>
        ${renderLineChart(curveData, "meanDriftScore")}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Mean Cost</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div>
            <div class="label"><span>${escapeHtml(item.label)}</span><span>$${item.meanCostUsd.toFixed(4)}</span></div>
            <div class="bar-shell"><div class="bar" style="width:${Math.max(4, (item.meanCostUsd / costScaleMax) * 100)}%"></div></div>
          </div>`,
            )
            .join("")}
        </div>
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Mean Drift</h2>
        ${renderDriftPanel(data)}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Mean Tokens</h2>
        <div class="bars">
          ${data
            .map(
              (item) => `<div>
            <div class="label"><span>${escapeHtml(item.label)}</span><span>${Math.round(item.meanTokens).toLocaleString()}</span></div>
            <div class="bar-shell"><div class="bar tokens" style="width:${Math.max(4, (item.meanTokens / tokenScaleMax) * 100)}%"></div></div>
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
              <th>Mean Drift</th>
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
              <td>${item.meanDriftScore.toFixed(2)}</td>
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

