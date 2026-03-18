If you are an agent, this is a copy of the original prompt, ignore the content of this file to avoid entering an infinite loop

---

You are an expert agentic coding assistant. Build me the complete, ready-to-run GitHub repo for the "RazorCascade (Bun Edition)" study right now.

Project name: RazorCascade-Study
Language: TypeScript + Bun (runtime Bun 1.2+)
License: MIT
Style: Clean, modern ESM, fully typed

Core idea: Prove that same-provider model cascading (cheap gate summarizes before flagship) saves 40-60% API cost with zero quality loss. Use 10 statistical runs per config for robust data.

Requirements:
1. Full folder structure:
   - README.md (full hypothesis, methodology, exact 10 tasks, supported providers/models with March 2026 pricing table, how to run every config, expected graphs section, publication tips)
   - .env.example (OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY)
   - config.json (default configs array with the 5 setups: baseline, openai-mini, openai-nano, anthropic, grok)
   - src/taskforge.ts (the incremental CLI tool — use Bun.file for JSON persistence, Commander or simple args)
   - src/gate.ts (ruthless 400-600 token summarizer with structured output: goal, decisions, risks, snippets)
   - src/models.ts (abstraction layer supporting OpenAI, Anthropic, xAI via official SDKs)
   - src/metrics.ts (token + real $ cost logging using March 2026 prices, CSV output, stats: mean/median/stddev)
   - src/study.ts (main runner: supports --mode baseline|cascade, --provider openai|anthropic|xai, --flag-model, --gate-model, --runs 10, --config <name> or --all)
   - experiments/ (auto-generated CSVs and simple Plotly or console charts)
   - package.json (with bun scripts: "study": "bun run src/study.ts", all deps listed)
   - tsconfig.json + .gitignore

2. Dependencies (bun add):
   - dotenv
   - commander
   - openai
   - @anthropic-ai/sdk
   - @ai-sdk/xai (for Grok)
   - zod (for safe parsing)

3. Model names to hard-code as defaults (use exact 2026 names):
   - OpenAI: gpt-5.4 (flag), gpt-5-mini (gate), gpt-5-nano (gate)
   - Anthropic: claude-4-sonnet (flag), claude-4-haiku (gate)
   - xAI: grok-4 (flagship), grok-code-fast (or grok-4.20-beta-lite if available)

4. CLI examples in README:
   bun run study --config baseline --runs 10
   bun run study --config openai-mini --runs 10
   bun run study --all --runs 10

5. Gate prompt: "You are a ruthless context compressor. Given full history + latest changes, output ONLY structured JSON: {goal, decisions: [], risks: [], snippets: []}. Max 600 tokens total."

6. The 10 tasks remain exactly:
   1. CLI skeleton
   2. Task model + JSON persistence
   3. List/filter/view
   4. Complete/delete + errors
   5. Integrate gate
   6. AI task decomposition
   7. Code snippet generator
   8. Automated tests
   9. Refinement loop
   10. Report export

7. Make the runner automatically execute 10 full cycles per config, log everything, and produce summary statistics + cost-savings charts.

Generate every file as separate, copy-paste-ready code blocks. Start with README.md, then package.json, then each .ts file. Make it production-quality, publication-ready, and dead simple to run on any laptop with Bun. Begin now.