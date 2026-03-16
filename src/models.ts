import { estimateTokens } from "./metrics.ts";

export type ProviderName = "openai" | "anthropic" | "xai" | "gemini";
export type ModelRole = "flagship" | "gate";
export type ClientMode = "live" | "mock";

export interface ModelRequest {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, string>;
}

export interface ModelResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  raw?: unknown;
}

export interface ModelClient {
  provider: ProviderName;
  model: string;
  mode: ClientMode;
  generateText(request: ModelRequest): Promise<ModelResponse>;
}

export interface CreateModelClientOptions {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fallbackToMock?: boolean;
}

export const DEFAULT_MODELS: Record<ProviderName, Record<ModelRole, string>> = {
  openai: {
    flagship: "gpt-5.4",
    gate: "gpt-5-mini",
  },
  anthropic: {
    flagship: "claude-4-sonnet",
    gate: "claude-4-haiku",
  },
  xai: {
    flagship: "grok-4",
    gate: "grok-code-fast",
  },
  gemini: {
    flagship: "gemini-2.5-pro",
    gate: "gemini-2.5-flash",
  },
};

const API_KEY_ENV: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const MODEL_ENV_NAMES: Record<ProviderName, Record<ModelRole, string[]>> = {
  openai: {
    flagship: ["OPENAI_FLAGSHIP_MODEL", "OPEN_AI_FLAGSHIP_MODEL"],
    gate: ["OPENAI_GATE_MODEL", "OPEN_AI_GATE_MODEL"],
  },
  anthropic: {
    flagship: ["ANTHROPIC_FLAGSHIP_MODEL"],
    gate: ["ANTHROPIC_GATE_MODEL"],
  },
  xai: {
    flagship: ["XAI_FLAGSHIP_MODEL"],
    gate: ["XAI_GATE_MODEL"],
  },
  gemini: {
    flagship: ["GEMINI_FLAGSHIP_MODEL"],
    gate: ["GEMINI_GATE_MODEL"],
  },
};

export function getProviderApiKey(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[API_KEY_ENV[provider]];
}

export function resolveModelFromEnv(
  provider: ProviderName,
  role: ModelRole,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const key of MODEL_ENV_NAMES[provider][role]) {
    const value = env[key];
    if (value?.trim()) {
      return value.trim();
    }
  }

  return DEFAULT_MODELS[provider][role];
}

export function detectPreferredProvider(env: NodeJS.ProcessEnv = process.env): ProviderName | null {
  const orderedProviders: ProviderName[] = ["openai", "anthropic", "xai", "gemini"];
  return orderedProviders.find((provider) => Boolean(getProviderApiKey(provider, env))) ?? null;
}

function hashString(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickItem(items: string[], seed: number): string {
  return items[seed % items.length];
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildMockGateJson(prompt: string): string {
  const compactPrompt = compact(prompt);
  const historyExcerpt = compactPrompt.slice(0, 180);
  const recentExcerpt = compactPrompt.slice(-180);
  return JSON.stringify(
    {
      goal: "Advance the TaskForge and RazorCascade workflow with minimal context overhead.",
      decisions: [
        "Keep the CLI typed and Bun-native with JSON persistence.",
        "Measure token usage, estimated cost, quality, and tests for every run.",
        `Retain only the highest-signal context: ${historyExcerpt}`,
      ],
      risks: [
        "Provider pricing or model names may drift over time.",
        "Prompt length can still grow if reports are too verbose.",
        "Live API calls require valid credentials and network access.",
      ],
      snippets: [recentExcerpt],
    },
    null,
    2,
  );
}

function buildMockExecutionText(request: ModelRequest, model: string): string {
  const seed = hashString(`${model}:${request.system}:${request.prompt}`);
  const style = pickItem(
    [
      "Focus on a typed implementation plan with concrete validation steps.",
      "Preserve architectural coherence, tests, and reproducible metrics.",
      "Keep the change set incremental so each task can be evaluated independently.",
    ],
    seed,
  );
  const excerpt = compact(request.prompt).slice(0, 240);
  const verification = pickItem(
    [
      "Validation: run the CLI commands, the study runner, and the automated tests.",
      "Validation: confirm storage, filters, report export, and CSV generation all behave as expected.",
      "Validation: compare token counts, cost, and quality against the baseline configuration.",
    ],
    seed + 7,
  );

  return [
    `Implementation note for ${model}:`,
    style,
    `Scope: ${excerpt}`,
    "Changes: reinforce command parsing, persistence, provider abstractions, and experiment exports.",
    verification,
    "Risks: watch for provider credential issues, pricing drift, and malformed structured output.",
  ].join("\n");
}

class MockModelClient implements ModelClient {
  public readonly mode = "mock" as const;

  public constructor(
    public readonly provider: ProviderName,
    public readonly model: string,
  ) {}

  public async generateText(request: ModelRequest): Promise<ModelResponse> {
    const rawText = request.metadata?.kind === "gate" ? buildMockGateJson(request.prompt) : buildMockExecutionText(request, this.model);
    const usage = {
      inputTokens: estimateTokens(`${request.system}\n${request.prompt}`),
      outputTokens: estimateTokens(rawText),
    };

    return {
      text: rawText,
      usage,
      raw: {
        simulated: true,
      },
    };
  }
}

function extractOpenAiResponseText(response: Record<string, unknown>): string {
  const outputText = response.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const itemContent = (item as { content?: unknown[] }).content;
    const content = Array.isArray(itemContent) ? itemContent : [];
    for (const entry of content) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        chunks.push(text.trim());
      }
    }
  }

  return chunks.join("\n").trim();
}

