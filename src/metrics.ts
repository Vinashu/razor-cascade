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

export type ArtifactDataSource = "mock" | "live";

export interface DashboardDatum {
  label: string;
  runs?: number;
  meanCostUsd: number;
  meanTokens: number;
  meanQuality: number;
  meanDriftScore: number;
  costSavingsVsBaselinePct?: number | null;
  tokenSavingsVsBaselinePct?: number | null;
  pValueCost?: number | null;
  pValueTokens?: number | null;
  pValueQuality?: number | null;
  cohensDCost?: number | null;
  ci95CostLower?: number | null;
  ci95CostUpper?: number | null;
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

export interface WelchTTestResult {
  tStatistic: number;
  pValue: number;
  degreesOfFreedom: number;
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
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

const LANCZOS_COEFFICIENTS = [
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
];

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const avg = mean(values);
  const squaredDiffs = values.reduce((sum, value) => sum + (value - avg) ** 2, 0);
  return squaredDiffs / (values.length - 1);
}

function logGamma(value: number): number {
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  const adjusted = value - 1;
  let series = 0.9999999999998099;

  for (let index = 0; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index] / (adjusted + index + 1);
  }

  const t = adjusted + LANCZOS_COEFFICIENTS.length - 0.5;
  return 0.9189385332046727 + (adjusted + 0.5) * Math.log(t) - t + Math.log(series);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const minimum = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);

  if (Math.abs(d) < minimum) {
    d = minimum;
  }

  d = 1 / d;
  let fraction = d;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const evenIndex = iteration * 2;
    const evenNumerator = (iteration * (b - iteration) * x) / ((a + evenIndex - 1) * (a + evenIndex));
    d = 1 + evenNumerator * d;
    if (Math.abs(d) < minimum) {
      d = minimum;
    }
    c = 1 + evenNumerator / c;
    if (Math.abs(c) < minimum) {
      c = minimum;
    }
    d = 1 / d;
    fraction *= d * c;

    const oddNumerator = (-(a + iteration) * (a + b + iteration) * x) / ((a + evenIndex) * (a + evenIndex + 1));
    d = 1 + oddNumerator * d;
    if (Math.abs(d) < minimum) {
      d = minimum;
    }
    c = 1 + oddNumerator / c;
    if (Math.abs(c) < minimum) {
      c = minimum;
    }
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;

    if (Math.abs(delta - 1) < epsilon) {
      break;
    }
  }

  return fraction;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }

  if (x >= 1) {
    return 1;
  }

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }

  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

function studentTCdf(value: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(value)) {
    return value < 0 ? 0 : 1;
  }

  if (degreesOfFreedom <= 0) {
    return 0.5;
  }

  if (value === 0) {
    return 0.5;
  }

  const x = degreesOfFreedom / (degreesOfFreedom + value ** 2);
  const tailProbability = 0.5 * regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5);
  return value > 0 ? 1 - tailProbability : tailProbability;
}

function twoTailedStudentTPValue(tStatistic: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0 || !Number.isFinite(tStatistic)) {
    return 1;
  }

  const x = degreesOfFreedom / (degreesOfFreedom + tStatistic ** 2);
  return Math.min(1, Math.max(0, regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5)));
}

function inverseStudentT(probability: number, degreesOfFreedom: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new RangeError("Probability must be between 0 and 1.");
  }

  if (degreesOfFreedom <= 0) {
    return 0;
  }

  let low = -50;
  let high = 50;

  while (studentTCdf(low, degreesOfFreedom) > probability) {
    low *= 2;
  }

  while (studentTCdf(high, degreesOfFreedom) < probability) {
    high *= 2;
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    const cdf = studentTCdf(midpoint, degreesOfFreedom);

    if (cdf < probability) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return (low + high) / 2;
}

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

  const avg = mean(values);
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

  const avg = mean(values);
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

export function welchTTest(samplesA: number[], samplesB: number[]): WelchTTestResult {
  if (samplesA.length === 0 || samplesB.length === 0) {
    return {
      tStatistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
    };
  }

  const meanA = mean(samplesA);
  const meanB = mean(samplesB);
  const varianceA = sampleVariance(samplesA);
  const varianceB = sampleVariance(samplesB);
  const varianceTermA = varianceA / samplesA.length;
  const varianceTermB = varianceB / samplesB.length;
  const standardError = Math.sqrt(varianceTermA + varianceTermB);

  if (standardError === 0) {
    return {
      tStatistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
    };
  }

  const numerator = (varianceTermA + varianceTermB) ** 2;
  const denominator = (
    (samplesA.length > 1 ? (varianceTermA ** 2) / (samplesA.length - 1) : 0) +
    (samplesB.length > 1 ? (varianceTermB ** 2) / (samplesB.length - 1) : 0)
  );
  const degreesOfFreedom = denominator === 0 ? 0 : numerator / denominator;
  const tStatistic = (meanA - meanB) / standardError;

  return {
    tStatistic,
    pValue: twoTailedStudentTPValue(tStatistic, degreesOfFreedom),
    degreesOfFreedom,
  };
}

