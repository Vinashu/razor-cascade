# RazorCascade Protocol: Model Cascading for Cost-Efficient Incremental Software Development

**Project Overview**  
RazorCascade is a reproducible study demonstrating that using a same-provider cheaper "gate" model to summarize context before every major step to a flagship model reduces total API cost by 40–60% (with statistical significance across multiple runs) while preserving ≥95% of baseline code quality, coherence, test pass rate, and architectural stability.

The name "RazorCascade" evokes Elon Musk-style efficiency: razor-sharp pruning of unnecessary tokens in a staged cascade — a cheap booster stage clears junk, and the flagship upper stage delivers precision.

## Hypothesis

Using same-provider model cascading (a low-cost gate model summarizes the full conversation history + latest changes into a concise 400–600 token summary before passing it to the flagship model for execution) across 10 statistical runs will reduce total API cost by 40–60% (p < 0.01) while maintaining ≥95% of baseline performance on code quality, functional correctness, and maintainability.

## Methodology

1. **Project to build**: TaskForge — a lightweight CLI task manager written in TypeScript (using Bun runtime). It supports creating/listing/completing tasks, AI-assisted decomposition, code snippet generation, automated tests, refinement loops, and report export. (Fully general-purpose for any programming workflow.)

2. **Incremental development**: Build the tool over exactly 10 standardized tasks (listed below).

3. **Runs**: Execute the full 10-task sequence **10 times** per configuration to gather robust statistics (mean, median, stddev on tokens used, estimated $, quality score 0–10 from manual review or automated tests).

4. **Configurations compared**:
   - **Baseline**: All steps use only the flagship model (full history passed every time).
   - **Cascades**: After each task, the gate model produces a structured summary; only this summary + new task prompt goes to the flagship.

5. **Metrics collected**:
   - Input/output tokens per step and total
   - Estimated cost (using provider pricing)
   - Task success rate (tests pass?)
   - Human-rated quality (coherence, bug-free code, architecture)
   - Fixes needed post-generation

6. **Implementation**: TypeScript + Bun, with `.env` for API keys and `config.json` or CLI flags to select models/providers.

## The 10 Incremental Tasks

1. CLI skeleton + argument parsing (basic commands: add, list, complete).
2. Task data model + JSON file persistence.
3. List, filter, and view tasks (by status, priority, etc.).
4. Mark complete / delete tasks + basic error handling and validation.
5. Integrate the summarization gate (first test of cascade).
6. AI-assisted task decomposition (break high-level goals into subtasks).
7. Code-snippet generator module (generate boilerplate code from description).
8. Automated testing suite (unit tests with coverage reporting).
9. Refinement/iteration loop (improve existing features based on feedback).
10. Report generation + simple export (Markdown summary + optional HTML dashboard).

## Supported Providers & Models (March 2026 Approximate Pricing)

Pricing per 1M tokens (input / output). Values based on public API docs and may vary slightly.

| Provider   | Flagship (Execution)          | Gate (Summarizer)          | Input / Output Pricing (Flagship) | Input / Output Pricing (Gate) | Notes |
|------------|-------------------------------|----------------------------|-----------------------------------|-------------------------------|-------|
| OpenAI    | gpt-5.4                      | gpt-5-mini                | $2.50 / $15.00                   | $0.25 / $2.00                | Balanced reasoning |
| OpenAI    | gpt-5.4                      | gpt-5-nano                | $2.50 / $15.00                   | $0.05 / $0.40                | Cheapest & fastest |
| Anthropic | claude-4-sonnet (or 4.5/4.6) | claude-4-haiku (or 4.5)   | $3.00 / $15.00                   | $1.00 / $5.00                | Strong on code structure |
| xAI       | grok-4 (or grok-4.20-beta)   | grok-code-fast (or grok-4-fast) | $2.00–$3.00 / $6.00–$15.00     | $0.20 / $0.50–$1.50          | Fast inference, low hallucination |

Use exact model strings from provider docs (e.g., `gpt-5.4`, `claude-4-sonnet-20260215`, `grok-4.20-beta-0309`).

## Setup & Running the Study

### Prerequisites
- Bun runtime[](https://bun.sh)
- API keys for chosen providers

### Folder Structure (Expected)

```text
RazorCascade-Study/
├── README.md               # This file
├── .env.example
├── config.json             # Default configs
├── package.json
├── src/
│   ├── taskforge.ts        # The app being built incrementally
│   ├── gate.ts             # Summarizer logic + prompt
│   ├── models.ts           # Provider abstractions (OpenAI, Anthropic, xAI)
│   ├── metrics.ts          # Logging, cost calc, stats
│   └── study.ts            # Main runner
└── experiments/            # Generated CSVs + summaries
```

### .env File
```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=...

OPEN_AI_FLAGSHIP_MODEL=gpt-5.4
OPEN_AI_GATE_MODEL=gpt-5-mini
ANTHROPIC_GATE_MODEL=claude-4-sonnet
XAI_GATE_MODEL=grok-4
```

## Example Commands (from study.ts)
```bash
# Baseline 10 runs (OpenAI flagship only)
bun run src/study.ts --config baseline --runs 10

# OpenAI cascade with mini gate
bun run src/study.ts --config openai-mini --runs 10

# Anthropic cascade
bun run src/study.ts --config anthropic --runs 10

# All configs, 10 runs each
bun run src/study.ts --all --runs 10
```
## Gate Prompt Template (in gate.ts)
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

## Expected Results & Analysis
- Generate CSV with columns: config, run_id, total_tokens, total_cost_usd, quality_score, tests_passed, etc.
- Compute savings % = (baseline_cost - cascade_cost) / baseline_cost
- Plot bar charts (tokens/cost saved per config) for the paper/blog.
- Quality delta should be minimal; if >5% drop, investigate prompt tuning.

## Publication Tips
- Repo: MIT license, clean code, detailed README.
- Paper: Short study format for arXiv / ICSE tool track / NeurIPS agent workshop.
- Title idea: "RazorCascade: Same-Provider Model Cascading Reduces API Costs by 40–60% in Incremental Agentic Coding"
- Blog: Share graphs + "How I cut my $100/mo AI bill while shipping faster"

This protocol turns quota frustration into measurable productivity. Fork, run, iterate — and publish the numbers!