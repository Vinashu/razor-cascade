import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStudy } from "../src/study.ts";

describe("study runner", () => {
  test("executes baseline aliases and explicit provider baselines in dry-run mode", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "razorcascade-study-"));

    try {
      const aliasResult = await runStudy({
        configName: "baseline",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });
      const geminiBaselineResult = await runStudy({
        configName: "baseline-gemini",
        runs: 1,
        outputDir,
        dryRun: true,
        skipTests: true,
      });

      expect(aliasResult.runRecords.length).toBe(1);
      expect(aliasResult.summaryRecords.length).toBe(1);
      expect(String(aliasResult.summaryRecords[0]?.config)).toBe("baseline-openai");

      expect(geminiBaselineResult.runRecords.length).toBe(1);
      expect(geminiBaselineResult.summaryRecords.length).toBe(1);
      expect(String(geminiBaselineResult.summaryRecords[0]?.config)).toBe("baseline-gemini");
      expect(Number(aliasResult.summaryRecords[0]?.mean_cost_usd)).toBeGreaterThan(0);
      expect(Number(geminiBaselineResult.summaryRecords[0]?.mean_cost_usd)).toBeGreaterThan(0);

      expect(await Bun.file(join(aliasResult.outputFolder, "steps.csv")).exists()).toBe(true);
      expect(await Bun.file(join(geminiBaselineResult.outputFolder, "dashboard.html")).exists()).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 30000);
});
