import { expect, it } from "vitest";
import { detectLanguage } from "../src/languages.js";
import { parseSource } from "../src/parser.js";
import { extractGo } from "../src/go.js";
import { formatEntries } from "../src/format.js";
import { indexPath } from "../src/tool.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = `package main

import (
\t"fmt"
\t"os"
)

const MaxRetries = 3
const (
\tA = 1
\tB = 2
)
var GlobalVar = "hello"
type Point struct {
\tX int
\tY int
}
type Reader interface {
\tRead(p []byte) (int, error)
}
type Alias = int
// Method doc
func (p *Point) Distance() float64 { return 0 }
func main() { fmt.Println("implementation must not leak") }
`;

it.each(["a.go", "UPPER.GO"])("detects %s as Go", (path) => {
  expect(detectLanguage(path)).toBe("go");
});

it("matches Maki's Go all-sections extraction with source-node ranges", () => {
  const tree = parseSource(source, "go");
  expect(tree.rootNode.hasError).toBe(false);
  const entries = extractGo(tree.rootNode);
  const lines = formatEntries(entries)
    .map((line) => line.text)
    .join("\n");
  expect(lines).toContain("imports: [3-6]\n  fmt\n  os");
  expect(lines).toContain("consts:\n  MaxRetries [8]\n  A [10]\n  B [11]");
  expect(lines).toContain("var GlobalVar [13]");
  expect(lines).toContain(
    "struct Point [14-17]\n    X int [15]\n    Y int [16]",
  );
  expect(lines).toContain(
    "interface Reader [18-20]\n    Read(p []byte) (int, error) [19]",
  );
  expect(lines).toContain("type Alias = int [21]");
  expect(lines).toContain("impls:\n  (p *Point) Distance() float64 [22-23]");
  expect(lines).toContain("fns:\n  main() [24]");
  expect(lines).not.toContain("implementation must not leak");
  expect(
    entries.find((entry) => entry.text.includes("Distance"))?.range.startLine,
  ).toBe(22);
});

it("keeps interface methods individually ranged and recognizes embedded types", () => {
  const tree = parseSource(
    "package p\ntype Store interface {\n Get(string) error\n io.Reader\n}\n",
    "go",
  );
  const entries = extractGo(tree.rootNode);
  expect(entries[0]?.children?.map((entry) => entry.text)).toEqual([
    "Get(string) error",
    "io.Reader",
  ]);
  expect(entries[0]?.children?.map((entry) => entry.range)).toEqual([
    { startLine: 3, endLine: 3 },
    { startLine: 4, endLine: 4 },
  ]);
});

it("retains intact declarations from malformed input and honors cancellation", () => {
  const source = "package p\nfunc Good() {}\nfunc Broken(";
  const tree = parseSource(source, "go");
  expect(tree.rootNode.hasError).toBe(true);
  expect(extractGo(tree.rootNode, source).map((entry) => entry.text)).toContain(
    "Good()",
  );
  const controller = new AbortController();
  controller.abort();
  expect(() => extractGo(tree.rootNode, source, controller.signal)).toThrow();
});

it("integrates Go through indexPath and the standalone CLI's shared implementation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tree-sitter-index-go-"));
  try {
    await writeFile(join(cwd, "main.go"), "package main\nfunc Hello() {}\n");
    const result = await indexPath("main.go", cwd);
    expect(result.details.language).toBe("go");
    expect(result.details.entryCount).toBe(1);
    expect(result.content[0]?.text).toContain("Hello() [2]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
