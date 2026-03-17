import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cohensD,
  confidenceInterval,
  estimateCostUsd,
  estimateTokens,
  summarizeNumbers,
  toCsv,
  welchTTest,
  writeHtmlDashboard,
} from "../src/metrics.ts";

describe("metrics", () => {
  test("estimates provider cost using the configured price book", () => {
    const cost = estimateCostUsd("openai", "gpt-5.4", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(cost).toBe(17.5);
  });

  test("computes descriptive stats", () => {
    const summary = summarizeNumbers([1, 2, 3, 4]);

    expect(summary.mean).toBe(2.5);
    expect(summary.median).toBe(2.5);
    expect(summary.stddev).toBeGreaterThan(1);
  });

  test("renders csv rows and token estimates", () => {
    const csv = toCsv([
      { config: "baseline", cost: 1.23 },
      { config: "cascade", cost: 0.72 },
    ]);

    expect(csv).toContain("config,cost");
    expect(csv).toContain("baseline");
    expect(estimateTokens("token budget")).toBeGreaterThan(0);
  });

  test("computes Welch's t-test with a known two-tailed p-value", () => {
    const shiftedMean = 2.266957935527523;
    const result = welchTTest(
      [-1, 0, 1],
      [-1 + shiftedMean, 0 + shiftedMean, 1 + shiftedMean],
    );

    expect(result.tStatistic).toBeCloseTo(-2.7764, 3);
    expect(result.degreesOfFreedom).toBeCloseTo(4, 6);
    expect(result.pValue).toBeCloseTo(0.05, 3);
  });

  test("computes Cohen's d for equal-variance samples", () => {
    expect(cohensD([1, 2, 3], [4, 5, 6])).toBeCloseTo(-3, 6);
  });

  test("computes a 95 percent confidence interval for the sample mean", () => {
    const interval = confidenceInterval([1, 2, 3, 4, 5]);

    expect(interval.lower).toBeCloseTo(1.0368, 3);
    expect(interval.upper).toBeCloseTo(4.9632, 3);
  });

  test("writes a dashboard with zoomed charts and a stable zero-drift panel", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-dashboard-"));

    try {
      const dashboardPath = join(outputDir, "dashboard.html");
      await writeHtmlDashboard(
        dashboardPath,
        "mock",
        [
          {
            label: "baseline-openai",
            runs: 3,
            meanCostUsd: 0.2194,
            meanTokens: 46041,
            meanQuality: 9.9,
            meanDriftScore: 0,
            costSavingsVsBaselinePct: 0,
            tokenSavingsVsBaselinePct: 0,
            pValueCost: null,
            pValueTokens: null,
            pValueQuality: null,
            cohensDCost: null,
            ci95CostLower: 0.2051,
            ci95CostUpper: 0.2337,
          },
          {
            label: "openai-nano",
            runs: 3,
            meanCostUsd: 0.1018,
            meanTokens: 57815,
            meanQuality: 9.71,
            meanDriftScore: 0,
            costSavingsVsBaselinePct: 53.6,
            tokenSavingsVsBaselinePct: -25.57,
            pValueCost: 0.013421,
            pValueTokens: 0.0921,
            pValueQuality: 0.2811,
            cohensDCost: -1.2874,
            ci95CostLower: 0.0942,
            ci95CostUpper: 0.1094,
          },
        ],
        [
          { label: "baseline-openai", stepNumber: 1, meanCostUsd: 0.0088, meanDriftScore: 0 },
          { label: "baseline-openai", stepNumber: 10, meanCostUsd: 0.0329, meanDriftScore: 0 },
          { label: "openai-nano", stepNumber: 1, meanCostUsd: 0.01, meanDriftScore: 0 },
          { label: "openai-nano", stepNumber: 10, meanCostUsd: 0.0113, meanDriftScore: 0 },
        ],
      );

      const html = await Bun.file(dashboardPath).text();
      expect(html).toContain("Mock Data");
      expect(html).toContain("illustrative rather than live-provider measurements");
      expect(html).toContain("Zoomed range:");
      expect(html).toContain("No drift detected across compared iterations.");
      expect(html).toContain("No drift observed across compared configurations.");
      expect(html).toContain("Stable memory");
      expect(html).toContain("Statistical Analysis");
      expect(html).toContain("Cost p-value");
      expect(html).toContain("Cohen's d (cost)");
      expect(html).toContain("statistically significant");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
