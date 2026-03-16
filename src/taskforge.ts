import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Command } from "commander";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import {
  createModelClient,
  detectPreferredProvider,
  getProviderApiKey,
  resolveModelFromEnv,
  type ModelClient,
  type ProviderName,
} from "./models.ts";

loadDotEnv();

const TaskPrioritySchema = z.enum(["low", "medium", "high"]);
const TaskStatusSchema = z.enum(["open", "completed"]);

const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  notes: z.array(z.string()),
  refinementHistory: z.array(z.string()),
});

const TaskStoreSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  tasks: z.array(TaskSchema),
});

export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Task = z.infer<typeof TaskSchema>;

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: string;
  search?: string;
}

export interface AddTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
}

export interface ReportResult {
  content: string;
  outputPath?: string;
}

export class TaskForgeError extends Error {}

function defaultStoragePath(): string {
  return process.env.TASKFORGE_DATA_PATH?.trim() || ".taskforge/tasks.json";
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateTaskId(existingTasks: Task[]): string {
  const maxNumber = existingTasks.reduce((currentMax, task) => {
    const match = task.id.match(/_(\d+)$/);
    return Math.max(currentMax, match ? Number(match[1]) : 0);
  }, 0);

  return `task_${String(maxNumber + 1).padStart(4, "0")}`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .flatMap((tag) => tag.split(","))
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parsePriority(value: string): TaskPriority {
  return TaskPrioritySchema.parse(value.toLowerCase());
}

function priorityWeight(priority: TaskPriority): number {
  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function parseJsonArray(text: string): string[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  try {
    const parsed = JSON.parse(fenced) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function heuristicDecompose(goal: string, count = 4): string[] {
  const cleaned = goal.trim().replace(/\.$/, "");
  const fragments = cleaned
    .split(/\b(?:and|then|with|plus|while)\b|,/i)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 4);

  const starterSteps = [
    `Clarify the scope and acceptance criteria for "${cleaned}".`,
    `Implement the main workflow required to "${cleaned}".`,
    `Add tests or validation steps that prove "${cleaned}" works.`,
    `Write documentation and usage notes for "${cleaned}".`,
  ];

  const directSteps = fragments.map((fragment, index) => `Subtask ${index + 1}: ${fragment}.`);
  const output = directSteps.length >= count
    ? directSteps
    : Array.from(new Set([...directSteps, ...starterSteps]));
  return output.slice(0, count);
}

function heuristicSnippet(description: string, language: string): string {
  const normalizedLanguage = language.toLowerCase();
  if (normalizedLanguage === "ts" || normalizedLanguage === "typescript") {
    return `export function executeTask(input: string): string {
  if (!input.trim()) {
    throw new Error("Input is required.");
  }

  return \`Processed: \${input.trim()}\`;
}`;
  }

  if (normalizedLanguage === "js" || normalizedLanguage === "javascript") {
    return `export function executeTask(input) {
  if (!input || !input.trim()) {
    throw new Error("Input is required.");
  }

  return \`Processed: \${input.trim()}\`;
}`;
  }

  if (normalizedLanguage === "bash" || normalizedLanguage === "sh") {
    return `#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: task \"${description}\"" >&2
  exit 1
fi

echo "Implement: ${description}"`;
  }

  return `// ${description}
// TODO: replace this placeholder with production code in ${language}.`;
}

function buildMarkdownReport(tasks: Task[]): string {
  const openTasks = tasks.filter((task) => task.status === "open");
  const completedTasks = tasks.filter((task) => task.status === "completed");

  const lines = [
    "# TaskForge Report",
    "",
    `Generated: ${nowIso()}`,
    "",
    `Total tasks: ${tasks.length}`,
    `Open tasks: ${openTasks.length}`,
    `Completed tasks: ${completedTasks.length}`,
    "",
    "## Tasks",
    "",
  ];

  for (const task of tasks) {
    lines.push(`### ${task.id} - ${task.title}`);
    lines.push(`- Status: ${task.status}`);
    lines.push(`- Priority: ${task.priority}`);
    lines.push(`- Tags: ${task.tags.join(", ") || "none"}`);
    lines.push(`- Updated: ${task.updatedAt}`);
    lines.push(`- Description: ${task.description || "none"}`);
    if (task.notes.length > 0) {
      lines.push(`- Notes: ${task.notes.join(" | ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildHtmlReport(tasks: Task[]): string {
  const rows = tasks
    .map(
      (task) => `<tr>
        <td>${task.id}</td>
        <td>${task.title}</td>
        <td>${task.status}</td>
        <td>${task.priority}</td>
        <td>${task.tags.join(", ") || "none"}</td>
        <td>${task.updatedAt}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TaskForge Report</title>
    <style>
      body {
        margin: 0;
        padding: 40px 20px;
        font-family: "Segoe UI", "Aptos", sans-serif;
        background: linear-gradient(180deg, #fcf7f0, #f2efe8);
        color: #1f2937;
      }
      main {
        max-width: 980px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 20px 42px rgba(31, 41, 55, 0.08);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 12px 10px;
        border-bottom: 1px solid rgba(31, 41, 55, 0.12);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TaskForge Report</h1>
      <p>Generated ${nowIso()}</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Tags</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </main>
  </body>
</html>`;
}

async function resolveOptionalAiClient(
  providerInput?: string,
  modelInput?: string,
): Promise<ModelClient | null> {
  const requestedProvider = (providerInput?.toLowerCase() as ProviderName | undefined) ?? detectPreferredProvider() ?? undefined;
  if (!requestedProvider) {
    return null;
  }

  const apiKey = getProviderApiKey(requestedProvider);
  if (!apiKey) {
    return null;
  }

  const model = modelInput?.trim() || resolveModelFromEnv(requestedProvider, "flagship");
  return createModelClient({
    provider: requestedProvider,
    model,
    apiKey,
    fallbackToMock: false,
  });
}

class TaskRepository {
  public constructor(private readonly storagePath: string) {}

  public async load(): Promise<{ version: 1; updatedAt: string; tasks: Task[] }> {
    const filePath = resolve(this.storagePath);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      await ensureParentDirectory(filePath);
      const initialStore = {
        version: 1 as const,
        updatedAt: nowIso(),
        tasks: [],
      };
      await Bun.write(filePath, JSON.stringify(initialStore, null, 2));
      return initialStore;
    }

    const raw = await file.text();
    return TaskStoreSchema.parse(JSON.parse(raw) as unknown);
  }

  public async save(store: { version: 1; updatedAt: string; tasks: Task[] }): Promise<void> {
    const filePath = resolve(this.storagePath);
    await ensureParentDirectory(filePath);
    await Bun.write(filePath, JSON.stringify(store, null, 2));
  }
}

export class TaskForgeService {
  private readonly repository: TaskRepository;

  public constructor(private readonly storagePath = defaultStoragePath()) {
    this.repository = new TaskRepository(storagePath);
  }

  public getStoragePath(): string {
    return resolve(this.storagePath);
  }

  public async addTask(input: AddTaskInput): Promise<Task> {
    const store = await this.repository.load();
    const title = input.title.trim();
    if (!title) {
      throw new TaskForgeError("Task title cannot be empty.");
    }

    const timestamp = nowIso();
    const task: Task = {
      id: generateTaskId(store.tasks),
      title,
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "medium",
      status: "open",
      tags: normalizeTags(input.tags),
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: [],
      refinementHistory: [],
    };

    store.tasks.push(task);
    store.updatedAt = timestamp;
    await this.repository.save(store);
    return task;
  }

  public async listTasks(filters: TaskFilters = {}): Promise<Task[]> {
    const store = await this.repository.load();
    return store.tasks
      .filter((task) => {
        if (filters.status && task.status !== filters.status) {
          return false;
        }

        if (filters.priority && task.priority !== filters.priority) {
          return false;
        }

        if (filters.tag && !task.tags.includes(filters.tag.toLowerCase())) {
          return false;
        }

        if (filters.search) {
          const haystack = `${task.title} ${task.description} ${task.tags.join(" ")} ${task.notes.join(" ")}`.toLowerCase();
          if (!haystack.includes(filters.search.toLowerCase())) {
            return false;
          }
        }

        return true;
      })
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "open" ? -1 : 1;
        }

        const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }

  public async getTask(id: string): Promise<Task> {
    const store = await this.repository.load();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskForgeError(`Task "${id}" was not found.`);
    }

    return task;
  }

  public async completeTask(id: string): Promise<Task> {
    const store = await this.repository.load();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskForgeError(`Task "${id}" was not found.`);
    }

    const timestamp = nowIso();
    task.status = "completed";
    task.completedAt = timestamp;
    task.updatedAt = timestamp;
    store.updatedAt = timestamp;
    await this.repository.save(store);
    return task;
  }

  public async deleteTask(id: string): Promise<void> {
    const store = await this.repository.load();
    const nextTasks = store.tasks.filter((candidate) => candidate.id !== id);
    if (nextTasks.length === store.tasks.length) {
      throw new TaskForgeError(`Task "${id}" was not found.`);
    }

    store.tasks = nextTasks;
    store.updatedAt = nowIso();
    await this.repository.save(store);
  }

  public async decomposeGoal(
    goal: string,
    options: {
      provider?: string;
      model?: string;
      count?: number;
      save?: boolean;
      priority?: TaskPriority;
      tags?: string[];
    } = {},
  ): Promise<string[]> {
    const client = await resolveOptionalAiClient(options.provider, options.model);
    const desiredCount = Math.max(2, Math.min(options.count ?? 4, 8));
    let subtasks = heuristicDecompose(goal, desiredCount);

    if (client) {
      const response = await client.generateText({
        system: "Return only a JSON array of concrete engineering subtasks.",
        prompt: `Break this goal into ${desiredCount} crisp subtasks:\n${goal}`,
        maxOutputTokens: 500,
      });
      subtasks = parseJsonArray(response.text) ?? subtasks;
    }

    if (options.save) {
      for (const subtask of subtasks) {
        await this.addTask({
          title: subtask,
          description: `Generated from goal decomposition for "${goal}".`,
          priority: options.priority ?? "medium",
          tags: normalizeTags([...(options.tags ?? []), "decomposed"]),
        });
      }
    }

    return subtasks;
  }

  public async generateSnippet(
    description: string,
    options: {
      language?: string;
      provider?: string;
      model?: string;
    } = {},
  ): Promise<string> {
    const language = options.language?.trim() || "ts";
    const fallback = heuristicSnippet(description, language);
    const client = await resolveOptionalAiClient(options.provider, options.model);
    if (!client) {
      return fallback;
    }

    const response = await client.generateText({
      system: "Generate a concise, production-leaning code snippet and return only code.",
      prompt: `Language: ${language}\nDescription: ${description}`,
      maxOutputTokens: 700,
    });

    const cleaned = response.text.replace(/```[\w-]*\n?/g, "").replace(/```/g, "").trim();
    return cleaned || fallback;
  }

  public async refineTask(
    id: string,
    feedback: string,
    options: {
      provider?: string;
      model?: string;
    } = {},
  ): Promise<Task> {
    const store = await this.repository.load();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskForgeError(`Task "${id}" was not found.`);
    }

    const client = await resolveOptionalAiClient(options.provider, options.model);
    let refinement = `Refinement requested: ${feedback.trim()}`;

    if (client) {
      const response = await client.generateText({
        system: "Rewrite the task into a tighter engineering brief. Return plain text only.",
        prompt: `Task title: ${task.title}
Current description: ${task.description || "none"}
Feedback: ${feedback}`,
        maxOutputTokens: 500,
      });
      refinement = response.text.trim() || refinement;
    }

    const timestamp = nowIso();
    task.description = task.description
      ? `${task.description}\n\nRefined guidance:\n${refinement}`
      : `Refined guidance:\n${refinement}`;
    task.notes.push(`Feedback: ${feedback.trim()}`);
    task.refinementHistory.push(refinement);
    task.updatedAt = timestamp;
    store.updatedAt = timestamp;
    await this.repository.save(store);
    return task;
  }

  public async exportReport(options: { format?: "markdown" | "html"; outputPath?: string } = {}): Promise<ReportResult> {
    const tasks = await this.listTasks();
    const format = options.format ?? "markdown";
    const content = format === "html" ? buildHtmlReport(tasks) : buildMarkdownReport(tasks);

    if (options.outputPath) {
      const filePath = resolve(options.outputPath);
      await ensureParentDirectory(filePath);
      await Bun.write(filePath, content);
      return {
        content,
        outputPath: filePath,
      };
    }

    return { content };
  }
}

function renderTask(task: Task): string {
  const metadata = [`status=${task.status}`, `priority=${task.priority}`];
  if (task.tags.length > 0) {
    metadata.push(`tags=${task.tags.join("|")}`);
  }

  return `${task.id}  ${task.title}\n  ${metadata.join("  ")}\n  ${task.description || "No description."}`;
}

function getStorageFromCommand(command: { parent?: { opts?: () => unknown } }): string {
  const parentOptions = command.parent?.opts?.() as { storage?: string } | undefined;
  return parentOptions?.storage ?? defaultStoragePath();
}

export function buildTaskForgeProgram(): Command {
  const program = new Command();
  program
    .name("taskforge")
    .description("A lightweight Bun-powered CLI task manager for the RazorCascade study.")
    .option("--storage <path>", "Path to the JSON task store.", defaultStoragePath());

  program
    .command("add")
    .description("Add a task.")
    .argument("<title>", "Task title.")
    .option("-d, --description <text>", "Task description.", "")
    .option("-p, --priority <priority>", "Task priority: low, medium, or high.", "medium")
    .option("--tags <tags>", "Comma-separated tags.", "")
    .action(async (title, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const task = await service.addTask({
        title,
        description: options.description,
        priority: parsePriority(options.priority),
        tags: normalizeTags([options.tags]),
      });
      console.log(renderTask(task));
    });

  program
    .command("list")
    .description("List tasks with optional filters.")
    .option("--status <status>", "Filter by status: open or completed.")
    .option("--priority <priority>", "Filter by priority.")
    .option("--tag <tag>", "Filter by tag.")
    .option("--search <query>", "Full-text filter across task data.")
    .option("--json", "Emit JSON instead of text.", false)
    .action(async (options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const tasks = await service.listTasks({
        status: options.status ? TaskStatusSchema.parse(options.status) : undefined,
        priority: options.priority ? parsePriority(options.priority) : undefined,
        tag: options.tag,
        search: options.search,
      });
      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      console.log(tasks.length > 0 ? tasks.map(renderTask).join("\n\n") : "No tasks found.");
    });

  program
    .command("view")
    .description("View one task.")
    .argument("<id>", "Task ID.")
    .action(async (id, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const task = await service.getTask(id);
      console.log(renderTask(task));
    });

  program
    .command("complete")
    .description("Mark a task complete.")
    .argument("<id>", "Task ID.")
    .action(async (id, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const task = await service.completeTask(id);
      console.log(renderTask(task));
    });

  program
    .command("delete")
    .description("Delete a task.")
    .argument("<id>", "Task ID.")
    .action(async (id, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      await service.deleteTask(id);
      console.log(`Deleted ${id}`);
    });

  program
    .command("decompose")
    .description("Break a goal into subtasks.")
    .argument("<goal>", "The goal to decompose.")
    .option("--provider <provider>", "Optional AI provider.")
    .option("--model <model>", "Optional model override.")
    .option("--count <number>", "Desired subtask count.", "4")
    .option("--save", "Save generated subtasks into the store.", false)
    .option("--priority <priority>", "Priority for saved subtasks.", "medium")
    .option("--tags <tags>", "Comma-separated tags for saved subtasks.", "")
    .action(async (goal, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const subtasks = await service.decomposeGoal(goal, {
        provider: options.provider,
        model: options.model,
        count: Number(options.count),
        save: options.save,
        priority: parsePriority(options.priority),
        tags: normalizeTags([options.tags]),
      });
      console.log(subtasks.map((task, index) => `${index + 1}. ${task}`).join("\n"));
    });

  program
    .command("snippet")
    .description("Generate a starter code snippet.")
    .argument("<description>", "What the snippet should do.")
    .option("--language <language>", "Language name.", "ts")
    .option("--provider <provider>", "Optional AI provider.")
    .option("--model <model>", "Optional model override.")
    .action(async (description, options) => {
      const service = new TaskForgeService();
      const snippet = await service.generateSnippet(description, {
        language: options.language,
        provider: options.provider,
        model: options.model,
      });
      console.log(snippet);
    });

  program
    .command("refine")
    .description("Refine a task based on feedback.")
    .argument("<id>", "Task ID.")
    .requiredOption("--feedback <text>", "Feedback to incorporate.")
    .option("--provider <provider>", "Optional AI provider.")
    .option("--model <model>", "Optional model override.")
    .action(async (id, options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const task = await service.refineTask(id, options.feedback, {
        provider: options.provider,
        model: options.model,
      });
      console.log(renderTask(task));
    });

  program
    .command("report")
    .description("Export a task report.")
    .option("--format <format>", "markdown or html", "markdown")
    .option("--output <path>", "Write the report to this path.")
    .action(async (options, command) => {
      const storagePath = getStorageFromCommand(command);
      const service = new TaskForgeService(storagePath);
      const format = options.format === "html" ? "html" : "markdown";
      const result = await service.exportReport({
        format,
        outputPath: options.output,
      });
      if (result.outputPath) {
        console.log(`Report written to ${result.outputPath}`);
        return;
      }

      console.log(result.content);
    });

  return program;
}

export async function main(argv = Bun.argv): Promise<void> {
  try {
    await buildTaskForgeProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof TaskForgeError) {
      console.error(`TaskForge error: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

if (import.meta.main) {
  await main();
}


