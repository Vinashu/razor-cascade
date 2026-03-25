# RazorCascade Memory Reliability Report

Generated: 2026-03-25T07:41:29.575Z
Output folder: C:\Repos\razor-cascade\experiments\2026-03-25T02-27-04-568Z
Tests: passed
Data source: live API calls

## Configuration Summary

| Config | Mean Cost (USD) | 95% Cost CI | 95% Token CI | 95% Quality CI | Mean Drift | Mean Tokens | Mean Quality | Cost Savings vs Baseline | Token Savings vs Baseline | Cost p-value | Cost p adj | Token p-value | Token p adj | Quality p-value | Quality p adj | Cost MW p | Token MW p | Cohen's d (Cost) | Cohen's d (Tokens) | Cohen's d (Quality) | Judge Agreement | Quality vs Human |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-openai | 0.2098 | [0.2044, 0.2153] | [42344.7619, 44614.8381] | [9.3067, 9.5433] | 0.00 | 43479.80 | 9.43 | 0.00 | 0.00 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.9908 | n/a |
| openai-mini | 0.1355 | [0.1323, 0.1387] | [65080.5126, 67963.6874] | [9.0495, 9.3405] | 2.69 | 66522.10 | 9.20 | 35.41 | -53.00 | 0.000000 (significant) | 0.000000 (significant) | 0.000000 (significant) | 0.000000 (significant) | 0.012841 (significant) | 0.038524 (significant) | 0.000000 (significant) | 0.000000 (significant) | -11.9410 | 12.7050 | -1.2408 | 0.9936 | n/a |
| openai-nano | 0.1054 | [0.1022, 0.1087] | [71086.8571, 76610.3429] | [9.0171, 9.3029] | 2.96 | 73848.60 | 9.16 | 49.76 | -69.85 | 0.000000 (significant) | 0.000000 (significant) | 0.000000 (significant) | 0.000000 (significant) | 0.004791 (significant) | 0.014373 (significant) | 0.000000 (significant) | 0.000000 (significant) | -16.7117 | 10.2894 | -1.4452 | 0.9915 | n/a |
| baseline-grok | 0.2589 | [0.2348, 0.2830] | [48184.9735, 56850.0265] | [8.9708, 9.0292] | 0.00 | 52517.50 | 9.00 | 0.00 | 0.00 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.9986 | n/a |
| grok | 0.1336 | [0.1295, 0.1376] | [63507.3501, 66620.6499] | [8.4625, 8.8175] | 0.32 | 65064.00 | 8.64 | 48.40 | -23.89 | 0.000001 (significant) | 0.000002 (significant) | 0.000063 (significant) | 0.000189 (significant) | 0.001252 (significant) | 0.003756 (significant) | 0.000000 (significant) | 0.000000 (significant) | -5.1945 | 2.7571 | -2.0248 | 0.9943 | n/a |
| baseline-gemini | 0.0670 | [0.0590, 0.0749] | [21060.8944, 27176.7056] | [7.3409, 8.3771] | 0.00 | 24118.80 | 7.86 | 0.00 | 0.00 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0.9874 | n/a |
| gemini | 0.0616 | [0.0595, 0.0637] | [39758.6309, 43355.3691] | [8.0655, 8.4645] | 0.46 | 41557.00 | 8.27 | 8.06 | -72.30 | 0.174104 (not significant) | 0.522311 (not significant) | 0.000000 (significant) | 0.000000 (significant) | 0.124817 (not significant) | 0.374450 (not significant) | 0.016157 (significant) | 0.000000 (significant) | -0.6531 | 4.9730 | 0.7398 | 0.9936 | n/a |

## Key Findings

