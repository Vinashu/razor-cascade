# RazorCascade — Plan to 10/10

> Actionable improvement plan. Each phase is independent. Tasks within a phase can run in parallel unless marked *sequential*. Codex agents should read this file, pick a phase, and swarm subagents for each task.

---

## Phase 1: Bug Fix — Population vs Sample Standard Deviation

**Parallelizable: NO (single file, single change)**

### Task 1.1: Fix `standardDeviation()` to use sample variance (Bessel's correction)

- **File:** `src/metrics.ts`, function `standardDeviation` (line ~322)
- **Bug:** Currently divides by `n` (population variance). The rest of the codebase uses `sampleVariance()` which correctly divides by `n-1`. Summary records report stddev via `summarizeNumbers()` which calls `standardDeviation()` — so all reported stddev values in CSVs, reports, and dashboards are biased low.
- **Fix:** Change the variance calculation from `/ values.length` to `/ (values.length - 1)` to match `sampleVariance()`:
  ```ts
  // BEFORE:
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  // AFTER:
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  ```
- **Test update:** In `tests/metrics.test.ts`, the test `"computes descriptive stats"` asserts `summary.stddev` is `> 1`. After Bessel's correction, stddev([1,2,3,4]) changes from ~1.118 to ~1.291. The existing assertion (`toBeGreaterThan(1)`) still passes, but add an explicit value check:
  ```ts
  expect(summary.stddev).toBeCloseTo(1.2910, 3);
  ```
- **Verify:** `bun test` — all 40+ tests must pass.

---

## Phase 2: Externalize Hardcoded Configuration

**Parallelizable: YES — all 3 tasks are independent**

### Task 2.1: Move price book to `config.json`

- **File:** `src/metrics.ts` — the `PRICE_BOOK` constant (line ~68)
- **File:** `config.json` — add a `"priceBook"` top-level key
- **What:** Move the `PRICE_BOOK` record from hardcoded TypeScript into `config.json` so pricing can be updated without code changes. The shape in config.json should be:
  ```json
  "priceBook": {
    "openai": {
      "gpt-5.4": { "inputUsdPerMillion": 2.5, "outputUsdPerMillion": 15 },
      "gpt-5-mini": { "inputUsdPerMillion": 0.25, "outputUsdPerMillion": 2 },
      "gpt-5-nano": { "inputUsdPerMillion": 0.05, "outputUsdPerMillion": 0.4 }
    },
    "anthropic": { ... },
    "xai": { ... },
    "gemini": { ... }
  }
  ```
- **Implementation:**
  1. Add a Zod schema `PriceBookSchema` in `src/metrics.ts` that validates the nested provider→model→pricing structure.
  2. Add a `loadPriceBook(configPath?)` async function that reads `config.json` and returns the parsed price book. Fall back to the current hardcoded `PRICE_BOOK` if the config file doesn't have a `priceBook` key (backward compatibility).
  3. Update `resolvePricing()` to accept an optional price book parameter. Default to the hardcoded fallback.
  4. In `src/study.ts`, load the price book once at study start and thread it through to `estimateCostUsd` calls.
- **Test:** Add a test in `tests/metrics.test.ts` that verifies `resolvePricing` works with both a custom price book object and the default fallback.
- **Verify:** `bun test` passes. Existing experiment outputs unchanged (same default prices).

### Task 2.2: Make study tasks configurable via config.json

- **File:** `src/study.ts` — the `STUDY_TASKS` array (line ~370)
- **File:** `config.json` — add an optional `"tasks"` top-level key
- **What:** Allow overriding the 10 hardcoded tasks via config.json while keeping them as defaults. This makes the study framework reusable for other projects.
- **Implementation:**
  1. Add a Zod schema `StudyTaskSchema` in `src/study.ts` for `{ number, title, objective, keywords[] }`.
  2. Add an optional `tasks` field to `StudyConfigFileSchema`.
  3. In `runStudy()`, if `configFile.tasks` exists and is non-empty, use it instead of `STUDY_TASKS`.
  4. Keep the current `STUDY_TASKS` as the fallback default.
