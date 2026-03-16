import { describe, expect, test } from "bun:test";

import { estimateCostUsd, estimateTokens, summarizeNumbers, toCsv } from "../src/metrics.ts";

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
});
