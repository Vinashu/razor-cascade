import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { buildDriftReport } from "./contradictions.ts";
import { formatGateSummary, summarizeWithGate } from "./gate.ts";
import { extractInvariants, mergeInvariantFacts } from "./invariants.ts";
import {
  type DashboardCurveDatum,
  estimateCostUsd,
  estimateTokens,
  percentSavings,
  renderTextBarChart,
  roundNumber,
  summarizeNumbers,
  totalTokens,
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

const StudyConfigFileSchema = z.object({
  defaultRuns: z.number().int().positive().default(10),
  outputDir: z.string().default("experiments"),
  configs: z.array(StudyConfigSchema),
});

export type StudyMode = z.infer<typeof StudyModeSchema>;
export type StudyConfig = z.infer<typeof StudyConfigSchema>;

export interface StudyTask {
  number: number;
  title: string;
  objective: string;
  keywords: string[];
}

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
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  qualityScore: number;
}

interface TestCacheResult {
  passed: boolean | null;
  output: string;
}

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

function scoreTaskOutput(task: StudyTask, text: string, testsPassed: boolean | null): number {
  const normalized = text.toLowerCase();
  const keywordHits = task.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase())).length;
  const keywordScore = task.keywords.length > 0 ? keywordHits / task.keywords.length : 0;
  const structureBonus = ["goal", "validation", "risk"].filter((keyword) => normalized.includes(keyword)).length / 3;
  const testBonus = testsPassed === true ? 0.4 : testsPassed === false ? -0.4 : 0;
  const lengthBonus = text.length >= 240 ? 0.3 : 0;
  const raw = 6 + keywordScore * 2.8 + structureBonus * 0.5 + lengthBonus + testBonus;
  return Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
}