- **Test:** Add a test in `tests/study.test.ts` that runs a dry-run study with a custom tasks array of 2 tasks and verifies only 2 steps per run are generated.
- **Verify:** `bun test` passes. Default behavior is unchanged.

### Task 2.3: Make quality scoring thresholds configurable

- **File:** `src/study.ts` — function `scoreTaskOutput` (line ~475)
- **File:** `config.json` — add optional `"scoring"` key
- **What:** The heuristic scorer has magic numbers (base=6, keywordWeight=2.8, structureBonus=0.5, lengthThreshold=240, lengthBonus=0.3, testBonus=0.4). Externalize them.
- **Implementation:**
  1. Define a `ScoringConfig` type: `{ baseScore, keywordWeight, structureWeight, lengthThreshold, lengthBonus, testBonus }` with Zod defaults matching current values.
  2. Add optional `scoring` to `StudyConfigFileSchema`.
  3. Thread the scoring config into `scoreTaskOutput`.
- **Test:** Add a test that passes custom scoring config and verifies the score changes accordingly.
- **Verify:** `bun test` passes. Default scores identical.

---

## Phase 3: Strengthen Quality Measurement

**Parallelizable: YES — all 3 tasks are independent**

### Task 3.1: Add inter-rater reliability metric for LLM judge

- **File:** `src/study.ts`
- **What:** When `--judge` is enabled, run the judge scoring TWICE per step (with slightly different temperatures or prompts) and compute agreement. This validates that the LLM judge is consistent and not just noisy.
- **Implementation:**
  1. Add a `--judge-repeat` CLI flag (default: 1, max: 3). When > 1, call `runJudgeScoringStep` N times per task.
  2. Compute the mean score and the standard deviation across judge repeats.
  3. Add `judgeScoreStddev` to `StepRecord`. When stddev > 1.5, log a warning about inconsistent judge scoring.
  4. In the summary record, add `mean_judge_agreement` (1 - avg_stddev / 10) as a 0-1 reliability metric.
- **Test:** Add a test with a mock judge client returning varying scores to verify stddev computation.
- **Verify:** `bun test` passes.

### Task 3.2: Add human-baseline calibration data

- **File:** `config.json` — add `"humanBaselineScores"` optional key
- **File:** `src/study.ts` — function `buildSummaryRecords`
- **What:** If the user provides human-scored quality baselines for each of the 10 tasks (via config.json), compute correlation between heuristic/judge scores and human scores. This validates the scoring method.
- **Implementation:**
  1. Add optional `humanBaselineScores: number[]` (length 10, one per task) to `StudyConfigFileSchema`.
  2. If present, compute Pearson correlation coefficient between the mean per-task quality scores and the human baselines.
  3. Add `qualityCorrelationWithHuman: number | null` to summary records.
  4. Include in report.md output.
- **Function needed:** `pearsonCorrelation(xs: number[], ys: number[]): number` in `src/metrics.ts`.
- **Test:** Add a test for `pearsonCorrelation` with known inputs (e.g., perfectly correlated → 1.0, inversely → -1.0).
- **Verify:** `bun test` passes.

### Task 3.3: Add quality confidence intervals and effect sizes

- **File:** `src/study.ts` — function `buildSummaryRecords`
- **What:** Currently only cost has 95% CI and Cohen's d. Quality and tokens should have the same.
- **Implementation:**
  1. Compute `ci95_quality_lower`, `ci95_quality_upper` using `confidenceInterval(qualitySamples)`.
  2. Compute `cohensD_quality` and `cohensD_tokens` using `cohensD()` against matched baselines.
  3. Add these 5 fields to `SummaryRecord` type and Zod schema.
  4. Include in `buildMarkdownSummary` report table.
  5. Include in `summary.json` output.
- **Test:** Extend the existing study dry-run tests to assert these new fields exist and are numeric (or null for baselines).
- **Verify:** `bun test` passes.

---

## Phase 4: Harden Drift Detection

**Parallelizable: YES — both tasks are independent**

### Task 4.1: Add semantic embedding-free similarity checking

