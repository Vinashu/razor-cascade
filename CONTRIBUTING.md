# Contributing To RazorCascade

Thanks for helping improve RazorCascade. This repository is intentionally small and test-driven, so changes are easiest to review when they stay focused and deterministic.

## Prerequisites

- Bun 1.2 or newer
- TypeScript 5.9 or newer
- Optional API keys for live provider runs

## Setup

```bash
bun install
```

Copy `.env.example` to `.env` and fill in any provider keys you plan to use for live runs.

## Running Tests

```bash
bun test
bun test --watch
```

## Running The Study

```bash
bun run study --dry-run
bun run study --all --runs 10
```

Dry runs are the safest way to validate changes locally because they use deterministic mock clients.

## Adding A Provider

Implement the `ModelClient` interface in `src/models.ts`, add the provider's pricing to `config.json`, and make sure the environment wiring can resolve its API key and default models.

## Adding Study Tasks

Edit the `tasks` array in `config.json`. Keep task numbers stable so historical summaries remain comparable.

## Code Style

- Prefer strict TypeScript
- Use Zod at config and boundary layers
- Avoid `any`
- Keep tests close to the behavior they protect
