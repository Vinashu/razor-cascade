import { describe, expect, test } from "bun:test";

import { withRetry } from "../src/models.ts";

describe("withRetry", () => {
  test("retries transient failures and eventually returns the result", async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;

        if (attempts < 3) {
          throw Object.assign(new Error("Rate limit exceeded"), { status: 429 });
        }

        return "ok";
      },
      {
        maxRetries: 3,
        baseDelayMs: 0,
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("rethrows non-retryable bad requests without retrying", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw Object.assign(new Error("Bad request"), { status: 400 });
        },
        {
          maxRetries: 3,
          baseDelayMs: 0,
        },
      ),
    ).rejects.toThrow("Bad request");

    expect(attempts).toBe(1);
  });
});