- **File:** `src/contradictions.ts`
- **What:** Current drift detection uses exact regex matching. When a gate summary says "data is saved to tasks.db" and the invariant is "storage file = .taskforge/tasks.json", the path mismatch should be caught even when the surrounding text differs significantly. Currently `PATH_CLAIM_PATTERNS` does some of this, but it can miss when the summary rephrases entirely.
- **Implementation:**
  1. Add a function `detectReformulationContradictions(summary: string, invariants: string[]): string[]`.
  2. For each invariant of kind "path" or "rule", extract the VALUE part (after `=` or `:`).
  3. Check if the summary contains ANY path-like token (anything matching `/[./][a-zA-Z0-9_/.-]+/`) that differs from the invariant's value. If a different path is found in a sentence that also mentions the invariant's SUBJECT (e.g., "storage", "task data"), flag it.
  4. Return an array of contradiction descriptions.
  5. Wire this into `buildDriftReport`.
- **Test:** Add a test in `tests/contradictions.test.ts`:
  - Invariant: `"storage file = .taskforge/tasks.json"`, Summary mentions `"task data is persisted in data/store.sqlite"` → catch contradiction.
  - Invariant: `"storage file = .taskforge/tasks.json"`, Summary mentions `".taskforge/tasks.json"` → no contradiction.
- **Verify:** `bun test` passes.

### Task 4.2: Add field addition drift (not just loss)

- **File:** `src/contradictions.ts`
- **What:** Current cardinality checking only flags when summary claims FEWER values than known. It should also flag when summary claims MORE values (field/enum addition without source).
- **Implementation:**
  1. In the cardinality checking within `detectContradictions`, when `claimedCount > knownValues.length`, add a contradiction: `"${subject}: summary claims ${claimedCount} values but only ${knownValues.length} are known"`.
  2. Also check when the summary explicitly lists enum values that don't appear in the known set (e.g., summary says "priority supports low|medium|high|urgent" but known enum is "low|medium|high" → flag "urgent" as unknown addition).
- **Test:** Add a test with an invariant `"priority enum = low|medium|high"` and summary claiming 4 values including "urgent". Expect a contradiction.
- **Verify:** `bun test` passes.

---

## Phase 5: Improve Statistical Rigor

**Parallelizable: YES — all 3 tasks are independent**

### Task 5.1: Add power analysis function

- **File:** `src/metrics.ts`
- **What:** No power analysis exists to justify the recommended 10 runs. Add a function that, given observed effect size and desired power/alpha, computes the minimum sample size.
- **Implementation:**
  1. Add `minimumSampleSize(effectSize: number, power?: number, alpha?: number): number`.
     - Default: power=0.8, alpha=0.05.
     - Use the standard formula for two-sample t-test: `n = 2 * ((z_alpha/2 + z_beta) / effectSize)^2`, approximated via the inverse normal CDF.
  2. Add a helper `inverseNormalCdf(p: number): number` using the rational approximation (Abramowitz and Stegun 26.2.23).
  3. Export both functions.
- **Usage in study:** In `buildMarkdownSummary`, when effect sizes are available, add a "Power Analysis" section stating whether the number of runs was sufficient for the observed effects.
- **Test:** Add a test: for Cohen's d = 0.8 (large effect), power=0.8, alpha=0.05, expected n ≈ 26 per group. For d = 1.5, expected n ≈ 10.
- **Verify:** `bun test` passes.

### Task 5.2: Add Bonferroni correction for multiple comparisons

- **File:** `src/metrics.ts` and `src/study.ts`
- **What:** When running all 9 configs, multiple pairwise comparisons inflate type-I error. Apply Bonferroni correction.
- **Implementation:**
  1. Add `bonferroniCorrect(pValues: number[]): number[]` in `src/metrics.ts` that multiplies each p-value by the number of comparisons and caps at 1.0.
  2. In `buildSummaryRecords`, after computing all p-values, apply Bonferroni correction.
  3. Add `pValue_cost_corrected`, `pValue_tokens_corrected`, `pValue_quality_corrected` fields to `SummaryRecord`.
  4. Include corrected p-values in the markdown report with a footnote explaining the correction.
- **Test:** Test that `bonferroniCorrect([0.01, 0.03, 0.5])` returns `[0.03, 0.09, 1.0]`.
- **Verify:** `bun test` passes.