export function cohensD(samplesA: number[], samplesB: number[]): number {
  if (samplesA.length === 0 || samplesB.length === 0) {
    return 0;
  }

  const meanA = mean(samplesA);
  const meanB = mean(samplesB);
  const varianceA = sampleVariance(samplesA);
  const varianceB = sampleVariance(samplesB);
  const pooledDegreesOfFreedom = samplesA.length + samplesB.length - 2;

  if (pooledDegreesOfFreedom <= 0) {
    return 0;
  }

  const pooledVariance =
    (((samplesA.length - 1) * varianceA) + ((samplesB.length - 1) * varianceB)) / pooledDegreesOfFreedom;

  if (pooledVariance <= 0) {
    return 0;
  }

  return (meanA - meanB) / Math.sqrt(pooledVariance);
}

export function confidenceInterval(values: number[], confidence = 0.95): ConfidenceInterval {
  if (confidence <= 0 || confidence >= 1) {
    throw new RangeError("Confidence must be between 0 and 1.");
  }

  if (values.length === 0) {
    return {
      lower: 0,
      upper: 0,
    };
  }

  const avg = mean(values);
  const variance = sampleVariance(values);
  if (values.length === 1 || variance === 0) {
    return {
      lower: avg,
      upper: avg,
    };
  }

  const standardError = Math.sqrt(variance / values.length);
  const alpha = 1 - confidence;
  const criticalValue = inverseStudentT(1 - alpha / 2, values.length - 1);
  const margin = criticalValue * standardError;

  return {
    lower: avg - margin,
    upper: avg + margin,
  };
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

function formatDashboardNumber(value: number | null | undefined, decimals: number): string {
  return typeof value === "number" ? value.toFixed(decimals) : "n/a";
}

function formatDashboardPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "n/a";
}

function describeArtifactDataSource(dataSource: ArtifactDataSource): {
  label: string;
  detail: string;
  tone: "stable" | "warning";
} {
  return dataSource === "mock"
    ? {
      label: "Mock Data",
      detail: "This dashboard reflects mock-client output, so costs and quality metrics are illustrative rather than live-provider measurements.",
      tone: "warning",
    }
    : {
      label: "Live API Data",
      detail: "This dashboard reflects live provider API calls and includes the measured study artifacts from those runs.",
      tone: "stable",
    };
}

function formatCostInterval(item: DashboardDatum): string {
  return typeof item.ci95CostLower === "number" && typeof item.ci95CostUpper === "number"
    ? `$${item.ci95CostLower.toFixed(4)} to $${item.ci95CostUpper.toFixed(4)}`
    : "n/a";
}