async function createOpenAiClient(options: CreateModelClientOptions): Promise<ModelClient> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });

  return {
    provider: options.provider,
    model: options.model,
    mode: "live",
    async generateText(request) {
      const response = await client.responses.create({
        model: options.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: request.system }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: request.prompt }],
          },
        ],
        temperature: request.temperature ?? 0.2,
        max_output_tokens: request.maxOutputTokens ?? 1_200,
      });

      const text = extractOpenAiResponseText(response as unknown as Record<string, unknown>);
      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? estimateTokens(`${request.system}\n${request.prompt}`),
          outputTokens: response.usage?.output_tokens ?? estimateTokens(text),
        },
        raw: response,
      };
    },
  };
}

function extractAnthropicText(response: Record<string, unknown>): string {
  const content = Array.isArray(response.content) ? response.content : [];
  const chunks: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    if ((item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string") {
      chunks.push(((item as { text?: string }).text ?? "").trim());
    }
  }

  return chunks.join("\n").trim();
}

async function createAnthropicClient(options: CreateModelClientOptions): Promise<ModelClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    apiKey: options.apiKey,
  });

  return {
    provider: options.provider,
    model: options.model,
    mode: "live",
    async generateText(request) {
      const response = await client.messages.create({
        model: options.model,
        system: request.system,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens ?? 1_200,
        messages: [
          {
            role: "user",
            content: request.prompt,
          },
        ],
      });

      const raw = response as unknown as Record<string, unknown>;
      const text = extractAnthropicText(raw);
      return {
        text,
        usage: {
          inputTokens: response.usage?.input_tokens ?? estimateTokens(`${request.system}\n${request.prompt}`),
          outputTokens: response.usage?.output_tokens ?? estimateTokens(text),
        },
        raw: response,
      };
    },
  };
}

async function createXaiCompatClient(options: CreateModelClientOptions): Promise<ModelClient> {
  return {
    provider: options.provider,
    model: options.model,
    mode: "live",
    async generateText(request) {
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? 1_200,
        }),
      });

      if (!response.ok) {
        throw new Error(`xAI request failed with status ${response.status}.`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.map((choice) => choice.message?.content ?? "").join("\n").trim() ?? "";
      return {
        text,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? estimateTokens(`${request.system}\n${request.prompt}`),
          outputTokens: body.usage?.completion_tokens ?? estimateTokens(text),
        },
        raw: body,
      };
    },
  };
}

async function createXaiClient(options: CreateModelClientOptions): Promise<ModelClient> {
  return createXaiCompatClient(options);
}

async function createGeminiClient(options: CreateModelClientOptions): Promise<ModelClient> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({
    apiKey: options.apiKey,
  });

  return {
    provider: options.provider,
    model: options.model,
    mode: "live",
    async generateText(request) {
      const response = await client.models.generateContent({
        model: options.model,
        config: {
          systemInstruction: request.system,
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxOutputTokens ?? 1_200,
        },
        contents: request.prompt,
      });

      const text = response.text?.trim() ?? "";
      return {
        text,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? estimateTokens(`${request.system}\n${request.prompt}`),
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
        },
        raw: response,
      };
    },
  };
}

export async function createModelClient(options: CreateModelClientOptions): Promise<ModelClient> {
  if (options.fallbackToMock) {
    return new MockModelClient(options.provider, options.model);
  }

  if (!options.apiKey) {
    throw new Error(`Missing API key for ${options.provider}.`);
  }

  if (options.provider === "openai") {
    return createOpenAiClient(options);
  }

  if (options.provider === "anthropic") {
    return createAnthropicClient(options);
  }

  if (options.provider === "xai") {
    return createXaiClient(options);
  }

  return createGeminiClient(options);
}