### Task 5.3: Add non-parametric alternative (Mann-Whitney U)

- **File:** `src/metrics.ts`
- **What:** Welch's t-test assumes approximately normal distributions. With only 10 runs, this assumption is weak. Add a non-parametric alternative.
- **Implementation:**
  1. Add `mannWhitneyU(samplesA: number[], samplesB: number[]): { uStatistic: number; pValue: number }`.
     - Compute U statistic by counting pairwise comparisons.
     - For small samples (n < 20), use the normal approximation with continuity correction: `z = (U - n1*n2/2) / sqrt(n1*n2*(n1+n2+1)/12)`.
     - Return two-tailed p-value from the standard normal CDF.
  2. Export the function.
  3. In `buildSummaryRecords`, compute Mann-Whitney p-values alongside Welch's t-test.
  4. Add `pValue_cost_mannwhitney`, `pValue_tokens_mannwhitney` to `SummaryRecord`.
- **Test:** Test with known ranked data (e.g., two clearly separated groups → p < 0.05).
- **Verify:** `bun test` passes.

---

## Phase 6: Improve Token Estimation

**Parallelizable: NO (single task)**

### Task 6.1: Add optional BPE-based token counting

- **File:** `src/metrics.ts` — function `estimateTokens`
- **File:** `package.json` — add `gpt-tokenizer` as optional dependency
- **What:** The current heuristic (`words * 1.3 + specialChars * 0.5`) is ±15% off vs actual BPE. When a tokenizer is available, use it.
- **Implementation:**
  1. Add `gpt-tokenizer` (or `tiktoken`) as an **optional** dependency in `package.json`.
  2. In `estimateTokens`, try to dynamically import the tokenizer. If available, use it. If not (import fails), fall back to the current heuristic.
  3. Add a `tokenEstimationMethod: "bpe" | "heuristic"` field to step records so users know which method was used.
  4. Keep the current heuristic as-is for when the dependency is absent.
- **Test:** Add a test that verifies `estimateTokens` returns a positive number regardless of whether the tokenizer is installed.
- **Verify:** `bun test` passes both with and without the optional dependency.

---

## Phase 7: Structured Logging

**Parallelizable: NO (single task, cross-cutting)**

### Task 7.1: Replace console.log/warn/error with structured logger

- **File:** New file `src/logger.ts`
- **Files modified:** `src/study.ts`, `src/models.ts`, `src/gate.ts`
- **What:** All logging currently goes to `console.log`/`console.warn`/`console.error` with unstructured text. Replace with a minimal structured logger.
- **Implementation:**
  1. Create `src/logger.ts` with a `Logger` class:
     - Methods: `info(message, context?)`, `warn(message, context?)`, `error(message, context?)`, `debug(message, context?)`
     - Output: JSON lines to stderr by default: `{"level":"info","timestamp":"...","message":"...","context":{...}}`
     - A `setLevel(level)` method to control verbosity (debug/info/warn/error).
     - A `setFormat(format)` method: `"json"` (default) or `"text"` (for human-friendly output).
  2. Export a default `logger` singleton.
  3. Replace all `console.log/warn/error` calls in `src/study.ts` and `src/models.ts` with the structured logger.
  4. Add a `--verbose` / `--quiet` CLI flag to control log level.
- **Test:** Create `tests/logger.test.ts` — verify JSON output format, level filtering, and text format mode.
- **Verify:** `bun test` passes. CLI output is unchanged in default mode (text format for backward compatibility).

---

## Phase 8: Improve Dashboard & Reports

**Parallelizable: YES — both tasks are independent**

### Task 8.1: Add effect size interpretation to dashboard

- **File:** `src/metrics.ts` — function `writeHtmlDashboard`
- **What:** The dashboard shows p-values and Cohen's d numerically but doesn't interpret them for the reader.
- **Implementation:**
  1. Add a helper `interpretCohensD(d: number): string` that returns "negligible" (< 0.2), "small" (0.2-0.5), "medium" (0.5-0.8), or "large" (≥ 0.8).
  2. Add a helper `interpretPValue(p: number, alpha?: number): string` that returns "significant" or "not significant".
  3. In the dashboard's statistical annotation, append the interpretation text next to the numeric values.
  4. Add color coding: green for significant + large effect, yellow for significant + small effect, red for not significant.
