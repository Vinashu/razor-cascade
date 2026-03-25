import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskForgeError, TaskForgeService } from "../src/taskforge.ts";

const cleanupPaths: string[] = [];

async function createService(): Promise<TaskForgeService> {
  const dir = await mkdtemp(join(tmpdir(), "taskforge-test-"));
  cleanupPaths.push(dir);
  return new TaskForgeService(join(dir, "tasks.json"));
}

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("TaskForgeService", () => {
  test("rejects empty task titles and missing task IDs", async () => {
    const service = await createService();

    await expect(
      service.addTask({
        title: "   ",
      }),
    ).rejects.toThrow(TaskForgeError);
    await expect(service.completeTask("task_9999")).rejects.toThrow(TaskForgeError);
    await expect(service.deleteTask("task_9999")).rejects.toThrow(TaskForgeError);
  });

  test("adds, lists, completes, and deletes tasks", async () => {
    const service = await createService();

    const first = await service.addTask({
      title: "Write study summary",
      description: "Capture cost and quality findings.",
      priority: "high",
      tags: ["study", "paper"],
    });
    await service.addTask({
      title: "Draft README examples",
      priority: "medium",
      tags: ["docs"],
    });

    const openTasks = await service.listTasks({ status: "open" });
    expect(openTasks).toHaveLength(2);
    expect(openTasks[0]?.id).toBe(first.id);

    const completed = await service.completeTask(first.id);
    expect(completed.status).toBe("completed");
    expect(typeof completed.completedAt).toBe("string");

    const completedTasks = await service.listTasks({ status: "completed" });
    expect(completedTasks).toHaveLength(1);

    await service.deleteTask(first.id);
    const remaining = await service.listTasks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.title).toContain("README");
  });

  test("supports decomposition, refinement, and report export without live AI", async () => {
    const service = await createService();
    const previousEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
    const task = await service.addTask({
      title: "Ship the first release",
      description: "Prepare a usable public release.",
      priority: "high",
    });

    const subtasks = await service.decomposeGoal("Ship the first public release with docs and tests", {
      count: 4,
    });
    expect(subtasks.length).toBeGreaterThanOrEqual(3);

    const refined = await service.refineTask(task.id, "Add acceptance criteria and rollout notes.");
    expect(refined.description).toContain("Refined guidance");
    expect(refined.notes[0]).toContain("Feedback");

    const report = await service.exportReport({ format: "markdown" });
    expect(report.content).toContain("TaskForge Report");
    expect(report.content).toContain(task.title);
    } finally {
      if (previousEnv.OPENAI_API_KEY !== undefined) {
        process.env.OPENAI_API_KEY = previousEnv.OPENAI_API_KEY;
      }
      if (previousEnv.ANTHROPIC_API_KEY !== undefined) {
        process.env.ANTHROPIC_API_KEY = previousEnv.ANTHROPIC_API_KEY;
      }
      if (previousEnv.XAI_API_KEY !== undefined) {
        process.env.XAI_API_KEY = previousEnv.XAI_API_KEY;
      }
      if (previousEnv.GEMINI_API_KEY !== undefined) {
        process.env.GEMINI_API_KEY = previousEnv.GEMINI_API_KEY;
      }
    }
  });
});
