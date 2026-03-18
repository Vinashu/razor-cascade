## RazorCascade — Improvement Plan

The scaffold is solid: clean types, working CLI, full mock pipeline, real provider adapters, a nice HTML dashboard, invariant tracking, drift detection, and good test coverage. The improvements below are organized from highest-impact to polish, with enough detail for any model to execute.

---

### 1. Add Statistical Significance Testing (Critical for publication)

**File:** metrics.ts

The study collects mean/median/stddev but never computes **p-values, confidence intervals, or effect sizes**. No reviewer will accept "cascade saves 53%" without a significance test.

**Tasks:**
- Add a `welchTTest(samplesA: number[], samplesB: number[]): { tStatistic: number; pValue: number; degreesOfFreedom: number }` function in metrics.ts. Use the Welch's t-test formula (unequal variance). Approximate the p-value using the regularized incomplete beta function or a lookup table for two-tailed tests.
- Add a `cohensD(samplesA: number[], samplesB: number[]): number` function for effect size.
- Add a `confidenceInterval(values: number[], confidence?: number): { lower: number; upper: number }` function (default 95%).
- Export all three from metrics.ts.

**File:** study.ts

- In `buildSummaryRecords`, when a cascade config has a matching baseline, compute and include `pValue_cost`, `pValue_tokens`, `pValue_quality`, `cohensD_cost`, and `ci95_cost_lower`/`ci95_cost_upper` in the summary record.
- Include these in the markdown report table and summary.json.

**File:** metrics.test.ts

- Add tests for `welchTTest`, `cohensD`, and `confidenceInterval` with known inputs.

---

### 2. Add LLM-as-Judge Quality Scoring Option

**File:** study.ts

The current `scoreTaskOutput` is keyword-counting heuristic. For publication-grade quality claims, add an optional LLM-as-judge mode.

**Tasks:**
- Create a function `llmJudgeScore(client: ModelClient, task: StudyTask, responseText: string): Promise<number>` that sends the task objective + response to a separate model call with a rubric prompt (completeness 0-3, correctness 0-3, clarity 0-2, architecture 0-2) and parses a numeric 0-10 score.
- Add a `--judge` CLI flag to `buildStudyProgram()` in study.ts. When set, after each flagship step, call `llmJudgeScore` using the flagship client (or a separate `--judge-model` model).
- Fall back to the existing heuristic when `--judge` is not set.
- Guard the LLM judge call cost: it should use low `maxOutputTokens` (~100).

---

### 3. Add API Retry with Exponential Backoff

**File:** models.ts

Live API calls have zero retry logic. Rate limits, transient 500s, and network blips will crash a 10-run study partway through.

**Tasks:**
- Add a `withRetry<T>(fn: () => Promise<T>, options?: { maxRetries?: number; baseDelayMs?: number }): Promise<T>` utility function. Default 3 retries, 1000ms base delay, exponential backoff with jitter.
- Wrap the API call in each live client's `generateText` method with `withRetry`.
- Catch and rethrow on non-retryable errors (401 auth failure, 400 bad request). Retry on 429, 500, 502, 503, network errors.
- Add a test in a new tests/models.test.ts that verifies the retry utility with a mock function that fails twice then succeeds.

---

### 4. Add Cost Cap Safety Mechanism

**File:** study.ts

Running `--all --runs 10` with live APIs could rack up significant cost with no guardrails.

**Tasks:**
- Add a `--cost-cap <usd>` CLI flag (default: no cap).
- Track cumulative estimated cost across all runs in `runStudy`. Before each `executeRun`, check if cumulative cost exceeds the cap. If so, log a warning and stop early, writing partial results.
- Add `costCapReached: boolean` to the return value of `runStudy`.

---

### 5. Snapshot Prompts and Responses for Reproducibility

**File:** study.ts

Each run is ephemeral. For reproducibility and debugging, save the actual prompts/responses.

**Tasks:**
- Add a `--snapshot` CLI flag.
- When set, write a `snapshots/` subdirectory inside the experiment output folder. For each step, write a JSON file: `{config}-run{runId}-step{stepNumber}-{role}.json` containing `{ system, prompt, response, usage, durationMs }`.
- Keep this off by default to avoid disk bloat.

---

### 6. Add Missing Project Files

**Missing files:**

- **.env.example** — create it with all the env vars from the README (keys as placeholder strings, model names as commented defaults). The README references it but it doesn't exist.
- **.gitignore** — create with: node_modules, .env, `.taskforge/`, `experiments/*/`, `dist/`, `*.tsbuildinfo`.

---

### 7. Mark Mock vs Live Clearly in All Artifacts

**File:** study.ts

The summary JSON and report don't indicate whether data came from mock or live clients. This is buried in `usedMockClients` in `RunRecord` but not surfaced.

**Tasks:**
- In `buildMarkdownSummary`, add a row or header note: `Data source: mock clients (dry-run)` or `Data source: live API calls`.
- In summary.json, add a top-level `"dataSource": "mock"` or `"live"` field.
- In the HTML dashboard, show a badge/pill in the header: "Mock Data" or "Live API Data".

---

### 8. Improve Token Estimation Accuracy

**File:** metrics.ts

`estimateTokens` uses `Math.ceil(text.length / 4)` which is ~25% off for typical English text and worse for code.

