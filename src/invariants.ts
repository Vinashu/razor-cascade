export interface InvariantMemory {
  facts: string[];
}

const IDENTIFIER_SUFFIX_PATTERN = /(Schema|Enum|Type|Interface|Config)$/;
const CRITICAL_FIELD_NAMES = new Set([
  "id",
  "title",
  "description",
  "priority",
  "status",
  "version",
  "tasks",
  "createdAt",
  "updatedAt",
  "completedAt",
  "notes",
  "refinementHistory",
]);

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanFactText(text: string): string {
  return compact(text).replace(/[.;:,]+$/, "");
}

function normalizeFact(fact: string): string {
  return cleanFactText(fact).toLowerCase();
}

function humanizeIdentifier(name: string): string {
  return compact(
    name
      .replace(IDENTIFIER_SUFFIX_PATTERN, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase(),
  );
}

function parseQuotedValues(text: string): string[] {
  const quotedMatches = [...text.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => compact(match[1] ?? "").toLowerCase());
  if (quotedMatches.length > 0) {
    return quotedMatches.filter(Boolean);
  }

  return text
    .split(/\s*(?:\||,)\s*/)
    .map((value) => compact(value).toLowerCase())
    .filter(Boolean);
}

function collectUniqueFacts(
  target: string[],
  seen: Set<string>,
  facts: string[],
): void {
  for (const fact of facts) {
    const normalized = normalizeFact(fact);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    target.push(cleanFactText(fact));
  }
}

function extractExplicitFacts(text: string): string[] {
  const facts: string[] = [];

  for (const match of text.matchAll(/(?:^|\n)\s*(?:[-*]\s+|\d+\.\s+)?([a-z][^=\n]{1,60}\s*=\s*[^.\n]{1,120})/gi)) {
    const fact = cleanFactText(match[1] ?? "");
    if (fact && !/^(?:export|const|let|var|return|function)\b/i.test(fact)) {
      facts.push(fact);
    }
  }

  for (const match of text.matchAll(/(?:^|\n)\s*(?:[-*]\s+|\d+\.\s+)?([a-z][a-z0-9 _-]{1,40}\s+must\s+[^.\n]{1,120})/gi)) {
    const fact = cleanFactText(match[1] ?? "");
    if (fact) {
      facts.push(fact);
    }
  }

  return facts;
}

function extractEnumFacts(text: string): string[] {
  const facts: string[] = [];

  for (const match of text.matchAll(/(?:const\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*z\.enum\(\[([^\]]+)\]\)/g)) {
    const label = humanizeIdentifier(match[1] ?? "");
    const values = parseQuotedValues(match[2] ?? "");
    if (label && values.length > 1) {
      facts.push(`${label} enum = ${values.join("|")}`);
    }
  }

  for (const match of text.matchAll(/type\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*((?:"[^"]+"\s*\|\s*)+"[^"]+")/g)) {
    const label = humanizeIdentifier(match[1] ?? "");
    const values = parseQuotedValues(match[2] ?? "");
    if (label && values.length > 1) {
      facts.push(`${label} enum = ${values.join("|")}`);
    }
  }

  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_ ]{1,40})\s+enum\s*(?:=|:)\s*([a-z0-9_ -]+(?:\s*(?:\||,)\s*[a-z0-9_ -]+)+)/gi)) {
    const label = compact((match[1] ?? "").toLowerCase());
    const values = parseQuotedValues(match[2] ?? "");
    if (label && values.length > 1) {
      facts.push(`${label} enum = ${values.join("|")}`);
    }
  }

  return facts;
}

function extractSchemaVersionFacts(text: string): string[] {
  const facts: string[] = [];

  for (const match of text.matchAll(/const\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*z\.object\(\{([\s\S]*?)\}\);/g)) {
    const label = humanizeIdentifier(match[1] ?? "");
    const body = match[2] ?? "";
    const versionMatch = body.match(/\bversion\s*:\s*z\.literal\((\d+)\)/);
    if (label && versionMatch?.[1]) {
      facts.push(`${label} version = ${versionMatch[1]}`);
    }
  }

  for (const match of text.matchAll(/\b(?:schema\s+)?version\s*(?:=|:)\s*(\d+)\b/gi)) {
    if (match[1]) {
      facts.push(`schema version = ${match[1]}`);
    }
  }

  return facts;
}

function extractFieldFacts(text: string): string[] {
  const facts: string[] = [];

  for (const match of text.matchAll(/const\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*z\.object\(\{([\s\S]*?)\}\);/g)) {
    const label = humanizeIdentifier(match[1] ?? "");
    const body = match[2] ?? "";
    const fields = body
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/)?.[1])
      .filter((field): field is string => Boolean(field))
      .filter((field) => CRITICAL_FIELD_NAMES.has(field));

    if (label && fields.length >= 2) {
      facts.push(`${label} fields = ${fields.join("|")}`);
    }
  }

  return facts;
}

function extractPathFacts(text: string): string[] {
  const facts: string[] = [];

  for (const match of text.matchAll(/\b(?:storage(?:\s+(?:file|path))?|data\s+path)\s*(?:=|:|is)\s*["'`]?([.~A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)?)/gi)) {
    const value = compact(match[1] ?? "");
    if (value) {
      facts.push(`storage file = ${value}`);
    }
  }

  for (const match of text.matchAll(/["'`](\.[A-Za-z0-9_-][A-Za-z0-9_./-]+)["'`]/g)) {
    const value = compact(match[1] ?? "");
    if (value.endsWith(".json")) {
      facts.push(`storage file = ${value}`);
    } else {
      facts.push(`file path = ${value}`);
    }
  }

  return facts;
}

function extractRequiredSections(text: string): string[] {
  const facts: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = compact(lines[index] ?? "");
    if (!/\b(?:must include|includes)\s*:$/i.test(line)) {
      continue;
    }

    const sections: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const itemMatch = lines[cursor]?.match(/^\s*\d+\.\s+(.+)$/);
      if (!itemMatch?.[1]) {
        break;
      }

      sections.push(compact(itemMatch[1]).toLowerCase());
    }

    if (sections.length >= 2) {
      facts.push(`required sections = ${sections.join("|")}`);
    }
  }

  return facts;
}

export function mergeInvariantFacts(...groups: Array<ReadonlyArray<string> | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const group of groups) {
    if (!group) {
      continue;
    }

    collectUniqueFacts(output, seen, [...group]);
  }

  return output;
}

export function extractInvariants(text: string): InvariantMemory {
  const facts: string[] = [];
  const seen = new Set<string>();

  collectUniqueFacts(facts, seen, extractExplicitFacts(text));
  collectUniqueFacts(facts, seen, extractEnumFacts(text));
  collectUniqueFacts(facts, seen, extractSchemaVersionFacts(text));
  collectUniqueFacts(facts, seen, extractFieldFacts(text));
  collectUniqueFacts(facts, seen, extractPathFacts(text));
  collectUniqueFacts(facts, seen, extractRequiredSections(text));

  return { facts };
}
