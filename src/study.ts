import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { buildDriftReport } from "./contradictions.ts";
import { formatGateSummary, summarizeWithGate } from "./gate.ts";
import { extractInvariants, mergeInvariantFacts } from "./invariants.ts";
import {
  bonferroniCorrect,
  cohensD,
  confidenceInterval,
  type DashboardCurveDatum,
  estimateCostUsd,
  interpretCohensD,
  interpretPValue,
  loadPriceBook,
  mannWhitneyU,
  minimumSampleSize,
  pearsonCorrelation,
  percentSavings,
  renderTextBarChart,
  roundNumber,
  standardDeviation,
  summarizeNumbers,
  totalTokens,
  type TokenUsage,
  welchTTest,
  writeCsv,
  writeHtmlDashboard,
  type DashboardDatum,
} from "./metrics.ts";
import {
  createModelClient,
  getProviderApiKey,
  resolveModelFromEnv,
  type ModelClient,
  type ProviderName,
} from "./models.ts";
import logger from "./logger.ts";

loadDotEnv();

const StudyModeSchema = z.enum(["baseline", "cascade"]);
const ProviderSchema = z.enum(["openai", "anthropic", "xai", "gemini"]);

const StudyConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  mode: StudyModeSchema,
  provider: ProviderSchema,
  flagshipModel: z.string().min(1),
  gateModel: z.string().optional(),
});

const StudyTaskSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  objective: z.string().min(1),
  keywords: z.array(z.string().min(1)),
});

const ScoringConfigSchema = z.object({
  baseScore: z.number().default(6),
  keywordWeight: z.number().default(2.8),
  structureWeight: z.number().default(0.5),
  lengthThreshold: z.number().int().positive().default(240),
  lengthBonus: z.number().default(0.3),
  testBonus: z.number().default(0.4),
});

const StudyConfigFileSchema = z.object({
  defaultRuns: z.number().int().positive().default(10),
  outputDir: z.string().default("experiments"),
  configs: z.array(StudyConfigSchema),
  tasks: z.array(StudyTaskSchema).optional(),
  scoring: ScoringConfigSchema.optional(),
  humanBaselineScores: z.array(z.number().finite()).optional(),
});

const JudgeScoreSchema = z.object({
  score: z.number().min(0).max(10),
});

const CostCapSchema = z.number().finite().nonnegative();

export type StudyMode = z.infer<typeof StudyModeSchema>;
export type StudyConfig = z.infer<typeof StudyConfigSchema>;
export type StudyTask = z.infer<typeof StudyTaskSchema>;
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

const DEFAULT_SCORING: ScoringConfig = ScoringConfigSchema.parse({});

export interface StepRecord {
  config: string;
  runId: number;
  step: number;
  stepNumber: number;
  stepTitle: string;
  modelRole: "flagship" | "gate";
  provider: ProviderName;
  requestedModel: string;
  actualMode: "live" | "mock";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  estimatedCostUsd: number;
  invariantCount: number;
  missingInvariants: number;
  contradictions: number;
  driftScore: number;
  durationMs: number;
  qualityScore: number;
  judgeScoreStddev: number | null;
  testsPassed: boolean | null;
  success: boolean;
}

export interface RunRecord {
  config: string;
  runId: number;
  provider: ProviderName;
  mode: StudyMode;
  flagshipModel: string;
  gateModel?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  meanInvariantCount: number;
  totalMissingInvariants: number;
  totalContradictions: number;
  totalDriftScore: number;
  meanDriftScore: number;
  meanQualityScore: number;
  testsPassed: boolean | null;
  usedMockClients: boolean;
}

interface IterationAggregate {
  stepNumber: number;
  cost: number;
  invariantCount: number;
  missingInvariants: number;
  contradictions: number;
  driftScore: number;
}

interface StudyTaskResponse {
  system: string;
  prompt: string;
  response: string;
  usage: TokenUsage;
  durationMs: number;
}

interface SnapshotPayload {
  system: string;
  prompt: string;
  response: string;
  usage: TokenUsage;
  durationMs: number;
}

interface StepSnapshotRecord {
  config: string;
  runId: number;
  stepNumber: number;
  role: "flagship" | "gate" | "judge";
  attempt?: number;
  payload: SnapshotPayload;
}

class JudgeScoringError extends Error {
  public readonly trace: SnapshotPayload;

  public constructor(message: string, trace: SnapshotPayload) {
    super(message);
    this.name = "JudgeScoringError";
    this.trace = trace;
  }
}

interface TestCacheResult {
  passed: boolean | null;
  output: string;
}

interface StudyClients {
  flagship: ModelClient;
  gate?: ModelClient;
  judge?: ModelClient;
}

type StudyArtifactDataSource = "mock" | "live";

export interface SummaryRecord {
  config: string;
  provider: ProviderName;
  mode: StudyMode;
  flagship_model: string;
  gate_model: string | null;
  runs: number;
  mean_cost_usd: number;
  median_cost_usd: number;
  stddev_cost_usd: number;
  mean_tokens: number;
  median_tokens: number;
  stddev_tokens: number;
  mean_invariant_count: number;
  mean_missing_invariants: number;
  mean_contradictions: number;
  mean_drift_score: number;
  mean_quality: number;
  median_quality: number;
  stddev_quality: number;
  cost_savings_vs_baseline_pct: number | null;
  token_savings_vs_baseline_pct: number | null;
  pValue_cost: number | null;
  pValue_tokens: number | null;
  pValue_quality: number | null;
  pValue_cost_corrected: number | null;
  pValue_tokens_corrected: number | null;
  pValue_quality_corrected: number | null;
  pValue_cost_mannwhitney: number | null;
  pValue_tokens_mannwhitney: number | null;
  cohensD_cost: number | null;
  cohensD_tokens: number | null;
  cohensD_quality: number | null;
  ci95_cost_lower: number;
  ci95_cost_upper: number;
  ci95_tokens_lower: number;
  ci95_tokens_upper: number;
  ci95_quality_lower: number;
  ci95_quality_upper: number;
  mean_judge_agreement: number | null;
  qualityCorrelationWithHuman: number | null;
}

export interface CrossProviderComparisonRecord {
  config_a: string;
  provider_a: ProviderName;
  mode_a: StudyMode;
  config_b: string;
  provider_b: ProviderName;
  mode_b: StudyMode;
  cost_ratio_a_to_b: number | null;
  token_ratio_a_to_b: number | null;
  quality_delta_a_minus_b: number;
}

interface StudySummaryArtifact {
  dataSource: StudyArtifactDataSource;
  configs: SummaryRecord[];
  cross_provider_comparisons?: CrossProviderComparisonRecord[];
}

const SummaryRecordSchema: z.ZodType<SummaryRecord> = z.object({
  config: z.string().min(1),
  provider: ProviderSchema,
  mode: StudyModeSchema,
  flagship_model: z.string().min(1),
  gate_model: z.string().nullable(),
  runs: z.number().int().nonnegative(),
  mean_cost_usd: z.number(),
  median_cost_usd: z.number(),
  stddev_cost_usd: z.number(),
  mean_tokens: z.number(),
  median_tokens: z.number(),
  stddev_tokens: z.number(),
  mean_invariant_count: z.number(),
  mean_missing_invariants: z.number(),
  mean_contradictions: z.number(),
  mean_drift_score: z.number(),
  mean_quality: z.number(),
  median_quality: z.number(),
  stddev_quality: z.number(),
  cost_savings_vs_baseline_pct: z.number().nullable(),
  token_savings_vs_baseline_pct: z.number().nullable(),
  pValue_cost: z.number().nullable(),
  pValue_tokens: z.number().nullable(),
  pValue_quality: z.number().nullable(),
  pValue_cost_corrected: z.number().nullable(),
  pValue_tokens_corrected: z.number().nullable(),
  pValue_quality_corrected: z.number().nullable(),
  pValue_cost_mannwhitney: z.number().nullable(),
  pValue_tokens_mannwhitney: z.number().nullable(),
  cohensD_cost: z.number().nullable(),
  cohensD_tokens: z.number().nullable(),
  cohensD_quality: z.number().nullable(),
  ci95_cost_lower: z.number(),
  ci95_cost_upper: z.number(),
  ci95_tokens_lower: z.number(),
  ci95_tokens_upper: z.number(),
  ci95_quality_lower: z.number(),
  ci95_quality_upper: z.number(),
  mean_judge_agreement: z.number().nullable(),
  qualityCorrelationWithHuman: z.number().nullable(),
});

const CrossProviderComparisonRecordSchema: z.ZodType<CrossProviderComparisonRecord> = z.object({
  config_a: z.string().min(1),
  provider_a: ProviderSchema,
  mode_a: StudyModeSchema,
  config_b: z.string().min(1),
  provider_b: ProviderSchema,
  mode_b: StudyModeSchema,
  cost_ratio_a_to_b: z.number().nullable(),
  token_ratio_a_to_b: z.number().nullable(),
  quality_delta_a_minus_b: z.number(),
});

