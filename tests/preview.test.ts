import { expect, it } from "vitest";
import { preview } from "../src/preview.js";

it("keeps short text unchanged and uses Maki-style truncation markers", () => {
  expect(preview("{}", 80)).toBe("{}");
  expect(preview("a".repeat(100), 60)).toBe("a".repeat(49) + "[truncated]");
  expect(preview("{\n" + "a".repeat(100), 80)).toBe(
    "{\n" + "a".repeat(67) + "\n[truncated]",
  );
});

it("does not split Unicode characters at a preview boundary", () => {
  expect(preview("😀".repeat(100), 60)).toBe("😀".repeat(49) + "[truncated]");
});
