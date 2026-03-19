/**
 * replay.ts
 *
 * Regenerates study artifacts (steps.csv, runs.csv, summary.json,
 * dashboard.html, report.md) from an existing snapshots/ directory.
 * No API calls are made — all scores and usage are read from the saved
 * JSON snapshots.
 *
 * Usage:
 *   bun run src/replay.ts --input experiments/<folder> [--output-dir experiments]
 */

import { readdir, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";

import {
  buildCrossProviderComparisons,
  buildDashboardCurveData,
  buildMarkdownSummary,
  buildSummaryRecords,
  type CrossProviderComparisonRecord,
  type RunRecord,
  type StepRecord,
  type StudyConfig,
} from "./study.ts";
import {
  estimateCostUsd,
  loadPriceBook,
  renderTextBarChart,
  roundNumber,
  standardDeviation,
  totalTokens,
  writeCsv,
  writeHtmlDashboard,
  type DashboardDatum,
  type TokenUsage,
} from "./metrics.ts";

loadDotEnv();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotPayload {
  system: string;
  prompt: string;
  response: string;
  usage: TokenUsage;
  durationMs: number;
}

interface ParsedSnapshotName {
  config: string;
  runId: number;
  stepNumber: number;
  role: "flagship" | "gate" | "judge";
  attempt: number;
}

interface StepAccumulator {
  config: string;
  runId: number;
  stepNumber: number;
  flagshipPayload?: SnapshotPayload;
  gatePayload?: SnapshotPayload;
  judgeScores: number[];
}

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

/**
 * Parses a snapshot filename like:
 *   baseline-openai-run3-step7-flagship.json
 *   openai-mini-run1-step10-gate.json
 *   anthropic-run2-step4-judge.json
 *   anthropic-run2-step4-judge-2.json
 */
function parseSnapshotFilename(filename: string): ParsedSnapshotName | null {
  const match = filename.match(
    /^(.+?)-run(\d+)-step(\d+)-(flagship|gate|judge(?:-(\d+))?)\.json$/,
  );
  if (!match) return null;
  const [, config, runStr, stepStr, roleRaw, attemptStr] = match;
  return {
    config,
    runId: Number(runStr),
    stepNumber: Number(stepStr),
    role: roleRaw.startsWith("judge") ? "judge" : (roleRaw as "flagship" | "gate"),
    attempt: attemptStr ? Number(attemptStr) : 1,
  };
}

// ---------------------------------------------------------------------------
// Judge score extraction (mirrors parseJudgeScore in study.ts)
// ---------------------------------------------------------------------------

function extractJudgeScore(text: string): number | null {
  const trimmed = text.trim();

  // Strip fenced code block if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonStr = fenced?.[1]?.trim() ?? trimmed;

  // Try JSON object with "score" key
  try {
    const first = jsonStr.indexOf("{");
    const last = jsonStr.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const obj = JSON.parse(jsonStr.slice(first, last + 1)) as { score?: unknown };
      if (typeof obj.score === "number") {
        return Math.min(10, Math.max(0, obj.score));
      }
    }
  } catch {
    // fall through
  }

  // Try N/10 format
  const fracMatch = trimmed.match(/\b(10|[0-9](?:\.\d+)?)\s*\/\s*10\b/);
  if (fracMatch) return Math.min(10, Math.max(0, Number(fracMatch[1])));

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function timestampFolderName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ---------------------------------------------------------------------------
// Core replay logic
// ---------------------------------------------------------------------------

async function replayStudy(options: {
  snapshotDir: string;
  outputFolder: string;
  configPath: string;
}): Promise<void> {
  const { snapshotDir, outputFolder, configPath } = options;

  console.log(`Reading snapshots from: ${snapshotDir}`);

  // Load config.json for provider/model/mode metadata and task titles
  const configRaw = JSON.parse(await Bun.file(configPath).text()) as {
    configs: StudyConfig[];
    tasks?: Array<{ number: number; title: string }>;
  };
  const configsByName = new Map<string, StudyConfig>(
    configRaw.configs.map((c) => [c.name, c]),
  );
  const taskTitles = new Map<number, string>(
    (configRaw.tasks ?? []).map((t) => [t.number, t.title]),
  );
  const priceBook = await loadPriceBook(configPath);

  // Read and parse all snapshot files
  const files = (await readdir(snapshotDir)).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} snapshot files.`);

  const accMap = new Map<string, StepAccumulator>();

  for (const file of files) {
    const parsed = parseSnapshotFilename(file);
    if (!parsed) continue;

    const key = `${parsed.config}|${parsed.runId}|${parsed.stepNumber}`;
    const acc = accMap.get(key) ?? {
      config: parsed.config,
      runId: parsed.runId,
      stepNumber: parsed.stepNumber,
      judgeScores: [],
    };

    const payload = JSON.parse(
      await Bun.file(join(snapshotDir, file)).text(),
    ) as SnapshotPayload;

    if (parsed.role === "flagship") {
      acc.flagshipPayload = payload;
    } else if (parsed.role === "gate") {
      acc.gatePayload = payload;
    } else if (parsed.role === "judge") {
      const score = extractJudgeScore(payload.response);
      if (score !== null) acc.judgeScores.push(score);
    }

    accMap.set(key, acc);
  }

  console.log(`Parsed ${accMap.size} unique (config, run, step) combinations.`);

  // Build StepRecords
  const stepRecords: StepRecord[] = [];
  let skipped = 0;

  for (const acc of accMap.values()) {
    const cfg = configsByName.get(acc.config);
    if (!cfg) {
      skipped += 1;
      continue;
    }
    if (!acc.flagshipPayload) {
      skipped += 1;
      continue;
    }

    const judgeScore =
      acc.judgeScores.length > 0 ? roundNumber(average(acc.judgeScores), 2) : 0;
    const judgeStddev =
      acc.judgeScores.length > 1
        ? roundNumber(standardDeviation(acc.judgeScores), 4)
        : acc.judgeScores.length === 1
          ? 0
          : null;

    const stepTitle = taskTitles.get(acc.stepNumber) ?? `Step ${acc.stepNumber}`;
    const flagshipUsage = acc.flagshipPayload.usage;
    const flagshipCost = estimateCostUsd(
      cfg.provider,
      cfg.flagshipModel,
      flagshipUsage,
      priceBook,
    );

    stepRecords.push({
      config: acc.config,
      runId: acc.runId,
      step: acc.stepNumber,
      stepNumber: acc.stepNumber,
      stepTitle,
      modelRole: "flagship",
      provider: cfg.provider,
      requestedModel: cfg.flagshipModel,
      actualMode: "live",
      inputTokens: flagshipUsage.inputTokens,
      outputTokens: flagshipUsage.outputTokens,
      totalTokens: totalTokens(flagshipUsage),
      cost: flagshipCost,
      estimatedCostUsd: flagshipCost,
      invariantCount: 0,
      missingInvariants: 0,
      contradictions: 0,
      driftScore: 0,
      durationMs: acc.flagshipPayload.durationMs,
      qualityScore: judgeScore,
      judgeScoreStddev: judgeStddev,
      testsPassed: null,
      success: judgeScore >= 7,
    });

    if (cfg.mode === "cascade" && acc.gatePayload && cfg.gateModel) {
      const gateUsage = acc.gatePayload.usage;
      const gateCost = estimateCostUsd(
        cfg.provider,
        cfg.gateModel,
        gateUsage,
        priceBook,
      );
      stepRecords.push({
        config: acc.config,
        runId: acc.runId,
        step: acc.stepNumber,
        stepNumber: acc.stepNumber,
        stepTitle: `${stepTitle} (gate)`,
        modelRole: "gate",
        provider: cfg.provider,
        requestedModel: cfg.gateModel,
        actualMode: "live",
        inputTokens: gateUsage.inputTokens,
        outputTokens: gateUsage.outputTokens,
        totalTokens: totalTokens(gateUsage),
        cost: gateCost,
        estimatedCostUsd: gateCost,
        invariantCount: 0,
        missingInvariants: 0,
        contradictions: 0,
        driftScore: 0,
        durationMs: acc.gatePayload.durationMs,
        qualityScore: judgeScore,
        judgeScoreStddev: judgeStddev,
        testsPassed: null,
        success: true,
      });
    }
  }

  if (skipped > 0) {
    console.warn(
      `Skipped ${skipped} step(s) — no flagship snapshot or unknown config name.`,
    );
  }
  console.log(`Built ${stepRecords.length} step records.`);

  // Build RunRecords by aggregating step records per (config, runId)
  const runGroupMap = new Map<string, StepRecord[]>();
  for (const sr of stepRecords) {
    const k = `${sr.config}|${sr.runId}`;
    const g = runGroupMap.get(k) ?? [];
    g.push(sr);
    runGroupMap.set(k, g);
  }

  const runRecords: RunRecord[] = [];
  for (const [key, steps] of runGroupMap) {
    const [configName, runIdStr] = key.split("|");
    const cfg = configsByName.get(configName);
    if (!cfg) continue;

    const totalInputTokens = steps.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = steps.reduce((s, r) => s + r.outputTokens, 0);
    const totalCostUsd = steps.reduce((s, r) => s + r.estimatedCostUsd, 0);
    const flagshipSteps = steps.filter((s) => s.modelRole === "flagship");

    runRecords.push({
      config: configName,
      runId: Number(runIdStr),
      provider: cfg.provider,
      mode: cfg.mode,
      flagshipModel: cfg.flagshipModel,
      gateModel: cfg.gateModel,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 100_000_000) / 100_000_000,
      meanInvariantCount: 0,
      totalMissingInvariants: 0,
      totalContradictions: 0,
      totalDriftScore: 0,
      meanDriftScore: 0,
      meanQualityScore:
        Math.round(average(flagshipSteps.map((s) => s.qualityScore)) * 100) / 100,
      testsPassed: null,
      usedMockClients: false,
    });
  }

  console.log(
    `Built ${runRecords.length} run records across ${new Set(runRecords.map((r) => r.config)).size} configs.`,
  );

  // Write artifacts
  await mkdir(outputFolder, { recursive: true });

  const summaryRecords = buildSummaryRecords(runRecords, stepRecords);
  const crossProviderComparisons = buildCrossProviderComparisons(summaryRecords);
  const dashboardCurveData = buildDashboardCurveData(stepRecords);

  const summaryArtifact = {
    dataSource: "live",
    configs: summaryRecords,
    ...(crossProviderComparisons.length > 0
      ? { cross_provider_comparisons: crossProviderComparisons }
      : {}),
  };

  const dashboardData: DashboardDatum[] = summaryRecords.map((row) => ({
    label: String(row.config),
    runs: Number(row.runs),
    meanCostUsd: Number(row.mean_cost_usd),
    meanTokens: Number(row.mean_tokens),
    meanQuality: Number(row.mean_quality),
    meanDriftScore: Number(row.mean_drift_score),
    costSavingsVsBaselinePct:
      row.cost_savings_vs_baseline_pct === null
        ? null
        : Number(row.cost_savings_vs_baseline_pct),
    tokenSavingsVsBaselinePct:
      row.token_savings_vs_baseline_pct === null
        ? null
        : Number(row.token_savings_vs_baseline_pct),
    pValueCost: row.pValue_cost === null ? null : Number(row.pValue_cost),
    pValueTokens: row.pValue_tokens === null ? null : Number(row.pValue_tokens),
    pValueQuality: row.pValue_quality === null ? null : Number(row.pValue_quality),
    cohensDCost: row.cohensD_cost === null ? null : Number(row.cohensD_cost),
    ci95CostLower:
      row.ci95_cost_lower === null ? null : Number(row.ci95_cost_lower),
    ci95CostUpper:
      row.ci95_cost_upper === null ? null : Number(row.ci95_cost_upper),
  }));

  await Promise.all([
    writeCsv(
      join(outputFolder, "steps.csv"),
      stepRecords as unknown as Array<Record<string, unknown>>,
    ),
    writeCsv(
      join(outputFolder, "runs.csv"),
      runRecords as unknown as Array<Record<string, unknown>>,
    ),
    Bun.write(
      join(outputFolder, "summary.json"),
      JSON.stringify(summaryArtifact, null, 2),
    ),
    writeHtmlDashboard(
      join(outputFolder, "dashboard.html"),
      "live",
      dashboardData,
      dashboardCurveData,
    ),
    Bun.write(
      join(outputFolder, "report.md"),
      buildMarkdownSummary(
        summaryRecords,
        crossProviderComparisons,
        outputFolder,
        { passed: null, output: "(tests not run during replay)" },
        "live",
      ),
    ),
  ]);

  console.log(`\nArtifacts written to ${outputFolder}`);
  console.log("");
  console.log("Mean cost");
  console.log(renderTextBarChart(dashboardData, "meanCostUsd"));
  console.log("");
  console.log("Mean quality");
  console.log(renderTextBarChart(dashboardData, "meanQuality"));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name("replay")
  .description(
    "Regenerate study artifacts from an existing snapshots/ directory without API calls.",
  )
  .requiredOption(
    "--input <folder>",
    "Path to an experiment folder containing a snapshots/ subdirectory.",
  )
  .option(
    "--output-dir <path>",
    "Root folder for output artifacts. Defaults to a new timestamped folder inside experiments/.",
  )
  .option(
    "--config-path <path>",
    "Path to config.json. Defaults to ./config.json.",
    "config.json",
  )
  .action(async (opts) => {
    const inputFolder = resolve(opts.input);
    const snapshotDir = join(inputFolder, "snapshots");
    const configPath = resolve(opts.configPath);

    const outputRoot = opts.outputDir
      ? resolve(opts.outputDir)
      : resolve("experiments");
    const outputFolder = join(outputRoot, `replay-${timestampFolderName()}`);

    await replayStudy({ snapshotDir, outputFolder, configPath });
  });

program.parseAsync(Bun.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
