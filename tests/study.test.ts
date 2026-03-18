import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildDashboardCurveData, main, runStudy } from "../src/study.ts";
import type { ModelClient } from "../src/models.ts";

async function writeConfigFixture(config: Record<string, unknown>): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "razorcascade-study-config-"));
  const path = join(dir, "config.json");
  await Bun.write(path, JSON.stringify(config, null, 2));
  return { dir, path };
}

describe("study runner", () => {
  test("builds dashboard curve data from actual step numbers", () => {
    const curveData = buildDashboardCurveData([
      {
        config: "baseline-openai",
        runId: 1,
        step: 1,
        stepNumber: 1,
        stepTitle: "CLI skeleton + argument parsing",
        modelRole: "flagship",
        provider: "openai",
        requestedModel: "gpt-5.4",
        actualMode: "mock",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cost: 0.1,
        estimatedCostUsd: 0.1,
        invariantCount: 1,
        missingInvariants: 0,
        contradictions: 0,
        driftScore: 0,
        durationMs: 10,
        qualityScore: 9,
        judgeScoreStddev: null,
        testsPassed: null,
        success: true,
      },
      {
        config: "baseline-openai",
        runId: 2,
        step: 10,
        stepNumber: 10,
        stepTitle: "Report export",
        modelRole: "flagship",
        provider: "openai",
        requestedModel: "gpt-5.4",
        actualMode: "mock",
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25,
        cost: 0.2,
        estimatedCostUsd: 0.2,
        invariantCount: 1,
        missingInvariants: 0,
        contradictions: 0,
        driftScore: 0,
        durationMs: 12,
        qualityScore: 9,
        judgeScoreStddev: null,
        testsPassed: null,
        success: true,
      },
    ]);

    expect(curveData).toHaveLength(2);
    expect(curveData.map((datum) => datum.stepNumber)).toEqual([1, 10]);
    expect(curveData.every((datum) => datum.label === "baseline-openai")).toBe(true);
  });

  test("executes baseline aliases and explicit provider baselines in dry-run mode", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-"));

    try {
      const aliasResult = await runStudy({
        configName: "baseline",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });
      const geminiBaselineResult = await runStudy({
        configName: "baseline-gemini",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(aliasResult.runRecords.length).toBe(1);
      expect(aliasResult.summaryRecords.length).toBe(1);
      expect(String(aliasResult.summaryRecords[0]?.config)).toBe("baseline-openai");
      expect(aliasResult.stepRecords[0]?.step).toBe(1);
      expect(aliasResult.stepRecords[0]?.cost).toBeGreaterThan(0);
      expect(aliasResult.stepRecords[0]?.driftScore).toBe(0);
      expect(aliasResult.stepRecords.some((step) => step.invariantCount > 0)).toBe(true);

      expect(geminiBaselineResult.runRecords.length).toBe(1);
      expect(geminiBaselineResult.summaryRecords.length).toBe(1);
      expect(String(geminiBaselineResult.summaryRecords[0]?.config)).toBe("baseline-gemini");
      expect(Number(aliasResult.summaryRecords[0]?.mean_cost_usd)).toBeGreaterThan(0);
      expect(Number(aliasResult.summaryRecords[0]?.mean_drift_score)).toBe(0);
      expect(Number(geminiBaselineResult.summaryRecords[0]?.mean_cost_usd)).toBeGreaterThan(0);

      expect(await Bun.file(join(aliasResult.outputFolder, "steps.csv")).exists()).toBe(true);
      expect(await Bun.file(join(geminiBaselineResult.outputFolder, "dashboard.html")).exists()).toBe(true);
      const stepsCsv = await Bun.file(join(aliasResult.outputFolder, "steps.csv")).text();
      const dashboardHtml = await Bun.file(join(geminiBaselineResult.outputFolder, "dashboard.html")).text();
      const header = stepsCsv.split(/\r?\n/, 1)[0] ?? "";
      expect(header).toContain("step");
      expect(header).toContain("cost");
      expect(header).toContain("driftScore");
      expect(header).toContain("missingInvariants");
      expect(header).toContain("contradictions");
      expect(dashboardHtml).toContain("Mock Data");
      expect(dashboardHtml).toContain("Iteration Drift Curve");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("routes every configured study through --all in dry-run mode", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-all-"));

    try {
      const result = await runStudy({
        all: true,
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.runRecords).toHaveLength(9);
      expect(result.summaryRecords).toHaveLength(9);
      expect(result.summaryRecords.map((row) => row.config)).toEqual([
        "baseline-openai",
        "openai-mini",
        "openai-nano",
        "baseline-anthropic",
        "anthropic",
        "baseline-grok",
        "grok",
        "baseline-gemini",
        "gemini",
      ]);
      expect(result.summaryRecords.every((row) => row.runs === 1)).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("supports --configs style matched-pair runs in one output folder", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-pair-"));

    try {
      const result = await runStudy({
        configNames: ["baseline-openai", "openai-mini"],
        runs: 2,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.runRecords.length).toBe(4);
      expect(result.summaryRecords.length).toBe(2);

      const baseline = result.summaryRecords.find((row) => row.config === "baseline-openai");
      const cascade = result.summaryRecords.find((row) => row.config === "openai-mini");

      expect(Number(baseline?.cost_savings_vs_baseline_pct)).toBe(0);
      expect(cascade?.cost_savings_vs_baseline_pct).not.toBeNull();
      expect(cascade?.token_savings_vs_baseline_pct).not.toBeNull();
      expect(Number(cascade?.mean_drift_score)).toBeGreaterThanOrEqual(0);

      expect(Object.hasOwn(cascade ?? {}, "pValue_cost")).toBe(true);
      expect(Object.hasOwn(cascade ?? {}, "pValue_tokens")).toBe(true);
      expect(Object.hasOwn(cascade ?? {}, "pValue_quality")).toBe(true);
      expect(Object.hasOwn(cascade ?? {}, "cohensD_cost")).toBe(true);
      expect(typeof cascade?.ci95_cost_lower).toBe("number");
      expect(typeof cascade?.ci95_cost_upper).toBe("number");
      expect(Number(cascade?.ci95_cost_lower)).toBeLessThanOrEqual(Number(cascade?.ci95_cost_upper));

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        dataSource?: string;
        configs?: Array<Record<string, unknown>>;
        cross_provider_comparisons?: Array<Record<string, unknown>>;
      };
      const report = await Bun.file(join(result.outputFolder, "report.md")).text();
      const serializedCascade = summaryJson.configs?.find((row) => row.config === "openai-mini");

      expect(summaryJson.dataSource).toBe("mock");
      expect(summaryJson.cross_provider_comparisons).toBeUndefined();
      expect(Object.hasOwn(serializedCascade ?? {}, "pValue_cost")).toBe(true);
      expect(report).toContain("Data source: mock clients");
      expect(report).toContain("Cost p-value");
      expect(report).toContain("Cohen's d (Cost)");
      expect(report).not.toContain("## Cross-Provider Comparisons");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("supports ad hoc cascade mode with an explicit anthropic provider", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-adhoc-"));

    try {
      const result = await runStudy({
        mode: "cascade",
        provider: "anthropic",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.runRecords).toHaveLength(1);
      expect(result.summaryRecords).toHaveLength(1);
      expect(result.summaryRecords[0]?.config).toBe("adhoc");
      expect(result.summaryRecords[0]?.provider).toBe("anthropic");
      expect(result.summaryRecords[0]?.mode).toBe("cascade");
      expect(result.runRecords[0]?.usedMockClients).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("adds cross-provider comparisons when multiple providers are present", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cross-provider-"));

    try {
      const result = await runStudy({
        configNames: ["openai-mini", "anthropic", "gemini"],
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.runRecords.length).toBe(3);
      expect(result.summaryRecords.length).toBe(3);
      expect(result.crossProviderComparisons).toHaveLength(3);

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        dataSource?: string;
        configs?: Array<Record<string, unknown>>;
        cross_provider_comparisons?: Array<Record<string, unknown>>;
      };
      const report = await Bun.file(join(result.outputFolder, "report.md")).text();
      const comparison = summaryJson.cross_provider_comparisons?.find(
        (row) => row.config_a === "openai-mini" && row.config_b === "anthropic",
      );

      expect(summaryJson.dataSource).toBe("mock");
      expect(summaryJson.cross_provider_comparisons).toHaveLength(3);
      expect(comparison?.provider_a).toBe("openai");
      expect(comparison?.mode_a).toBe("cascade");
      expect(comparison?.provider_b).toBe("anthropic");
      expect(comparison?.mode_b).toBe("cascade");
      expect(typeof comparison?.cost_ratio_a_to_b).toBe("number");
      expect(typeof comparison?.token_ratio_a_to_b).toBe("number");
      expect(typeof comparison?.quality_delta_a_minus_b).toBe("number");

      expect(report).toContain("## Cross-Provider Comparisons");
      expect(report).toContain("Cost Ratio (A/B)");
      expect(report).toContain("Quality Delta (A-B)");
      expect(report).toContain("openai-mini (openai, cascade)");
      expect(report).toContain("anthropic (anthropic, cascade)");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("omits cross-provider comparisons when only one provider is present", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cross-provider-single-"));

    try {
      const result = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.crossProviderComparisons).toHaveLength(0);

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        cross_provider_comparisons?: Array<Record<string, unknown>>;
      };

      expect(summaryJson.cross_provider_comparisons).toBeUndefined();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("creates every pairwise cross-provider comparison across four providers", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cross-provider-four-"));

    try {
      const result = await runStudy({
        configNames: [
          "baseline-openai",
          "baseline-anthropic",
          "baseline-grok",
          "baseline-gemini",
        ],
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.crossProviderComparisons).toHaveLength(6);

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        cross_provider_comparisons?: Array<Record<string, unknown>>;
      };

      expect(summaryJson.cross_provider_comparisons).toHaveLength(6);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("supports LLM judge scoring with an optional judge model in dry-run mode", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-judge-"));

    try {
      const result = await runStudy({
        configName: "openai-mini",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
        judge: true,
        judgeModel: "gpt-5-nano",
      });

      expect(result.runRecords.length).toBe(1);
      expect(result.stepRecords.filter((step) => step.modelRole === "flagship")).toHaveLength(10);
      expect(result.stepRecords.every((step) => step.qualityScore >= 0 && step.qualityScore <= 10)).toBe(true);
      expect(result.runRecords[0]?.meanQualityScore).toBeGreaterThan(0);
      expect(result.runRecords[0]?.usedMockClients).toBe(true);

      const stepsCsv = await Bun.file(join(result.outputFolder, "steps.csv")).text();
      expect(stepsCsv).toContain("qualityScore");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("falls back to heuristic scoring when judge output is empty", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-judge-fallback-"));

    try {
      const emptyJudge: ModelClient = {
        provider: "openai",
        model: "gpt-5-nano",
        mode: "mock",
        async generateText() {
          return {
            text: "",
            usage: {
              inputTokens: 1,
              outputTokens: 0,
            },
          };
        },
      };

      const result = await runStudy({
        configName: "openai-mini",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
        judge: true,
        judgeClient: emptyJudge,
      });

      expect(result.runRecords.length).toBe(1);
      expect(result.runRecords[0]?.meanQualityScore).toBeGreaterThan(0);
      expect(result.stepRecords[0]?.judgeScoreStddev).toBeNull();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("stops before any run when the cost cap is exactly zero", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-"));

    try {
      const result = await runStudy({
        configName: "baseline-openai",
        runs: 3,
        costCap: 0,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.costCapReached).toBe(true);
      expect(result.runRecords).toHaveLength(0);
      expect(result.stepRecords).toHaveLength(0);
      expect(result.summaryRecords).toHaveLength(0);

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        dataSource?: string;
        configs?: Array<Record<string, unknown>>;
      };
      const report = await Bun.file(join(result.outputFolder, "report.md")).text();

      expect(summaryJson.dataSource).toBe("mock");
      expect(summaryJson.configs).toHaveLength(0);
      expect(report).toContain("No cascade configurations were present in this run.");
      expect(report).toContain("Data source: mock clients");
      expect(report).toContain("Configuration Summary");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("stops after the first run when a tiny positive cap is exceeded", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-positive-"));

    try {
      const result = await runStudy({
        configName: "baseline-openai",
        runs: 2,
        costCap: 0.000001,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.costCapReached).toBe(true);
      expect(result.runRecords).toHaveLength(1);
      expect(result.stepRecords).toHaveLength(10);
      expect(result.summaryRecords).toHaveLength(1);
      expect(result.runRecords[0]?.totalCostUsd).toBeGreaterThan(0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("stops mid-study once the next config run would exceed the cap", async () => {
    const baselineMeasureDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-measure-baseline-"));
    const miniMeasureDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-measure-mini-"));
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-mid-"));

    try {
      const baselineMeasure = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir: baselineMeasureDir,
        dryRun: true,
        skipTests: true,
      });
      const miniMeasure = await runStudy({
        configName: "openai-mini",
        runs: 1,
        outputDir: miniMeasureDir,
        dryRun: true,
        skipTests: true,
      });
      const baselineCost = Number(baselineMeasure.runRecords[0]?.totalCostUsd ?? 0);
      const miniCost = Number(miniMeasure.runRecords[0]?.totalCostUsd ?? 0);
      const cap = baselineCost * 3 + miniCost / 2;

      const result = await runStudy({
        configNames: ["baseline-openai", "openai-mini"],
        runs: 3,
        costCap: cap,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.costCapReached).toBe(true);
      expect(result.runRecords).toHaveLength(4);
      expect(result.runRecords.map((run) => run.config)).toEqual([
        "baseline-openai",
        "baseline-openai",
        "baseline-openai",
        "openai-mini",
      ]);
      expect(result.summaryRecords).toHaveLength(2);
    } finally {
      await rm(baselineMeasureDir, { recursive: true, force: true });
      await rm(miniMeasureDir, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("supports configurable tasks, scoring, human baselines, and richer summary fields", async () => {
    const baseFixture = await writeConfigFixture({
      defaultRuns: 1,
      outputDir: "experiments",
      configs: [
        {
          name: "baseline-openai",
          description: "Fixture baseline.",
          mode: "baseline",
          provider: "openai",
          flagshipModel: "gpt-5.4",
        },
      ],
      tasks: [
        {
          number: 1,
          title: "Custom storage task",
          objective: "Discuss JSON persistence and storage layout.",
          keywords: ["storage", "json", "persistence"],
        },
        {
          number: 2,
          title: "Custom reporting task",
          objective: "Discuss markdown and HTML export.",
          keywords: ["report", "markdown", "html"],
        },
      ],
      humanBaselineScores: [2, 8],
    });
    const customFixture = await writeConfigFixture({
      defaultRuns: 1,
      outputDir: "experiments",
      configs: [
        {
          name: "baseline-openai",
          description: "Fixture baseline.",
          mode: "baseline",
          provider: "openai",
          flagshipModel: "gpt-5.4",
        },
      ],
      tasks: [
        {
          number: 1,
          title: "Custom storage task",
          objective: "Discuss JSON persistence and storage layout.",
          keywords: ["storage", "json", "persistence"],
        },
        {
          number: 2,
          title: "Custom reporting task",
          objective: "Discuss markdown and HTML export.",
          keywords: ["report", "markdown", "html"],
        },
      ],
      scoring: {
        baseScore: 8,
        keywordWeight: 3.5,
        structureWeight: 1,
        lengthThreshold: 1,
        lengthBonus: 0,
        testBonus: 0,
      },
      humanBaselineScores: [2, 8],
    });
    const baselineOutputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-config-baseline-"));
    const customOutputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-config-custom-"));

    try {
      const baselineResult = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir: baselineOutputDir,
        configPath: baseFixture.path,
        dryRun: true,
        skipTests: true,
      });
      const customResult = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir: customOutputDir,
        configPath: customFixture.path,
        dryRun: true,
        skipTests: true,
      });

      expect(baselineResult.stepRecords).toHaveLength(2);
      expect(customResult.stepRecords).toHaveLength(2);
      expect(customResult.summaryRecords[0]?.mean_quality).not.toBe(baselineResult.summaryRecords[0]?.mean_quality);
      expect(customResult.summaryRecords[0]?.qualityCorrelationWithHuman).not.toBeNull();
      expect(typeof customResult.summaryRecords[0]?.qualityCorrelationWithHuman).toBe("number");
      expect(typeof customResult.summaryRecords[0]?.ci95_tokens_lower).toBe("number");
      expect(typeof customResult.summaryRecords[0]?.ci95_quality_lower).toBe("number");
      expect(Object.hasOwn(customResult.summaryRecords[0] ?? {}, "pValue_cost_corrected")).toBe(true);
      expect(Object.hasOwn(customResult.summaryRecords[0] ?? {}, "pValue_cost_mannwhitney")).toBe(true);
      expect(Object.hasOwn(customResult.summaryRecords[0] ?? {}, "cohensD_tokens")).toBe(true);
      expect(Object.hasOwn(customResult.summaryRecords[0] ?? {}, "cohensD_quality")).toBe(true);
      expect(Object.hasOwn(customResult.summaryRecords[0] ?? {}, "mean_judge_agreement")).toBe(true);

      const summaryJson = JSON.parse(await Bun.file(join(customResult.outputFolder, "summary.json")).text()) as {
        configs?: Array<Record<string, unknown>>;
      };
      const report = await Bun.file(join(customResult.outputFolder, "report.md")).text();

      expect(summaryJson.configs?.[0]?.qualityCorrelationWithHuman).not.toBeNull();
      expect(report).toContain("## Key Findings");
      expect(report).toContain("## Methodology Note");
      expect(report).toContain("Cost p adj");
      expect(report).toContain("Cohen's d (Quality)");
    } finally {
      await rm(baseFixture.dir, { recursive: true, force: true });
      await rm(customFixture.dir, { recursive: true, force: true });
      await rm(baselineOutputDir, { recursive: true, force: true });
      await rm(customOutputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("repeats judge scoring and records judge score variability", async () => {
    const fixture = await writeConfigFixture({
      defaultRuns: 1,
      outputDir: "experiments",
      configs: [
        {
          name: "baseline-openai",
          description: "Fixture baseline.",
          mode: "baseline",
          provider: "openai",
          flagshipModel: "gpt-5.4",
        },
      ],
      tasks: [
        {
          number: 1,
          title: "Judge repeat task",
          objective: "Produce a compact implementation note.",
          keywords: ["goal", "validation", "risk"],
        },
      ],
    });
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-judge-repeat-"));

    const judgeClient: ModelClient = {
      provider: "openai",
      model: "gpt-5-nano",
      mode: "mock",
      async generateText(request) {
        const attempt = Number(request.metadata?.attempt ?? "1");
        const score = attempt === 1 ? 1 : 9;
        return {
          text: JSON.stringify({ score }),
          usage: {
            inputTokens: 1,
            outputTokens: 1,
          },
        };
      },
    };

    try {
      const result = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir,
        configPath: fixture.path,
        dryRun: true,
        skipTests: true,
        judge: true,
        judgeClient,
        judgeRepeat: 2,
      });

      expect(result.stepRecords).toHaveLength(1);
      expect(result.stepRecords[0]?.qualityScore).toBe(5);
      expect(result.stepRecords[0]?.judgeScoreStddev).toBeGreaterThan(1.5);
      expect(result.summaryRecords[0]?.mean_judge_agreement).not.toBeNull();
      expect(Number(result.summaryRecords[0]?.mean_judge_agreement)).toBeLessThan(1);
    } finally {
      await rm(fixture.dir, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("falls back to heuristic scoring when judge output is malformed or unavailable", async () => {
    const fixture = await writeConfigFixture({
      defaultRuns: 1,
      outputDir: "experiments",
      configs: [
        {
          name: "baseline-openai",
          description: "Fixture baseline.",
          mode: "baseline",
          provider: "openai",
          flagshipModel: "gpt-5.4",
        },
      ],
      tasks: [
        {
          number: 1,
          title: "Judge fallback task",
          objective: "Provide a succinct implementation update.",
          keywords: ["goal", "validation", "risk"],
        },
      ],
    });
    const cases: Array<{
      name: string;
      client: ModelClient;
      expectScore?: number;
    }> = [
      {
        name: "invalid JSON",
        client: {
          provider: "openai",
          model: "gpt-5-nano",
          mode: "mock",
          async generateText() {
            return {
              text: "not json",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        },
      },
      {
        name: "out-of-range JSON",
        client: {
          provider: "openai",
          model: "gpt-5-nano",
          mode: "mock",
          async generateText() {
            return {
              text: JSON.stringify({ score: 15 }),
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        },
      },
      {
        name: "network error",
        client: {
          provider: "openai",
          model: "gpt-5-nano",
          mode: "mock",
          async generateText() {
            throw new Error("network down");
          },
        },
      },
      {
        name: "rubric sub-category sum",
        client: {
          provider: "openai",
          model: "gpt-5-nano",
          mode: "mock",
          async generateText() {
            return {
              text: JSON.stringify({
                completeness: 3,
                correctness: 3,
                clarity: 2,
                architecture: 2,
              }),
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        },
        expectScore: 10,
      },
    ];

    try {
      for (const testCase of cases) {
        const outputDir = await mkdtemp(join(tmpdir(), `razorcascade-study-judge-fallback-${testCase.name.replace(/\s+/g, "-")}-`));

        try {
          const result = await runStudy({
            configName: "baseline-openai",
            runs: 1,
            outputDir,
            configPath: fixture.path,
            dryRun: true,
            skipTests: true,
            judge: true,
            judgeClient: testCase.client,
          });

          expect(result.runRecords).toHaveLength(1);
          expect(result.stepRecords).toHaveLength(1);
          if (typeof testCase.expectScore === "number") {
            expect(result.runRecords[0]?.meanQualityScore).toBe(testCase.expectScore);
            expect(result.stepRecords[0]?.judgeScoreStddev).toBe(0);
          } else {
            expect(result.runRecords[0]?.meanQualityScore).toBeGreaterThan(0);
            expect(result.stepRecords[0]?.judgeScoreStddev).toBeNull();
          }
        } finally {
          await rm(outputDir, { recursive: true, force: true });
        }
      }
    } finally {
      await rm(fixture.dir, { recursive: true, force: true });
    }
  }, 30000);

  test("writes prompt and response snapshots only when snapshot mode is enabled", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-snapshots-"));

    try {
      const defaultResult = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });
      const defaultSnapshotFile = Bun.file(
        join(defaultResult.outputFolder, "snapshots", "baseline-openai-run1-step1-flagship.json"),
      );
      expect(await defaultSnapshotFile.exists()).toBe(false);

      const snapshotResult = await runStudy({
        configName: "openai-mini",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
        judge: true,
        judgeModel: "gpt-5-nano",
        snapshot: true,
      });

      const snapshotDir = join(snapshotResult.outputFolder, "snapshots");
      const snapshotFiles = await readdir(snapshotDir);

      expect(snapshotFiles).toHaveLength(30);
      expect(snapshotFiles).toContain("openai-mini-run1-step1-flagship.json");
      expect(snapshotFiles).toContain("openai-mini-run1-step1-gate.json");
      expect(snapshotFiles).toContain("openai-mini-run1-step1-judge.json");

      const flagshipSnapshot = JSON.parse(
        await Bun.file(join(snapshotDir, "openai-mini-run1-step1-flagship.json")).text(),
      ) as {
        system?: string;
        prompt?: string;
        response?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
        durationMs?: number;
      };

      expect(flagshipSnapshot.system).toContain("senior engineer");
      expect(flagshipSnapshot.prompt).toContain("Execution mode: cascade");
      expect(flagshipSnapshot.response).toContain("Implementation note");
      expect(flagshipSnapshot.usage?.inputTokens).toBeGreaterThan(0);
      expect(flagshipSnapshot.usage?.outputTokens).toBeGreaterThan(0);
      expect(flagshipSnapshot.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("writes snapshots with special-character config names into nested directories", async () => {
    const fixture = await writeConfigFixture({
      defaultRuns: 1,
      outputDir: "experiments",
      configs: [
        {
          name: "openai mini π",
          description: "Fixture with a unicode config name.",
          mode: "baseline",
          provider: "openai",
          flagshipModel: "gpt-5.4",
        },
      ],
      tasks: [
        {
          number: 1,
          title: "Snapshot edge task",
          objective: "Produce a compact implementation note.",
          keywords: ["goal", "validation", "risk"],
        },
      ],
    });
    const outputDir = join(
      await mkdtemp(join(tmpdir(), "razorcascade-study-snapshots-nested-")),
      "level-1",
      "level-2",
    );

    try {
      const result = await runStudy({
        configName: "openai mini π",
        runs: 1,
        outputDir,
        configPath: fixture.path,
        dryRun: true,
        skipTests: true,
        judge: true,
        judgeClient: {
          provider: "openai",
          model: "gpt-5-nano",
          mode: "mock",
          async generateText() {
            return {
              text: JSON.stringify({ score: 7 }),
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        },
        snapshot: true,
      });

      const snapshotDir = join(result.outputFolder, "snapshots");
      const snapshotFiles = await readdir(snapshotDir);

      expect(snapshotFiles).toHaveLength(2);
      expect(snapshotFiles).toContain("openai mini π-run1-step1-flagship.json");
      expect(snapshotFiles).toContain("openai mini π-run1-step1-judge.json");

      const flagshipSnapshot = JSON.parse(
        await Bun.file(join(snapshotDir, "openai mini π-run1-step1-flagship.json")).text(),
      ) as {
        system?: string;
        prompt?: string;
        response?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
        durationMs?: number;
      };

      expect(flagshipSnapshot.system).toContain("senior engineer");
      expect(flagshipSnapshot.prompt).toContain("Execution mode: baseline");
      expect(flagshipSnapshot.response).toContain("Implementation note");
      expect(flagshipSnapshot.usage?.inputTokens).toBeGreaterThan(0);
      expect(flagshipSnapshot.usage?.outputTokens).toBeGreaterThan(0);
      expect(flagshipSnapshot.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(fixture.dir, { recursive: true, force: true });
      await rm(dirname(outputDir), { recursive: true, force: true });
    }
  }, 30000);

  test("compares existing experiment folders without re-running the study", async () => {
    const leftOutputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-compare-left-"));
    const rightOutputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-compare-right-"));
    const reportDir = await mkdtemp(join(tmpdir(), "razorcascade-study-compare-report-"));
    const reportPath = join(reportDir, "comparison.md");
    const originalLog = console.log;
    const logs: string[] = [];

    try {
      const baselineResult = await runStudy({
        configName: "baseline-openai",
        runs: 1,
        outputDir: leftOutputDir,
        dryRun: true,
        skipTests: true,
      });
      const pairedResult = await runStudy({
        configNames: ["baseline-openai", "openai-mini"],
        runs: 1,
        outputDir: rightOutputDir,
        dryRun: true,
        skipTests: true,
      });

      console.log = (...args: unknown[]) => {
        logs.push(args.map((value) => String(value)).join(" "));
      };

      await main([
        "bun",
        "study",
        "compare",
        baselineResult.outputFolder,
        pairedResult.outputFolder,
        "--output",
        reportPath,
      ]);

      const stdout = logs.join("\n");
      const writtenReport = await Bun.file(reportPath).text();

      expect(stdout).toContain("# RazorCascade Experiment Comparison");
      expect(stdout).toContain("## Side-by-Side Configuration Metrics");
      expect(stdout).toContain("baseline-openai (openai, baseline)");
      expect(stdout).toContain("openai-mini (openai, cascade)");
      expect(stdout).toContain("Mean Cost (USD)");
      expect(stdout).toContain("Comparison written to");

      expect(writtenReport).toContain("## Experiments");
      expect(writtenReport).toContain(baselineResult.outputFolder);
      expect(writtenReport).toContain(pairedResult.outputFolder);
      expect(writtenReport).toContain("Cost Savings vs Baseline (%)");
      expect(writtenReport).toContain("| openai-mini (openai, cascade) | Runs | n/a | 1 |");
    } finally {
      console.log = originalLog;
      await rm(leftOutputDir, { recursive: true, force: true });
      await rm(rightOutputDir, { recursive: true, force: true });
      await rm(reportDir, { recursive: true, force: true });
    }
  }, 30000);
});