async function runSingleModelStep(
  client: ModelClient,
  prompt: string,
  task: StudyTask,
  testsPassed: boolean | null,
): Promise<StudyTaskResponse> {
  const startedAt = performance.now();
  const response = await client.generateText({
    system: "You are a senior engineer writing concise implementation updates.",
    prompt,
    maxOutputTokens: 900,
    metadata: {
      kind: "task",
      task: String(task.number),
    },
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const qualityScore = scoreTaskOutput(task, response.text, testsPassed);

  return {
    text: response.text,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    durationMs,
    qualityScore,
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

async function resolveSelectedConfigs(options: {
  configName?: string;
  configNames?: string[];
  all?: boolean;
  mode?: StudyMode;
  provider?: ProviderName;
  flagModel?: string;
  gateModel?: string;
}): Promise<StudyConfig[]> {
  const configFile = await loadConfigFile();
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

async function createClients(config: StudyConfig, dryRun: boolean): Promise<{
  flagship: ModelClient;
  gate?: ModelClient;
}> {
  const apiKey = getProviderApiKey(config.provider);
  const fallbackToMock = dryRun || !apiKey;
  const flagship = await createModelClient({
    provider: config.provider,
    model: config.flagshipModel,
    apiKey,
    fallbackToMock,
  });

  if (config.mode === "baseline") {
    return { flagship };
  }

  const gateModel = config.gateModel || resolveModelFromEnv(config.provider, "gate");
  const gate = await createModelClient({
    provider: config.provider,
    model: gateModel,
    apiKey,
    fallbackToMock,
  });

  return { flagship, gate };
}

async function executeRun(
  config: StudyConfig,
  runId: number,
  clients: { flagship: ModelClient; gate?: ModelClient },
  testsPassed: boolean | null,
): Promise<{ steps: StepRecord[]; run: RunRecord }> {
  const fullHistory: string[] = [];
  let cascadedContext = "";
  let invariantMemory: string[] = [];
  const stepRecords: StepRecord[] = [];

  for (const task of STUDY_TASKS) {
    const context = config.mode === "baseline" ? fullHistory.join("\n\n") : cascadedContext;
    const prompt = buildTaskPrompt(task, config.mode, context);
    const flagshipResult = await runSingleModelStep(clients.flagship, prompt, task, testsPassed);
    const flagshipUsage = {
      inputTokens: flagshipResult.inputTokens,
      outputTokens: flagshipResult.outputTokens,
    };
    const flagshipCost = estimateCostUsd(config.provider, config.flagshipModel, flagshipUsage);

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
      qualityScore: flagshipResult.qualityScore,
      testsPassed,
      success: flagshipResult.qualityScore >= 7 && testsPassed !== false,
    });

    fullHistory.push(buildHistoryEntry(task, flagshipResult.text));
    invariantMemory = mergeInvariantFacts(invariantMemory, extractInvariants(fullHistory[fullHistory.length - 1] ?? "").facts);

    const flagshipStepRecord = stepRecords[stepRecords.length - 1];
    if (flagshipStepRecord) {
      flagshipStepRecord.invariantCount = invariantMemory.length;
    }

    if (config.mode === "cascade" && clients.gate && config.gateModel) {
      const gateStartedAt = performance.now();
      const gateInputText = `${fullHistory.join("\n\n")}\n\nLatest changes:\n${flagshipResult.text}`;
      const gateResult = await summarizeWithGate({
        history: fullHistory.join("\n\n"),
        latestChanges: flagshipResult.text,
        previousInvariants: invariantMemory,
        client: clients.gate,
      });
      const gateDurationMs = Math.round(performance.now() - gateStartedAt);
      const gateUsage = {
        inputTokens: estimateTokens(gateInputText),
        outputTokens: estimateTokens(JSON.stringify(gateResult.summary)),
      };
      const driftReport = buildDriftReport(formatGateSummary(gateResult.draftSummary), invariantMemory);
      const gateCost = estimateCostUsd(config.provider, config.gateModel, gateUsage);

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
        qualityScore: flagshipResult.qualityScore,
        testsPassed,
        success: true,
      });

      cascadedContext = formatGateSummary(gateResult.summary);
    } else {
      cascadedContext = flagshipResult.text;
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
      usedMockClients: clients.flagship.mode === "mock" || clients.gate?.mode === "mock",
    },
  };
}

function buildSummaryRecords(runs: RunRecord[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const list = grouped.get(run.config) ?? [];
    list.push(run);
    grouped.set(run.config, list);
  }

  const baselineConfigByProvider: Record<ProviderName, string> = {
    openai: "baseline-openai",
    anthropic: "baseline-anthropic",
    xai: "baseline-grok",
    gemini: "baseline-gemini",
  };

  return Array.from(grouped.entries()).map(([configName, configRuns]) => {
    const representativeRun = configRuns[0];
    const cost = summarizeNumbers(configRuns.map((run) => run.totalCostUsd));
    const tokens = summarizeNumbers(configRuns.map((run) => run.totalTokens));
    const quality = summarizeNumbers(configRuns.map((run) => run.meanQualityScore));
    const drift = summarizeNumbers(configRuns.map((run) => run.meanDriftScore));
    const invariantCount = summarizeNumbers(configRuns.map((run) => run.meanInvariantCount));
    const missingInvariants = summarizeNumbers(configRuns.map((run) => run.totalMissingInvariants));
    const contradictions = summarizeNumbers(configRuns.map((run) => run.totalContradictions));
    const baselineConfigName = representativeRun ? baselineConfigByProvider[representativeRun.provider] : undefined;
    const matchingBaselineRuns = baselineConfigName ? grouped.get(baselineConfigName) ?? [] : [];
    const baselineCostMean = summarizeNumbers(matchingBaselineRuns.map((run) => run.totalCostUsd)).mean;
    const baselineTokenMean = summarizeNumbers(matchingBaselineRuns.map((run) => run.totalTokens)).mean;
    const isBaselineConfig = representativeRun?.mode === "baseline";

    return {
      config: configName,
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
    };
  });
}

function buildDashboardCurveData(stepRecords: StepRecord[]): DashboardCurveDatum[] {
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
      const [label, stepNumberText] = key.split("::");
      return {
        label,
        stepNumber: Number(stepNumberText),
        meanCostUsd: roundNumber(average(values.map((item) => item.cost)), 8),
        meanDriftScore: roundNumber(average(values.map((item) => item.driftScore)), 4),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.stepNumber - right.stepNumber);
}

function buildMarkdownSummary(
  summaryRows: Array<Record<string, unknown>>,
  outputFolder: string,
  tests: TestCacheResult,
): string {
  const lines = [
    "# RazorCascade Memory Reliability Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Output folder: ${outputFolder}`,
    `Tests: ${tests.passed === null ? "skipped" : tests.passed ? "passed" : "failed"}`,
    "",
    "## Configuration Summary",
    "",
    "| Config | Mean Cost (USD) | Mean Drift | Mean Tokens | Mean Quality | Cost Savings vs Baseline | Token Savings vs Baseline |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of summaryRows) {
    lines.push(
      `| ${row.config} | ${row.mean_cost_usd} | ${row.mean_drift_score} | ${row.mean_tokens} | ${row.mean_quality} | ${row.cost_savings_vs_baseline_pct ?? "n/a"} | ${row.token_savings_vs_baseline_pct ?? "n/a"} |`,
    );
  }

  lines.push("");
  lines.push("## Test Output");
  lines.push("");
  lines.push("```text");
  lines.push(tests.output || "No test output captured.");
  lines.push("```");

  return `${lines.join("\n")}\n`;
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
  outputDir?: string;
  dryRun?: boolean;
  skipTests?: boolean;
}): Promise<{
  outputFolder: string;
  stepRecords: StepRecord[];
  runRecords: RunRecord[];
  summaryRecords: Array<Record<string, unknown>>;
}> {
  const selectedConfigs = await resolveSelectedConfigs({
    configName: options.configName,
    configNames: options.configNames,
    all: options.all,
    mode: options.mode,
    provider: options.provider,
    flagModel: options.flagModel,
    gateModel: options.gateModel,
  });
  const configFile = await loadConfigFile();
  const runs = options.runs ?? Number(process.env.RAZORCASCADE_DEFAULT_RUNS || configFile.defaultRuns || 10);
  const outputRoot = resolve(options.outputDir || configFile.outputDir || "experiments");
  const outputFolder = join(outputRoot, timestampFolderName());
  await mkdir(outputFolder, { recursive: true });

  const cachedTests = await runTestsOnce(Boolean(options.skipTests));
  const stepRecords: StepRecord[] = [];
  const runRecords: RunRecord[] = [];

  for (const config of selectedConfigs) {
    const clients = await createClients(config, Boolean(options.dryRun));
    for (let runId = 1; runId <= runs; runId += 1) {
      const result = await executeRun(config, runId, clients, cachedTests.passed);
      stepRecords.push(...result.steps);
      runRecords.push(result.run);
    }
  }

  const summaryRecords = buildSummaryRecords(runRecords);
  const dashboardCurveData = buildDashboardCurveData(stepRecords);
  const dashboardData: DashboardDatum[] = summaryRecords.map((row) => ({
    label: String(row.config),
    meanCostUsd: Number(row.mean_cost_usd),
    meanTokens: Number(row.mean_tokens),
    meanQuality: Number(row.mean_quality),
    meanDriftScore: Number(row.mean_drift_score),
    costSavingsVsBaselinePct:
      row.cost_savings_vs_baseline_pct === null ? null : Number(row.cost_savings_vs_baseline_pct),
    tokenSavingsVsBaselinePct:
      row.token_savings_vs_baseline_pct === null ? null : Number(row.token_savings_vs_baseline_pct),
  }));

  await writeCsv(join(outputFolder, "steps.csv"), stepRecords as unknown as Array<Record<string, unknown>>);
  await writeCsv(join(outputFolder, "runs.csv"), runRecords as unknown as Array<Record<string, unknown>>);
  await Bun.write(join(outputFolder, "summary.json"), JSON.stringify(summaryRecords, null, 2));
  await writeHtmlDashboard(join(outputFolder, "dashboard.html"), dashboardData, dashboardCurveData);
  await Bun.write(join(outputFolder, "report.md"), buildMarkdownSummary(summaryRecords, outputFolder, cachedTests));

  return {
    outputFolder,
    stepRecords,
    runRecords,
    summaryRecords,
  };
}

