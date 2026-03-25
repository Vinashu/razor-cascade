# RazorCascade-Study

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#running-the-study)
[![Providers](https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20xAI%20%7C%20Gemini-blueviolet)](#supported-providers-and-march-2026-pricing)

RazorCascade is a reproducible TypeScript + Bun study scaffold for measuring whether same-provider model cascading reduces API cost during incremental software development without materially degrading quality. The repository ships with a working `TaskForge` CLI, provider adapters for OpenAI, Anthropic, and xAI, a gate summarizer, study runner, metrics pipeline, strengthened drift detection, and automated tests.

## Hypothesis

Using a cheaper same-provider gate model to summarize context before each flagship-model execution step will reduce total API cost by 40-60% while preserving at least 95% of baseline quality, coherence, test pass rate, and architectural stability across ten repeated runs.

## Methodology

1. Build and evaluate `TaskForge`, a lightweight Bun-powered CLI task manager.
2. Execute the same 10 standardized development tasks across repeated runs.
3. Compare baseline full-history prompting against cascaded prompting.
4. Collect token counts, estimated cost, quality score, test results, and summary artifacts.
5. Export step-level CSVs, run-level CSVs, JSON summaries, Markdown reports, and an HTML dashboard.

## The 10 Incremental Tasks

1. CLI skeleton + argument parsing.
2. Task data model + JSON persistence.
3. List, filter, and view tasks.
4. Complete/delete commands + validation.
5. Integrate the summarization gate.
6. AI-assisted task decomposition.
7. Code snippet generation.
8. Automated tests with coverage.
9. Refinement loop driven by feedback.
10. Markdown/HTML report export.

## Supported Providers And March 2026 Pricing

| Provider | Flagship | Gate | Flagship Input / Output | Gate Input / Output | Notes |
| --- | --- | --- | --- | --- | --- |
| OpenAI | `gpt-5.4` | `gpt-5-mini` | $2.50 / $15.00 | $0.25 / $2.00 | Balanced reasoning |
| OpenAI | `gpt-5.4` | `gpt-5-nano` | $2.50 / $15.00 | $0.05 / $0.40 | Lowest cost OpenAI gate |
| Anthropic | `claude-sonnet-4-6` | `claude-haiku-4-5` | $3.00 / $15.00 | $1.00 / $5.00 | Strong architectural planning |
| xAI | `grok-4` | `grok-code-fast` | $3.00 / $15.00 | $0.20 / $1.50 | Fast same-provider cascade |
| Gemini | `gemini-2.5-pro` | `gemini-2.5-flash` | $1.25 / $10.00 | $0.30 / $2.50 | Google flagship + fast gate |

## Repository Layout

```text
.
├── README.md
├── LICENSE
├── .env.example
├── config.json
├── package.json
├── tsconfig.json
├── docs/
│   ├── paper.md          ← research paper write-up
│   └── figures/
├── src/
│   ├── contradictions.ts
│   ├── gate.ts
│   ├── invariants.ts
│   ├── logger.ts
│   ├── metrics.ts
│   ├── models.ts
│   ├── replay.ts
│   ├── study.ts
│   └── taskforge.ts
├── tests/
│   ├── contradictions.test.ts
│   ├── gate.test.ts
│   ├── invariants.test.ts
│   ├── logger.test.ts
│   ├── metrics.test.ts
│   ├── models.test.ts
│   ├── study.test.ts
│   └── taskforge.test.ts
└── experiments/
    └── .gitkeep
```

## Prerequisites

- Bun 1.2+
- Optional provider API keys for live runs
- Node-compatible environment for local file access

## Setup

```bash
bun install
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

If provider keys are absent, the study runner automatically falls back to deterministic mock clients so the pipeline still runs end-to-end.

## Environment Variables

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=xai-...
GEMINI_API_KEY=...

OPENAI_FLAGSHIP_MODEL=gpt-5.4
OPENAI_GATE_MODEL=gpt-5-mini
OPENAI_TEMPERATURE_OMIT_MODELS=gpt-5.4,gpt-5-mini,gpt-5-nano
ANTHROPIC_FLAGSHIP_MODEL=claude-sonnet-4-6
ANTHROPIC_GATE_MODEL=claude-haiku-4-5
XAI_FLAGSHIP_MODEL=grok-4
XAI_GATE_MODEL=grok-code-fast
GEMINI_FLAGSHIP_MODEL=gemini-2.5-pro
GEMINI_GATE_MODEL=gemini-2.5-flash
```

## Running TaskForge

```bash
bun run taskforge -- add "Draft evaluation section" --priority high --tags study,writing
bun run taskforge -- list --status open
bun run taskforge -- complete task_0001
bun run taskforge -- report --format markdown --output experiments/taskforge-report.md
```

AI-assisted commands:

```bash
bun run taskforge -- decompose "Ship the first public RazorCascade release" --provider openai
bun run taskforge -- snippet "Create a Bun CLI command parser" --language ts --provider anthropic
bun run taskforge -- refine task_0001 --feedback "Add acceptance criteria and edge cases"
```

## Running The Study

```bash
# OpenAI baseline, 10 runs
bun run study --config baseline-openai --runs 10

# Backward-compatible alias for the OpenAI baseline
bun run study --config baseline --runs 10

# OpenAI cascade using gpt-5-mini as the gate
bun run study --config openai-mini --runs 10

# OpenAI cascade using gpt-5-nano
bun run study --config openai-nano --runs 10

# Anthropic baseline and cascade
bun run study --config baseline-anthropic --runs 10
bun run study --config anthropic --runs 10

# xAI baseline and cascade
bun run study --config baseline-grok --runs 10
bun run study --config grok --runs 10

# Gemini baseline and cascade
bun run study --config baseline-gemini --runs 10
bun run study --config gemini --runs 10

# Every configured setup
bun run study --all --runs 10

# Every configured setup with a hard stop once estimated spend is already above $25
bun run study --all --runs 10 --cost-cap 25

# Just one matched pair in one output folder
bun run study --configs baseline-openai,openai-mini --runs 10

# Cross-provider comparisons in one artifact set
bun run study --configs openai-mini,anthropic,gemini --runs 10

# One-pass run with LLM-as-judge scoring using GPT-5 nano as the judge
bun run study --config openai-mini --runs 1 --judge --judge-model gpt-5-nano

# Cross-provider judge: use Gemini Flash to score OpenAI outputs
bun run study --config openai-mini --runs 1 --judge --judge-provider gemini --judge-model gemini-2.5-flash

# Repeat judge scoring three times to estimate judge consistency
bun run study --config openai-mini --runs 2 --judge --judge-repeat 3

# Capture per-step prompt/response snapshots for reproducibility
bun run study --config openai-mini --runs 1 --snapshot

# Show debug logs while the study runs
bun run study --config openai-mini --runs 1 --verbose

# Quick dry-run for local iteration
bun run study:dry
```

## Config File

`config.json` is now the main control surface for the study. The shipped file includes:

- `priceBook`: provider and model pricing used by cost estimation. If the key is omitted, RazorCascade falls back to the built-in defaults.
- `tasks`: the standardized task list for the study. Keeping it in config makes the runner reusable for other projects without editing source.
- `scoring`: heuristic quality weights and thresholds.
- `humanBaselineScores`: optional per-task calibration scores for correlation against human judgment.

See [`config.json`](./config.json) for the default shape and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development workflow.

## Comparing Existing Experiments

```bash
# Print a side-by-side post-hoc comparison to stdout
bun run study compare experiments/2026-03-16T15-22-12-243Z experiments/2026-03-16T18-01-10-165Z

# Save the same comparison table to a file
bun run study compare experiments/2026-03-16T15-22-12-243Z experiments/2026-03-16T18-01-10-165Z --output experiments/compare-openai.md
```

The `compare` subcommand reads each experiment folder's `summary.json`, renders a side-by-side Markdown table with the key config metrics, prints it to stdout, and can optionally write the same report to a file. It does not call any model APIs or rerun the study.

## Replaying Snapshots (Recovering Partial Data)

If a study run crashes partway through — e.g. a provider returns a terminal 503 after all retries — the snapshots already written to disk are fully reusable. The `replay` tool reads every `*.json` file from an existing `snapshots/` folder and regenerates all study artifacts (`steps.csv`, `runs.csv`, `summary.json`, `dashboard.html`, `report.md`) without making any API calls.

```bash
# Regenerate artifacts from a previous (possibly crashed) experiment
bun run src/replay.ts --input experiments/2026-03-19T00-13-38-875Z
```

The output is written to a new timestamped folder:

```
experiments/replay-2026-03-19T12-10-08-926Z/
  steps.csv
  runs.csv
  summary.json
  dashboard.html
  report.md
```

Quality scores are extracted directly from the saved judge snapshot responses — no re-scoring occurs. Cost figures are recalculated from the token usage stored in each snapshot and the `priceBook` in `config.json`.

### Replay Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--input <folder>` | required | Experiment folder containing a `snapshots/` subdirectory. |
| `--output-dir <path>` | `experiments/` | Root folder for the generated output. A new timestamped subfolder is created inside it. |
| `--config-path <path>` | `config.json` | Path to the config file used to look up provider, model, and pricing metadata. |

### Typical Crash-Recovery Workflow

```powershell
# 1. Crash happened partway through --all --runs 10.
#    The snapshots folder contains complete data for some configs.

# 2. Recover what was collected before the crash:
bun run src/replay.ts --input experiments/2026-03-19T00-13-38-875Z

# 3. Run only the missing or incomplete configs:
bun run src/study.ts --configs "grok,baseline-gemini,gemini" --runs 10 \
  --judge --judge-provider gemini --judge-model "gemini-2.5-flash" \
  --judge-repeat 2 --snapshot --verbose

# 4. Replay the new folder to produce a clean artifact set for those configs:
bun run src/replay.ts --input experiments/<new-folder>
```

If you want a single unified artifact set combining both runs, copy the snapshot files from both folders into a single `snapshots/` directory and run replay once against that merged folder.

> **Note:** Drift and invariant metrics (`missingInvariants`, `contradictions`, `driftScore`) are not reconstructed during replay because they depend on in-flight conversation state that is not persisted in snapshot files. These fields are zeroed out in the replayed output. All cost, token, and quality metrics are fully accurate.

Helpful flags:

- `--dry-run`: force deterministic mock clients even if API keys exist. Generated `summary.json`, `report.md`, and `dashboard.html` artifacts are labeled as mock data.
- `--skip-tests`: skip local test execution during the study run.
- `--output-dir <path>`: write artifacts to a custom folder.
- `--cost-cap <usd>`: stop before the next run once cumulative estimated study cost already exceeds this USD amount.
- `--configs <name1,name2,...>`: run a comma-separated set of named configs together so paired baselines, cascades, and cross-provider comparisons land in the same report.
- `--mode <baseline|cascade>` with `--provider`, `--flag-model`, and `--gate-model`: run an ad hoc configuration without editing `config.json`.
- `--judge`: score each flagship response with an LLM judge instead of the built-in heuristic scorer.
- `--judge-model <model>`: optionally use a separate judge model; if omitted, the flagship model is reused.
- `--judge-provider <provider>`: use a different provider for the judge model (e.g. `anthropic`, `gemini`). Defaults to the config's own provider. Cross-provider judging avoids potential self-evaluation bias and works around reasoning-model token budget limitations.
- `--judge-repeat <number>`: repeat each judge scoring pass up to three times and record judge-score variability plus agreement.
- `--snapshot`: write per-step JSON snapshots under `snapshots/` with the exact system prompt, user prompt, model response, usage, and duration.
- `--verbose`: enable debug logging from the study pipeline.
- `--quiet`: suppress non-error structured logs.

Judge mode sends the task objective plus the flagship response to a short rubric-based evaluator prompt and asks for a 0-10 score across completeness, correctness, clarity, and architecture. Judge calls use up to 1200 output tokens to accommodate reasoning models that consume part of the budget for chain-of-thought before producing the JSON score.

> **Tip:** Current OpenAI models (gpt-5.4, gpt-5-mini, gpt-5-nano) are reasoning models. Using `--judge-provider gemini --judge-model gemini-2.5-flash` gives faster, more cost-effective judge scoring with more nuanced score distributions.

Cost-cap mode is especially useful for live `--all` or high-run studies. If the cumulative estimated spend is already above the configured cap, the runner stops early, logs a warning, and still writes the partial results collected so far.

- `bun run test:watch`: run the test suite in watch mode during development.
- `bun run study:dry`: run a single dry-run study with tests skipped, which is handy for fast local iteration.

Live API runs also include automatic retry with exponential backoff and jitter for transient failures such as rate limits, 5xx responses, and short network interruptions. Non-retryable request errors such as invalid authentication or malformed input are surfaced immediately.

Snapshot mode is off by default to avoid disk bloat. When enabled, each flagship step writes `{config}-run{runId}-step{stepNumber}-flagship.json`; cascade runs also add `-gate.json`, and judge-enabled runs add `-judge.json`.

## Gate Prompt

The summarizer in [`src/gate.ts`](./src/gate.ts) uses this default system prompt:

```text
You are a ruthless context compressor for agentic coding workflows.
Given the full conversation history + latest code/output, output ONLY valid JSON.
If the user message includes a "Known invariants that must survive" block, copy those facts into "invariants" and keep them unless the latest changes clearly contradict them.
{
  "goal": "1-sentence current project goal",
  "decisions": ["key architectural decisions", "..."],
  "risks": ["max 3 open questions or risks"],
  "snippets": ["only the most relevant code blocks, total <200 tokens"],
  "invariants": ["stable architectural facts that must survive future gates"]
}
Examples:
Input: history about TaskForge CLI; latest changes add JSON persistence and Bun runtime.
Output: {"goal":"Build the TaskForge CLI on Bun","decisions":["Use Bun","Persist tasks in JSON"],"risks":["API pricing may drift"],"snippets":["const storagePath = '.taskforge/tasks.json';"],"invariants":["storage file = .taskforge/tasks.json"]}

Input: history about the study runner; latest output adds mock/live data labeling.
Output: {"goal":"Document the study artifacts and analysis workflow","decisions":["Label mock vs live data in outputs"],"risks":["Docs may drift from implementation"],"snippets":["Data source: mock clients"],"invariants":["summary.json includes dataSource"]}

Max 600 tokens total. Be concise, faithful, and eliminate redundancy.
```

## Outputs

Each study execution writes a timestamped folder under `experiments/` containing:

- `steps.csv`: per-step token, duration, cost, and quality metrics.
- `runs.csv`: per-run aggregate results.
- `summary.json`: a top-level `dataSource` field (`mock` or `live`) plus a `configs` array with config-level statistics, corrected p-values, Mann-Whitney alternatives, effect sizes, confidence intervals for cost, tokens, and quality, judge-agreement metrics, and optional human-correlation fields. When more than one provider is present, it also includes `cross_provider_comparisons` with pairwise cost ratios, token ratios, and quality deltas across providers.
- `dashboard.html`: simple zero-dependency HTML visualization with effect-size and significance interpretations layered onto the statistical panels.
- `report.md`: Markdown summary suitable for publication notes, including the expanded significance table, auto-generated `Key Findings`, `Methodology Note`, and a cross-provider comparison table when applicable.
- `snapshots/` when `--snapshot` is enabled: per-call JSON traces for reproducibility and debugging. These files can be fed into the `replay` tool to regenerate all other artifacts without any API calls — useful for recovering data from crashed or interrupted study runs.

The `study compare` subcommand is post-hoc analysis only, so it reads these existing artifacts in place and does not create a new experiment folder unless you explicitly point `--output` at a file path.

If a study stops early because of `--cost-cap`, these artifacts still reflect all completed runs up to that point.

## Quality And Analysis

The runner reports:

- Input, output, and total token counts.
- Optional `gpt-tokenizer` BPE counting when available, with a heuristic fallback when it is not.
- Estimated USD cost using the `priceBook` configured in `config.json`.
- Mean, median, min, max, and standard deviation by configuration.
- Cost and token savings versus baseline.
- Cross-provider pairwise cost ratios, token ratios, and quality deltas when multiple providers are included in the same run.
- Welch's t-test p-values for cost, token, and quality comparisons when matched baseline samples are available.
- Bonferroni-corrected p-values when multiple matched comparisons are present.
- Mann-Whitney U p-values for non-parametric cost and token comparisons.
- Cohen's d effect sizes for cost, tokens, and quality.
- 95% confidence intervals for per-configuration cost, tokens, and quality.
- Average quality score by task and by configuration.
- Quality via either the default heuristic scorer or optional LLM-as-judge scoring with a 10-point rubric.
- Judge repeat variability through `judgeScoreStddev` and aggregated `mean_judge_agreement`.
- Optional correlation between model quality scores and `humanBaselineScores`.
- Drift via missing invariants plus contradiction checks for explicit value changes, semantic storage/path mismatches, rule violations, and enum cardinality drift.
- Power-analysis guidance in `report.md` when observed effects suggest more runs would be helpful.
- Cached local test pass status for the current repository.
- Edge-case coverage for dry-run `--all`, ad hoc provider modes, TaskForge validation failures, gate JSON fallback, and zero-drift contradiction cases.

## Project Docs

- [`docs/paper.md`](./docs/paper.md): the research paper write-up covering methodology, results, and analysis. The paper source lives in the `docs/` folder; figures go in `docs/figures/`.
- [`METHODOLOGY.md`](./METHODOLOGY.md): experimental design, statistical choices, validity limits, and reproducibility notes.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): setup, test commands, study commands, provider extension notes, and code-style expectations.

## Notes

- Live provider integrations are supported, but the repo is runnable without keys through deterministic mock mode.
- When live provider responses include token usage metadata, RazorCascade always uses those actual counts instead of the fallback estimator.
- The xAI adapter uses the OpenAI-compatible xAI REST API path so the repo stays easy to install and run.
- The study runner focuses on cost/quality instrumentation and prompt-context management rather than mutating this repository's source files during each simulated run.
- OpenAI temperature suppression is configurable through `OPENAI_TEMPERATURE_OMIT_MODELS`, so you can update the list without changing source code when model behavior changes.
