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
const PATH_LIKE_TOKEN_PATTERN =
  /(?<![A-Za-z0-9_])(?:\.{1,2}[\\/]+|~[\\/]+|[A-Za-z]:[\\/]+|[\\/]+)?(?:\.?[A-Za-z0-9_-]+[\\/]+)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?|(?<![A-Za-z0-9_])[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/g;

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

function canonicalizePathToken(text: string): string {
  let token = normalizeValueToken(text);
  if (token.includes("/") || token.includes("\\")) {
    token = token.replace(/^(?:\.{1,2}[\\/]+)/, "");
    token = token.replace(/^\.([A-Za-z0-9_.-]+[\\/])/, "$1");
    token = token.replace(/\\/g, "/");
  }

  return token.replace(/[.,;:!?]+$/g, "");
}

function pathsEquivalent(left: string, right: string): boolean {
  return canonicalizePathToken(left) === canonicalizePathToken(right);
}

function subjectTokens(subject: string): string[] {
  return subject
    .replace(/\s+enum$/i, "")
    .split(/\s+/)
    .map((token) => normalizeValueToken(token))
    .filter(Boolean);
}

function subjectMentions(summary: string, subject: string): boolean {
  const normalizedSummary = normalizeText(summary);
  const tokens = subjectTokens(subject);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => normalizedSummary.includes(token));
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

  for (const match of text.matchAll(PATH_LIKE_TOKEN_PATTERN)) {
    const candidate = normalizeValueToken(match[0] ?? "");
    if (candidate) {
      values.add(candidate);
    }
  }

  return [...values];
}

function extractPathLikeTokens(text: string): string[] {
  const tokens = new Set<string>();

  for (const match of text.matchAll(PATH_LIKE_TOKEN_PATTERN)) {
    const candidate = canonicalizePathToken(match[0] ?? "");
    if (candidate) {
      tokens.add(candidate);
    }
  }

  return [...tokens];
}

function hasPathContext(summary: string, subject: string): boolean {
  if (subjectMentions(summary, subject)) {
    return true;
  }

  return /\b(storage|file|path|data|task\s+data|persisted|stored|saved|written|kept)\b/i.test(summary);
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

function parseEnumValues(values: string[]): string[] {
  return values.flatMap((value) =>
    value
      .split("|")
      .map((entry) => normalizeValueToken(entry))
      .filter(Boolean),
  );
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

function hasEnumAdditionContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const subjectRoot = invariant.subject.replace(/\s+enum$/i, "").trim();
  if (!subjectRoot) {
    return false;
  }

  const allowedValues = new Set(parseEnumValues(invariant.values));
  const normalizedSummary = normalizeText(summary);
  if (!subjectMentions(summary, subjectRoot)) {
    return false;
  }

  const enumPattern = new RegExp(
    `${escapeRegExp(subjectRoot)}[^\\n]{0,80}\\b(?:supports?|includes?|allows?|accepts?|uses?|values?|options?)\\b([^\\n]{0,120})`,
    "i",
  );
  const match = summary.match(enumPattern);
  if (!match?.[1]) {
    return false;
  }

  const listCandidates = match[1]
    .split(/[\s,|/]+|\band\b|\bor\b/gi)
    .map((token) => normalizeValueToken(token))
    .filter((token) => token && !DIRECT_ENUM_STOP_WORDS.has(token) && parseCardinalityToken(token) === null);

  const unknownValues = listCandidates.filter((value) => !allowedValues.has(value));
  if (unknownValues.length > 0) {
    return true;
  }

  const explicitListMatch = normalizedSummary.match(
    new RegExp(`${escapeRegExp(subjectRoot)}[^\\n]{0,80}(?:=|:|supports?|includes?|allows?|accepts?)\\s*([^\\n]{0,120})`, "i"),
  );
  if (!explicitListMatch?.[1]) {
    return false;
  }

  const claimedValues = parseEnumValues([explicitListMatch[1]]).filter((value) => !DIRECT_ENUM_STOP_WORDS.has(value));
  return claimedValues.some((value) => !allowedValues.has(value));
}

function extractSemanticPathClaims(summary: string): string[] {
  const values = new Set<string>();

  for (const pattern of PATH_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of summary.matchAll(pattern)) {
      for (const candidate of extractPathLikeValues(match[1] ?? "")) {
        values.add(candidate);
      }
    }
  }

  return [...values];
}

function hasSemanticPathContradiction(summary: string, invariant: ParsedInvariant): boolean {
  const expectedValue = canonicalizePathToken(invariant.values[0] ?? "");
  if (!expectedValue) {
    return false;
  }

  if (!hasPathContext(summary, invariant.subject)) {
    return false;
  }

  const pathTokens = extractPathLikeTokens(summary);
  if (pathTokens.length === 0) {
    return false;
  }

  return pathTokens.some((claim) => !pathsEquivalent(claim, expectedValue));
}

function hasReformulationContradiction(summary: string, invariant: ParsedInvariant): boolean {
  if (invariant.kind === "path") {
    const expectedValue = canonicalizePathToken(invariant.values[0] ?? "");
    if (!expectedValue) {
      return false;
    }

    if (!hasPathContext(summary, invariant.subject)) {
      return false;
    }

    return extractPathLikeTokens(summary).some((claim) => !pathsEquivalent(claim, expectedValue));
  }

  if (invariant.kind === "rule") {
    if (!subjectMentions(summary, invariant.subject)) {
      return false;
    }

    const expectedRule = normalizeText(invariant.values[0] ?? "");
    if (!expectedRule) {
      return false;
    }

    if (/\b(change|changes|changing|replace|replaces|replaced|regenerate|different|instead|swap)\b/i.test(summary)) {
      return !normalizeText(summary).includes(expectedRule);
    }
  }

  return false;
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
      continue;
    }

    if (invariant.kind === "enum" && hasEnumAdditionContradiction(summary, invariant)) {
      contradictionSet.add(contradictionLabel(invariant.subject));
    }
  }

  return [...contradictionSet];
}

export function detectReformulationContradictions(summary: string, invariants: string[]): string[] {
  const contradictions = new Set<string>();

  for (const rawFact of invariants) {
    const invariant = parseInvariant(rawFact);
    if (!invariant) {
      continue;
    }

    if ((invariant.kind === "path" || invariant.kind === "rule") && hasReformulationContradiction(summary, invariant)) {
      contradictions.add(contradictionLabel(invariant.subject));
    }
  }

  return [...contradictions];
}

export function buildDriftReport(summary: string, invariants: string[]): DriftReport {
  const contradictionList = [
    ...new Set([...detectContradictions(summary, invariants), ...detectReformulationContradictions(summary, invariants)]),
  ];
  const missingInvariants = countMissingInvariants(summary, invariants);
  return {
    missingInvariants,
    contradictions: contradictionList.length,
    driftScore: missingInvariants + contradictionList.length,
  };
}