const StudySummaryArtifactSchema: z.ZodType<StudySummaryArtifact> = z.object({
  dataSource: z.union([z.literal("mock"), z.literal("live")]),
  configs: z.array(SummaryRecordSchema),
  cross_provider_comparisons: z.array(CrossProviderComparisonRecordSchema).optional(),
});

interface LoadedStudySummaryArtifact {
  label: string;
  folder: string;
  summaryPath: string;
  summary: StudySummaryArtifact;
}

interface ComparisonMetricDefinition {
  label: string;
  decimals: number;
  value: (row: SummaryRecord) => number | null;
}

const SUMMARY_COMPARISON_METRICS: ComparisonMetricDefinition[] = [
  {
    label: "Runs",
    decimals: 0,
    value: (row) => row.runs,
  },
  {
    label: "Mean Cost (USD)",
    decimals: 4,
    value: (row) => row.mean_cost_usd,
  },
  {
    label: "Mean Tokens",
    decimals: 2,
    value: (row) => row.mean_tokens,
  },
  {
    label: "Mean Quality",
    decimals: 2,
    value: (row) => row.mean_quality,
  },
  {
    label: "Mean Drift",
    decimals: 2,
    value: (row) => row.mean_drift_score,
  },
  {
    label: "Cost Savings vs Baseline (%)",
    decimals: 2,
    value: (row) => row.cost_savings_vs_baseline_pct,
  },
  {
    label: "Token Savings vs Baseline (%)",
    decimals: 2,
    value: (row) => row.token_savings_vs_baseline_pct,
  },
  {
    label: "Cost p-value",
    decimals: 6,
    value: (row) => row.pValue_cost,
  },
  {
    label: "Quality p-value",
    decimals: 6,
    value: (row) => row.pValue_quality,
  },
];

const STUDY_TASKS: StudyTask[] = [
  {
    number: 1,
    title: "CLI skeleton + argument parsing",
    objective: "Establish the Bun CLI surface, command definitions, and basic argument handling.",
    keywords: ["cli", "command", "argument", "bun", "task"],
  },
  {
    number: 2,
    title: "Task data model + JSON persistence",
    objective: "Define a typed task model and persist it safely to JSON storage.",
    keywords: ["json", "task model", "persistence", "storage", "typed"],
  },
  {
    number: 3,
    title: "List, filter, and view tasks",
    objective: "Support querying tasks by status, priority, tags, and free-text search.",
    keywords: ["list", "filter", "view", "status", "priority"],
  },
  {
    number: 4,
    title: "Complete/delete commands + validation",
    objective: "Add complete/delete flows with good error handling and state validation.",
    keywords: ["complete", "delete", "validation", "error", "state"],
  },
  {
    number: 5,
    title: "Gate summarizer integration",
    objective: "Compress the history into a structured summary before flagship execution.",
    keywords: ["gate", "summary", "context", "json", "cascade"],
  },
  {
    number: 6,
    title: "AI-assisted decomposition",
    objective: "Break goals into practical subtasks and optionally persist them.",
    keywords: ["decompose", "subtask", "goal", "ai", "persist"],
  },
  {
    number: 7,
    title: "Code snippet generator",
    objective: "Generate useful starter code from a short description.",
    keywords: ["snippet", "code", "language", "template", "generator"],
  },
  {
    number: 8,
    title: "Automated tests",
    objective: "Add unit coverage and reliable verification for the CLI and metrics pipeline.",
    keywords: ["test", "coverage", "unit", "verification", "quality"],
  },
  {
    number: 9,
    title: "Refinement loop",
    objective: "Improve an existing task based on feedback and preserve iteration history.",
    keywords: ["refine", "feedback", "iteration", "history", "improve"],
  },
  {
    number: 10,
    title: "Report export",
    objective: "Export Markdown and HTML outputs suitable for publication or sharing.",
    keywords: ["report", "markdown", "html", "export", "summary"],
  },
];

function timestampFolderName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseOptionalCostCap(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return CostCapSchema.parse(numericValue);
}

function resolveStudyDataSource(runRecords: RunRecord[]): StudyArtifactDataSource {
  return runRecords.some((run) => run.usedMockClients) ? "mock" : "live";
}

function formatStudyDataSource(dataSource: StudyArtifactDataSource): string {
  return dataSource === "mock" ? "mock clients" : "live API calls";
}

function aggregateIterations(stepRecords: StepRecord[]): IterationAggregate[] {
  const grouped = new Map<number, IterationAggregate>();

  for (const stepRecord of stepRecords) {
    const existing = grouped.get(stepRecord.stepNumber) ?? {
      stepNumber: stepRecord.stepNumber,
      cost: 0,
      invariantCount: 0,
      missingInvariants: 0,
      contradictions: 0,
      driftScore: 0,
    };

    existing.cost = roundNumber(existing.cost + stepRecord.estimatedCostUsd, 8);
    existing.invariantCount = Math.max(existing.invariantCount, stepRecord.invariantCount);
    existing.missingInvariants = Math.max(existing.missingInvariants, stepRecord.missingInvariants);
    existing.contradictions = Math.max(existing.contradictions, stepRecord.contradictions);
    existing.driftScore = Math.max(existing.driftScore, stepRecord.driftScore);
    grouped.set(stepRecord.stepNumber, existing);
  }

  return [...grouped.values()].sort((left, right) => left.stepNumber - right.stepNumber);
}

function buildHistoryEntry(task: StudyTask, responseText: string): string {
  return `Task ${task.number}: ${task.title}
Objective: ${task.objective}
Response:
${responseText}`;
}

function buildTaskPrompt(task: StudyTask, mode: StudyMode, context: string): string {
  return `You are contributing to TaskForge, a TypeScript + Bun CLI used in the RazorCascade memory reliability study.

Execution mode: ${mode}
Standardized task: ${task.number}. ${task.title}
Objective: ${task.objective}

Context from prior work:
${context || "(no prior context available)"}

Produce a concise engineering update that includes:
1. Goal
2. Proposed implementation details
3. Validation or testing
4. Risks`;
}

function scoreTaskOutput(
  task: StudyTask,
  text: string,
  testsPassed: boolean | null,
  scoring: ScoringConfig = DEFAULT_SCORING,
): number {
  const normalized = text.toLowerCase();
  const keywordHits = task.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase())).length;
  const keywordScore = task.keywords.length > 0 ? keywordHits / task.keywords.length : 0;
  const structureBonus = ["goal", "validation", "risk"].filter((keyword) => normalized.includes(keyword)).length / 3;
  const testBonus = testsPassed === true ? scoring.testBonus : testsPassed === false ? -scoring.testBonus : 0;
  const lengthBonus = text.length >= scoring.lengthThreshold ? scoring.lengthBonus : 0;
  const raw =
    scoring.baseScore +
    keywordScore * scoring.keywordWeight +
    structureBonus * scoring.structureWeight +
    lengthBonus +
    testBonus;
  return Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
}

function trySubCategorySum(obj: unknown): number | null {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }

  const record = obj as Record<string, unknown>;
  const fields = [record.completeness, record.correctness, record.clarity, record.architecture];
  const defined = fields.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (defined.length < 2) {
    return null;
  }

  return Math.min(10, Math.max(0, defined.reduce((sum, v) => sum + v, 0)));
}

function parseJudgeScore(text: string): number {
  const trimmed = text.trim();

  try {
    const obj = JSON.parse(trimmed) as unknown;
    const directJson = JudgeScoreSchema.safeParse(obj);
    if (directJson.success) {
      return roundNumber(directJson.data.score, 1);
    }

    const subCategorySum = trySubCategorySum(obj);
    if (subCategorySum !== null) {
      return roundNumber(subCategorySum, 1);
    }
  } catch {
    // Fall through to alternate parsing strategies below.
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as unknown;
      const parsed = JudgeScoreSchema.safeParse(obj);
      if (parsed.success) {
        return roundNumber(parsed.data.score, 1);
      }

      const subCategorySum = trySubCategorySum(obj);
      if (subCategorySum !== null) {
        return roundNumber(subCategorySum, 1);
      }
    } catch {
      // Fall through to regex parsing below.
    }
  }

  const labeledMatch = trimmed.match(/(?:^|\b)(?:score|total)\D{0,12}(10|[0-9](?:\.\d+)?)(?:\b|\/10)/i);
  if (labeledMatch) {
    return roundNumber(Math.min(10, Math.max(0, Number(labeledMatch[1]))), 1);
  }

  const fractionMatch = trimmed.match(/\b(10|[0-9](?:\.\d+)?)\s*\/\s*10\b/);
  if (fractionMatch) {
    return roundNumber(Math.min(10, Math.max(0, Number(fractionMatch[1]))), 1);
  }

  throw new Error(`Unable to parse judge score from response: ${trimmed}`);
}

