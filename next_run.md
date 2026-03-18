# Validation Run (small, fast)
#
# Goal: confirm judge scoring, cross-provider judge, and snapshot output all
# work end-to-end before committing to a full study.
#
# What it covers:
#   - 2 configs: one baseline + its cascade pair (matched comparison)
#   - 2 runs each: enough to produce p-values, CIs, and Cohen's d
#   - Cross-provider judge: Anthropic claude-4-haiku scoring OpenAI outputs
#   - Judge repeat 2: validates judge consistency (judgeScoreStddev)
#   - Snapshots on: lets you inspect the raw prompts/responses
#   - Verbose: see debug logs for any extraction issues
#
# Estimated cost: ~$1.50–2.00 (4 × gpt-5.4 runs + judge calls)
# Estimated time: ~5–8 minutes

bun run src/study.ts --configs "baseline-openai,openai-nano" --runs 2 --judge --judge-provider anthropic --judge-model "claude-4-haiku" --judge-repeat 2 --snapshot --verbose

# What to check after it finishes:
#   1. No "Unable to parse judge score" warnings in the output
#   2. steps.csv has non-empty qualityScore for every step
#   3. summary.json shows mean_judge_agreement close to 1.0
#   4. summary.json has p-values and Cohen's d for cost/tokens/quality
#   5. snapshots/ folder contains judge JSON traces
#   6. report.md Key Findings section mentions cost savings %
#
# If all looks good, run the full study:

bun run src/study.ts --all --runs 10 --judge --judge-provider anthropic --judge-model "claude-4-haiku" --judge-repeat 2 --snapshot --verbose