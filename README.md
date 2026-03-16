# RazorCascade-Study

RazorCascade is a reproducible TypeScript + Bun study scaffold for measuring whether same-provider model cascading reduces API cost during incremental software development without materially degrading quality. The repository ships with a working `TaskForge` CLI, provider adapters for OpenAI, Anthropic, and xAI, a gate summarizer, study runner, metrics pipeline, and automated tests.

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

OPENAI_FLAGSHIP_MODEL=gpt-5.4
OPENAI_GATE_MODEL=gpt-5-mini
ANTHROPIC_FLAGSHIP_MODEL=claude-4-sonnet
ANTHROPIC_GATE_MODEL=claude-4-haiku
XAI_FLAGSHIP_MODEL=grok-4
XAI_GATE_MODEL=grok-code-fast
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

# Every configured setup
bun run study --all --runs 10
```

Helpful flags:

- `--dry-run`: force deterministic mock clients even if API keys exist.
- `--skip-tests`: skip local test execution during the study run.
- `--output-dir <path>`: write artifacts to a custom folder.
- `--mode <baseline|cascade>` with `--provider`, `--flag-model`, and `--gate-model`: run an ad hoc configuration without editing `config.json`.

## Gate Prompt

The summarizer in [`src/gate.ts`](./src/gate.ts) uses this default system prompt:

```text
You are a ruthless context compressor for agentic coding workflows.
Given the full conversation history + latest code/output, output ONLY valid JSON:
{
  "goal": "1-sentence current project goal",
  "decisions": ["key architectural decisions", "..."],
  "risks": ["max 3 open questions or risks"],
  "snippets": ["only the most relevant code blocks, total <200 tokens"]
}
Max 600 tokens total. Be concise, faithful, and eliminate redundancy.
```

## Outputs

Each study execution writes a timestamped folder under `experiments/` containing:

- `steps.csv`: per-step token, duration, cost, and quality metrics.
- `runs.csv`: per-run aggregate results.
- `summary.json`: config-level statistics and baseline comparisons.
- `dashboard.html`: simple zero-dependency HTML visualization.
- `report.md`: Markdown summary suitable for publication notes.

## Quality And Analysis

The runner reports:

- Input, output, and total token counts.
- Estimated USD cost using the March 2026 price table.
- Mean, median, min, max, and standard deviation by configuration.
- Cost and token savings versus baseline.
- Average quality score by task and by configuration.
- Cached local test pass status for the current repository.

## Publication Tips

- License the repo under MIT.
- Keep the methodology identical across runs.
- Save generated CSVs and summaries for reproducibility.
- Pair the HTML dashboard with screenshots or charts in a paper/blog post.
- Investigate gate prompt tuning if quality drops by more than 5%.

## Notes

- Live provider integrations are supported, but the repo is runnable without keys through deterministic mock mode.
- The xAI adapter uses the OpenAI-compatible xAI REST API path so the repo stays easy to install and run.
- The study runner focuses on cost/quality instrumentation and prompt-context management rather than mutating this repository's source files during each simulated run.
