import { z } from "zod";

import { extractInvariants, mergeInvariantFacts } from "./invariants.ts";
import type { ModelClient } from "./models.ts";
import type { TokenUsage } from "./metrics.ts";

export const GateSummarySchema = z.object({
  goal: z.string().min(1),
  decisions: z.array(z.string()).min(1).max(6),
  risks: z.array(z.string()).max(3),
  snippets: z.array(z.string()).max(4),
  invariants: z.array(z.string()).default([]),
});

export type GateSummary = z.infer<typeof GateSummarySchema>;

export const GATE_SYSTEM_PROMPT = `You are a ruthless context compressor for agentic coding workflows.
Given the full conversation history + latest code/output, output ONLY valid JSON.
If the user message includes a "Known invariants that must survive" block, copy those facts into "invariants" and keep them unless the latest changes clearly contradict them.
{
  "goal": "1-sentence current project goal",
  "decisions": ["key architectural decisions", "..."],
  "risks": ["max 3 open questions or risks"],
  "snippets": ["only the most relevant code blocks, total <200 tokens"],
  "invariants": ["stable architectural facts that must survive future gates"]
}
Examples:
Input: history about TaskForge CLI; latest changes add JSON persistence and Bun runtime.
Output: {"goal":"Build the TaskForge CLI on Bun","decisions":["Use Bun","Persist tasks in JSON"],"risks":["API pricing may drift"],"snippets":["const storagePath = '.taskforge/tasks.json';"],"invariants":["storage file = .taskforge/tasks.json"]}

Input: history about the study runner; latest output adds mock/live data labeling.
Output: {"goal":"Document the study artifacts and analysis workflow","decisions":["Label mock vs live data in outputs"],"risks":["Docs may drift from implementation"],"snippets":["Data source: mock clients"],"invariants":["summary.json includes dataSource"]}

Max 600 tokens total. Be concise, faithful, and eliminate redundancy.`;

function truncateWords(text: string, maxWords: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(item.trim());
  }

  return output;
}

function extractJsonBlock(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function collectCandidateBullets(text: string, pattern: RegExp, limit: number): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const directMatches = lines.filter((line) => pattern.test(line));
  const fallbacks = lines.filter((line) => line.length > 24);
  return unique([...directMatches, ...fallbacks]).slice(0, limit).map((line) => truncateWords(line, 18));
}

function extractSnippets(text: string): string[] {
  const codeFences = [...text.matchAll(/```[\w-]*\s*([\s\S]*?)```/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  if (codeFences.length > 0) {
    return codeFences.slice(0, 3).map((snippet) => truncateWords(snippet, 32));
  }

  const meaningfulLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);

  return unique(meaningfulLines.slice(-3)).map((line) => truncateWords(line, 24));
}

function finalizeGateSummary(summary: GateSummary, sourceText: string, previousInvariants: string[]): GateSummary {
  return GateSummarySchema.parse({
    ...summary,
    invariants: mergeInvariantFacts(previousInvariants, extractInvariants(sourceText).facts),
  });
}

export function buildGatePrompt(history: string, latestChanges: string, previousInvariants: string[] = []): string {
  const invariantBlock =
    previousInvariants.length > 0
      ? `Known invariants that must survive:
${previousInvariants.map((fact) => `- ${fact}`).join("\n")}

`
      : "";

  return `Conversation history:
${history.trim() || "(empty)"}

Latest changes or output:
${latestChanges.trim() || "(empty)"}

${invariantBlock}`.trim();
}

export function formatGateSummary(summary: GateSummary): string {
  return [
    `Goal: ${summary.goal}`,
    `Decisions: ${summary.decisions.join("; ")}`,
    `Risks: ${summary.risks.join("; ") || "None noted."}`,
    `Snippets: ${summary.snippets.join(" | ") || "None captured."}`,
    `Invariants: ${summary.invariants.join("; ") || "None captured."}`,
  ].join("\n");
}

export function heuristicGateSummary(history: string, latestChanges: string, previousInvariants: string[] = []): GateSummary {
  const combined = `${history}\n${latestChanges}`.trim();
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const goalLine =
    lines.find((line) => /\b(goal|objective|taskforge|razorcascade|study|build|implement)\b/i.test(line)) ??
    "Advance the TaskForge CLI and RazorCascade study implementation with a stable architecture.";

  const decisions = collectCandidateBullets(
    combined,
    /\b(use|prefer|keep|store|support|implement|validate|export|report|test|gate|provider)\b/i,
    4,
  );
  const risks = collectCandidateBullets(
    combined,
    /\b(risk|open|missing|follow-up|todo|edge case|pricing|api key|validation|coverage)\b/i,
    3,
  );
  const snippets = extractSnippets(combined);
  const invariants = mergeInvariantFacts(previousInvariants, extractInvariants(combined).facts);

  return GateSummarySchema.parse({
    goal: truncateWords(goalLine, 18),
    decisions:
      decisions.length > 0
        ? decisions
        : ["Keep the study reproducible with typed configs, deterministic fallbacks, and exported metrics."],
    risks:
      risks.length > 0
        ? risks
        : ["Provider pricing can drift over time and should be verified before publication."],
    snippets,
    invariants,
  });
}

export function parseGateSummary(rawText: string): GateSummary {
  const jsonBlock = extractJsonBlock(rawText);
  if (!jsonBlock) {
    throw new Error("Unable to locate JSON content in gate output.");
  }

  const parsed = JSON.parse(jsonBlock) as unknown;
  return GateSummarySchema.parse(parsed);
}

export async function summarizeWithGate(options: {
  history: string;
  latestChanges: string;
  previousInvariants?: string[];
  client: ModelClient;
}): Promise<{
  summary: GateSummary;
  draftSummary: GateSummary;
  rawText: string;
  system: string;
  prompt: string;
  usage: TokenUsage;
}> {
  const previousInvariants = options.previousInvariants ?? [];
  const prompt = buildGatePrompt(options.history, options.latestChanges, previousInvariants);
  const system = GATE_SYSTEM_PROMPT;
  const response = await options.client.generateText({
    system,
    prompt,
    maxOutputTokens: 650,
    metadata: {
      kind: "gate",
    },
  });
  const sourceText = `${options.history}\n${options.latestChanges}`;

  try {
    const draftSummary = parseGateSummary(response.text);
    return {
      summary: finalizeGateSummary(draftSummary, sourceText, previousInvariants),
      draftSummary,
      rawText: response.text,
      system,
      prompt,
      usage: response.usage,
    };
  } catch {
    const draftSummary = heuristicGateSummary(options.history, options.latestChanges, previousInvariants);
    return {
      summary: finalizeGateSummary(draftSummary, sourceText, previousInvariants),
      draftSummary,
      rawText: response.text,
      system,
      prompt,
      usage: response.usage,
    };
  }
}
