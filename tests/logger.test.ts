import { describe, expect, test } from "bun:test";

import { Logger } from "../src/logger.ts";

function captureConsoleError(fn: () => void): string[] {
  const originalConsoleError = console.error;
  const output: string[] = [];

  console.error = (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(" "));
  };

  try {
    fn();
    return output;
  } finally {
    console.error = originalConsoleError;
  }
}

describe("logger", () => {
  test("writes JSON log lines with message and context", () => {
    const output = captureConsoleError(() => {
      const logger = new Logger("info", "json");
      logger.info("hello", { runId: 1 });
    });

    expect(output).toHaveLength(1);
    const parsed = JSON.parse(output[0] ?? "") as {
      level?: string;
      timestamp?: string;
      message?: string;
      context?: { runId?: number };
    };

    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello");
    expect(parsed.context?.runId).toBe(1);
    expect(parsed.timestamp).toBeString();
  });

  test("filters out entries below the configured level", () => {
    const output = captureConsoleError(() => {
      const logger = new Logger("warn", "text");
      logger.info("skip me");
      logger.error("keep me");
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("keep me");
    expect(output[0]).not.toContain("skip me");
  });

  test("supports text format output", () => {
    const output = captureConsoleError(() => {
      const logger = new Logger("debug", "text");
      logger.warn("warned", { provider: "openai" });
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("[warn]");
    expect(output[0]).toContain("warned");
    expect(output[0]).toContain("\"provider\":\"openai\"");
  });
});
