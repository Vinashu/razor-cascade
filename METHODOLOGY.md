# RazorCascade Methodology

## Experimental Design

RazorCascade uses a matched-pair repeated-measures design. Each configuration is evaluated across the same task sequence so the results can be compared run-to-run instead of across unrelated prompts.

The study records cost, token usage, quality scores, and drift metrics for each step and aggregates them into per-run and per-configuration summaries. This keeps the analysis focused on differences introduced by the configuration rather than differences in task mix.

## Statistical Tests

Welch's t-test is used for pairwise comparisons because the compared configurations may have different variances. Cohen's d is reported alongside p-values to show standardized effect size, not just statistical significance.

The summary reports 95% confidence intervals for cost and quality-related aggregates so readers can see the likely range of outcomes, not only the mean.

## Multiple Comparisons

When several configurations are compared in the same study, the report applies Bonferroni correction to reduce the chance of false positives from repeated hypothesis testing.

## Quality Scoring

Quality is scored with a heuristic rubric by default, and optionally with an LLM judge. The heuristic scorer uses task keywords, structural cues, response length, and test status as signals.

The judge path is intended to validate the heuristic rather than replace the broader study design. If the judge is noisy or inconsistent, the study can fall back to the heuristic score.

## Drift Detection

Drift detection follows a simple pipeline: extract invariants, summarize the gate output, and compare the summary against the stable facts. The contradiction checks look for explicit loss of information, reformulations that point to different paths or rules, and cardinality changes that add unsupported values.

## Threats To Validity

Mock runs are deterministic and useful for tests, but they do not reflect live provider variance. Heuristic scoring can saturate on high-quality outputs. A fixed task sequence is good for repeatability, but it does not guarantee generalization to other projects.

## Reproducibility

The study writes CSV, JSON, Markdown, and HTML artifacts into timestamped experiment folders. Configuration is kept in `config.json`, which makes provider settings, tasks, scoring, and thresholds easy to review and reproduce.
