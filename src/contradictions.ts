import { extractInvariants } from "./invariants.ts";

export interface DriftReport {
  missingInvariants: number;
  contradictions: number;
  driftScore: number;
}

interface ParsedInvariant {
  kind: "enum" | "fields" | "version" | "path" | "rule" | "generic";
  subject: string;
  subjectKey: string;
  values: string[];
  source: string;
}

const DIRECT_ENUM_STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "a",
  "an",
  "supports",
  "support",
  "includes",
  "include",
  "allows",
  "allow",
  "accepts",
  "accept",
  "uses",
  "use",
  "values",
  "value",
  "options",
  "option",
]);

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeText(text: string): string {
  return compact(text).toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseList(text: string): string[] {
  return text
    .split("|")
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function parseInvariant(fact: string): ParsedInvariant | null {
  const normalized = compact(fact);
  const enumMatch = normalized.match(/^(.+? enum)\s*=\s*(.+)$/i);
  if (enumMatch?.[1] && enumMatch[2]) {
    const subject = normalizeText(enumMatch[1]);
    return {
      kind: "enum",
      subject,
      subjectKey: subject,
      values: parseList(enumMatch[2]),
      source: normalized,
    };
  }

  const fieldsMatch = normalized.match(/^(.+? fields)\s*=\s*(.+)$/i);
  if (fieldsMatch?.[1] && fieldsMatch[2]) {
    const subject = normalizeText(fieldsMatch[1]);
    return {
      kind: "fields",
      subject,
      subjectKey: subject,
      values: parseList(fieldsMatch[2]),
      source: normalized,
    };
  }

  const versionMatch = normalized.match(/^(.+? version)\s*=\s*(\d+)$/i);
  if (versionMatch?.[1] && versionMatch[2]) {
    const subject = normalizeText(versionMatch[1]);
    return {
      kind: "version",
      subject,
      subjectKey: subject,
      values: [normalizeText(versionMatch[2])],
      source: normalized,
    };
  }

  const pathMatch = normalized.match(/^(storage file|file path|data path)\s*=\s*(.+)$/i);
  if (pathMatch?.[1] && pathMatch[2]) {
    const subject = normalizeText(pathMatch[1]);
    return {
      kind: "path",
      subject,
      subjectKey: subject,
      values: [normalizeText(pathMatch[2])],
      source: normalized,
    };
  }

  const ruleMatch = normalized.match(/^(.+?)\s+must\s+(.+)$/i);
  if (ruleMatch?.[1] && ruleMatch[2]) {
    const subject = normalizeText(ruleMatch[1]);
    return {
      kind: "rule",
      subject,
      subjectKey: subject,
      values: [normalizeText(ruleMatch[2])],
      source: normalized,
    };
  }

  const genericMatch = normalized.match(/^(.+?)\s*=\s*(.+)$/i);
  if (genericMatch?.[1] && genericMatch[2]) {
    const subject = normalizeText(genericMatch[1]);
    return {
      kind: "generic",
      subject,
      subjectKey: subject,
      values: [normalizeText(genericMatch[2])],
      source: normalized,
    };
  }

  return null;
}

function contradictionLabel(subject: string): string {
  return `${subject} contradiction`;
}

function hasExplicitValueContradiction(expected: ParsedInvariant, summaryFacts: ParsedInvariant[]): boolean {
  const matchingFacts = summaryFacts.filter((fact) => fact.subjectKey === expected.subjectKey && fact.source !== expected.source);
  if (matchingFacts.length === 0) {
    return false;
  }

  const expectedValues = new Set(expected.values);
  if (expected.kind === "enum" || expected.kind === "fields") {
    return matchingFacts.some((fact) => fact.values.some((value) => !expectedValues.has(value)));
  }

  return matchingFacts.some((fact) => fact.values[0] !== expected.values[0]);
}

function hasDirectEnumContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const subjectRoot = invariant.subject.replace(/\s+enum$/i, "").trim();
  if (!subjectRoot) {
    return false;
  }

  const allowedValues = new Set(invariant.values);
  const pattern = new RegExp(
    `${escapeRegExp(subjectRoot)}[^\\n]{0,80}\\b(?:supports?|includes?|allows?|accepts?|uses?|values?|options?)\\b([^\\n]{0,80})`,
    "i",
  );
  const match = summary.match(pattern);
  if (!match?.[1]) {
    return false;
  }

  const tokens = match[1]
    .split(/[\s,|/]+|\band\b|\bor\b/gi)
    .map((token) => normalizeText(token))
    .filter((token) => token && !DIRECT_ENUM_STOP_WORDS.has(token));

  return tokens.some((token) => !allowedValues.has(token));
}

function hasRuleContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const subjectPattern = escapeRegExp(invariant.subject);
  const stablePattern = /\b(remain stable|stay stable|be stable)\b/i;
  if (stablePattern.test(invariant.values[0] ?? "")) {
    return new RegExp(`${subjectPattern}[^\\n]{0,80}\\b(change|changes|changing|regenerate|replace|unstable)\\b`, "i").test(summary);
  }

  return false;
}

export function countMissingInvariants(summary: string, invariants: string[]): number {
  const normalizedSummary = normalizeText(summary);
  return invariants.filter((fact) => !normalizedSummary.includes(normalizeText(fact))).length;
}

export function detectContradictions(summary: string, invariants: string[]): string[] {
  const summaryFacts = extractInvariants(summary).facts
    .map((fact) => parseInvariant(fact))
    .filter((fact): fact is ParsedInvariant => fact !== null);
  const contradictionSet = new Set<string>();

  for (const rawFact of invariants) {
    const invariant = parseInvariant(rawFact);
    if (!invariant) {
      continue;
    }

    if (hasExplicitValueContradiction(invariant, summaryFacts)) {
      contradictionSet.add(contradictionLabel(invariant.subject));
      continue;
    }

    if (invariant.kind === "enum" && hasDirectEnumContradiction(summary, invariant)) {
      contradictionSet.add(contradictionLabel(invariant.subject));
      continue;
    }

    if (invariant.kind === "rule" && hasRuleContradiction(summary, invariant)) {
      contradictionSet.add(contradictionLabel(invariant.subject));
    }
  }

  return [...contradictionSet];
}

export function buildDriftReport(summary: string, invariants: string[]): DriftReport {
  const contradictionList = detectContradictions(summary, invariants);
  const missingInvariants = countMissingInvariants(summary, invariants);
  return {
    missingInvariants,
    contradictions: contradictionList.length,
    driftScore: missingInvariants + contradictionList.length,
  };
}
