# RazorCascade Memory Reliability Report

Generated: 2026-03-18T20:00:25.975Z
Output folder: C:\Repos\razor-cascade\experiments\2026-03-18T17-42-54-047Z
Tests: passed
Data source: live API calls

## Configuration Summary

| Config | Mean Cost (USD) | 95% Cost CI | 95% Token CI | 95% Quality CI | Mean Drift | Mean Tokens | Mean Quality | Cost Savings vs Baseline | Token Savings vs Baseline | Cost p-value | Cost p adj | Token p-value | Token p adj | Quality p-value | Quality p adj | Cost MW p | Token MW p | Cohen's d (Cost) | Cohen's d (Tokens) | Cohen's d (Quality) | Judge Agreement | Quality vs Human |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-openai | 0.2059 | [0.1980, 0.2138] | [41362.0985, 44891.9015] | [9.7182, 9.9118] | 0.00 | 43127.00 | 9.81 | 0.00 | 0.00 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| openai-nano | 0.0989 | [0.0928, 0.1050] | [55201.2655, 61352.2345] | [9.5837, 9.8038] | 0.23 | 58276.75 | 9.69 | 51.97 | -35.13 | 0.000000 (significant) | 0.000000 (significant) | 0.000001 (significant) | 0.000002 (significant) | 0.071059 (not significant) | 0.213178 (not significant) | 0.000003 (significant) | 0.000003 (significant) | -12.6983 | 5.0514 | -0.9780 | n/a | n/a |
| baseline-grok | 0.1798 | [0.1622, 0.1974] | [44661.0547, 53676.1953] | [9.7781, 9.8669] | 0.00 | 49168.63 | 9.82 | 0.00 | 0.00 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| grok | 0.0975 | [0.0932, 0.1019] | [62425.8090, 67952.6910] | [9.5380, 9.6995] | 0.76 | 65189.25 | 9.62 | 45.77 | -32.58 | 0.000006 (significant) | 0.000017 (significant) | 0.000014 (significant) | 0.000041 (significant) | 0.000292 (significant) | 0.000876 (significant) | 0.000003 (significant) | 0.000003 (significant) | -5.3614 | 3.5825 | -2.6143 | n/a | n/a |

## Key Findings