function buildStudyProgram(): Command {
  const program = new Command();
  program
    .name("study")
    .description("Run the RazorCascade cost, drift, and quality study.")
    .option("--config <name>", "Named configuration from config.json.")
    .option("--configs <names>", "Comma-separated list of named configurations from config.json.")
    .option("--all", "Run every configuration in config.json.", false)
    .option("--runs <number>", "Number of repeated runs per configuration.", "10")
    .option("--mode <mode>", "Ad hoc mode override: baseline or cascade.")
    .option("--provider <provider>", "Ad hoc provider override: openai, anthropic, or xai.")
    .option("--flag-model <model>", "Flagship model override.")
    .option("--gate-model <model>", "Gate model override.")
    .option("--output-dir <path>", "Root folder for experiment artifacts.")
    .option("--dry-run", "Use deterministic mock clients even if API keys are present.", false)
    .option("--skip-tests", "Skip local tests while running the study.", false)
    .action(async (options) => {
      const provider = options.provider ? ProviderSchema.parse(options.provider) : undefined;
      const mode = options.mode ? StudyModeSchema.parse(options.mode) : undefined;
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
        outputDir: options.outputDir,
        dryRun: options.dryRun,
        skipTests: options.skipTests,
      });

      const dashboardData: DashboardDatum[] = result.summaryRecords.map((row) => ({
        label: String(row.config),
        meanCostUsd: Number(row.mean_cost_usd),
        meanTokens: Number(row.mean_tokens),
        meanQuality: Number(row.mean_quality),
        meanDriftScore: Number(row.mean_drift_score),
        costSavingsVsBaselinePct:
          row.cost_savings_vs_baseline_pct === null ? null : Number(row.cost_savings_vs_baseline_pct),
        tokenSavingsVsBaselinePct:
          row.token_savings_vs_baseline_pct === null ? null : Number(row.token_savings_vs_baseline_pct),
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

  return program;
}

export async function main(argv = Bun.argv): Promise<void> {
  await buildStudyProgram().parseAsync(argv);
}

if (import.meta.main) {
  await main();
}
