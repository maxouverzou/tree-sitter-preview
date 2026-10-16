import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { indexPath } from "../src/tool.js";
import {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_LINES,
} from "../src/limits.js";
let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "index-test-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});
it("resolves cwd, follows explicit symlinks, returns fresh serializable details", async () => {
  await writeFile(join(cwd, "a.ts"), "export function a() { return 42; }");
  await symlink(join(cwd, "a.ts"), join(cwd, "link.ts"));
  const result = await indexPath("link.ts", cwd);
  expect(result.details.path).toBe(join(cwd, "link.ts"));
  expect(result.content[0]!.text).toContain("export a()");
  expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
  await writeFile(join(cwd, "a.ts"), "const changed = 1;");
  expect((await indexPath("a.ts", cwd)).content[0]!.text).toContain("changed");
});
it("lists non-recursive sorted directory entries and identifies symlinks", async () => {
  await mkdir(join(cwd, "z"));
  await writeFile(join(cwd, "a.ts"), "bad syntax");
  await symlink("z", join(cwd, "b"));
  const result = await indexPath(".", cwd);
  expect(result.content[0]!.text).toBe('"a.ts"\n"b" (symlink)\n"z"/');
  expect(result.details.kind).toBe("directory");
});
it("rejects missing, unsupported, binary and large input", async () => {
  await expect(indexPath("missing.ts", cwd)).rejects.toThrow();
  await writeFile(join(cwd, "a.rb"), "");
  await expect(indexPath("a.rb", cwd)).rejects.toThrow("Unsupported");
  await writeFile(join(cwd, "a.ts"), Buffer.from([0]));
  await expect(indexPath("a.ts", cwd)).rejects.toThrow("binary");
  await writeFile(join(cwd, "a.ts"), Buffer.from([255]));
  await expect(indexPath("a.ts", cwd)).rejects.toThrow("UTF-8");
  await writeFile(join(cwd, "a.ts"), " ".repeat(MAX_INPUT_BYTES + 1));
  await expect(indexPath("a.ts", cwd)).rejects.toThrow("5 MiB");
});
it("supports empty files and warns on partial errors", async () => {
  await writeFile(join(cwd, "a.ts"), "");
  expect((await indexPath("a.ts", cwd)).details.sourceLineCount).toBe(0);
  await writeFile(join(cwd, "a.ts"), "function valid() {}\nfunction broken( {");
  const result = await indexPath("a.ts", cwd);
  expect(result.details.parseError).toBe(true);
  expect(result.content[0]!.text).toContain("Warning");
  expect(result.content[0]!.text).toContain("valid");
});
it("truncates with aligned metadata and readable full artifact", async () => {
  await writeFile(
    join(cwd, "a.ts"),
    Array.from(
      { length: 1500 },
      (_, i) => `function f${i}() { return ${i}; }`,
    ).join("\n"),
  );
  const result = await indexPath("a.ts", cwd);
  const text = result.content[0]!.text;
  expect(result.details.truncated).toBe(true);
  expect(text.split("\n").length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(result.details.lines).toHaveLength(text.split("\n").length);
  const artifact = result.details.fullOutputPath!;
  try {
    expect(await readFile(artifact, "utf8")).toContain("f1499");
  } finally {
    await rm(dirname(artifact), { recursive: true, force: true });
  }
});
it("bounds a single giant signature by bytes without splitting its line", async () => {
  await writeFile(
    join(cwd, "a.ts"),
    `function huge(value: "${"a".repeat(MAX_OUTPUT_BYTES)}") {}`,
  );
  const result = await indexPath("a.ts", cwd);
  const artifact = result.details.fullOutputPath!;
  try {
    expect(result.details.truncated).toBe(true);
    expect(Buffer.byteLength(result.content[0]!.text)).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(result.details.lines.at(-1)?.ranges).toEqual([]);
    expect((await readFile(artifact, "utf8")).length).toBeGreaterThan(
      MAX_OUTPUT_BYTES,
    );
  } finally {
    await rm(dirname(artifact), { recursive: true, force: true });
  }
});
it("bounds directory listings and reports exact omissions", async () => {
  await Promise.all(
    Array.from({ length: 1002 }, (_, i) => writeFile(join(cwd, `${i}`), "")),
  );
  const result = await indexPath(".", cwd);
  expect(result.details.entryCount).toBe(1002);
  expect(result.details.omittedEntries).toBe(2);
  expect(result.details.truncated).toBe(true);
  const artifact = result.details.fullOutputPath;
  if (artifact) await rm(dirname(artifact), { recursive: true, force: true });
});
it("uses independent parsers and honors pre-abort", async () => {
  await writeFile(join(cwd, "a.ts"), "function a() {}");
  await writeFile(join(cwd, "b.tsx"), "const b = () => <Box />;");
  const results = await Promise.all([
    indexPath("a.ts", cwd),
    indexPath("b.tsx", cwd),
  ]);
  expect(results.map((r) => r.details.language)).toEqual(["typescript", "tsx"]);
  const abort = new AbortController();
  abort.abort();
  await expect(indexPath("a.ts", cwd, abort.signal)).rejects.toThrow();
});
