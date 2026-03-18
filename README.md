# RazorCascade-Study

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
| Anthropic | `claude-4-sonnet` | `claude-4-haiku` | $3.00 / $15.00 | $1.00 / $5.00 | Strong architectural planning |
| xAI | `grok-4` | `grok-code-fast` | $2.50 / $10.00 | $0.20 / $1.00 | Fast same-provider cascade |
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
├── src/
│   ├── gate.ts
│   ├── metrics.ts
│   ├── models.ts
│   ├── study.ts
│   └── taskforge.ts
├── tests/
│   ├── gate.test.ts
│   ├── metrics.test.ts
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
ANTHROPIC_FLAGSHIP_MODEL=claude-4-sonnet
ANTHROPIC_GATE_MODEL=claude-4-haiku
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

# Capture per-step prompt/response snapshots for reproducibility
bun run study --config openai-mini --runs 1 --snapshot

# Quick dry-run for local iteration
bun run study:dry
```

## Comparing Existing Experiments

```bash
# Print a side-by-side post-hoc comparison to stdout
bun run study compare experiments/2026-03-16T15-22-12-243Z experiments/2026-03-16T18-01-10-165Z

# Save the same comparison table to a file
bun run study compare experiments/2026-03-16T15-22-12-243Z experiments/2026-03-16T18-01-10-165Z --output experiments/compare-openai.md
```

The `compare` subcommand reads each experiment folder's `summary.json`, renders a side-by-side Markdown table with the key config metrics, prints it to stdout, and can optionally write the same report to a file. It does not call any model APIs or rerun the study.

Helpful flags:

- `--dry-run`: force deterministic mock clients even if API keys exist. Generated `summary.json`, `report.md`, and `dashboard.html` artifacts are labeled as mock data.
- `--skip-tests`: skip local test execution during the study run.
- `--output-dir <path>`: write artifacts to a custom folder.
- `--cost-cap <usd>`: stop before the next run once cumulative estimated study cost already exceeds this USD amount.
- `--configs <name1,name2,...>`: run a comma-separated set of named configs together so paired baselines, cascades, and cross-provider comparisons land in the same report.
- `--mode <baseline|cascade>` with `--provider`, `--flag-model`, and `--gate-model`: run an ad hoc configuration without editing `config.json`.
- `--judge`: score each flagship response with an LLM judge instead of the built-in heuristic scorer.
- `--judge-model <model>`: optionally use a separate judge model; if omitted, the flagship model is reused.
- `--snapshot`: write per-step JSON snapshots under `snapshots/` with the exact system prompt, user prompt, model response, usage, and duration.

Judge mode sends the task objective plus the flagship response to a short rubric-based evaluator prompt and asks for a 0-10 score across completeness, correctness, clarity, and architecture. Judge calls are capped to a small output budget to control extra cost.

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
- `summary.json`: a top-level `dataSource` field (`mock` or `live`) plus a `configs` array with config-level statistics, baseline comparisons, p-values, effect sizes, and confidence intervals. When more than one provider is present, it also includes `cross_provider_comparisons` with pairwise cost ratios, token ratios, and quality deltas across providers.
- `dashboard.html`: simple zero-dependency HTML visualization with a header badge showing `Mock Data` or `Live API Data`.
- `report.md`: Markdown summary suitable for publication notes, including the significance-testing table, a cross-provider comparison table when applicable, and a header note indicating whether the run used mock clients or live API calls.
- `snapshots/` when `--snapshot` is enabled: per-call JSON traces for reproducibility and debugging.

The `study compare` subcommand is post-hoc analysis only, so it reads these existing artifacts in place and does not create a new experiment folder unless you explicitly point `--output` at a file path.

If a study stops early because of `--cost-cap`, these artifacts still reflect all completed runs up to that point.

## Quality And Analysis

The runner reports:

- Input, output, and total token counts.
- Dependency-free fallback token estimates using a weighted word + punctuation/operator heuristic when a provider omits usage metadata.
- Estimated USD cost using the March 2026 price table.
- Mean, median, min, max, and standard deviation by configuration.
- Cost and token savings versus baseline.
- Cross-provider pairwise cost ratios, token ratios, and quality deltas when multiple providers are included in the same run.
- Welch's t-test p-values for cost, token, and quality comparisons when matched baseline samples are available.
- Cohen's d effect size for cost versus the matched baseline.
- 95% confidence intervals for per-configuration cost.
- Average quality score by task and by configuration.
- Quality via either the default heuristic scorer or optional LLM-as-judge scoring with a 10-point rubric.
- Drift via missing invariants plus contradiction checks for explicit value changes, semantic storage/path mismatches, rule violations, and enum cardinality drift.
- Cached local test pass status for the current repository.
- Edge-case coverage for dry-run `--all`, ad hoc provider modes, TaskForge validation failures, gate JSON fallback, and zero-drift contradiction cases.

## Publication Tips

- License the repo under MIT.
- Keep the methodology identical across runs.
- Save generated CSVs and summaries for reproducibility.
- Pair the HTML dashboard with screenshots or charts in a paper/blog post.
- Investigate gate prompt tuning if quality drops by more than 5%.

## Notes

- Live provider integrations are supported, but the repo is runnable without keys through deterministic mock mode.
- When live provider responses include token usage metadata, RazorCascade always uses those actual counts instead of the fallback estimator.
- The xAI adapter uses the OpenAI-compatible xAI REST API path so the repo stays easy to install and run.
- The study runner focuses on cost/quality instrumentation and prompt-context management rather than mutating this repository's source files during each simulated run.
- OpenAI temperature suppression is configurable through `OPENAI_TEMPERATURE_OMIT_MODELS`, so you can update the list without changing source code when model behavior changes.
