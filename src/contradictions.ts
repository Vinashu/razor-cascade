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
  "is",
  "are",
  "be",
  "has",
  "have",
  "with",
  "of",
  "possible",
  "distinct",
  "different",
]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const CARDINALITY_VALUE_LABELS = "(?:values?|options?|states?|types?|levels?|priorities?|statuses?)";
const PATH_CLAIM_PATTERNS = [
  /\b(?:storage(?:\s+(?:file|path))?|data\s+path|file\s+path)\b[^\n]{0,80}\b(?:=|:|is|at|to|in)\b([^\n]{0,120})/gi,
  /\b(?:task\s+data|data|tasks?|storage)\s+(?:is\s+)?(?:stored|persisted|saved|written|kept)\b[^\n]{0,40}\b(?:in|at|to|under|within|inside)\b([^\n]{0,120})/gi,
];

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

function normalizeValueToken(text: string): string {
  return normalizeText(text).replace(/^[^a-z0-9./_-]+|[^a-z0-9./_-]+$/g, "");
}

function parseCardinalityToken(token: string): number | null {
  const normalized = normalizeText(token);
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  return NUMBER_WORDS[normalized] ?? null;
}

function extractPathLikeValues(text: string): string[] {
  const values = new Set<string>();

  for (const match of text.matchAll(/(^|[\s("'`])([.~]?(?:[A-Za-z0-9_-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)/g)) {
    const candidate = normalizeValueToken(match[2] ?? "");
    if (candidate) {
      values.add(candidate);
    }
  }

  return [...values];
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
    .map((token) => normalizeValueToken(token))
    .filter((token) => token && !DIRECT_ENUM_STOP_WORDS.has(token) && parseCardinalityToken(token) === null);

  return tokens.some((token) => !allowedValues.has(token));
}

function hasEnumCardinalityContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const subjectRoot = invariant.subject.replace(/\s+enum$/i, "").trim();
  if (!subjectRoot) {
    return false;
  }

  const cardinalityPattern = `(${["\\d+", ...Object.keys(NUMBER_WORDS)].join("|")})`;
  const patterns = [
    new RegExp(
      `${escapeRegExp(subjectRoot)}[^\\n.!?]{0,80}\\b(?:has|have|contains?|includes?|supports?|allows?|accepts?|uses?|offers?)\\b[^\\n.!?]{0,40}\\b${cardinalityPattern}\\b(?:\\s+(?:distinct|different|possible|supported|available|total))?\\s+${CARDINALITY_VALUE_LABELS}\\b`,
      "i",
    ),
    new RegExp(
      `${escapeRegExp(subjectRoot)}[^\\n.!?]{0,40}\\b${cardinalityPattern}\\b(?:\\s+(?:distinct|different|possible|supported|available|total))?\\s+${CARDINALITY_VALUE_LABELS}\\b`,
      "i",
    ),
    new RegExp(
      `\\b${cardinalityPattern}\\b[^\\n.!?]{0,20}${escapeRegExp(subjectRoot)}[^\\n.!?]{0,20}\\s+${CARDINALITY_VALUE_LABELS}\\b`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = summary.match(pattern);
    const claimedCardinality = match?.[1] ? parseCardinalityToken(match[1]) : null;
    if (claimedCardinality !== null && claimedCardinality !== invariant.values.length) {
      return true;
    }
  }

  return false;
}

function extractSemanticPathClaims(summary: string): string[] {
  const values = new Set<string>();

  for (const pattern of PATH_CLAIM_PATTERNS) {
    for (const match of summary.matchAll(pattern)) {
      for (const candidate of extractPathLikeValues(match[1] ?? "")) {
        values.add(candidate);
      }
    }
  }

  return [...values];
}

function hasSemanticPathContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const expectedValue = normalizeValueToken(invariant.values[0] ?? "");
  if (!expectedValue) {
    return false;
  }

  const pathClaims = extractSemanticPathClaims(summary);
  if (pathClaims.length === 0) {
    return false;
  }

  return pathClaims.some((claim) => claim !== expectedValue);
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

    if (invariant.kind === "enum" && hasEnumCardinalityContradiction(summary, invariant)) {
      contradictionSet.add(contradictionLabel(invariant.subject));
      continue;
    }

    if (invariant.kind === "path" && hasSemanticPathContradiction(summary, invariant)) {
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
