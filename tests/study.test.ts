import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStudy } from "../src/study.ts";
import type { ModelClient } from "../src/models.ts";

describe("study runner", () => {
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

  test("supports LLM judge scoring with an optional judge model in dry-run mode", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-judge-"));
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(String(args[0] ?? "")); originalWarn(...args); };

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

      // No fallback warnings: the mock judge must have returned parseable JSON for every task.
      expect(warnings.filter((w) => w.includes("falling back to heuristic scoring"))).toHaveLength(0);

      const stepsCsv = await Bun.file(join(result.outputFolder, "steps.csv")).text();
      expect(stepsCsv).toContain("qualityScore");
    } finally {
      console.warn = originalWarn;
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("falls back to heuristic scoring when judge output is empty", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-judge-fallback-"));
    const originalWarn = console.warn;
    const warnings: string[] = [];

    console.warn = (message?: unknown) => {
      warnings.push(String(message ?? ""));
    };

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
      expect(warnings.some((warning) => warning.includes("falling back to heuristic scoring"))).toBe(true);
    } finally {
      console.warn = originalWarn;
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);

  test("stops early when the cumulative estimated cost exceeds the configured cap", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-cost-cap-"));
    const originalWarn = console.warn;
    const warnings: string[] = [];

    console.warn = (message?: unknown) => {
      warnings.push(String(message ?? ""));
    };

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
      expect(result.runRecords).toHaveLength(1);
      expect(result.stepRecords).toHaveLength(10);
      expect(result.summaryRecords).toHaveLength(1);
      expect(result.runRecords[0]?.totalCostUsd).toBeGreaterThan(0);
      expect(warnings.some((warning) => warning.includes("Cost cap of $0.0000 already exceeded"))).toBe(true);

      const summaryJson = JSON.parse(await Bun.file(join(result.outputFolder, "summary.json")).text()) as {
        dataSource?: string;
        configs?: Array<Record<string, unknown>>;
      };
      const report = await Bun.file(join(result.outputFolder, "report.md")).text();

      expect(summaryJson.dataSource).toBe("mock");
      expect(summaryJson.configs).toHaveLength(1);
      expect(summaryJson.configs?.[0]?.config).toBe("baseline-openai");
      expect(report).toContain("Data source: mock clients");
      expect(report).toContain("Configuration Summary");
    } finally {
      console.warn = originalWarn;
      await rm(outputDir, { recursive: true, force: true });
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
});
