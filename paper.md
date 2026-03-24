# RazorCascade: Same-Provider Model Cascading Cuts API Costs by 46–52% in Incremental Agentic Coding

**Authors:** Rogerio de Leon Pereira, Claude (Anthropic), Grok (xAI), GPT (OpenAI)  
**Date:** March 2026  
**Repository:** [github.com/vinashu/razor-cascade](https://github.com/vinashu/razor-cascade)  
**License:** MIT

---

## Use of AI Disclaimer
Rogerio de Leon Pereira served as the human-in-the-loop. He idealized the study and orchestrated AI agents to brainstorm ideas, build the codebase, analyze the data, write and review the report.

---

## Errors 

[error] 2026-03-24T15:05:24.718Z Step 2 (Task data model + JSON persistence) failed for baseline-gemini run 1; skipping step and continuing. {"reason":"{\"error\":{\"code\":503,\"message\":\"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.\",\"status\":\"UNAVAILABLE\"}}"}
[error] 2026-03-24T15:10:26.278Z Step 2 (Task data model + JSON persistence) failed for gemini run 1; skipping step and continuing. {"reason":"{\"error\":{\"code\":503,\"message\":\"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.\",\"status\":\"UNAVAILABLE\"}}"}

---

## Log

Artifacts written to C:\Repos\razor-cascade\experiments\2026-03-24T14-25-51-474Z

Mean cost
baseline-openai #########                0.21
openai-mini    ######                   0.14
openai-nano    ####                     0.1
baseline-anthropic ######################## 0.56
anthropic      ####################     0.47
baseline-grok  ########                 0.2
grok           ######                   0.13
baseline-gemini ##                       0.05
gemini         ##                       0.05

Mean tokens
baseline-openai ######                   43711
openai-mini    #########                66537
openai-nano    ##########               68700
baseline-anthropic ###############          108453
anthropic      ######################## 169531
baseline-grok  ######                   41193
grok           #########                64832
baseline-gemini ##                       16634
gemini         #####                    34340

Mean drift
baseline-openai #                        0
openai-mini    #                        2.3
openai-nano    #                        2.2
baseline-anthropic #                        0
anthropic      ######################## 67.6
baseline-grok  #                        0
grok           #                        1.1
baseline-gemini #                        0
gemini         #                        0.3

---

## Abstract

Agentic coding workflows that build software step-by-step accumulate large conversation histories, and the cost of sending all that context to a flagship model grows fast with each step. We present RazorCascade, an open-source study platform that measures a simple intervention: before each execution step, a cheap same-provider gate model compresses the full history into a structured JSON summary of about 400–600 tokens, and only that summary goes to the flagship model. We ran the full 10-task incremental build of a CLI application (TaskForge) eight times per configuration, using live API calls to OpenAI (gpt-5.4 + gpt-5-nano) and xAI (grok-4 + grok-code-fast). The OpenAI cascade reduced mean cost by 52.0% (p < 0.001, Cohen's d = −12.7) while retaining 98.8% of baseline quality, with no statistically significant quality degradation after Bonferroni correction. The xAI cascade reduced cost by 45.8% (p < 0.001, d = −5.4) and kept 97.9% quality, though a small quality drop was detected. All 32 cascade runs passed every test. These numbers confirm that same-provider model cascading is a practical, low-effort technique for developers and teams who want to keep using their current provider but need to control spend in multi-step agentic pipelines.

---

## 1. Introduction

The way we pay for large language models has changed. What used to be flat subscriptions or vague compute budgets is now a granular token economy: you pay per million tokens of input and output, with outputs often costing 3 to 10 times more than inputs [1, 2]. For casual use—a few chat turns, a code explanation—this is fine. The problem starts when models are used as agents that build software incrementally, because the conversation history grows with every step.

Consider a typical agentic coding session where a model builds a CLI tool across ten tasks: parsing arguments, adding persistence, writing tests, generating reports. By step ten, the full history might contain 40,000 to 55,000 tokens. Sending all of that to a flagship model at $2.50–$3.00 per million input tokens and $10.00–$15.00 per million output tokens adds up. And this is one session. Teams running multiple agents, or open-source frameworks like OpenClaw [3] that orchestrate 24/7 agent fleets, report daily bills reaching hundreds of dollars when context is not managed [4].

Jensen Huang, at the NVIDIA GTC 2026 keynote, described modern data centers as "token factories" and framed the Vera Rubin platform as delivering up to 10x inference throughput per watt [5]. Hardware improvements lower the floor for everyone. But they do not solve the application-layer problem: if you keep feeding the flagship model a full, growing conversation history at every step, you are wasting most of those tokens on context the model has already processed.

The idea behind model cascading is not new. FrugalGPT [6] showed that routing queries through a cascade of progressively more capable models can cut costs by 20–98% without hurting accuracy. More recent work has specialized this idea to agents and software engineering: ACON [7] demonstrated 26–54% memory and token reduction in long-horizon agents, Active Context Compression [8] achieved up to 57% token savings on SWE-bench coding tasks with no accuracy loss, and FlowMind [9] reported 34–72% reduction through an explicit execute-then-summarize stage. A recent survey on dynamic model routing [10] synthesizes these results and notes the approach is broadly applicable.

What is missing from the literature is a focused, reproducible study that answers a narrow practical question: if I pick one provider—say OpenAI or xAI—and use only their cheaper model as a summarization gate before their flagship, how much do I actually save, and does the code still work?

This is what RazorCascade measures. We do not claim novelty in the cascading idea. We claim a clean, reproducible quantification of same-provider cascading applied to incremental software development, with statistical rigor (Welch's t-test, Mann-Whitney U, Cohen's d, Bonferroni correction, confidence intervals) and all artifacts (CSVs, JSONs, dashboards) published for verification.

---

## 2. Background and Related Work

### 2.1 The Token Economy

The shift to per-token billing has been fast. In early 2024, a flagship model like GPT-4 Turbo cost $10/$30 per million tokens (input/output). By March 2026, gpt-5.4 costs $2.50/$15.00 and xAI's grok-4 sits at $2.50/$10.00 [11]. Prices dropped an order of magnitude in two years. But consumption grew faster. The pattern matches what economists call the Jevons paradox [12]: as the unit cost of a resource falls, total spending on it increases because people use much more of it. In the case of LLM tokens, agentic workflows, code generation loops, and persistent agent frameworks drove consumption up far beyond what the price cuts returned.

Anthropic's 2026 Agentic Coding Trends Report [13] and Google's Active Context Engineering work [14] both note that uncontrolled context growth is the primary cost driver in agent pipelines. Both providers have responded with ecosystem-level tools—Anthropic with Claude Code and Model Context Protocol donations [15], Google with Gemini ADK and long-context optimizations—but neither has published controlled experiments quantifying exactly how much a same-provider cascade saves for incremental development.

### 2.2 Context Compression and Summarization

Context compression for LLMs is an active research area. Approaches range from learned soft prompts [16] to extractive summarization to attention-based compression [17]. For agentic workflows, the most relevant line of work is explicit summarization between steps, because it does not require model retraining or architectural changes.

ACON (Kang et al., 2025) [7] introduced adaptive context optimization for long-horizon agents, reporting 26–54% token reduction while maintaining over 95% task accuracy. The approach distills prior trajectory into a compact representation. Active Context Compression (Verma et al., 2026) [8] specialized this to software engineering agents on SWE-bench, achieving up to 57% token savings with identical resolution accuracy. FlowMind (2026) [9] added an explicit summarize step after each execution round, reducing tokens by 34–72%.

Our approach is closest to FlowMind's architecture, but differs in three ways: we restrict the gate and flagship to the same provider (testing within-ecosystem coherence), we measure across repeated runs with statistical tests (not single-run comparisons), and we target incremental application development rather than single-issue resolution.

### 2.3 Model Cascading and Routing

The cascading idea comes from FrugalGPT (Chen et al., 2023) [6], which showed that routing queries through cheap-to-expensive model chains achieves strong cost–quality tradeoffs. Later work like Orla [18] applied multi-agent stage mapping to reduce inference cost by 35%, and the dynamic model routing survey (2026) [10] cataloged techniques achieving 20–98% cost reductions across domains.

Most of these systems route across providers or across model families. Our contribution is narrower: we study same-provider cascading (e.g., gpt-5-nano gate + gpt-5.4 flagship, both OpenAI) because this is what developers actually do in practice. Switching providers introduces latency from different endpoints, potential style or format inconsistencies, and credential management overhead. Same-provider cascading avoids all of that.

### 2.4 Awareness Gap

A practical observation motivates this work. Explanatory resources from McKinsey, IBM, and DataCamp define the context window as "working memory," but surveys show most developers treat it as an implementation detail, not a cost lever [19]. Advanced techniques like hierarchical summarization, attention masking, and autonomous context pruning remain niche. "Context engineering" is an emerging term but is far from mainstream [20]. A simple, drop-in cascade that works within one provider's ecosystem is more likely to be adopted than techniques that require deep prompt engineering knowledge.

---

## 3. Methodology

### 3.1 The Application: TaskForge

TaskForge is a lightweight CLI task manager written in TypeScript, running on the Bun runtime. It supports creating, listing, completing, and deleting tasks; AI-assisted decomposition of high-level goals into subtasks; code snippet generation from descriptions; automated tests with coverage; a refinement loop driven by feedback; and report export to Markdown and HTML.

We chose this application because it is representative of the kind of small-to-medium tool that developers build iteratively with AI assistance: it touches I/O, data modeling, validation, external API integration, testing, and reporting.

### 3.2 The 10 Standardized Tasks

Every run builds TaskForge through the same 10 tasks, in order:

1. CLI skeleton and argument parsing
2. Task data model and JSON file persistence
3. List, filter, and view tasks by status and priority
4. Complete and delete commands with input validation
5. Integration of the summarization gate
6. AI-assisted task decomposition
7. Code snippet generator module
8. Automated test suite
9. Refinement and iteration loop
10. Report generation and export

This sequence was fixed to eliminate task-ordering variance across runs.

### 3.3 Configurations

We tested four configurations across two providers:

| Config | Provider | Mode | Flagship | Gate | Flagship $/M (in/out) | Gate $/M (in/out) |
|---|---|---|---|---|---|---|
| baseline-openai | OpenAI | baseline | gpt-5.4 | — | $2.50 / $15.00 | — |
| openai-nano | OpenAI | cascade | gpt-5.4 | gpt-5-nano | $2.50 / $15.00 | $0.05 / $0.40 |
| baseline-grok | xAI | baseline | grok-4 | — | $2.50 / $10.00 | — |
| grok | xAI | cascade | grok-4 | grok-code-fast | $2.50 / $10.00 | $0.20 / $1.00 |

In baseline mode, each step sends the full accumulated conversation history plus the new task prompt to the flagship model.

In cascade mode, each step first sends the full history to the gate model, which produces a structured JSON summary (goal, decisions, risks, code snippets, and invariants) capped at 600 tokens. Only this summary plus the new task prompt goes to the flagship.

### 3.4 Gate Prompt

The gate uses a system prompt that instructs it to act as a "ruthless context compressor." It outputs valid JSON with five fields: `goal` (one sentence), `decisions` (key architectural choices), `risks` (up to three open questions), `snippets` (relevant code blocks totaling less than 200 tokens), and `invariants` (stable architectural facts that must survive across future gate passes). Two few-shot examples are included in the prompt. The maximum output budget is 600 tokens.

The invariant field is important. Without it, the gate might drop stable facts across steps—for instance, forgetting that TaskForge stores data in `.taskforge/tasks.json`. This field acts as a persistent memory bridge.

### 3.5 Runs and Statistical Design

Each of the four configurations was run 8 times with live API calls to the respective providers. This gives us 32 runs total and 320 individual step executions. We originally planned 10 runs per configuration, but cost constraints led us to 8, which still provides adequate statistical power for the effect sizes observed.

For each run we recorded:

- Input and output token counts per step
- Estimated cost in USD using the provider's public pricing
- Quality score per step (heuristic rubric, 0–10)
- Invariant count, missing invariants, contradictions, and drift score
- Test pass status
- Latency in milliseconds

Aggregate statistics per configuration:

- Mean, median, standard deviation for cost, tokens, quality
- Cost and token savings percentage versus the matched baseline
- Welch's t-test (two-tailed) for cost, token, and quality differences
- Bonferroni-corrected p-values (3 tests per pair)
- Mann-Whitney U test for non-parametric cost and token comparisons
- Cohen's d effect sizes
- 95% confidence intervals

### 3.6 Drift Detection

We implemented a drift detection pipeline that extracts and tracks architectural invariants across steps. After each gate summary, the system checks whether previously established invariants are still present and whether any contradictions have been introduced—explicit value changes, semantic path mismatches, rule violations, or enum cardinality drift. A drift score aggregates missing invariants and contradiction counts.

---

## 4. Results

### 4.1 Summary

All data come from live API calls. No mock or simulated data were used.

| Metric | baseline-openai | openai-nano | baseline-grok | grok |
|---|---:|---:|---:|---:|
| Runs | 8 | 8 | 8 | 8 |
| Mean cost (USD) | 0.2059 | 0.0989 | 0.1798 | 0.0975 |
| 95% CI cost | [0.198, 0.214] | [0.093, 0.105] | [0.162, 0.197] | [0.093, 0.102] |
| Cost savings vs baseline | — | **52.0%** | — | **45.8%** |
| Mean tokens | 43,127 | 58,277 | 49,169 | 65,189 |
| Token change vs baseline | — | +35.1% | — | +32.6% |
| Mean quality (0–10) | 9.82 | 9.69 | 9.82 | 9.62 |
| 95% CI quality | [9.72, 9.91] | [9.58, 9.80] | [9.78, 9.87] | [9.54, 9.70] |
| Quality retained | — | 98.8% | — | 97.9% |
| Mean drift score | 0.00 | 0.23 | 0.00 | 0.76 |
| Tests passed | 8/8 | 8/8 | 8/8 | 8/8 |

### 4.2 Cost Savings

The OpenAI cascade (gpt-5.4 + gpt-5-nano) reduced mean per-run cost from $0.206 to $0.099, a savings of 52.0%. The Welch's t-test p-value for this comparison is effectively zero (p < 10⁻⁶), and the Mann-Whitney U test confirms it (p = 3 × 10⁻⁶). Cohen's d = −12.7, which is an extremely large effect. After Bonferroni correction, the cost p-value remains significant at p < 10⁻⁶.

The xAI cascade (grok-4 + grok-code-fast) reduced mean cost from $0.180 to $0.098, a savings of 45.8%. The corrected p-value is 1.7 × 10⁻⁵, and Cohen's d = −5.4. Also a very large effect.

Both cascades brought the per-run cost to roughly the same level (~$0.10), despite the two providers having different baseline cost structures. This is a useful practical finding: same-provider cascading approximately equalizes costs across providers.

### 4.3 Token Counts

An important detail: cascade runs use *more* total tokens than baseline runs. The OpenAI cascade averaged 58,277 tokens per run versus 43,127 for baseline (+35.1%). The xAI cascade averaged 65,189 versus 49,169 (+32.6%).

This is not a contradiction. The cascade adds a gate call before every flagship call, which adds tokens. But the gate model is extremely cheap ($0.05/$0.40 per million for gpt-5-nano), so the additional tokens cost very little. Meanwhile, the flagship receives far fewer input tokens per step—typically 250–550 tokens of summary instead of the full growing history—which drastically reduces the expensive part of the bill.

In other words, the cascade trades cheap tokens for expensive ones.

### 4.4 Quality

Quality scores were computed using a heuristic rubric that evaluates task keyword coverage, structural cues, response length, and local test pass status.

For the OpenAI cascade, mean quality was 9.69 versus 9.82 baseline (difference of 0.13 points on a 10-point scale). The uncorrected p-value for quality is 0.071 and the Bonferroni-corrected p-value is 0.213—not statistically significant. Cohen's d for quality is −0.98, suggesting a medium-to-large effect in terms of standardized distance, but the absolute magnitude is small and the hypothesis test does not reject the null. We interpret this as: *no detectable quality degradation* for the OpenAI cascade.

For the xAI cascade, mean quality was 9.62 versus 9.82 baseline (difference of 0.20). The corrected p-value is 8.8 × 10⁻⁴, which is significant, and Cohen's d = −2.6. There is a statistically detectable quality drop for the xAI cascade. However, 97.9% of baseline quality is retained, and all tests still passed in every run. Whether this 2% difference matters depends on the application. For most development workflows, it does not.

### 4.5 Drift

Baselines showed zero drift (no missing invariants, no contradictions), as expected since they do not use a gate.

The OpenAI cascade had a mean drift score of 0.23, with no missing invariants but occasional contradictions (mean 2.25 per run). These contradictions were minor—reformulations the detection system flagged as potential semantic mismatches, rather than actual information loss.

The xAI cascade showed higher drift (mean 0.76), with some runs showing missing invariants (run 3 had 12, run 6 had 25) and contradictions. This suggests that grok-code-fast, while cheap and fast, is less faithful at preserving invariants than gpt-5-nano. This is a useful signal for practitioners choosing their gate model: cheapest is not always best for summarization fidelity.

### 4.6 Cross-Provider Observations

The baseline cost ratio between OpenAI and xAI was 1.15:1 (OpenAI slightly more expensive), which reflects the pricing difference ($15.00 vs $10.00 per million output tokens for the flagships). After cascading, both end up near $0.10/run, with a cost ratio of 1.01:1—essentially identical.

This means the cascade acts as a cost equalizer across providers. The choice of provider after cascading becomes more about quality, latency, and ecosystem preferences than about raw cost.

---

## 5. Discussion

### 5.1 Relation to Prior Work

Our 52% cost savings for the OpenAI cascade falls within the range reported by ACON (26–54%) [7] and near the midpoint of FlowMind (34–72%) [9]. The 45.8% for xAI is also in range. Active Context Compression [8] reported up to 57% on SWE-bench, which is higher, but their setup involves single-issue resolution rather than 10-step incremental builds.

The key difference is that our results come from a same-provider, same-ecosystem setup that requires no model retraining, no learned prompts, no custom inference infrastructure. It is a pure prompt-engineering technique: add one API call to a cheap model before every flagship call. This makes it immediately adoptable.

### 5.2 Why Same-Provider Matters

There are practical reasons to stay within one provider's ecosystem. API keys, billing, rate limits, support, terms of service—all of these are simpler when you use one vendor. After the OpenClaw phenomenon [3], where open-source agent fleets drove massive API consumption, providers like Anthropic responded with API restrictions and ToS updates targeting heavy third-party routing [13]. Staying within one provider avoids these friction points.

Same-provider cascading also avoids style mismatches. A Grok gate summarizing context for a Claude flagship might produce summaries that miss nuances the Claude model relies on. Keeping both models in the same family reduces this risk.

### 5.3 The Token Trade-off

The counterintuitive result—cascades use 32–35% more tokens but cost 46–52% less—deserves emphasis. It means that token count alone is a poor proxy for cost. What matters is which model processes those tokens. Sending 6,000 tokens to gpt-5-nano costs roughly $0.0005. Sending 6,000 tokens to gpt-5.4 costs roughly $0.03. The gate adds tokens that are individually almost free, while removing tokens from the flagship's input that are individually expensive.

This has implications for anyone monitoring their LLM spend. Dashboard metrics that track total token count will make cascaded pipelines look worse. Cost-aware metrics are needed.

### 5.4 Drift as a Gate Quality Signal

The drift difference between gpt-5-nano (0.23) and grok-code-fast (0.76) is informative. Both are cheap models from their respective providers, but gpt-5-nano was more faithful in preserving invariants. This could reflect differences in the models' instruction-following capability, their sensitivity to the JSON output format, or the specific few-shot examples in the gate prompt.

For practitioners, this means the gate model should be chosen not just by price but by its summarization fidelity. A gate that drops invariants saves tokens but may cause downstream drift that requires human intervention—defeating the cost savings.

### 5.5 Limitations

Our study has several limitations that should be considered:

**Sample size.** Eight runs per configuration gives adequate power for the large effects observed (Cohen's d > 5), but for subtler quality differences a larger N would be needed. A power analysis suggests that detecting a Cohen's d of 0.5 for quality at alpha = 0.05 with 80% power would require approximately 64 runs per configuration.

**Task diversity.** All runs build the same application (TaskForge) in the same order. We cannot claim generalization to other project types, languages, or task sequences without further experiments.

**Quality scoring.** We used a heuristic rubric, not human evaluation or LLM-as-judge scoring. The heuristic can saturate on high-quality outputs, which is likely happening here (means above 9.6 on a 10-point scale). A ceiling effect may mask real quality differences.

**Two providers.** We tested OpenAI and xAI. Results for Anthropic (claude-4-sonnet + claude-4-haiku) and Google (gemini-2.5-pro + gemini-2.5-flash) remain untested. The platform supports these providers and we plan to add them in future runs.

**Fixed gate prompt.** We used one gate prompt across both providers. The prompt was designed with general instructions and two few-shot examples. Provider-specific prompt tuning might improve gate fidelity, particularly for the xAI cascade where drift was higher.

**Real-time pricing.** Token pricing was taken from public API documentation as of March 2026. Prices change frequently. The absolute dollar savings will shift, though the relative savings should hold as long as the gate-to-flagship price ratio remains similar.

---

## 6. Practical Recommendations

Based on our results, we offer these guidelines for teams considering same-provider model cascading:

1. **Start with the cheapest gate available.** For OpenAI, gpt-5-nano at $0.05/$0.40 per million tokens delivered 52% cost savings with negligible quality loss. The price is so low that the gate adds almost nothing to the bill.

2. **Monitor drift, not just cost.** If your gate shows rising drift scores or missing invariants, consider switching to a slightly more capable (but still cheap) gate model, or refining the gate prompt with better few-shot examples.

3. **Track cost, not just tokens.** Total token count is misleading for cascaded pipelines. Use cost-weighted dashboards.

4. **Use the invariant field.** The gate prompt's `invariants` field acts as persistent memory. Without it, stable architectural facts can be lost across steps, leading to drift and inconsistency.

5. **Set a cost cap.** The RazorCascade platform supports a `--cost-cap` flag that stops the study before overspending. We recommend this for any multi-run, multi-config study with live API calls.

---

## 7. Conclusion

We ran a controlled, reproducible experiment measuring same-provider model cascading for incremental software development. The results are clear: a cheap gate model that summarizes context before each flagship call reduces API cost by 46–52% while retaining 97.9–98.8% of baseline quality, with all tests passing across every run.

The technique is simple to implement, requires no model training or custom infrastructure, and works within a single provider's ecosystem. The RazorCascade platform, all data, and all artifacts are published under the MIT license for reproduction and extension.

For developers and teams spending on agentic coding workflows, same-provider cascading is a practical intervention. It works.

---

## References

[1] S. Seligman, "The Token Economy: How AI Billing Shifted from Compute to Tokens," *AI Economics Quarterly*, vol. 4, no. 1, pp. 12–19, Jan. 2026.

[2] J. Brockman, "Scaling and Pricing in the Age of Foundation Models," *OpenAI Technical Blog*, Dec. 2025. Available: https://openai.com/blog

[3] OpenClaw Contributors, "OpenClaw: An Open-Source Framework for Autonomous 24/7 AI Agent Teams," 2026. Available: https://openclaw.ai

[4] R. Vasquez, "The Hidden Token Tax: How Agentic Workflows Create Runaway API Bills," *Practical AI Engineering*, Feb. 2026.

[5] J. Huang, "NVIDIA GTC 2026 Keynote: The Age of AI Factories," NVIDIA, San Jose, CA, Mar. 16, 2026. Available: https://www.nvidia.com/gtc

[6] L. Chen, M. Zaharia, and J. Zou, "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance," arXiv:2305.05176, May 2023.

[7] S. Kang, D. Kim, and J. Lee, "ACON: Adaptive Context Optimization for Long-Horizon Agents," arXiv:2510.00615, Oct. 2025.

[8] A. Verma, P. Singh, and R. Gupta, "Active Context Compression for Software Engineering Agents," arXiv:2601.07190, Jan. 2026.

[9] FlowMind Team, "FlowMind: Execute-Summarize Pipelines for Token-Efficient Agentic Workflows," arXiv:2602.11782, Feb. 2026.

[10] M. Zhang, Y. Liu, and T. Chen, "A Survey on Dynamic Model Routing and Cascading for Cost-Efficient LLM Inference," arXiv:2603.04445, Mar. 2026.

[11] OpenAI, "API Pricing," Mar. 2026. Available: https://openai.com/pricing; xAI, "Grok API Pricing," Mar. 2026. Available: https://x.ai/api

[12] W. S. Jevons, *The Coal Question*, London: Macmillan, 1865. (For modern application to compute and AI, see also: T. Hicks, "Jevons Paradox and the AI Token Economy," *IEEE Spectrum*, Jan. 2026.)

[13] Anthropic, "Agentic Coding Trends Report 2026," Anthropic Research, Feb. 2026.

[14] Google DeepMind, "Active Context Engineering with Gemini ADK," Google AI Blog, Jan. 2026.

[15] Anthropic, "Model Context Protocol: Donation to the Agentic AI Foundation," Dec. 2025. Available: https://www.anthropic.com/news

[16] J. Li, R. Tang, and W. X. Zhao, "Compressing Context for Enhanced Language Model Interaction," in *Proc. ACL*, 2024, pp. 1082–1094.

[17] H. Jiang, Q. Wu, and X. Lin, "LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models," in *Proc. EMNLP*, 2023, pp. 3452–3467.

[18] Orla Contributors, "Orla: A Multi-Agent Library for Cost-Efficient LLM Orchestration," arXiv:2603.13605, Mar. 2026.

[19] McKinsey Global Institute, "The State of AI Adoption: What Developers Know and Don't Know," McKinsey Digital, Nov. 2025; IBM, "Understanding Context Windows in Large Language Models," IBM AI Education, 2025.

[20] DataCamp, "Context Engineering for LLMs: From Prompt Engineering to Context Architecture," DataCamp Tutorials, Jan. 2026.

---

## Appendix A: Experimental Artifacts

All experiment data are stored in the `experiments/2026-03-18T17-42-54-047Z/` directory:

- **steps.csv**: Per-step token counts, costs, quality scores, drift metrics, and latency for all 320 step executions.
- **runs.csv**: Per-run aggregates for all 32 runs.
- **summary.json**: Machine-readable statistical summary with p-values, effect sizes, confidence intervals, and cross-provider comparisons.
- **report.md**: Auto-generated Markdown report with key findings.
- **dashboard.html**: Interactive HTML visualization with charts for cost, tokens, quality, and drift.

## Appendix B: Reproducibility

To reproduce the experiment:

```bash
git clone https://github.com/your-handle/razor-cascade.git
cd razor-cascade
bun install
cp .env.example .env
# Add your API keys to .env

# Run the same configurations
bun run study --configs baseline-openai,openai-nano,baseline-grok,grok --runs 8
```

The platform falls back to deterministic mock clients if API keys are absent, so the pipeline can be verified end-to-end without incurring costs.

## Appendix C: Per-Run Cost Data

| Config | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Run 6 | Run 7 | Run 8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline-openai | $0.222 | $0.214 | $0.200 | $0.211 | $0.193 | $0.207 | $0.201 | $0.200 |
| openai-nano | $0.088 | $0.110 | $0.102 | $0.106 | $0.097 | $0.098 | $0.100 | $0.090 |
| baseline-grok | $0.200 | $0.155 | $0.154 | $0.161 | $0.175 | $0.189 | $0.202 | $0.202 |
| grok | $0.093 | $0.097 | $0.107 | $0.095 | $0.094 | $0.104 | $0.095 | $0.094 |
