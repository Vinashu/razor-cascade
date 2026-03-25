
```bash
$ bun run src/study.ts --configs "baseline-openai,openai-mini,openai-nano,baseline-grok,grok,baseline-gemini,gemini" --runs "10" --judge --judge-provider anthropic --judge-model "claude-haiku-4-5" --judge-repeat "2" --snapshot --verbose
```

```bash
[dotenv@17.3.1] injecting env (0) from .env -- tip: ⚙️  write to custom object with { processEnv: myObject }
```

```bash
[warn] 2026-03-25T05:36:33.232Z Gate summary parsing failed; falling back to heuristic summary. {"hasPreviousInvariants":false,"parseError":"JSON Parse error: Unexpected identifier \"typescript\"","rawTextPreview":"{\n  \"goal\": \"Establish the foundational CLI structure for TaskForge using TypeScript and Bun, including command definitions and basic argument handling.\",\n  \"decisions\": [\n    \"Use Bun as runtime with shebang for direct invocation\",\n    \"Integrate commander for structured argument parsing\",\n    \"Define subcommands: init, run, analyze with options like --force, --dry-run, --verbose, --output\"\n  ],\n"}
```

```bash
[warn] 2026-03-25T06:09:10.777Z Gate summary parsing failed; falling back to heuristic summary. {"hasPreviousInvariants":false,"parseError":"JSON Parse error: Unexpected identifier \"typescript\"","rawTextPreview":"{\n  \"goal\": \"Establish the foundational CLI structure for TaskForge using TypeScript and Bun, including command definitions and basic argument parsing.\",\n  \"decisions\": [\n    \"Use Bun for CLI runtime with shebang for direct invocation\",\n    \"Implement switch-based command handler for subcommands: init, run, status\",\n    \"Create simple argument parser for flags and positional args, mapping to typed"}
```

```bash
[warn] 2026-03-25T06:36:31.227Z Judge scoring failed for task 3 (List, filter, and view tasks) on repeat 2/2; falling back to heuristic scoring for that repeat. {"reason":"Unable to parse judge score from response: I notice that no candidate response was provided in your message. You've included the task title, objective, and rubric, but the actual \"Candidate response\" section is empty.\n\nTo properly evaluate an engineering update against the stated task objective of \"Support querying tasks by status, priority, tags, and free-text search,\" I would need to see:\n\n- The proposed implementation details\n- Architecture decisions\n- Code or design specifications\n- API/query interface design\n- Any relevant technical documentation\n\nPlease provide the candidate response you'd like me to evaluate, and I'll score it according to the rubric dimensions (completeness, correctness, clarity, and architecture)."}
```

```bash
[warn] 2026-03-25T06:36:31.227Z Judge scoring was inconsistent for task 3 (List, filter, and view tasks). {"judgeScoreStddev":"4.5255","judgeRepeat":2}
```

```bash
[warn] 2026-03-25T06:51:51.669Z Judge scoring failed for task 3 (List, filter, and view tasks) on repeat 2/2; falling back to heuristic scoring for that repeat. {"reason":"Unable to parse judge score from response: I notice that no candidate response was provided in your message. You've included the task title, objective, and rubric, but the actual \"Candidate response\" section is empty.\n\nTo properly evaluate an engineering update against the stated task objective of \"Support querying tasks by status, priority, tags, and free-text search,\" I would need to see:\n\n- The proposed implementation details\n- Architecture decisions\n- Code or design specifications\n- API/query interface design\n- Any relevant technical documentation\n\nPlease provide the candidate response you'd like me to evaluate, and I'll score it according to the rubric dimensions (completeness, correctness, clarity, and architecture)."}
```

```bash
[warn] 2026-03-25T06:51:51.669Z Judge scoring was inconsistent for task 3 (List, filter, and view tasks). {"judgeScoreStddev":"4.5255","judgeRepeat":2}
```

```bash
[warn] 2026-03-25T07:02:53.526Z Gate summary parsing failed; falling back to heuristic summary. {"hasPreviousInvariants":false,"parseError":"JSON Parse error: Unterminated string","rawTextPreview":"```json\n{\n  \"goal\": \"Build the TaskForge CLI on Bun, defining a typed task model and implementing safe JSON persistence.\",\n  \"decisions\": [\n    \"Use Bun and TypeScript for the CLI\",\n    \"Implement argument parsing with `commander`\",\n    \"Define a `Task` interface with `id`, `title`, `status`, `createdAt`, `updatedAt`\",\n    \"Persist tasks to `~/.taskforge/tasks.json` using atomic writes (temp file "}
Artifacts written to C:\Repos\razor-cascade\experiments\2026-03-25T02-27-04-568Z
```

```bash
Mean cost
baseline-openai ###################      0.21
openai-mini    #############            0.14
openai-nano    ##########               0.11
baseline-grok  ######################## 0.26
grok           ############             0.13
baseline-gemini ######                   0.07
gemini         ######                   0.06

Mean tokens
baseline-openai ##############           43479.8
openai-mini    ######################   66522.1
openai-nano    ######################## 73848.6
baseline-grok  #################        52517.5
grok           #####################    65064
baseline-gemini ########                 24118.8
gemini         ##############           41557

Mean drift
baseline-openai #                        0
openai-mini    ######################   2.69
openai-nano    ######################## 2.96
baseline-grok  #                        0
grok           ###                      0.32
baseline-gemini #                        0
gemini         ####                     0.46
```