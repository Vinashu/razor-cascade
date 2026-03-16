import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskForgeService } from "../src/taskforge.ts";

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
  });
});
