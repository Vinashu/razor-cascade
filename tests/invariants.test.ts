import { describe, expect, test } from "bun:test";

import { extractInvariants, mergeInvariantFacts } from "../src/invariants.ts";

describe("invariants", () => {
  test("extracts deterministic architectural facts from code and prompts", () => {
    const text = `
const TaskPrioritySchema = z.enum(["low", "medium", "high"]);
const TaskStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  tasks: z.array(TaskSchema),
});
return process.env.TASKFORGE_DATA_PATH?.trim() || ".taskforge/tasks.json";
task id must remain stable
Produce a concise engineering update that includes:
1. Goal
2. Proposed implementation details
3. Validation or testing
4. Risks
`;

    const memory = extractInvariants(text);

    expect(memory.facts).toContain("task priority enum = low|medium|high");
    expect(memory.facts).toContain("task store version = 1");
    expect(memory.facts).toContain("storage file = .taskforge/tasks.json");
    expect(memory.facts).toContain("task id must remain stable");
    expect(memory.facts).toContain("required sections = goal|proposed implementation details|validation or testing|risks");
  });

  test("merges invariant memory without duplicating facts", () => {
    const merged = mergeInvariantFacts(
      ["priority enum = low|medium|high", "storage file = .taskforge/tasks.json"],
      ["Priority enum = low|medium|high", "task id must remain stable"],
    );

    expect(merged).toEqual([
      "priority enum = low|medium|high",
      "storage file = .taskforge/tasks.json",
      "task id must remain stable",
    ]);
  });
});
