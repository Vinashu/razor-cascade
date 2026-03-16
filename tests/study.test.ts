import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStudy } from "../src/study.ts";

describe("study runner", () => {
  test("executes all configs in dry-run mode and writes artifacts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-"));

    try {
      const result = await runStudy({
        all: true,
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(result.runRecords.length).toBe(5);
      expect(result.summaryRecords.length).toBe(5);

      const baseline = result.summaryRecords.find((row) => row.config === "baseline");
      const mini = result.summaryRecords.find((row) => row.config === "openai-mini");
      expect(Number(baseline?.mean_cost_usd)).toBeGreaterThan(0);
      expect(Number(mini?.mean_cost_usd)).toBeLessThan(Number(baseline?.mean_cost_usd));

      expect(await Bun.file(join(result.outputFolder, "steps.csv")).exists()).toBe(true);
      expect(await Bun.file(join(result.outputFolder, "dashboard.html")).exists()).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
