import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { detectLanguage } from "../src/languages.js";
import { parseSource } from "../src/parser.js";
import { extractPython } from "../src/python.js";
import { formatEntries } from "../src/format.js";
import { indexPath } from "../src/tool.js";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES } from "../src/limits.js";

function outline(source: string) {
  const tree = parseSource(source, "python");
  expect(tree.rootNode.hasError).toBe(false);
  const entries = extractPython(tree.rootNode);
  return { entries, lines: formatEntries(entries) };
}

it.each(["a.py", "a.pyi", "SCRIPT.PY", "types.PYI"])(
  "detects %s as Python",
  (path) => {
    expect(detectLanguage(path)).toBe("python");
  },
);

it("matches Maki's all-sections Python example", () => {
  // Source from Maki's plugins/index/tests/lang/python.lua.
  const source = `"""Module docstring."""

import os
from typing import Optional

MAX_RETRIES = 3
MY_VAR: int = 10

@dataclass
class MyClass:
    x: int = 0

class AuthService:
    def __init__(self, secret: str):
        self.secret = secret
    @staticmethod
    def validate(token: str) -> bool:
        return True

def process(data: list) -> dict:
    return {}
`;
  const { lines } = outline(source);
  expect(lines.map((line) => line.text).join("\n")).toBe(`module doc: [1]

imports: [3-4]
  os
  typing.Optional

consts:
  MAX_RETRIES = 3 [6]
  MY_VAR = 10 [7]

fns:
  process(data: list) -> dict [20-21]

classes:
  MyClass [9-11]
  AuthService [13-18]
    __init__(self, secret: str) [14-15]
    @staticmethod
    validate(token: str) -> bool [17-18]`);
  expect(lines.at(-1)!.ranges).toEqual([{ startLine: 17, endLine: 18 }]);
});

it("groups dotted imports and retains ranges for aliases, duplicates and prefix leaves", () => {
  const { lines } = outline(
    "from typing import Optional, List\nimport os.path\nimport os\nimport typing.Optional\nimport os.path as p\n",
  );
  expect(lines.map((line) => line.text)).toEqual([
    "imports: [1-5]",
    "  os",
    "  os.path",
    "  os.path as p",
    "  typing.{List, Optional}",
  ]);
  expect(lines.at(-1)!.ranges).toEqual([
    { startLine: 1, endLine: 1 },
    { startLine: 4, endLine: 4 },
  ]);
});

it("preserves relative imports and parses multiline/parenthesized/comma imports", () => {
  const { lines } = outline(
    "from ..pkg import (\n    one as alias,\n    two,\n)\nfrom . import helper\nimport os, sys as system\nfrom pkg import *\nimport export\n",
  );
  expect(lines.map((line) => line.text)).toEqual([
    "imports: [1-8]",
    "  .{.pkg.{one as alias, two}, helper}",
    "  export",
    "  os",
    "  pkg.*",
    "  sys as system",
  ]);
});

it("compacts async signatures and defaults, omits def/async and skips implementations", () => {
  const { lines } = outline(
    "@cached\nasync def fetch(\n    url: str,\n    retries: int = 3,\n) -> dict[str, int]:\n    secret = 42\n    def nested():\n        return secret\n    return {}\n",
  );
  expect(lines.map((line) => line.text)).toEqual([
    "fns:",
    "  fetch( url: str, retries: int = 3, ) -> dict[str, int] [1-9]",
  ]);
});

it("includes direct class methods and their decorators, not class fields or nested bodies", () => {
  const { lines } = outline(
    "class Repo(Base):\n    FIELD = 2\n    @classmethod\n    @cached\n    async def fetch(cls, id: int) -> dict:\n        def nested():\n            pass\n        return {}\n    class Inner:\n        def hidden(self):\n            pass\n",
  );
  expect(lines.map((line) => line.text)).toEqual([
    "classes:",
    "  Repo [1-11]",
    "    @classmethod",
    "    @cached",
    "    fetch(cls, id: int) -> dict [5-8]",
  ]);
});

it("matches Maki's uppercase constant rule and bounded raw value previews", () => {
  const { lines } = outline(
    `lower = 1\nHAS_DIGIT_2 = 2\nONLY_TYPE: int\nVALUE: int = 3\nHUGE = "${"x".repeat(100)}"\n`,
  );
  expect(lines.map((line) => line.text)).toEqual([
    "consts:",
    "  ONLY_TYPE [3]",
    "  VALUE = 3 [4]",
    `  HUGE = "${"x".repeat(48)}[truncated] [5]`,
  ]);
});

it("detects only initial triple-double-quoted module docs and skips comments", () => {
  const { lines } = outline(
    '# comment\n"""First\nSecond"""\n# gap\n"""More"""\ndef f():\n    """Function docs"""\n    pass\n"""Not module docs"""\n',
  );
  expect(lines.map((line) => line.text)).toEqual([
    "module doc: [2-5]",
    "",
    "fns:",
    "  f() [6-8]",
  ]);
  expect(outline("'''Single quoted'''\n").entries).toEqual([]);
});

it("handles CRLF, Unicode, Python stubs and an already aborted signal", () => {
  const { lines } = outline("def café(name: str = '😀') -> str:\r\n    ...");
  expect(lines[1]!.text).toBe("  café(name: str = '😀') -> str [1-2]");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    extractPython(parseSource("", "python").rootNode, controller.signal),
  ).toThrow();
});

it("integrates metadata, empty outlines, syntax warnings and output limits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "index-python-test-"));
  let artifact: string | undefined;
  try {
    await writeFile(
      join(cwd, "a.py"),
      "class Repo:\n    def connect(self) -> None:\n        pass\n",
    );
    const result = await indexPath("a.py", cwd);
    expect(result.details.language).toBe("python");
    expect(result.details.entryCount).toBe(2);
    expect(result.details.sourceLineCount).toBe(4);
    expect(result.details.parseError).toBe(false);
    expect(result.details.lines.at(-1)).toEqual({
      outputLine: 3,
      ranges: [{ startLine: 2, endLine: 3 }],
    });
    for (const source of [
      "",
      "# comment\n",
      "print('hello')\n",
      "if True:\n    def hidden():\n        pass\n",
    ]) {
      await writeFile(join(cwd, "a.py"), source);
      const empty = await indexPath("a.py", cwd);
      expect(empty.content[0]!.text).toBe("");
      expect(empty.details.entryCount).toBe(0);
    }
    await writeFile(join(cwd, "a.py"), "def valid():\n    pass\ndef broken(\n");
    const broken = await indexPath("a.py", cwd);
    expect(broken.details.parseError).toBe(true);
    expect(broken.content[0]!.text).toContain("Warning: syntax errors");
    expect(broken.content[0]!.text).toContain("valid()");
    await writeFile(
      join(cwd, "a.pyi"),
      Array.from({ length: 1500 }, (_, i) => `def f${i}(): ...`).join("\n"),
    );
    const large = await indexPath("a.pyi", cwd);
    artifact = large.details.fullOutputPath;
    expect(large.details.entryCount).toBe(1500);
    expect(large.details.truncated).toBe(true);
    expect(large.details.lines).toHaveLength(
      large.content[0]!.text.split("\n").length,
    );
    expect(large.details.lines.length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
    expect(Buffer.byteLength(large.content[0]!.text)).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(await readFile(artifact!, "utf8")).toContain("f1499() [1500]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    if (artifact) await rm(dirname(artifact), { recursive: true, force: true });
  }
});