**Tasks:**
- Improve the heuristic: count words and special tokens separately. A better formula: `words * 1.3 + specialCharacters * 0.5` where `specialCharacters` are brackets, punctuation, operators. This stays dependency-free while being closer to actual BPE counts.
- Alternatively, add an optional dependency on `tiktoken` (or `gpt-tokenizer`) and use it when available, falling back to the heuristic. Add to package.json as an optional dependency.
- When live API clients return actual token counts in `usage`, those should always be preferred (this is already done correctly).

---

### 9. Add Cross-Provider Comparison Support

**File:** study.ts

`buildSummaryRecords` only compares cascade configs against their same-provider baseline. Cross-provider comparisons (e.g., "OpenAI cascade vs Anthropic cascade") would be valuable.

**Tasks:**
- Add a `cross_provider_comparisons` section to summary.json when multiple providers are present.
- For each pair of configs, compute cost ratio, quality delta, and token ratio.
- Add a cross-provider comparison table to the markdown report.

---

### 10. Strengthen Drift Detection

**File:** contradictions.ts

Current drift detection checks enum value changes, field changes, version changes, and rule violations. It misses:

**Tasks:**
- Add **semantic similarity checking**: when an invariant is "storage file = .taskforge/tasks.json" and the summary says "data stored in tasks.db", detect the path contradiction even though the format is different. Check if the invariant's key ("storage file") appears in the summary with a different value.
- Add **cardinality checking**: if an enum had 3 values and the summary claims 4, flag it even if all original values are present (addition drift).
- Add tests for these new detection modes in contradictions.test.ts.

---

### 11. Add a `--compare` Post-Hoc Analysis Command

**File:** study.ts

Currently you must re-run the study to get comparisons. Allow comparing existing experiment folders.

**Tasks:**
- Add a `compare` subcommand to the CLI: `bun run study compare experiments/2026-03-16T15-22-12-243Z experiments/2026-03-16T18-01-10-165Z`.
- Read the summary.json from each folder.
- Output a side-by-side comparison table to stdout and optionally to a file.
- This is purely a data aggregation task — no API calls needed.

---

### 12. Harden the Gate Prompt with Few-Shot Examples

**File:** gate.ts

The gate's system prompt tells the model what JSON to produce but gives no examples. Few-shot prompting dramatically improves structured output compliance.

**Tasks:**
- Add 1-2 short few-shot examples to `GATE_SYSTEM_PROMPT` showing an input snippet and the expected JSON output.
- Keep total prompt under 800 tokens to avoid negating the cost savings.
- Add an `invariants` field instruction explicitly referencing the previous invariants passed in.

---

### 13. Add Watch Mode for Development

**File:** package.json

**Tasks:**
- Add a `"test:watch"` script: `"bun test --watch"`.
- Add a `"study:dry"` convenience script: `"bun run study.ts --dry-run --skip-tests --runs 1"` for quick iteration.

---

### 14. Test Edge Cases

**File:** study.test.ts and taskforge.test.ts

Current tests cover happy paths. Add:
- **study.test.ts**: Test `--all` with `--dry-run` (runs all 9 configs × 1 run) to ensure they all route correctly.
- **study.test.ts**: Test ad hoc mode with `--mode cascade --provider anthropic`.
- **taskforge.test.ts**: Test error cases — complete a non-existent task, delete a non-existent task, add empty title.
- **gate.test.ts**: Test `summarizeWithGate` with a mock client to verify fallback when JSON parsing fails.
- **contradictions.test.ts**: Test with empty invariants list, test with invariants that are all present (expect 0 drift).

---

### 15. Minor Code Quality Fixes

- **study.ts**: `buildDashboardCurveData` splits on `"::"` but only destructures 2 values — the second destructured value is the step number, but the split produces 3 segments (`label::runId::stepNumber`). Change `const [label, stepNumberText] = key.split("::");` to `const parts = key.split("::"); const label = parts[0]; const stepNumberText = parts[2];` to avoid silently using `runId` as the step number. **This is a bug** — currently `stepNumberText` gets the `runId`, not the step number.
- **metrics.ts**: `escapeCsvValue` uses `"\"\""` for escaping — this is correct but the double-backslash in the source may confuse linters. Verify the escape produces actual doubled-quote characters.
- **models.ts**: The OpenAI client conditionally omits `temperature` for `gpt-5` models based on a regex. This should be configurable rather than hardcoded, since model behavior may change.

---

### Execution Priority

| Priority | Items | Impact |
|----------|-------|--------|
| **P0 — Do first** | #6 (missing files), #15 (bug fix in curve data) | Correctness |
| **P1 — Scientific** | #1 (p-values), #2 (LLM judge), #7 (mock/live label) | Publication readiness |
| **P2 — Robustness** | #3 (retry), #4 (cost cap), #5 (snapshots) | Production safety |
| **P3 — Analysis** | #9 (cross-provider), #11 (compare command), #10 (drift) | Richer insights |
| **P4 — Polish** | #8 (tokens), #12 (few-shot), #13 (watch), #14 (tests) | Developer experience |

---

This plan is self-contained — each item specifies exact files, functions, and behaviors. Any model can pick items in priority order and implement them independently. The P0 items fix actual issues; P1 items are what separate "interesting project" from "publishable study."