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

  test("flags semantic path contradictions when storage is described in natural language", () => {
    const contradictions = detectContradictions(
      "Summary: task data is stored in tasks.db so the CLI can reload state later.",
      ["storage file = .taskforge/tasks.json"],
    );

    expect(contradictions).toContain("storage file contradiction");
  });

  test("flags enum cardinality drift when the summary claims too many values", () => {
    const contradictions = detectContradictions(
      "Summary: priority has four values: low, medium, and high.",
      ["priority enum = low|medium|high"],
    );

    expect(contradictions).toContain("priority enum contradiction");
  });

  test("reports zero drift when no invariants are supplied", () => {
    const report = buildDriftReport("Goal: keep the task store simple.", []);

    expect(report.missingInvariants).toBe(0);
    expect(report.contradictions).toBe(0);
    expect(report.driftScore).toBe(0);
  });

  test("reports zero drift when all invariants are present", () => {
    const report = buildDriftReport(
      "Goal: keep the task store simple. storage file = .taskforge/tasks.json. priority enum = low|medium|high.",
      ["priority enum = low|medium|high", "storage file = .taskforge/tasks.json"],
    );

    expect(report.missingInvariants).toBe(0);
    expect(report.contradictions).toBe(0);
    expect(report.driftScore).toBe(0);
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
