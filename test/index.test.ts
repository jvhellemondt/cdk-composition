import { describe, expect, test } from "bun:test";

describe("cdk-composition", () => {
  test("package exports resolve", async () => {
    const lib = await import("../src/index");
    expect(lib).toBeDefined();
  });
});
