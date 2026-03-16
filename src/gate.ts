import { z } from "zod";

import type { ModelClient } from "./models.ts";

export const GateSummarySchema = z.object({
  goal: z.string().min(1),
  decisions: z.array(z.string()).min(1).max(6),
  risks: z.array(z.string()).max(3),
  snippets: z.array(z.string()).max(4),
});

export type GateSummary = z.infer<typeof GateSummarySchema>;

export const GATE_SYSTEM_PROMPT = `You are a ruthless context compressor for agentic coding workflows.
Given the full conversation history + latest code/output, output ONLY valid JSON:
{
  "goal": "1-sentence current project goal",
  "decisions": ["key architectural decisions", "..."],
  "risks": ["max 3 open questions or risks"],
  "snippets": ["only the most relevant code blocks, total <200 tokens"]
}
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

export function buildGatePrompt(history: string, latestChanges: string): string {
  return `Conversation history:
${history.trim() || "(empty)"}

Latest changes or output:
${latestChanges.trim() || "(empty)"}`;
}

export function formatGateSummary(summary: GateSummary): string {
  return [
    `Goal: ${summary.goal}`,
    `Decisions: ${summary.decisions.join("; ")}`,
    `Risks: ${summary.risks.join("; ") || "None noted."}`,
    `Snippets: ${summary.snippets.join(" | ") || "None captured."}`,
  ].join("\n");
}

export function heuristicGateSummary(history: string, latestChanges: string): GateSummary {
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
  client: ModelClient;
}): Promise<{ summary: GateSummary; rawText: string }> {
  const prompt = buildGatePrompt(options.history, options.latestChanges);
  const response = await options.client.generateText({
    system: GATE_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 650,
    metadata: {
      kind: "gate",
    },
  });

  try {
    return {
      summary: parseGateSummary(response.text),
      rawText: response.text,
    };
  } catch {
    return {
      summary: heuristicGateSummary(options.history, options.latestChanges),
      rawText: response.text,
    };
  }
}