function describeStatisticalSignal(item: DashboardDatum): {
  title: string;
  detail: string;
  tone: "stable" | "warning";
} {
  if (typeof item.costSavingsVsBaselinePct !== "number" || item.costSavingsVsBaselinePct === 0) {
    return {
      title: "Reference configuration",
      detail: "This row is the baseline used for matched comparisons.",
      tone: "stable",
    };
  }

  if ((item.runs ?? 0) < 2) {
    return {
      title: "Insufficient repeated runs",
      detail: "One run per configuration can show directional differences, but not publication-grade significance.",
      tone: "warning",
    };
  }

  if (typeof item.pValueCost === "number") {
    if (item.pValueCost < 0.05) {
      return {
        title: "Cost difference is statistically significant",
        detail: `Two-tailed Welch's t-test p = ${item.pValueCost.toFixed(4)}.`,
        tone: "stable",
      };
    }

    return {
      title: "Cost difference is not statistically significant",
      detail: `Two-tailed Welch's t-test p = ${item.pValueCost.toFixed(4)}.`,
      tone: "warning",
    };
  }

  return {
    title: "No matched baseline comparison",
    detail: "Significance fields are only available when the configuration has a same-provider baseline.",
    tone: "warning",
  };
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
  dataSource: ArtifactDataSource,
  data: DashboardDatum[],
  curveData: DashboardCurveDatum[],
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const maxCost = Math.max(...data.map((item) => item.meanCostUsd));
  const maxTokens = Math.max(...data.map((item) => item.meanTokens));
  const costScaleMax = maxCost > 0 ? maxCost : 1;
  const tokenScaleMax = maxTokens > 0 ? maxTokens : 1;
  const dataSourceBadge = describeArtifactDataSource(dataSource);
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

      .hero {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }

      .hero-copy {
        flex: 1 1 420px;
      }

      .hero-copy p {
        margin: 0;
      }

      .hero-meta {
        flex: 0 1 320px;
        display: grid;
        gap: 10px;
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.78);
        box-shadow: var(--shadow);
      }

      .hero-meta p {
        margin: 0;
        font-size: 0.95rem;
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

      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
        margin-top: 20px;
      }

      .stat-card {
        display: grid;
        gap: 12px;
        padding: 18px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.78);
      }

      .stat-card h3 {
        margin: 0;
        font-size: 1.05rem;
      }

      .stat-card p {
        margin: 0;
      }

      .stat-list {
        display: grid;
        gap: 8px;
      }

      .stat-list span {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 0.94rem;
      }

      .stat-list strong {
        color: var(--ink);
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
      <header class="hero">
        <div class="hero-copy">
          <h1>RazorCascade Dashboard</h1>
          <p>Mean cost, drift, tokens, and quality by configuration.</p>
        </div>
        <div class="hero-meta">
          <span class="status-pill ${dataSourceBadge.tone}">${escapeHtml(dataSourceBadge.label)}</span>
          <p>${escapeHtml(dataSourceBadge.detail)}</p>
        </div>
      </header>
      <section class="grid">
        ${data
          .map((item) => {
            const statisticalSignal = describeStatisticalSignal(item);
            return `<article class="card">
          <div class="label"><span>${escapeHtml(item.label)}</span><span>${item.costSavingsVsBaselinePct ?? "n/a"}% cost savings</span></div>
          <p>$${item.meanCostUsd.toFixed(4)} mean cost</p>
          <p>${item.meanDriftScore.toFixed(2)} mean drift</p>
          <p>${Math.round(item.meanTokens).toLocaleString()} mean tokens</p>
          <p>${item.meanQuality.toFixed(2)} / 10 mean quality</p>
          <p>95% cost CI: ${escapeHtml(formatCostInterval(item))}</p>
          <div class="drift-row-meta">
            <span class="status-pill ${statisticalSignal.tone}">${escapeHtml(statisticalSignal.title)}</span>
          </div>
        </article>`;
          })
          .join("")}
      </section>
      <section class="card" style="margin-top: 22px;">
        <h2>Statistical Analysis</h2>
        <p>Matched baseline comparisons use Welch's t-test for unequal variances, Cohen's d for cost effect size, and 95% confidence intervals around mean cost.</p>
        <div class="stat-grid">
          ${data
            .map((item) => {
              const statisticalSignal = describeStatisticalSignal(item);
              return `<article class="stat-card">
            <div>
              <h3>${escapeHtml(item.label)}</h3>
              <p>${escapeHtml(statisticalSignal.detail)}</p>
            </div>
            <div class="drift-row-meta">
              <span class="status-pill ${statisticalSignal.tone}">${escapeHtml(statisticalSignal.title)}</span>
            </div>
            <div class="stat-list">
              <span><span>Repeated runs</span><strong>${item.runs ?? "n/a"}</strong></span>
              <span><span>95% cost CI</span><strong>${escapeHtml(formatCostInterval(item))}</strong></span>
              <span><span>Cost p-value</span><strong>${escapeHtml(formatDashboardNumber(item.pValueCost, 6))}</strong></span>
              <span><span>Token p-value</span><strong>${escapeHtml(formatDashboardNumber(item.pValueTokens, 6))}</strong></span>
              <span><span>Quality p-value</span><strong>${escapeHtml(formatDashboardNumber(item.pValueQuality, 6))}</strong></span>
              <span><span>Cohen's d (cost)</span><strong>${escapeHtml(formatDashboardNumber(item.cohensDCost, 4))}</strong></span>
            </div>
          </article>`;
            })
            .join("")}
        </div>
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
              <th>95% Cost CI</th>
              <th>Cost Savings</th>
              <th>Token Savings</th>
              <th>Cost p-value</th>
              <th>Cohen's d</th>
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
              <td>${escapeHtml(formatCostInterval(item))}</td>
              <td>${escapeHtml(formatDashboardPercent(item.costSavingsVsBaselinePct))}</td>
              <td>${escapeHtml(formatDashboardPercent(item.tokenSavingsVsBaselinePct))}</td>
              <td>${escapeHtml(formatDashboardNumber(item.pValueCost, 6))}</td>
              <td>${escapeHtml(formatDashboardNumber(item.cohensDCost, 4))}</td>
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

