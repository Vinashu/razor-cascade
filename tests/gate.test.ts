import { describe, expect, test } from "bun:test";

import { heuristicGateSummary, parseGateSummary } from "../src/gate.ts";

describe("gate", () => {
  test("creates a heuristic summary with decisions, risks, and snippets", () => {
    const summary = heuristicGateSummary(
      "Use Bun for runtime and keep JSON persistence in a typed store. Risk: pricing drift.",
      "```ts\nexport const value = 1;\n```",
    );

    expect(summary.goal.length).toBeGreaterThan(10);
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.risks.length).toBeGreaterThan(0);
    expect(summary.snippets.length).toBeGreaterThan(0);
  });

  test("parses JSON output even when fenced", () => {
    const parsed = parseGateSummary("```json\n{\"goal\":\"Ship TaskForge\",\"decisions\":[\"Use Bun\"],\"risks\":[\"Verify pricing\"],\"snippets\":[\"const x = 1;\"]}\n```");

    expect(parsed.goal).toBe("Ship TaskForge");
    expect(parsed.decisions).toContain("Use Bun");
  });
});