- openai-mini saved 35.4% on average vs baseline-openai (cost p = 0.000000 (significant), Cohen's d = -11.9410 large).
- openai-mini retained 97.6% of baseline quality (cascade=9.20, baseline=9.43; quality degradation detected).
- openai-mini token efficiency remains at -53.00% vs baseline (token p = 0.000000 (significant)).
- openai-nano saved 49.8% on average vs baseline-openai (cost p = 0.000000 (significant), Cohen's d = -16.7117 large).
- openai-nano retained 97.2% of baseline quality (cascade=9.16, baseline=9.43; quality degradation detected).
- openai-nano token efficiency remains at -69.85% vs baseline (token p = 0.000000 (significant)).
- grok saved 48.4% on average vs baseline-grok (cost p = 0.000002 (significant), Cohen's d = -5.1945 large).
- grok retained 96.0% of baseline quality (cascade=8.64, baseline=9.00; quality degradation detected).
- grok token efficiency remains at -23.89% vs baseline (token p = 0.000189 (significant)).
- gemini saved 8.1% on average vs baseline-gemini (cost p = 0.522311 (not significant), Cohen's d = -0.6531 medium).
- gemini retained 105.2% of baseline quality (cascade=8.27, baseline=7.86; no statistically significant quality degradation detected).
- gemini token efficiency remains at -72.30% vs baseline (token p = 0.000000 (significant)).
- Drift score was non-zero in at least one configuration (max mean drift: 2.96).

## Methodology Note

- N runs per configuration: 10.
- Statistical tests: Welch's t-test (two-tailed), Cohen's d effect size, 95% confidence intervals, Bonferroni correction, and Mann-Whitney U where reported.

## Cross-Provider Comparisons

| Config A | Config B | Cost Ratio (A/B) | Token Ratio (A/B) | Quality Delta (A-B) |
| --- | --- | ---: | ---: | ---: |
| baseline-openai (openai, baseline) | baseline-grok (xai, baseline) | 0.8104 | 0.8279 | 0.4250 |
| baseline-openai (openai, baseline) | grok (xai, cascade) | 1.5704 | 0.6683 | 0.7850 |
| baseline-openai (openai, baseline) | baseline-gemini (gemini, baseline) | 3.1313 | 1.8027 | 1.5660 |
| baseline-openai (openai, baseline) | gemini (gemini, cascade) | 3.4058 | 1.0463 | 1.1600 |
| openai-mini (openai, cascade) | baseline-grok (xai, baseline) | 0.5234 | 1.2667 | 0.1950 |
| openai-mini (openai, cascade) | grok (xai, cascade) | 1.0142 | 1.0224 | 0.5550 |
| openai-mini (openai, cascade) | baseline-gemini (gemini, baseline) | 2.0224 | 2.7581 | 1.3360 |
| openai-mini (openai, cascade) | gemini (gemini, cascade) | 2.1997 | 1.6007 | 0.9300 |
| openai-nano (openai, cascade) | baseline-grok (xai, baseline) | 0.4071 | 1.4062 | 0.1600 |
| openai-nano (openai, cascade) | grok (xai, cascade) | 0.7889 | 1.1350 | 0.5200 |
| openai-nano (openai, cascade) | baseline-gemini (gemini, baseline) | 1.5731 | 3.0619 | 1.3010 |
| openai-nano (openai, cascade) | gemini (gemini, cascade) | 1.7110 | 1.7770 | 0.8950 |
| baseline-grok (xai, baseline) | baseline-gemini (gemini, baseline) | 3.8642 | 2.1775 | 1.1410 |
| baseline-grok (xai, baseline) | gemini (gemini, cascade) | 4.2029 | 1.2637 | 0.7350 |
| grok (xai, cascade) | baseline-gemini (gemini, baseline) | 1.9940 | 2.6976 | 0.7810 |
| grok (xai, cascade) | gemini (gemini, cascade) | 2.1688 | 1.5657 | 0.3750 |

## Test Output

```text
bun test v1.3.9 (cf6cdbbb)
[dotenv@17.3.1] injecting env (0) from .env -- tip: ⚙️  enable debug logging with { debug: true }
[dotenv@17.3.1] injecting env (0) from .env -- tip: 🤖 agentic secret storage: https://dotenvx.com/as2


tests\contradictions.test.ts:
(pass) contradictions > flags enum contradictions in summaries
(pass) contradictions > flags semantic path contradictions when storage is described in natural language
(pass) contradictions > flags enum cardinality drift when the summary claims too many values
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
{"level":"warn","timestamp":"2026-03-25T02:27:04.687Z","message":"Gate summary parsing failed; falling back to heuristic summary.","context":{"hasPreviousInvariants":true,"parseError":"Unable to locate JSON content in gate output.","rawTextPreview":"this is not valid json"}}
(pass) gate > falls back to heuristic summarization when JSON parsing fails

tests\invariants.test.ts:
(pass) invariants > extracts deterministic architectural facts from code and prompts [15.00ms]
(pass) invariants > merges invariant memory without duplicating facts

tests\logger.test.ts:
(pass) logger > writes JSON log lines with message and context
(pass) logger > filters out entries below the configured level
(pass) logger > supports text format output

tests\metrics.test.ts:
(pass) metrics > estimates provider cost using the configured price book
(pass) metrics > loads a configured price book and falls back to defaults for missing providers
(pass) metrics > computes descriptive stats [16.00ms]
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
(pass) metrics > writes a dashboard with zoomed charts and a stable zero-drift panel [31.00ms]

tests\models.test.ts:
(pass) withRetry > retries transient failures and eventually returns the result
(pass) withRetry > rethrows non-retryable bad requests without retrying
(pass) withRetry > uses a configurable OpenAI temperature omission policy

tests\study.test.ts:
(pass) study runner > builds dashboard curve data from actual step numbers
(pass) study runner > executes baseline aliases and explicit provider baselines in dry-run mode [47.00ms]
(pass) study runner > routes every configured study through --all in dry-run mode [141.00ms]
(pass) study runner > supports --configs style matched-pair runs in one output folder [47.00ms]
(pass) study runner > supports ad hoc cascade mode with an explicit anthropic provider [31.00ms]
(pass) study runner > adds cross-provider comparisons when multiple providers are present [63.00ms]
(pass) study runner > omits cross-provider comparisons when only one provider is present [15.00ms]
(pass) study runner > creates every pairwise cross-provider comparison across four providers [31.00ms]
(pass) study runner > supports LLM judge scoring with an optional judge model in dry-run mode [32.00ms]
{"level":"warn","timestamp":"2026-03-25T02:27:05.308Z","message":"Judge scoring failed for task 1 (CLI skeleton + argument parsing) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.310Z","message":"Judge scoring failed for task 2 (Task data model + JSON persistence) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.311Z","message":"Judge scoring failed for task 3 (List, filter, and view tasks) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.313Z","message":"Judge scoring failed for task 4 (Complete/delete commands + validation) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.315Z","message":"Judge scoring failed for task 5 (Gate summarizer integration) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.316Z","message":"Judge scoring failed for task 6 (AI-assisted decomposition) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.318Z","message":"Judge scoring failed for task 7 (Code snippet generator) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.320Z","message":"Judge scoring failed for task 8 (Automated tests) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.322Z","message":"Judge scoring failed for task 9 (Refinement loop) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.324Z","message":"Judge scoring failed for task 10 (Report export) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: "}}
(pass) study runner > falls back to heuristic scoring when judge output is empty [31.00ms]
{"level":"warn","timestamp":"2026-03-25T02:27:05.338Z","message":"Cost cap of $0.0000 reached at $0.0000 before baseline-openai run 1; stopping early and writing partial results."}
(pass) study runner > stops before any run when the cost cap is exactly zero
{"level":"warn","timestamp":"2026-03-25T02:27:05.356Z","message":"Cost cap of $0.0000 reached at $0.0465 before baseline-openai run 2; stopping early and writing partial results."}
(pass) study runner > stops after the first run when a tiny positive cap is exceeded [31.00ms]
{"level":"warn","timestamp":"2026-03-25T02:27:05.435Z","message":"Cost cap of $0.1596 reached at $0.1796 before openai-mini run 2; stopping early and writing partial results."}
(pass) study runner > stops mid-study once the next config run would exceed the cap [78.00ms]
(pass) study runner > supports configurable tasks, scoring, human baselines, and richer summary fields [16.00ms]
{"level":"warn","timestamp":"2026-03-25T02:27:05.471Z","message":"Judge scoring was inconsistent for task 1 (Judge repeat task).","context":{"judgeScoreStddev":"5.6569","judgeRepeat":2}}
(pass) study runner > repeats judge scoring and records judge score variability [16.00ms]
{"level":"warn","timestamp":"2026-03-25T02:27:05.485Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: not json"}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.494Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"Unable to parse judge score from response: {\"score\":15}"}}
{"level":"warn","timestamp":"2026-03-25T02:27:05.503Z","message":"Judge scoring failed for task 1 (Judge fallback task) on repeat 1/1; falling back to heuristic scoring for that repeat.","context":{"reason":"network down"}}
(pass) study runner > falls back to heuristic scoring when judge output is malformed or unavailable [46.00ms]
(pass) study runner > writes prompt and response snapshots only when snapshot mode is enabled [47.00ms]
(pass) study runner > writes snapshots with special-character config names into nested directories [16.00ms]
(pass) study runner > compares existing experiment folders without re-running the study [62.00ms]

tests\taskforge.test.ts:
(pass) TaskForgeService > rejects empty task titles and missing task IDs
(pass) TaskForgeService > adds, lists, completes, and deletes tasks [16.00ms]
(pass) TaskForgeService > supports decomposition, refinement, and report export without live AI

 60 pass
 0 fail
 299 expect() calls
Ran 60 tests across 8 files. [1073.00ms]
```
