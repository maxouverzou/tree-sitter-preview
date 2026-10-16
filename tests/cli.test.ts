import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { indexPath } from "../src/tool.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/tree-sitter-index", import.meta.url));
let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "index-cli-test-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

it("prints the tool output for a relative path from an unrelated cwd", async () => {
  await writeFile(join(cwd, "source file.ts"), "export function hello() {}");
  const result = await indexPath("source file.ts", cwd);
  const { stdout, stderr } = await exec(
    process.execPath,
    [cli, "source file.ts"],
    {
      cwd,
    },
  );
  expect(stdout).toBe(`${result.content[0]!.text}\n`);
  expect(stderr).toBe("");
});

it("accepts an absolute path", async () => {
  const path = join(cwd, "source.ts");
  await writeFile(path, "export const value = 1;");
  const { stdout, stderr } = await exec(process.execPath, [cli, path], { cwd });
  expect(stdout).toContain("value");
  expect(stderr).toBe("");
});

it.each([[], ["a.ts", "b.ts"]])(
  "requires exactly one path (%j)",
  async (...args) => {
    await expect(
      exec(process.execPath, [cli, ...args], { cwd }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "Usage: tree-sitter-index <path>\n",
    });
  },
);

it("reports indexing errors on stderr with a nonzero exit status", async () => {
  await expect(
    exec(process.execPath, [cli, "missing.ts"], { cwd }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("tree-sitter-index:") as unknown,
  });
});

it("prints Markdown headings and section ranges", async () => {
  await writeFile(
    join(cwd, "guide.md"),
    "# Guide\n\n## Setup\nInstructions.\n",
  );
  const { stdout, stderr } = await exec(process.execPath, [cli, "guide.md"], {
    cwd,
  });
  expect(stdout).toBe("headings:\n  # Guide [1-5]\n  ## Setup [3-5]\n");
  expect(stderr).toBe("");
});

it("prints Go function outlines", async () => {
  await writeFile(
    join(cwd, "example.go"),
    "package main\nfunc Hello(name string) error { return nil }\n",
  );
  const { stdout, stderr } = await exec(process.execPath, [cli, "example.go"], {
    cwd,
  });
  expect(stdout).toBe("fns:\n  Hello(name string) error [2]\n");
  expect(stderr).toBe("");
});

it("prints Python functions and classes", async () => {
  await writeFile(
    join(cwd, "example.py"),
    "def hello(name: str) -> str:\n    return name\n\nclass Example:\n    def run(self):\n        pass\n",
  );
  const { stdout, stderr } = await exec(process.execPath, [cli, "example.py"], {
    cwd,
  });
  expect(stdout).toBe(
    "fns:\n  hello(name: str) -> str [1-2]\n\nclasses:\n  Example [4-6]\n    run(self) [5-6]\n",
  );
  expect(stderr).toBe("");
});