- **Test:** Verify `interpretCohensD(0.3)` returns "small", `interpretCohensD(1.2)` returns "large", etc.
- **Verify:** `bun test` passes. Dashboard HTML includes interpretation labels.

### Task 8.2: Add summary statistics section to report.md

- **File:** `src/study.ts` — function `buildMarkdownSummary`
- **What:** The report has a table but no prose summary. Add an automatically generated narrative section.
- **Implementation:**
  1. After the table, add a "## Key Findings" section with auto-generated bullet points:
     - "Cascade saved X% on average vs baseline (p = Y, Cohen's d = Z [interpretation])"
     - "Quality preserved at X% of baseline (mean quality: cascade=A, baseline=B)"
     - "No statistically significant quality degradation detected" (or flag if there is)
     - "Drift score remained at 0 across all cascade runs" (or flag if non-zero)
  2. Add a "## Methodology Note" section: "N runs per configuration. Statistical tests: Welch's t-test (two-tailed), Cohen's d effect size, 95% confidence intervals."
  3. If power analysis runs were insufficient, add: "Note: X runs may be insufficient for detecting effects smaller than d=Y. Consider increasing to Z runs."
- **Test:** Run a dry-run study and verify the report contains "Key Findings" and "Methodology Note" sections.
- **Verify:** `bun test` passes.

---

## Phase 9: Expand Test Coverage

**Parallelizable: YES — all 4 tasks are independent**

### Task 9.1: Test snapshot file I/O edge cases

- **File:** `tests/study.test.ts`
- **What:** Snapshot writing is tested for "writes files when enabled" but not for edge cases.
- **Implementation:** Add tests for:
  1. Snapshot filenames with special characters in config names (e.g., config name with spaces or unicode).
  2. Snapshot directory creation when parent doesn't exist (verify `mkdir { recursive: true }` behavior).
  3. Snapshot content is valid JSON and contains expected fields (`system`, `prompt`, `response`, `usage`, `durationMs`).
- **Verify:** `bun test` passes.

### Task 9.2: Test judge error fallback thoroughly

- **File:** `tests/study.test.ts`
- **What:** The existing `"falls back to heuristic scoring when judge output is empty"` test covers one case. Add more.
- **Implementation:** Add tests for:
  1. Judge returns invalid JSON (not parseable) → falls back to heuristic.
  2. Judge returns valid JSON but score out of range (e.g., `{"score": 15}`) → falls back or clamps.
  3. Judge client throws a network error → falls back to heuristic with warning.
  4. Judge returns sub-category format `{"completeness":3,"correctness":3,"clarity":2,"architecture":2}` → correctly sums to 10.
- **Verify:** `bun test` passes.

### Task 9.3: Test cost cap edge cases

- **File:** `tests/study.test.ts`
- **What:** Cost cap is tested for "stops early" but not for boundary conditions.
- **Implementation:** Add tests for:
  1. Cost cap of exactly 0 → stops before any run.
  2. Cost cap reached mid-config (e.g., 3 configs, cap reached during config 2) → partial results include only completed runs.
  3. Cost cap with single run that exceeds it → that run completes, next is blocked.
- **Verify:** `bun test` passes.

### Task 9.4: Test cross-provider comparison edge cases

- **File:** `tests/study.test.ts`
- **What:** Cross-provider comparisons work but edge cases aren't tested.
- **Implementation:** Add tests for:
  1. Single provider only → empty cross-provider array.
  2. All 4 providers → verify correct number of pairwise comparisons (n*(n-1)/2).
  3. Provider with zero mean cost → cost_ratio is null (division by zero guard).
- **Verify:** `bun test` passes.

---

## Phase 10: Documentation & Publication Polish

**Parallelizable: YES — all 3 tasks are independent**

### Task 10.1: Add METHODOLOGY.md with statistical justification

