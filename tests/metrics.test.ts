import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bonferroniCorrect,
  cohensD,
  confidenceInterval,
  estimateCostUsd,
  estimateTokens,
  interpretCohensD,
  interpretPValue,
  loadPriceBook,
  mannWhitneyU,
  minimumSampleSize,
  pearsonCorrelation,
  resolvePricing,
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

  test("loads a configured price book and falls back to defaults for missing providers", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-price-book-"));

    try {
      const configPath = join(outputDir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify(
          {
            priceBook: {
              openai: {
                "gpt-5.4": {
                  inputUsdPerMillion: 99,
                  outputUsdPerMillion: 88,
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const configuredBook = await loadPriceBook(configPath);

      expect(resolvePricing("openai", "gpt-5.4", configuredBook)).toEqual({
        inputUsdPerMillion: 99,
        outputUsdPerMillion: 88,
      });
      expect(resolvePricing("anthropic", "claude-4-sonnet", configuredBook)).toEqual(
        resolvePricing("anthropic", "claude-4-sonnet"),
      );
      expect(
        estimateCostUsd("openai", "gpt-5.4", {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }, configuredBook),
      ).toBe(187);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test("computes descriptive stats", () => {
    const summary = summarizeNumbers([1, 2, 3, 4]);

    expect(summary.mean).toBe(2.5);
    expect(summary.median).toBe(2.5);
    expect(summary.stddev).toBeCloseTo(1.291, 3);
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

  test("escapes csv quotes, commas, and newlines", () => {
    const csv = toCsv([
      {
        config: 'baseline, "openai"',
        notes: "line 1\nline 2",
      },
    ]);

    expect(csv).toContain('"baseline, ""openai"""');
    expect(csv).toContain('"line 1\nline 2"');
  });

  test("weights punctuation and operators when estimating code-heavy text", async () => {
    // @ts-ignore Optional dependency may be absent in local installs.
    const hasTokenizer = await import("gpt-tokenizer").then(() => true).catch(() => false);
    const estimate = estimateTokens("if (count <= 10) return count + 1;");

    if (hasTokenizer) {
      expect(estimate).toBeGreaterThan(0);
    } else {
      expect(estimate).toBe(11);
    }
  });

  test("returns zero for empty or whitespace-only text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n\t  ")).toBe(0);
  });

  test("computes Pearson correlation for aligned and inverse samples", () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(pearsonCorrelation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 6);
  });

  test("computes a minimum sample size from effect size, power, and alpha", () => {
    expect(minimumSampleSize(0.8)).toBeGreaterThanOrEqual(25);
    expect(minimumSampleSize(0.8)).toBeLessThanOrEqual(26);
    expect(minimumSampleSize(1.5)).toBeGreaterThanOrEqual(7);
    expect(minimumSampleSize(1.5)).toBeLessThanOrEqual(8);
  });

  test("applies Bonferroni correction across multiple comparisons", () => {
    expect(bonferroniCorrect([0.01, 0.03, 0.5])).toEqual([0.03, 0.09, 1]);
  });

  test("computes Mann-Whitney U for clearly separated groups", () => {
    const result = mannWhitneyU([1, 2, 3, 4, 5], [10, 11, 12, 13, 14]);

    expect(result.uStatistic).toBe(0);
    expect(result.pValue).toBeLessThan(0.05);
  });

  test("interprets Cohen's d and p-values for dashboard annotations", () => {
    expect(interpretCohensD(0.1)).toBe("negligible");
    expect(interpretCohensD(0.3)).toBe("small");
    expect(interpretCohensD(0.6)).toBe("medium");
    expect(interpretCohensD(1.2)).toBe("large");
    expect(interpretPValue(0.04)).toBe("significant");
    expect(interpretPValue(0.06)).toBe("not significant");
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
      expect(html).toContain("significant");
      expect(html).toContain("large");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
