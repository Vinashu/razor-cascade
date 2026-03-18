import { describe, expect, test } from "bun:test";

import {
  GATE_SYSTEM_PROMPT,
  buildGatePrompt,
  heuristicGateSummary,
  parseGateSummary,
  summarizeWithGate,
} from "../src/gate.ts";
import type { ModelClient } from "../src/models.ts";

describe("gate", () => {
  test("includes compact few-shot guidance and invariant preservation instructions", () => {
    expect(GATE_SYSTEM_PROMPT).toContain("If the user message includes a \"Known invariants that must survive\" block");
    expect(GATE_SYSTEM_PROMPT).toContain("Examples:");
    expect(GATE_SYSTEM_PROMPT).toContain("TaskForge CLI");
    expect(GATE_SYSTEM_PROMPT).toContain("Data source: mock clients");

    const prompt = buildGatePrompt("history", "latest", ["storage file = .taskforge/tasks.json"]);
    expect(prompt).toContain("Conversation history:");
    expect(prompt).toContain("Latest changes or output:");
    expect(prompt).toContain("Known invariants that must survive:");
    expect(prompt).toContain("storage file = .taskforge/tasks.json");
  });

  test("creates a heuristic summary with decisions, risks, snippets, and invariants", () => {
    const summary = heuristicGateSummary(
      "Use Bun for runtime and keep JSON persistence in a typed store. storage file = .taskforge/tasks.json. Risk: pricing drift.",
      "```ts\nexport const value = 1;\n```",
    );

    expect(summary.goal.length).toBeGreaterThan(10);
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.risks.length).toBeGreaterThan(0);
    expect(summary.snippets.length).toBeGreaterThan(0);
    expect(summary.invariants).toContain("storage file = .taskforge/tasks.json");
  });

  test("parses JSON output even when fenced", () => {
    const parsed = parseGateSummary("```json\n{\"goal\":\"Ship TaskForge\",\"decisions\":[\"Use Bun\"],\"risks\":[\"Verify pricing\"],\"snippets\":[\"const x = 1;\"],\"invariants\":[\"storage file = .taskforge/tasks.json\"]}\n```");

    expect(parsed.goal).toBe("Ship TaskForge");
    expect(parsed.decisions).toContain("Use Bun");
    expect(parsed.invariants).toContain("storage file = .taskforge/tasks.json");
  });

  test("preserves larger invariant sets without schema overflow", () => {
    const previousInvariants = Array.from({ length: 32 }, (_, index) => `fact ${index + 1} = value ${index + 1}`);
    const summary = heuristicGateSummary(
      "Use Bun for runtime and keep JSON persistence in a typed store.",
      "storage file = .taskforge/tasks.json",
      previousInvariants,
    );

    expect(summary.invariants.length).toBeGreaterThanOrEqual(32);
    expect(summary.invariants).toContain("fact 32 = value 32");
  });

  test("falls back to heuristic summarization when JSON parsing fails", async () => {
    const client: ModelClient = {
      provider: "openai",
      model: "gpt-5-nano",
      mode: "mock",
      async generateText() {
        return {
          text: "this is not valid json",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
          },
        };
      },
    };

    const result = await summarizeWithGate({
      history: "Use Bun for runtime and keep JSON persistence in a typed store.",
      latestChanges: "storage file = .taskforge/tasks.json",
      previousInvariants: ["storage file = .taskforge/tasks.json"],
      client,
    });

    expect(result.rawText).toBe("this is not valid json");
    expect(result.summary.goal.length).toBeGreaterThan(0);
    expect(result.summary.decisions.length).toBeGreaterThan(0);
    expect(result.summary.invariants).toContain("storage file = .taskforge/tasks.json");
  });
});
