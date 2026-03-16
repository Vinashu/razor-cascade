import { describe, expect, test } from "bun:test";

import { buildDriftReport, detectContradictions } from "../src/contradictions.ts";

describe("contradictions", () => {
  test("flags enum contradictions in summaries", () => {
    const contradictions = detectContradictions(
      "Summary: priority supports urgent and medium.",
      ["priority enum = low|medium|high"],
    );

    expect(contradictions).toContain("priority enum contradiction");
  });

  test("builds drift scores from missing invariants and contradictions", () => {
    const report = buildDriftReport(
      "Goal: keep the task store simple.\nInvariants: priority enum = low|medium|high",
      ["priority enum = low|medium|high", "storage file = .taskforge/tasks.json"],
    );

    expect(report.missingInvariants).toBe(1);
    expect(report.contradictions).toBe(0);
    expect(report.driftScore).toBe(1);
  });
});