- **File:** New file `METHODOLOGY.md`
- **What:** Separate document explaining the statistical methods used, for reviewers and readers.
- **Content (write this document):**
  1. **Experimental Design**: Matched-pair, repeated-measures design. 10 tasks × N runs per config.
  2. **Statistical Tests**: Why Welch's t-test (unequal variance assumption), why Cohen's d (standardized effect size), why 95% CIs.
  3. **Multiple Comparisons**: Bonferroni correction applied when running >2 configs.
  4. **Quality Scoring**: Describe heuristic method, LLM judge rubric, inter-rater reliability metric, and limitations.
  5. **Drift Detection**: Invariant extraction → gate summarization → contradiction checking pipeline.
  6. **Threats to Validity**: Mock mode doesn't reflect live variance; heuristic scoring has ceiling effects; fixed task sequence may not generalize.
  7. **Reproducibility**: Snapshot mode, deterministic mock clients, CSV exports, config.json for all parameters.

### Task 10.2: Add CONTRIBUTING.md with development guide

- **File:** New file `CONTRIBUTING.md`
- **Content:**
  1. Prerequisites (Bun 1.2+, TypeScript 5.9+)
  2. Setup: `bun install`, copy `.env.example` to `.env`
  3. Running tests: `bun test`, `bun test --watch`
  4. Running the study: `bun run study --dry-run`, `bun run study --all --runs 10`
  5. Adding a new provider: Implement `ModelClient` interface in `src/models.ts`, add to price book in `config.json`
  6. Adding study tasks: Edit `config.json` tasks array
  7. Code style: strict TypeScript, Zod for all boundaries, no `any` types

### Task 10.3: Update README.md with new features

- **File:** `README.md`
- **What:** After all improvements are implemented, update README to document:
  1. New CLI flags: `--judge-repeat`, `--verbose`, `--quiet`
  2. New config.json keys: `priceBook`, `tasks`, `scoring`, `humanBaselineScores`
  3. New statistical outputs: corrected p-values, Mann-Whitney, power analysis, quality CIs
  4. New files: `METHODOLOGY.md`, `CONTRIBUTING.md`
  5. Updated example outputs showing the richer report format
- **NOTE:** This task should run LAST, after all other phases are complete. It depends on phases 1-9.

---

## Dependency Graph

```
Phase 1 ─────────────────────────────────────────────┐
Phase 2 (2.1 ∥ 2.2 ∥ 2.3) ─────────────────────────┤
Phase 3 (3.1 ∥ 3.2 ∥ 3.3) ─────────────────────────┤
Phase 4 (4.1 ∥ 4.2) ────────────────────────────────┤
Phase 5 (5.1 ∥ 5.2 ∥ 5.3) ─────────────────────────┤
Phase 6 ─────────────────────────────────────────────┤
Phase 7 ─────────────────────────────────────────────┤
Phase 8 (8.1 ∥ 8.2) ────────────────────────────────┤
Phase 9 (9.1 ∥ 9.2 ∥ 9.3 ∥ 9.4) ───────────────────┤
Phase 10 (10.1 ∥ 10.2) ─────────────────────────────┤
                                                      │
                  ALL ABOVE COMPLETE ─────────────────┤
                                                      ▼
                                              Task 10.3 (README update)
```

**Phases 1-9 can all run in parallel.** Phase 10 tasks 10.1 and 10.2 can run in parallel with everything. Only task 10.3 (README update) must run last.

Within each phase, tasks marked with `∥` can run as parallel subagents.

---

## Verification Checklist (run after ALL phases)

1. `bun test` — all tests pass (should be 55+ tests after additions)
2. `bun run study --dry-run --all --runs 2` — generates artifacts without errors
3. `bun run study --dry-run --all --runs 2 --judge --snapshot` — judge + snapshot mode works
4. Inspect `experiments/<latest>/summary.json` — contains new fields (corrected p-values, quality CIs, power analysis note)
5. Inspect `experiments/<latest>/report.md` — contains "Key Findings" and "Methodology Note" sections
6. Inspect `experiments/<latest>/dashboard.html` — contains effect size interpretation labels
7. Open `config.json` — contains `priceBook`, optional `tasks`, optional `scoring` keys
8. `METHODOLOGY.md` exists and is comprehensive
9. `CONTRIBUTING.md` exists and is accurate
10. `README.md` reflects all new features