export async function llmJudgeScore(
  client: ModelClient,
  task: StudyTask,
  responseText: string,
): Promise<number> {
  const rubricPrompt = `Evaluate the candidate engineering update for this study task.

Task title: ${task.title}
Task objective: ${task.objective}

Rubric (use these for your internal reasoning only — do NOT include sub-scores in the output):
- completeness: 0-3 (does the response fully address the objective?)
- correctness: 0-3 (is the proposed implementation technically sound?)
- clarity: 0-2 (is it easy to understand and act on?)
- architecture: 0-2 (does it respect sound design principles?)

Candidate response:
${responseText}

Respond with ONLY a valid JSON object where "score" is the integer sum of the four rubric dimensions above (0–10):
{"score": <integer>}`;
  const response = await client.generateText({
    system: "You are a strict, impartial evaluator. Score only the candidate response against the stated task objective.",
    prompt: rubricPrompt,
    maxOutputTokens: 1200,
    metadata: {
      kind: "judge",
      task: String(task.number),
    },
  });

  return parseJudgeScore(response.text);
}

async function runJudgeScoringStep(
  client: ModelClient,
  task: StudyTask,
  responseText: string,
  attemptNumber: number,
  totalAttempts: number,
): Promise<{ score: number; trace: SnapshotPayload }> {
  const rubricPrompt = `Evaluate the candidate engineering update for this study task.

Task title: ${task.title}
Task objective: ${task.objective}

Rubric (use these for your internal reasoning only - do NOT include sub-scores in the output):
- completeness: 0-3 (does the response fully address the objective?)
- correctness: 0-3 (is the proposed implementation technically sound?)
- clarity: 0-2 (is it easy to understand and act on?)
- architecture: 0-2 (does it respect sound design principles?)

Candidate response:
${responseText}

Repeat evaluation pass ${attemptNumber} of ${totalAttempts}. Keep the score consistent with the rubric.

Respond with ONLY a valid JSON object where "score" is the integer sum of the four rubric dimensions above (0-10):
{"score": <integer>}`;
  const system = "You are a strict, impartial evaluator. Score only the candidate response against the stated task objective.";
  const startedAt = performance.now();
  const response = await client.generateText({
    system,
    prompt: rubricPrompt,
    temperature: 0.05 + Math.min(0.4, attemptNumber * 0.05),
    maxOutputTokens: 1200,
    metadata: {
      kind: "judge",
      task: String(task.number),
      attempt: String(attemptNumber),
    },
  });
  const trace: SnapshotPayload = {
    system,
    prompt: rubricPrompt,
    response: response.text,
    usage: response.usage,
    durationMs: Math.round(performance.now() - startedAt),
  };

  try {
    return {
      score: parseJudgeScore(response.text),
      trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JudgeScoringError(message, trace);
  }
}

async function scoreTaskOutputWithOptionalJudge(
  task: StudyTask,
  text: string,
  testsPassed: boolean | null,
  scoring: ScoringConfig,
  judgeRepeat: number,
  judgeClient?: ModelClient,
): Promise<{ score: number; traces: SnapshotPayload[]; judgeScoreStddev: number | null }> {
  if (!judgeClient) {
    return {
      score: scoreTaskOutput(task, text, testsPassed, scoring),
      traces: [],
      judgeScoreStddev: null,
    };
  }

  const repeatCount = Math.max(1, Math.min(3, Math.trunc(judgeRepeat) || 1));
  const scores: number[] = [];
  const traces: SnapshotPayload[] = [];
  let hadFallback = false;

  for (let attempt = 1; attempt <= repeatCount; attempt += 1) {
    try {
      const result = await runJudgeScoringStep(judgeClient, task, text, attempt, repeatCount);
      scores.push(result.score);
      traces.push(result.trace);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Judge scoring failed for task ${task.number} (${task.title}) on repeat ${attempt}/${repeatCount}; falling back to heuristic scoring for that repeat.`,
        { reason },
      );
      scores.push(scoreTaskOutput(task, text, testsPassed, scoring));
      hadFallback = true;
      if (error instanceof JudgeScoringError) {
        traces.push(error.trace);
      }
    }
  }

  const meanScore = roundNumber(average(scores), 2);
  const judgeScoreStddev = hadFallback && repeatCount === 1
    ? null
    : repeatCount > 1
      ? roundNumber(standardDeviation(scores), 4)
      : 0;

  if (judgeScoreStddev !== null && judgeScoreStddev > 1.5) {
    logger.warn(
      `Judge scoring was inconsistent for task ${task.number} (${task.title}).`,
      {
        judgeScoreStddev: judgeScoreStddev.toFixed(4),
        judgeRepeat: repeatCount,
      },
    );
  }

  return {
    score: meanScore,
    traces,
    judgeScoreStddev,
  };
}

async function runSingleModelStep(
  client: ModelClient,
  prompt: string,
  task: StudyTask,
): Promise<StudyTaskResponse> {
  const system = "You are a senior engineer writing concise implementation updates.";
  const startedAt = performance.now();
  const response = await client.generateText({
    system,
    prompt,
    maxOutputTokens: 2000,
    metadata: {
      kind: "task",
      task: String(task.number),
    },
  });
  const durationMs = Math.round(performance.now() - startedAt);

  return {
    system,
    prompt,
    response: response.text,
    usage: response.usage,
    durationMs,
  };
}

async function runTestsOnce(skipTests: boolean): Promise<TestCacheResult> {
  if (skipTests) {
    return {
      passed: null,
      output: "Skipped by flag.",
    };
  }

  const proc = Bun.spawn(["bun", "test"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutText = proc.stdout ? await new Response(proc.stdout).text() : "";
  const stderrText = proc.stderr ? await new Response(proc.stderr).text() : "";
  const exitCode = await proc.exited;

  return {
    passed: exitCode === 0,
    output: `${stdoutText}\n${stderrText}`.trim(),
  };
}

async function loadConfigFile(configPath = resolve("config.json")): Promise<z.infer<typeof StudyConfigFileSchema>> {
  const raw = await readFile(configPath, "utf8");
  return StudyConfigFileSchema.parse(JSON.parse(raw) as unknown);
}

async function resolveSelectedConfigs(
  configFile: z.infer<typeof StudyConfigFileSchema>,
  options: {
    configName?: string;
    configNames?: string[];
    all?: boolean;
    mode?: StudyMode;
    provider?: ProviderName;
    flagModel?: string;
    gateModel?: string;
  },
): Promise<StudyConfig[]> {
  const configAliases: Record<string, string> = {
    baseline: "baseline-openai",
    openai: "openai-mini",
  };

  if (options.mode && options.provider) {
    return [
      StudyConfigSchema.parse({
        name: "adhoc",
        description: "Ad hoc study configuration from CLI flags.",
        mode: options.mode,
        provider: options.provider,
        flagshipModel: options.flagModel || resolveModelFromEnv(options.provider, "flagship"),
        gateModel:
          options.mode === "cascade"
            ? options.gateModel || resolveModelFromEnv(options.provider, "gate")
            : undefined,
      }),
    ];
  }

  if (options.all) {
    return configFile.configs;
  }

  if (options.configNames && options.configNames.length > 0) {
    return options.configNames.map((requestedName) => {
      const selectedName = configAliases[requestedName] ?? requestedName;
      const match = configFile.configs.find((config) => config.name === selectedName);
      if (!match) {
        throw new Error(`Unknown config "${requestedName}".`);
      }

      return match;
    });
  }

  const requestedName = options.configName || "baseline";
  const selectedName = configAliases[requestedName] ?? requestedName;
  const match = configFile.configs.find((config) => config.name === selectedName);
  if (!match) {
    throw new Error(`Unknown config "${requestedName}".`);
  }

  return [match];
}

async function createClients(
  config: StudyConfig,
  dryRun: boolean,
  judgeEnabled: boolean,
  judgeModel?: string,
  judgeProvider?: ProviderName,
): Promise<StudyClients> {
  const apiKey = getProviderApiKey(config.provider);
  const fallbackToMock = dryRun || !apiKey;
  const flagship = await createModelClient({
    provider: config.provider,
    model: config.flagshipModel,
    apiKey,
    fallbackToMock,
  });

  const effectiveJudgeProvider = judgeProvider ?? config.provider;
  const judgeApiKey = judgeProvider ? getProviderApiKey(judgeProvider) : apiKey;
  const judgeFallbackToMock = dryRun || !judgeApiKey;
  const judge = judgeEnabled
    ? judgeModel
      ? await createModelClient({
        provider: effectiveJudgeProvider,
        model: judgeModel,
        apiKey: judgeApiKey,
        fallbackToMock: judgeFallbackToMock,
      })
      : flagship
    : undefined;

  if (config.mode === "baseline") {
    return { flagship, judge };
  }

  const gateModel = config.gateModel || resolveModelFromEnv(config.provider, "gate");
  const gate = await createModelClient({
    provider: config.provider,
    model: gateModel,
    apiKey,
    fallbackToMock,
  });

  return { flagship, gate, judge };
}

async function executeRun(
  config: StudyConfig,
  runId: number,
  clients: StudyClients,
  testsPassed: boolean | null,
  tasks: StudyTask[],
  scoring: ScoringConfig,
  judgeRepeat: number,
  priceBook: Awaited<ReturnType<typeof loadPriceBook>>,
): Promise<{ steps: StepRecord[]; run: RunRecord; snapshots: StepSnapshotRecord[] }> {
  const fullHistory: string[] = [];
  let cascadedContext = "";
  let invariantMemory: string[] = [];
  const stepRecords: StepRecord[] = [];
  const snapshots: StepSnapshotRecord[] = [];

  for (const task of tasks) {
    const context = config.mode === "baseline" ? fullHistory.join("\n\n") : cascadedContext;
    const prompt = buildTaskPrompt(task, config.mode, context);
    const flagshipResult = await runSingleModelStep(clients.flagship, prompt, task);
    const flagshipUsage = {
      inputTokens: flagshipResult.usage.inputTokens,
      outputTokens: flagshipResult.usage.outputTokens,
    };
    const flagshipCost = estimateCostUsd(config.provider, config.flagshipModel, flagshipUsage, priceBook);
    const qualityResult = await scoreTaskOutputWithOptionalJudge(
      task,
      flagshipResult.response,
      testsPassed,
      scoring,
      judgeRepeat,
      clients.judge,
    );
    const qualityScore = qualityResult.score;

    stepRecords.push({
      config: config.name,
      runId,
      step: task.number,
      stepNumber: task.number,
      stepTitle: task.title,
      modelRole: "flagship",
      provider: config.provider,
      requestedModel: config.flagshipModel,
      actualMode: clients.flagship.mode,
      inputTokens: flagshipUsage.inputTokens,
      outputTokens: flagshipUsage.outputTokens,
      totalTokens: totalTokens(flagshipUsage),
      cost: flagshipCost,
      estimatedCostUsd: flagshipCost,
      invariantCount: 0,
      missingInvariants: 0,
      contradictions: 0,
      driftScore: 0,
      durationMs: flagshipResult.durationMs,
      qualityScore,
      judgeScoreStddev: qualityResult.judgeScoreStddev,
      testsPassed,
      success: qualityScore >= 7 && testsPassed !== false,
    });
    snapshots.push({
      config: config.name,
      runId,
      stepNumber: task.number,
      role: "flagship",
      payload: {
        system: flagshipResult.system,
        prompt: flagshipResult.prompt,
        response: flagshipResult.response,
        usage: flagshipResult.usage,
        durationMs: flagshipResult.durationMs,
      },
    });
    for (const [index, trace] of qualityResult.traces.entries()) {
      snapshots.push({
        config: config.name,
        runId,
        stepNumber: task.number,
        role: "judge",
        attempt: index + 1,
        payload: trace,
      });
    }

    fullHistory.push(buildHistoryEntry(task, flagshipResult.response));
    invariantMemory = mergeInvariantFacts(invariantMemory, extractInvariants(fullHistory[fullHistory.length - 1] ?? "").facts);

    const flagshipStepRecord = stepRecords[stepRecords.length - 1];
    if (flagshipStepRecord) {
      flagshipStepRecord.invariantCount = invariantMemory.length;
    }

    if (config.mode === "cascade" && clients.gate && config.gateModel) {
      const gateStartedAt = performance.now();
      const gateResult = await summarizeWithGate({
        history: fullHistory.join("\n\n"),
        latestChanges: flagshipResult.response,
        previousInvariants: invariantMemory,
        client: clients.gate,
      });
      const gateDurationMs = Math.round(performance.now() - gateStartedAt);
      const gateUsage = gateResult.usage;
      const driftReport = buildDriftReport(formatGateSummary(gateResult.draftSummary), invariantMemory);
      const gateCost = estimateCostUsd(config.provider, config.gateModel, gateUsage, priceBook);

      stepRecords.push({
        config: config.name,
        runId,
        step: task.number,
        stepNumber: task.number,
        stepTitle: `${task.title} (gate)`,
        modelRole: "gate",
        provider: config.provider,
        requestedModel: config.gateModel,
        actualMode: clients.gate.mode,
        inputTokens: gateUsage.inputTokens,
        outputTokens: gateUsage.outputTokens,
        totalTokens: totalTokens(gateUsage),
        cost: gateCost,
        estimatedCostUsd: gateCost,
        invariantCount: invariantMemory.length,
        missingInvariants: driftReport.missingInvariants,
        contradictions: driftReport.contradictions,
        driftScore: driftReport.driftScore,
        durationMs: gateDurationMs,
        qualityScore,
        judgeScoreStddev: qualityResult.judgeScoreStddev,
        testsPassed,
        success: true,
      });
      snapshots.push({
        config: config.name,
        runId,
        stepNumber: task.number,
        role: "gate",
        payload: {
          system: gateResult.system,
          prompt: gateResult.prompt,
          response: gateResult.rawText,
          usage: gateResult.usage,
          durationMs: gateDurationMs,
        },
      });

      cascadedContext = formatGateSummary(gateResult.summary);
    } else {
      cascadedContext = flagshipResult.response;
    }
  }

  const flagshipSteps = stepRecords.filter((step) => step.modelRole === "flagship");
  const iterationAggregates = aggregateIterations(stepRecords);
  const totalInputTokens = stepRecords.reduce((sum, step) => sum + step.inputTokens, 0);
  const totalOutputTokens = stepRecords.reduce((sum, step) => sum + step.outputTokens, 0);
  const totalCostUsd = stepRecords.reduce((sum, step) => sum + step.estimatedCostUsd, 0);
  const totalMissingInvariants = iterationAggregates.reduce((sum, step) => sum + step.missingInvariants, 0);
  const totalContradictions = iterationAggregates.reduce((sum, step) => sum + step.contradictions, 0);
  const totalDriftScore = iterationAggregates.reduce((sum, step) => sum + step.driftScore, 0);

  return {
    steps: stepRecords,
    run: {
      config: config.name,
      runId,
      provider: config.provider,
      mode: config.mode,
      flagshipModel: config.flagshipModel,
      gateModel: config.gateModel,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 100000000) / 100000000,
      meanInvariantCount: roundNumber(average(iterationAggregates.map((step) => step.invariantCount)), 2),
      totalMissingInvariants,
      totalContradictions,
      totalDriftScore,
      meanDriftScore: roundNumber(average(iterationAggregates.map((step) => step.driftScore)), 2),
      meanQualityScore: Math.round(average(flagshipSteps.map((step) => step.qualityScore)) * 100) / 100,
      testsPassed,
      usedMockClients:
        clients.flagship.mode === "mock" ||
        clients.gate?.mode === "mock" ||
        clients.judge?.mode === "mock",
    },
    snapshots,
  };
}

function buildSnapshotFileName(snapshot: StepSnapshotRecord): string {
  const attemptSuffix = snapshot.role === "judge" && typeof snapshot.attempt === "number" && snapshot.attempt > 1
    ? `-${snapshot.attempt}`
    : "";
  return `${snapshot.config}-run${snapshot.runId}-step${snapshot.stepNumber}-${snapshot.role}${attemptSuffix}.json`;
}

async function writeSnapshots(outputFolder: string, snapshots: StepSnapshotRecord[]): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  const snapshotDir = join(outputFolder, "snapshots");
  await mkdir(snapshotDir, { recursive: true });
  await Promise.all(
    snapshots.map((snapshot) =>
      Bun.write(
        join(snapshotDir, buildSnapshotFileName(snapshot)),
        JSON.stringify(snapshot.payload, null, 2),
      )
    ),
  );
}

function buildCrossProviderComparisons(summaryRows: SummaryRecord[]): CrossProviderComparisonRecord[] {
  if (new Set(summaryRows.map((row) => row.provider)).size < 2) {
    return [];
  }

  const comparisons: CrossProviderComparisonRecord[] = [];
  for (let leftIndex = 0; leftIndex < summaryRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < summaryRows.length; rightIndex += 1) {
      const left = summaryRows[leftIndex];
      const right = summaryRows[rightIndex];
      if (left.provider === right.provider) {
        continue;
      }

      comparisons.push({
        config_a: left.config,
        provider_a: left.provider,
        mode_a: left.mode,
        config_b: right.config,
        provider_b: right.provider,
        mode_b: right.mode,
        cost_ratio_a_to_b:
          right.mean_cost_usd > 0 ? roundNumber(left.mean_cost_usd / right.mean_cost_usd, 4) : null,
        token_ratio_a_to_b:
          right.mean_tokens > 0 ? roundNumber(left.mean_tokens / right.mean_tokens, 4) : null,
        quality_delta_a_minus_b: roundNumber(left.mean_quality - right.mean_quality, 4),
      });
    }
  }

  return comparisons;
}

export function buildSummaryRecords(
  runs: RunRecord[],
  stepRecords: StepRecord[] = [],
  options: { humanBaselineScores?: number[] } = {},
): SummaryRecord[] {
  const grouped = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const list = grouped.get(run.config) ?? [];
    list.push(run);
    grouped.set(run.config, list);
  }

  const flagshipStepRecords = stepRecords.filter((record) => record.modelRole === "flagship");
  const qualityByConfigAndStep = new Map<string, Map<number, number[]>>();
  const judgeStddevByConfig = new Map<string, number[]>();

  for (const record of flagshipStepRecords) {
    const stepMap = qualityByConfigAndStep.get(record.config) ?? new Map<number, number[]>();
    const scores = stepMap.get(record.stepNumber) ?? [];
    scores.push(record.qualityScore);
    stepMap.set(record.stepNumber, scores);
    qualityByConfigAndStep.set(record.config, stepMap);

    if (typeof record.judgeScoreStddev === "number" && Number.isFinite(record.judgeScoreStddev)) {
      const stddevs = judgeStddevByConfig.get(record.config) ?? [];
      stddevs.push(record.judgeScoreStddev);
      judgeStddevByConfig.set(record.config, stddevs);
    }
  }

  const baselineConfigByProvider: Record<ProviderName, string> = {
    openai: "baseline-openai",
    anthropic: "baseline-anthropic",
    xai: "baseline-grok",
    gemini: "baseline-gemini",
  };

  return Array.from(grouped.entries()).map(([configName, configRuns]) => {
    const representativeRun = configRuns[0];
    if (!representativeRun) {
      throw new Error(`Cannot build a summary row for "${configName}" without run records.`);
    }

    const costSamples = configRuns.map((run) => run.totalCostUsd);
    const tokenSamples = configRuns.map((run) => run.totalTokens);
    const qualitySamples = configRuns.map((run) => run.meanQualityScore);
    const cost = summarizeNumbers(configRuns.map((run) => run.totalCostUsd));
    const tokens = summarizeNumbers(configRuns.map((run) => run.totalTokens));
    const quality = summarizeNumbers(configRuns.map((run) => run.meanQualityScore));
    const drift = summarizeNumbers(configRuns.map((run) => run.meanDriftScore));
    const invariantCount = summarizeNumbers(configRuns.map((run) => run.meanInvariantCount));
    const missingInvariants = summarizeNumbers(configRuns.map((run) => run.totalMissingInvariants));
    const contradictions = summarizeNumbers(configRuns.map((run) => run.totalContradictions));
    const baselineConfigName = baselineConfigByProvider[representativeRun.provider];
    const matchingBaselineRuns = baselineConfigName ? grouped.get(baselineConfigName) ?? [] : [];
    const baselineCostSamples = matchingBaselineRuns.map((run) => run.totalCostUsd);
    const baselineTokenSamples = matchingBaselineRuns.map((run) => run.totalTokens);
    const baselineQualitySamples = matchingBaselineRuns.map((run) => run.meanQualityScore);
    const baselineCostMean = summarizeNumbers(matchingBaselineRuns.map((run) => run.totalCostUsd)).mean;
    const baselineTokenMean = summarizeNumbers(matchingBaselineRuns.map((run) => run.totalTokens)).mean;
    const isBaselineConfig = representativeRun?.mode === "baseline";
    const hasMatchingBaseline = !isBaselineConfig && matchingBaselineRuns.length > 0;
    const hasEnoughSamplesForSignificance =
      hasMatchingBaseline &&
      costSamples.length > 1 &&
      baselineCostSamples.length > 1 &&
      tokenSamples.length > 1 &&
      baselineTokenSamples.length > 1 &&
      qualitySamples.length > 1 &&
      baselineQualitySamples.length > 1;
    const costInterval = confidenceInterval(costSamples);
    const tokenInterval = confidenceInterval(tokenSamples);
    const qualityInterval = confidenceInterval(qualitySamples);
    const costTTest = hasEnoughSamplesForSignificance ? welchTTest(costSamples, baselineCostSamples) : null;
    const tokenTTest = hasEnoughSamplesForSignificance ? welchTTest(tokenSamples, baselineTokenSamples) : null;
    const qualityTTest = hasEnoughSamplesForSignificance ? welchTTest(qualitySamples, baselineQualitySamples) : null;
    const costEffectSize = hasEnoughSamplesForSignificance ? cohensD(costSamples, baselineCostSamples) : null;
    const tokenEffectSize = hasEnoughSamplesForSignificance ? cohensD(tokenSamples, baselineTokenSamples) : null;
    const qualityEffectSize = hasEnoughSamplesForSignificance ? cohensD(qualitySamples, baselineQualitySamples) : null;
    const costMannWhitney = hasEnoughSamplesForSignificance ? mannWhitneyU(costSamples, baselineCostSamples) : null;
    const tokenMannWhitney = hasEnoughSamplesForSignificance ? mannWhitneyU(tokenSamples, baselineTokenSamples) : null;
    const rawPValues = [costTTest?.pValue ?? null, tokenTTest?.pValue ?? null, qualityTTest?.pValue ?? null];
    const correctedNumericPValues = bonferroniCorrect(
      rawPValues.filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    );
    let correctedPValueIndex = 0;
    const correctedPValues = rawPValues.map((value) =>
      typeof value === "number" && Number.isFinite(value)
        ? roundNumber(correctedNumericPValues[correctedPValueIndex++] ?? value, 6)
        : null
    );
    const qualityStepMap = qualityByConfigAndStep.get(configName) ?? new Map<number, number[]>();
    const sortedQualitySteps = [...qualityStepMap.entries()].sort((left, right) => left[0] - right[0]);
    const humanBaselineScores = options.humanBaselineScores ?? [];
    const comparableQuality: number[] = [];
    const comparableHuman: number[] = [];

    for (let index = 0; index < Math.min(sortedQualitySteps.length, humanBaselineScores.length); index += 1) {
      const qualityValues = sortedQualitySteps[index]?.[1] ?? [];
      if (qualityValues.length === 0) {
        continue;
      }

      comparableQuality.push(average(qualityValues));
      comparableHuman.push(humanBaselineScores[index] ?? 0);
    }

    const qualityCorrelationWithHuman =
      comparableQuality.length > 1 && comparableHuman.length > 1
        ? roundNumber(pearsonCorrelation(comparableQuality, comparableHuman), 6)
        : null;
    const judgeStddevs = judgeStddevByConfig.get(configName) ?? [];
    const meanJudgeAgreement =
      judgeStddevs.length > 0 ? roundNumber(Math.max(0, Math.min(1, 1 - average(judgeStddevs) / 10)), 4) : null;

    return {
      config: configName,
      provider: representativeRun?.provider ?? "openai",
      mode: representativeRun?.mode ?? "baseline",
      flagship_model: representativeRun?.flagshipModel ?? "",
      gate_model: representativeRun?.gateModel ?? null,
      runs: configRuns.length,
      mean_cost_usd: cost.mean,
      median_cost_usd: cost.median,
      stddev_cost_usd: cost.stddev,
      mean_tokens: tokens.mean,
      median_tokens: tokens.median,
      stddev_tokens: tokens.stddev,
      mean_invariant_count: invariantCount.mean,
      mean_missing_invariants: missingInvariants.mean,
      mean_contradictions: contradictions.mean,
      mean_drift_score: drift.mean,
      mean_quality: quality.mean,
      median_quality: quality.median,
      stddev_quality: quality.stddev,
      cost_savings_vs_baseline_pct: isBaselineConfig
        ? 0
        : baselineCostMean
          ? percentSavings(baselineCostMean, cost.mean)
          : null,
      token_savings_vs_baseline_pct: isBaselineConfig
        ? 0
        : baselineTokenMean
          ? percentSavings(baselineTokenMean, tokens.mean)
          : null,
      pValue_cost: costTTest ? roundNumber(costTTest.pValue, 6) : null,
      pValue_tokens: tokenTTest ? roundNumber(tokenTTest.pValue, 6) : null,
      pValue_quality: qualityTTest ? roundNumber(qualityTTest.pValue, 6) : null,
      pValue_cost_corrected: correctedPValues[0] ?? null,
      pValue_tokens_corrected: correctedPValues[1] ?? null,
      pValue_quality_corrected: correctedPValues[2] ?? null,
      pValue_cost_mannwhitney: costMannWhitney ? roundNumber(costMannWhitney.pValue, 6) : null,
      pValue_tokens_mannwhitney: tokenMannWhitney ? roundNumber(tokenMannWhitney.pValue, 6) : null,
      cohensD_cost: costEffectSize === null ? null : roundNumber(costEffectSize, 4),
      cohensD_tokens: tokenEffectSize === null ? null : roundNumber(tokenEffectSize, 4),
      cohensD_quality: qualityEffectSize === null ? null : roundNumber(qualityEffectSize, 4),
      ci95_cost_lower: roundNumber(costInterval.lower, 8),
      ci95_cost_upper: roundNumber(costInterval.upper, 8),
      ci95_tokens_lower: roundNumber(tokenInterval.lower, 8),
      ci95_tokens_upper: roundNumber(tokenInterval.upper, 8),
      ci95_quality_lower: roundNumber(qualityInterval.lower, 8),
      ci95_quality_upper: roundNumber(qualityInterval.upper, 8),
      mean_judge_agreement: meanJudgeAgreement,
      qualityCorrelationWithHuman,
    };
  });
}

export function buildDashboardCurveData(stepRecords: StepRecord[]): DashboardCurveDatum[] {
  const perRunStep = new Map<string, {
    label: string;
    runId: number;
    stepNumber: number;
    cost: number;
    driftScore: number;
  }>();

  for (const record of stepRecords) {
    const key = `${record.config}::${record.runId}::${record.stepNumber}`;
    const existing = perRunStep.get(key) ?? {
      label: record.config,
      runId: record.runId,
      stepNumber: record.stepNumber,
      cost: 0,
      driftScore: 0,
    };

    existing.cost = roundNumber(existing.cost + record.estimatedCostUsd, 8);
    existing.driftScore = Math.max(existing.driftScore, record.driftScore);
    perRunStep.set(key, existing);
  }

  const grouped = new Map<string, Array<{ cost: number; driftScore: number }>>();
  for (const value of perRunStep.values()) {
    const key = `${value.label}::${value.stepNumber}`;
    const existing = grouped.get(key) ?? [];
    existing.push({
      cost: value.cost,
      driftScore: value.driftScore,
    });
    grouped.set(key, existing);
  }

  return [...grouped.entries()]
    .map(([key, values]) => {
      const separatorIndex = key.indexOf("::");
      const label = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
      const stepNumberText = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : "";
      return {
        label,
        stepNumber: Number(stepNumberText),
        meanCostUsd: roundNumber(average(values.map((item) => item.cost)), 8),
        meanDriftScore: roundNumber(average(values.map((item) => item.driftScore)), 4),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.stepNumber - right.stepNumber);
}

export function buildMarkdownSummary(
  summaryRows: SummaryRecord[],
  crossProviderComparisons: CrossProviderComparisonRecord[],
  outputFolder: string,
  tests: TestCacheResult,
  dataSource: StudyArtifactDataSource,
): string {
  const formatMetric = (value: unknown, decimals: number): string =>
    typeof value === "number" ? value.toFixed(decimals) : "n/a";
  const formatPValue = (value: number | null | undefined): string =>
    typeof value === "number" ? `${value.toFixed(6)} (${interpretPValue(value)})` : "n/a";
  const formatCostInterval = (row: SummaryRecord): string => {
    const lower = row.ci95_cost_lower;
    const upper = row.ci95_cost_upper;
    return typeof lower === "number" && typeof upper === "number"
      ? `[${lower.toFixed(4)}, ${upper.toFixed(4)}]`
      : "n/a";
  };
  const formatInterval = (lower: number, upper: number): string => `[${lower.toFixed(4)}, ${upper.toFixed(4)}]`;
  const formatConfigLabel = (config: string, provider: ProviderName, mode: StudyMode): string =>
    `${config} (${provider}, ${mode})`;
  const baselineByProvider = new Map<ProviderName, SummaryRecord>();
  for (const row of summaryRows) {
    if (row.mode === "baseline") {
      baselineByProvider.set(row.provider, row);
    }
  }

  const cascadeRows = summaryRows.filter((row) => row.mode === "cascade");
  const keyFindings: string[] = [];
  const recommendedSampleSizes: number[] = [];

  for (const row of cascadeRows) {
    const baseline = baselineByProvider.get(row.provider);
    if (!baseline) {
      continue;
    }

    const savingsText = typeof row.cost_savings_vs_baseline_pct === "number"
      ? `${row.cost_savings_vs_baseline_pct.toFixed(1)}%`
      : "n/a";
    const costP = row.pValue_cost_corrected ?? row.pValue_cost;
    const tokenP = row.pValue_tokens_corrected ?? row.pValue_tokens;
    const qualityP = row.pValue_quality_corrected ?? row.pValue_quality;
    const qualityPct = baseline.mean_quality > 0 ? (row.mean_quality / baseline.mean_quality) * 100 : null;
    const qualityPctText = typeof qualityPct === "number" ? `${qualityPct.toFixed(1)}%` : "n/a";
    const qualitySignal = typeof qualityP === "number" && qualityP < 0.05
      ? "quality degradation detected"
      : "no statistically significant quality degradation detected";

    keyFindings.push(
      `- ${row.config} saved ${savingsText} on average vs ${baseline.config} (cost p = ${formatPValue(costP)}, Cohen's d = ${formatMetric(row.cohensD_cost, 4)} ${row.cohensD_cost === null ? "" : interpretCohensD(row.cohensD_cost)}).`,
    );
    keyFindings.push(
      `- ${row.config} retained ${qualityPctText} of baseline quality (cascade=${formatMetric(row.mean_quality, 2)}, baseline=${formatMetric(baseline.mean_quality, 2)}; ${qualitySignal}).`,
    );

    const candidateEffects = [row.cohensD_cost, row.cohensD_tokens, row.cohensD_quality].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (candidateEffects.length > 0) {
      const largestEffect = Math.max(...candidateEffects.map((value) => Math.abs(value)));
      const requiredRuns = minimumSampleSize(largestEffect);
      if (Number.isFinite(requiredRuns)) {
        recommendedSampleSizes.push(requiredRuns);
      }
    }

    if (typeof tokenP === "number") {
      keyFindings.push(
        `- ${row.config} token efficiency remains at ${formatMetric(row.token_savings_vs_baseline_pct, 2)}% vs baseline (token p = ${formatPValue(tokenP)}).`,
      );
    }
  }

  if (summaryRows.length === 0) {
    keyFindings.push("- No cascade configurations were present in this run.");
  }

  if (summaryRows.every((row) => row.mean_drift_score === 0)) {
    keyFindings.push("- Drift score remained at 0 across all runs.");
  } else {
    const maxDrift = Math.max(...summaryRows.map((row) => row.mean_drift_score));
    keyFindings.push(`- Drift score was non-zero in at least one configuration (max mean drift: ${maxDrift.toFixed(2)}).`);
  }

  const runsPerConfig = summaryRows.length > 0 ? summaryRows[0]?.runs ?? 0 : 0;
  const maxRecommendedRuns = recommendedSampleSizes.length > 0 ? Math.max(...recommendedSampleSizes) : null;
  const observedEffectMagnitude = Math.max(
    0,
    ...summaryRows.flatMap((row) =>
      [row.cohensD_cost, row.cohensD_tokens, row.cohensD_quality]
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Math.abs(value)),
    ),
  );
  const methodologyNote = [
    `N runs per configuration: ${runsPerConfig}.`,
    "Statistical tests: Welch's t-test (two-tailed), Cohen's d effect size, 95% confidence intervals, Bonferroni correction, and Mann-Whitney U where reported.",
    maxRecommendedRuns !== null && runsPerConfig < maxRecommendedRuns
      ? `Power note: ${runsPerConfig} runs may be insufficient for the observed effects; consider at least ${maxRecommendedRuns} runs per configuration (largest observed |d| = ${observedEffectMagnitude.toFixed(2)}).`
      : null,
  ].filter((line): line is string => Boolean(line));

  const lines = [
    "# RazorCascade Memory Reliability Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Output folder: ${outputFolder}`,
    `Tests: ${tests.passed === null ? "skipped" : tests.passed ? "passed" : "failed"}`,
    `Data source: ${formatStudyDataSource(dataSource)}`,
    "",
    "## Configuration Summary",
    "",
    "| Config | Mean Cost (USD) | 95% Cost CI | 95% Token CI | 95% Quality CI | Mean Drift | Mean Tokens | Mean Quality | Cost Savings vs Baseline | Token Savings vs Baseline | Cost p-value | Cost p adj | Token p-value | Token p adj | Quality p-value | Quality p adj | Cost MW p | Token MW p | Cohen's d (Cost) | Cohen's d (Tokens) | Cohen's d (Quality) | Judge Agreement | Quality vs Human |",
    "| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of summaryRows) {
    lines.push(
      `| ${row.config} | ${formatMetric(row.mean_cost_usd, 4)} | ${formatCostInterval(row)} | ${formatInterval(row.ci95_tokens_lower, row.ci95_tokens_upper)} | ${formatInterval(row.ci95_quality_lower, row.ci95_quality_upper)} | ${formatMetric(row.mean_drift_score, 2)} | ${formatMetric(row.mean_tokens, 2)} | ${formatMetric(row.mean_quality, 2)} | ${formatMetric(row.cost_savings_vs_baseline_pct, 2)} | ${formatMetric(row.token_savings_vs_baseline_pct, 2)} | ${formatPValue(row.pValue_cost)} | ${formatPValue(row.pValue_cost_corrected)} | ${formatPValue(row.pValue_tokens)} | ${formatPValue(row.pValue_tokens_corrected)} | ${formatPValue(row.pValue_quality)} | ${formatPValue(row.pValue_quality_corrected)} | ${formatPValue(row.pValue_cost_mannwhitney)} | ${formatPValue(row.pValue_tokens_mannwhitney)} | ${formatMetric(row.cohensD_cost, 4)} | ${formatMetric(row.cohensD_tokens, 4)} | ${formatMetric(row.cohensD_quality, 4)} | ${formatMetric(row.mean_judge_agreement, 4)} | ${formatMetric(row.qualityCorrelationWithHuman, 4)} |`,
    );
  }

  lines.push("");
  lines.push("## Key Findings");
  lines.push("");
  lines.push(...(keyFindings.length > 0 ? keyFindings : ["- No cascade configurations were present in this run."]));

  if (methodologyNote.length > 0) {
    lines.push("");
    lines.push("## Methodology Note");
    lines.push("");
    lines.push(...methodologyNote.map((line) => `- ${line}`));
  }

  if (crossProviderComparisons.length > 0) {
    lines.push("");
    lines.push("## Cross-Provider Comparisons");
    lines.push("");
    lines.push("| Config A | Config B | Cost Ratio (A/B) | Token Ratio (A/B) | Quality Delta (A-B) |");
    lines.push("| --- | --- | ---: | ---: | ---: |");

    for (const comparison of crossProviderComparisons) {
      lines.push(
        `| ${formatConfigLabel(comparison.config_a, comparison.provider_a, comparison.mode_a)} | ${formatConfigLabel(comparison.config_b, comparison.provider_b, comparison.mode_b)} | ${formatMetric(comparison.cost_ratio_a_to_b, 4)} | ${formatMetric(comparison.token_ratio_a_to_b, 4)} | ${formatMetric(comparison.quality_delta_a_minus_b, 4)} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Test Output");
  lines.push("");
  lines.push("```text");
  lines.push(tests.output || "No test output captured.");
  lines.push("```");

  return `${lines.join("\n")}\n`;
}

function buildExperimentLabels(experimentFolders: string[]): string[] {
  const counts = new Map<string, number>();

  return experimentFolders.map((folder) => {
    const baseLabel = basename(folder) || folder;
    const occurrence = (counts.get(baseLabel) ?? 0) + 1;
    counts.set(baseLabel, occurrence);
    return occurrence === 1 ? baseLabel : `${baseLabel} (${occurrence})`;
  });
}

function formatComparisonValue(value: number | null | undefined, decimals: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "n/a";
}

function formatConfigLabel(row: SummaryRecord): string {
  return `${row.config} (${row.provider}, ${row.mode})`;
}

async function loadStudySummaryArtifact(
  experimentFolder: string,
  label: string,
): Promise<LoadedStudySummaryArtifact> {
  const folder = resolve(experimentFolder);
  const summaryPath = join(folder, "summary.json");
  let rawSummary: string;

  try {
    rawSummary = await readFile(summaryPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read study summary from "${summaryPath}": ${reason}`);
  }

  try {
    return {
      label,
      folder,
      summaryPath,
      summary: StudySummaryArtifactSchema.parse(JSON.parse(rawSummary) as unknown),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid study summary artifact at "${summaryPath}": ${reason}`);
  }
}

function buildComparisonReport(experiments: LoadedStudySummaryArtifact[]): string {
  const lines = [
    "# RazorCascade Experiment Comparison",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Compared experiments: ${experiments.length}`,
    "",
    "## Experiments",
    "",
    "| Experiment | Folder | Data Source | Config Count | Cross-Provider Pairs |",
    "| --- | --- | --- | ---: | ---: |",
  ];

  for (const experiment of experiments) {
    lines.push(
      `| ${experiment.label} | ${experiment.folder} | ${experiment.summary.dataSource} | ${experiment.summary.configs.length} | ${experiment.summary.cross_provider_comparisons?.length ?? 0} |`,
    );
  }

  const configOrder = new Map<string, SummaryRecord>();
  for (const experiment of experiments) {
    for (const row of experiment.summary.configs) {
      if (!configOrder.has(row.config)) {
        configOrder.set(row.config, row);
      }
    }
  }

  lines.push("");
  lines.push("## Side-by-Side Configuration Metrics");
  lines.push("");
  lines.push(`| Config | Metric | ${experiments.map((experiment) => experiment.label).join(" | ")} |`);
  lines.push(`| --- | --- | ${experiments.map(() => "---:").join(" | ")} |`);

  for (const configName of [...configOrder.keys()].sort((left, right) => left.localeCompare(right))) {
    const representativeRow = configOrder.get(configName);
    if (!representativeRow) {
      continue;
    }

    for (const metric of SUMMARY_COMPARISON_METRICS) {
      const values = experiments.map((experiment) => {
        const row = experiment.summary.configs.find((summaryRow) => summaryRow.config === configName);
        return formatComparisonValue(row ? metric.value(row) : null, metric.decimals);
      });

      lines.push(`| ${formatConfigLabel(representativeRow)} | ${metric.label} | ${values.join(" | ")} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function compareStudyArtifacts(
  experimentFolders: string[],
  outputPath?: string,
): Promise<{
  report: string;
  outputPath?: string;
}> {
  if (experimentFolders.length < 2) {
    throw new Error("The compare command requires at least two experiment folders.");
  }

  const labels = buildExperimentLabels(experimentFolders);
  const experiments = await Promise.all(
    experimentFolders.map((folder, index) => loadStudySummaryArtifact(folder, labels[index] ?? folder)),
  );
  const report = buildComparisonReport(experiments);
  const resolvedOutputPath = outputPath ? resolve(outputPath) : undefined;

  if (resolvedOutputPath) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await Bun.write(resolvedOutputPath, report);
  }

  return {
    report,
    outputPath: resolvedOutputPath,
  };
}

export async function runStudy(options: {
  configName?: string;
  configNames?: string[];
  all?: boolean;
  runs?: number;
  mode?: StudyMode;
  provider?: ProviderName;
  flagModel?: string;
  gateModel?: string;
  judge?: boolean;
  judgeModel?: string;
  judgeProvider?: ProviderName;
  judgeClient?: ModelClient;
  outputDir?: string;
  configPath?: string;
  dryRun?: boolean;
  skipTests?: boolean;
  costCap?: number;
  snapshot?: boolean;
  judgeRepeat?: number;
}): Promise<{
  outputFolder: string;
  stepRecords: StepRecord[];
  runRecords: RunRecord[];
  summaryRecords: SummaryRecord[];
  crossProviderComparisons: CrossProviderComparisonRecord[];
  costCapReached: boolean;
}> {
  const configPath = options.configPath ?? resolve("config.json");
  const configFile = await loadConfigFile(configPath);
  const priceBook = await loadPriceBook(configPath);
  const selectedConfigs = await resolveSelectedConfigs(configFile, {
    configName: options.configName,
    configNames: options.configNames,
    all: options.all,
    mode: options.mode,
    provider: options.provider,
    flagModel: options.flagModel,
    gateModel: options.gateModel,
  });
  const studyTasks = configFile.tasks?.length ? configFile.tasks : STUDY_TASKS;
  const scoring = configFile.scoring ?? DEFAULT_SCORING;
  const runs = options.runs ?? Number(process.env.RAZORCASCADE_DEFAULT_RUNS || configFile.defaultRuns || 10);
  const judgeRepeat = Math.max(1, Math.min(3, Math.trunc(options.judgeRepeat ?? 1) || 1));
  const costCap = parseOptionalCostCap(options.costCap);
  const outputRoot = resolve(options.outputDir || configFile.outputDir || "experiments");
  const outputFolder = join(outputRoot, timestampFolderName());
  await mkdir(outputFolder, { recursive: true });

  const cachedTests = await runTestsOnce(Boolean(options.skipTests));
  const stepRecords: StepRecord[] = [];
  const runRecords: RunRecord[] = [];
  let cumulativeEstimatedCostUsd = 0;
  let costCapReached = false;

  outer:
  for (const config of selectedConfigs) {
    const clients = options.judgeClient
      ? {
        ...(await createClients(
          config,
          Boolean(options.dryRun),
          false,
          options.judgeModel,
          options.judgeProvider,
        )),
        judge: options.judgeClient,
      }
      : await createClients(
        config,
        Boolean(options.dryRun),
        Boolean(options.judge),
        options.judgeModel,
        options.judgeProvider,
      );
    for (let runId = 1; runId <= runs; runId += 1) {
      if (costCap !== undefined && cumulativeEstimatedCostUsd >= costCap) {
        costCapReached = true;
        logger.warn(
          `Cost cap of $${costCap.toFixed(4)} reached at $${cumulativeEstimatedCostUsd.toFixed(4)} before ${config.name} run ${runId}; stopping early and writing partial results.`,
        );
        break outer;
      }

      const runResult = await executeRun(
        config,
        runId,
        clients,
        cachedTests.passed,
        studyTasks,
        scoring,
        judgeRepeat,
        priceBook,
      );
      stepRecords.push(...runResult.steps);
      runRecords.push(runResult.run);
      if (options.snapshot) {
        await writeSnapshots(outputFolder, runResult.snapshots);
      }
      cumulativeEstimatedCostUsd = roundNumber(cumulativeEstimatedCostUsd + runResult.run.totalCostUsd, 8);
    }
  }

  const summaryRecords = buildSummaryRecords(runRecords, stepRecords, {
    humanBaselineScores: configFile.humanBaselineScores,
  });
  const crossProviderComparisons = buildCrossProviderComparisons(summaryRecords);
  const dataSource = runRecords.length > 0 ? resolveStudyDataSource(runRecords) : (options.dryRun ? "mock" : "live");
  const summaryArtifact: StudySummaryArtifact = {
    dataSource,
    configs: summaryRecords,
    ...(crossProviderComparisons.length > 0
      ? { cross_provider_comparisons: crossProviderComparisons }
      : {}),
  };
  const dashboardCurveData = buildDashboardCurveData(stepRecords);
  const dashboardData: DashboardDatum[] = summaryRecords.map((row) => ({
    label: String(row.config),
    runs: typeof row.runs === "number" ? row.runs : Number(row.runs),
    meanCostUsd: Number(row.mean_cost_usd),
    meanTokens: Number(row.mean_tokens),
    meanQuality: Number(row.mean_quality),
    meanDriftScore: Number(row.mean_drift_score),
    costSavingsVsBaselinePct:
      row.cost_savings_vs_baseline_pct === null ? null : Number(row.cost_savings_vs_baseline_pct),
    tokenSavingsVsBaselinePct:
      row.token_savings_vs_baseline_pct === null ? null : Number(row.token_savings_vs_baseline_pct),
    pValueCost: row.pValue_cost === null ? null : Number(row.pValue_cost),
    pValueTokens: row.pValue_tokens === null ? null : Number(row.pValue_tokens),
    pValueQuality: row.pValue_quality === null ? null : Number(row.pValue_quality),
    cohensDCost: row.cohensD_cost === null ? null : Number(row.cohensD_cost),
    ci95CostLower: row.ci95_cost_lower === null ? null : Number(row.ci95_cost_lower),
    ci95CostUpper: row.ci95_cost_upper === null ? null : Number(row.ci95_cost_upper),
  }));

  await writeCsv(join(outputFolder, "steps.csv"), stepRecords as unknown as Array<Record<string, unknown>>);
  await writeCsv(join(outputFolder, "runs.csv"), runRecords as unknown as Array<Record<string, unknown>>);
  await Bun.write(join(outputFolder, "summary.json"), JSON.stringify(summaryArtifact, null, 2));
  await writeHtmlDashboard(join(outputFolder, "dashboard.html"), dataSource, dashboardData, dashboardCurveData);
  await Bun.write(
    join(outputFolder, "report.md"),
    buildMarkdownSummary(summaryRecords, crossProviderComparisons, outputFolder, cachedTests, dataSource),
  );

  return {
    outputFolder,
    stepRecords,
    runRecords,
    summaryRecords,
    crossProviderComparisons,
    costCapReached,
  };
}

function configureLogger(options: { verbose?: boolean; quiet?: boolean }): void {
  logger.setFormat("text");
  if (options.quiet) {
    logger.setLevel("error");
    return;
  }

  logger.setLevel(options.verbose ? "debug" : "info");
}

function buildStudyProgram(): Command {
  const program = new Command();
  program
    .name("study")
    .description("Run the RazorCascade cost, drift, and quality study or compare existing artifacts.")
    .option("--config <name>", "Named configuration from config.json.")
    .option("--configs <names>", "Comma-separated list of named configurations from config.json.")
    .option("--all", "Run every configuration in config.json.", false)
    .option("--runs <number>", "Number of repeated runs per configuration.", "10")
    .option("--mode <mode>", "Ad hoc mode override: baseline or cascade.")
    .option("--provider <provider>", "Ad hoc provider override: openai, anthropic, or xai.")
    .option("--flag-model <model>", "Flagship model override.")
    .option("--gate-model <model>", "Gate model override.")
    .option("--judge", "Score flagship outputs with an LLM judge instead of the heuristic scorer.", false)
    .option("--judge-model <model>", "Optional judge model override. Defaults to the flagship model.")
    .option("--judge-provider <provider>", "Provider for the judge model (e.g. anthropic, gemini). Defaults to the config provider.")
    .option("--judge-repeat <number>", "Repeat judge scoring per step up to three times.", "1")
    .option("--cost-cap <usd>", "Stop early once cumulative estimated study cost already exceeds this USD cap.")
    .option("--snapshot", "Write per-step prompt/response JSON snapshots for reproducibility.", false)
    .option("--output-dir <path>", "Root folder for experiment artifacts.")
    .option("--dry-run", "Use deterministic mock clients even if API keys are present.", false)
    .option("--skip-tests", "Skip local tests while running the study.", false)
    .option("--verbose", "Enable debug logging for study diagnostics.", false)
    .option("--quiet", "Only emit error-level logs during the study.", false)
    .action(async (options) => {
      configureLogger(options);
      const provider = options.provider ? ProviderSchema.parse(options.provider) : undefined;
      const mode = options.mode ? StudyModeSchema.parse(options.mode) : undefined;
      const costCap = parseOptionalCostCap(options.costCap);
      const configNames =
        typeof options.configs === "string"
          ? options.configs.split(",").map((name: string) => name.trim()).filter(Boolean)
          : undefined;
      const result = await runStudy({
        configName: options.config,
        configNames,
        all: options.all,
        runs: Number(options.runs),
        mode,
        provider,
        flagModel: options.flagModel,
        gateModel: options.gateModel,
        judge: options.judge,
        judgeModel: options.judgeModel,
        judgeProvider: options.judgeProvider ? ProviderSchema.parse(options.judgeProvider) : undefined,
        judgeRepeat: Number(options.judgeRepeat),
        costCap,
        snapshot: options.snapshot,
        outputDir: options.outputDir,
        dryRun: options.dryRun,
        skipTests: options.skipTests,
      });

      const dashboardData: DashboardDatum[] = result.summaryRecords.map((row) => ({
        label: String(row.config),
        runs: typeof row.runs === "number" ? row.runs : Number(row.runs),
        meanCostUsd: Number(row.mean_cost_usd),
        meanTokens: Number(row.mean_tokens),
        meanQuality: Number(row.mean_quality),
        meanDriftScore: Number(row.mean_drift_score),
        costSavingsVsBaselinePct:
          row.cost_savings_vs_baseline_pct === null ? null : Number(row.cost_savings_vs_baseline_pct),
        tokenSavingsVsBaselinePct:
          row.token_savings_vs_baseline_pct === null ? null : Number(row.token_savings_vs_baseline_pct),
        pValueCost: row.pValue_cost === null ? null : Number(row.pValue_cost),
        pValueTokens: row.pValue_tokens === null ? null : Number(row.pValue_tokens),
        pValueQuality: row.pValue_quality === null ? null : Number(row.pValue_quality),
        cohensDCost: row.cohensD_cost === null ? null : Number(row.cohensD_cost),
        ci95CostLower: row.ci95_cost_lower === null ? null : Number(row.ci95_cost_lower),
        ci95CostUpper: row.ci95_cost_upper === null ? null : Number(row.ci95_cost_upper),
      }));

      console.log(`Artifacts written to ${result.outputFolder}`);
      console.log("");
      console.log("Mean cost");
      console.log(renderTextBarChart(dashboardData, "meanCostUsd"));
      console.log("");
      console.log("Mean tokens");
      console.log(renderTextBarChart(dashboardData, "meanTokens"));
      console.log("");
      console.log("Mean drift");
      console.log(renderTextBarChart(dashboardData, "meanDriftScore"));
    });

  program
    .command("compare")
    .description("Compare summary.json artifacts from existing experiment folders.")
    .argument("<experimentFolders...>", "Experiment folders containing summary.json")
    .option("--output <path>", "Optional file path for the rendered comparison table.")
    .option("--verbose", "Enable debug logging for comparison diagnostics.", false)
    .option("--quiet", "Only emit error-level logs during comparison.", false)
    .action(async (experimentFolders: string[], options: { output?: string; verbose?: boolean; quiet?: boolean }) => {
      configureLogger(options);
      const result = await compareStudyArtifacts(experimentFolders, options.output);
      console.log(result.report.trimEnd());

      if (result.outputPath) {
        console.log("");
        console.log(`Comparison written to ${result.outputPath}`);
      }
    });

  return program;
}

export async function main(argv = Bun.argv): Promise<void> {
  await buildStudyProgram().parseAsync(argv);
}

if (import.meta.main) {
  await main();
}
