import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  estimateCostUsd,
  estimateTokens,
  summarizeNumbers,
  toCsv,
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

  test("writes a dashboard with zoomed charts and a stable zero-drift panel", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-dashboard-"));

    try {
      const dashboardPath = join(outputDir, "dashboard.html");
      await writeHtmlDashboard(
        dashboardPath,
        [
          {
            label: "baseline-openai",
            meanCostUsd: 0.2194,
            meanTokens: 46041,
            meanQuality: 9.9,
            meanDriftScore: 0,
            costSavingsVsBaselinePct: 0,
            tokenSavingsVsBaselinePct: 0,
          },
          {
            label: "openai-nano",
            meanCostUsd: 0.1018,
            meanTokens: 57815,
            meanQuality: 9.71,
            meanDriftScore: 0,
            costSavingsVsBaselinePct: 53.6,
            tokenSavingsVsBaselinePct: -25.57,
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
      expect(html).toContain("Zoomed range:");
      expect(html).toContain("No drift detected across compared iterations.");
      expect(html).toContain("No drift observed across compared configurations.");
      expect(html).toContain("Stable memory");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