- openai-nano saved 52.0% on average vs baseline-openai (cost p = 0.000000 (significant), Cohen's d = -12.6983 large).
- openai-nano retained 98.8% of baseline quality (cascade=9.69, baseline=9.81; no statistically significant quality degradation detected).
- openai-nano token efficiency remains at -35.13% vs baseline (token p = 0.000002 (significant)).
- grok saved 45.8% on average vs baseline-grok (cost p = 0.000017 (significant), Cohen's d = -5.3614 large).
- grok retained 97.9% of baseline quality (cascade=9.62, baseline=9.82; quality degradation detected).
- grok token efficiency remains at -32.58% vs baseline (token p = 0.000041 (significant)).
- Drift score was non-zero in at least one configuration (max mean drift: 0.76).

## Methodology Note

- N runs per configuration: 8.
- Statistical tests: Welch's t-test (two-tailed), Cohen's d effect size, 95% confidence intervals, Bonferroni correction, and Mann-Whitney U where reported.

## Cross-Provider Comparisons

| Config A | Config B | Cost Ratio (A/B) | Token Ratio (A/B) | Quality Delta (A-B) |
| --- | --- | ---: | ---: | ---: |
| baseline-openai (openai, baseline) | baseline-grok (xai, baseline) | 1.1452 | 0.8771 | -0.0075 |
| baseline-openai (openai, baseline) | grok (xai, cascade) | 2.1118 | 0.6616 | 0.1963 |
| openai-nano (openai, cascade) | baseline-grok (xai, baseline) | 0.5501 | 1.1852 | -0.1287 |
| openai-nano (openai, cascade) | grok (xai, cascade) | 1.0144 | 0.8940 | 0.0751 |

## Test Output

```text
bun test v1.3.9 (cf6cdbbb)
[dotenv@17.3.1] injecting env (0) from .env -- tip: ⚙️  write to custom object with { processEnv: myObject }
[dotenv@17.3.1] injecting env (0) from .env -- tip: 🔐 prevent committing .env to code: https://dotenvx.com/precommit


tests\contradictions.test.ts:
(pass) contradictions > flags enum contradictions in summaries
(pass) contradictions > flags semantic path contradictions when storage is described in natural language
(pass) contradictions > flags enum cardinality drift when the summary claims too many values [15.00ms]
(pass) contradictions > flags reformulated storage path mismatches in a different sentence
(pass) contradictions > does not flag reformulation when the invariant path is preserved
(pass) contradictions > flags explicit unknown enum additions
(pass) contradictions > reports zero drift when no invariants are supplied
(pass) contradictions > reports zero drift when all invariants are present
(pass) contradictions > builds drift scores from missing invariants and contradictions

tests\gate.test.ts:
(pass) gate > includes compact few-shot guidance and invariant preservation instructions
(pass) gate > creates a heuristic summary with decisions, risks, snippets, and invariants
(pass) gate > parses JSON output even when fenced
(pass) gate > preserves larger invariant sets without schema overflow
{"level":"warn","timestamp":"2026-03-18T17:42:54.142Z","message":"Gate summary parsing failed; falling back to heuristic summary.","context":{"hasPreviousInvariants":true}}
(pass) gate > falls back to heuristic summarization when JSON parsing fails

tests\invariants.test.ts:
(pass) invariants > extracts deterministic architectural facts from code and prompts
(pass) invariants > merges invariant memory without duplicating facts

tests\logger.test.ts:
(pass) logger > writes JSON log lines with message and context
(pass) logger > filters out entries below the configured level
(pass) logger > supports text format output

tests\metrics.test.ts:
(pass) metrics > estimates provider cost using the configured price book
(pass) metrics > loads a configured price book and falls back to defaults for missing providers [15.00ms]
(pass) metrics > computes descriptive stats
(pass) metrics > renders csv rows and token estimates
(pass) metrics > escapes csv quotes, commas, and newlines
(pass) metrics > weights punctuation and operators when estimating code-heavy text
(pass) metrics > returns zero for empty or whitespace-only text
(pass) metrics > computes Pearson correlation for aligned and inverse samples
(pass) metrics > computes a minimum sample size from effect size, power, and alpha
(pass) metrics > applies Bonferroni correction across multiple comparisons
(pass) metrics > computes Mann-Whitney U for clearly separated groups
(pass) metrics > interprets Cohen's d and p-values for dashboard annotations
(pass) metrics > computes Welch's t-test with a known two-tailed p-value
(pass) metrics > computes Cohen's d for equal-variance samples
(pass) metrics > computes a 95 percent confidence interval for the sample mean
(pass) metrics > writes a dashboard with zoomed charts and a stable zero-drift panel [16.00ms]

tests\models.test.ts:
(pass) withRetry > retries transient failures and eventually returns the result
(pass) withRetry > rethrows non-retryable bad requests without retrying
(pass) withRetry > uses a configurable OpenAI temperature omission policy

tests\study.test.ts:
(pass) study runner > builds dashboard curve data from actual step numbers
(pass) study runner > executes baseline aliases and explicit provider baselines in dry-run mode [31.00ms]
(pass) study runner > routes every configured study through --all in dry-run mode [125.00ms]
(pass) study runner > supports --configs style matched-pair runs in one output folder [47.00ms]
(pass) study runner > supports ad hoc cascade mode with an explicit anthropic provider [32.00ms]
(pass) study runner > adds cross-provider comparisons when multiple providers are present [46.00ms]
(pass) study runner > omits cross-provider comparisons when only one provider is present [16.00ms]
(pass) study runner > creates every pairwise cross-provider comparison across four providers [16.00ms]
(pass) study runner > supports LLM judge scoring with an optional judge model in dry-run mode [47.00ms]
{"level":"warn","timestamp":"2026-03-18T17:42:54.664Z","message":"Judge scoring failed for task 1 (CLI skeleton + argument parsing) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.665Z","message":"Judge scoring failed for task 2 (Task data model + JSON persistence) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.666Z","message":"Judge scoring failed for task 3 (List, filter, and view tasks) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.667Z","message":"Judge scoring failed for task 4 (Complete/delete commands + validation) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.669Z","message":"Judge scoring failed for task 5 (Gate summarizer integration) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.670Z","message":"Judge scoring failed for task 6 (AI-assisted decomposition) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.672Z","message":"Judge scoring failed for task 7 (Code snippet generator) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.673Z","message":"Judge scoring failed for task 8 (Automated tests) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.675Z","message":"Judge scoring failed for task 9 (Refinement loop) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.677Z","message":"Judge scoring failed for task 10 (Report export) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
(pass) study runner > falls back to heuristic scoring when judge output is empty [15.00ms]
{"level":"warn","timestamp":"2026-03-18T17:42:54.687Z","message":"Cost cap of $0.0000 reached at $0.0000 before baseline-openai run 1; stopping early and writing partial results."}
(pass) study runner > stops before any run when the cost cap is exactly zero
{"level":"warn","timestamp":"2026-03-18T17:42:54.697Z","message":"Cost cap of $0.0000 reached at $0.0465 before baseline-openai run 2; stopping early and writing partial results."}
(pass) study runner > stops after the first run when a tiny positive cap is exceeded [31.00ms]
{"level":"warn","timestamp":"2026-03-18T17:42:54.764Z","message":"Cost cap of $0.1596 reached at $0.1796 before openai-mini run 2; stopping early and writing partial results."}
(pass) study runner > stops mid-study once the next config run would exceed the cap [63.00ms]
(pass) study runner > supports configurable tasks, scoring, human baselines, and richer summary fields [16.00ms]
{"level":"warn","timestamp":"2026-03-18T17:42:54.798Z","message":"Judge scoring was inconsistent for task 1 (Judge repeat task).","context":{"judgeScoreStddev":"5.6569","judgeRepeat":2}}
(pass) study runner > repeats judge scoring and records judge score variability [15.00ms]
{"level":"warn","timestamp":"2026-03-18T17:42:54.808Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: not json"}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.815Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: {\"score\":15}"}}
{"level":"warn","timestamp":"2026-03-18T17:42:54.826Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"network down"}}
(pass) study runner > falls back to heuristic scoring when judge output is malformed or unavailable [31.00ms]
(pass) study runner > writes prompt and response snapshots only when snapshot mode is enabled [63.00ms]
(pass) study runner > writes snapshots with special-character config names into nested directories [16.00ms]
(pass) study runner > compares existing experiment folders without re-running the study [46.00ms]

tests\taskforge.test.ts:
(pass) TaskForgeService > rejects empty task titles and missing task IDs [16.00ms]
(pass) TaskForgeService > adds, lists, completes, and deletes tasks
(pass) TaskForgeService > supports decomposition, refinement, and report export without live AI

 60 pass
 0 fail
 299 expect() calls
Ran 60 tests across 8 files. [906.00ms]
```
