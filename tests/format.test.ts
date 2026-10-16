import { expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { typescriptProfile } from "../src/typescript.js";
import { parseSource } from "../src/parser.js";
import { formatEntries } from "../src/format.js";
it("groups only unambiguous adjacent side-effect paths and keeps ranges", () => {
  const source =
    'import "./setup/a";\nimport "./setup/b";\nimport {a as alias} from "./setup/a";\nimport type {T} from "./setup/b";';
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines[0]!.text).toBe("imports: [1-4]");
  expect(lines[0]!.ranges).toHaveLength(4);
  expect(lines[1]).toEqual({
    text: '  paths "./setup/": "a", "b"',
    ranges: [
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
    ],
  });
  expect(lines[2]!.text).toContain("type {T}");
  expect(lines[3]!.text).toContain("a as alias");
});
it("keeps duplicate and differing imports separate", () => {
  const source = 'import "./a";\nimport "./a";\nexport {a} from "./a";';
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines).toHaveLength(4);
});

it("uses Maki-style sections, sorted imports, defaults and trailing ranges", () => {
  const source = [
    'import { tryLock } from "fs-native-extensions";',
    'import path from "node:path";',
    'import os from "node:os";',
    "const MAX_SLOTS = 10_000;",
    "type Owner = { pid: number };",
    "export async function acquire(",
    "  strict = false,",
    "  options: Owner | {} = {},",
    '): Promise<void> { throw new Error("hidden"); }',
  ].join("\n");
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines.map((l) => l.text).join("\n")).toBe(
    [
      "imports: [1-3]",
      '  os from "node:os"',
      '  path from "node:path"',
      '  { tryLock } from "fs-native-extensions"',
      "",
      "consts:",
      "  MAX_SLOTS = 10_000 [4]",
      "",
      "types:",
      "  type Owner = { pid: number } [5]",
      "",
      "fns:",
      "  export acquire( strict = false, options: Owner | {} = {}, ): Promise<void> [6-9]",
    ].join("\n"),
  );
  expect(lines[1]!.ranges).toEqual([{ startLine: 3, endLine: 3 }]);
});

it("compacts layout without changing whitespace in literal defaults", () => {
  const source =
    'function f(\r\n  s = "a  b",\r\n  t = `a  b`,\r\n  r = /a  b/,\r\n) {}';
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines[1]!.text).toBe(
    '  f( s = "a  b", t = `a  b`, r = /a  b/, ) [1-5]',
  );
});

it("renders bounded multiline type previews with aligned source ranges", () => {
  const source = `type Big = {\n  field: "${"x".repeat(100)}";\n};`;
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines[1]!.text).toBe("  type Big = { [1-3]");
  expect(lines.at(-1)!.text).toBe("  [truncated]");
  for (const line of lines.slice(1))
    expect(line.ranges).toEqual([{ startLine: 1, endLine: 3 }]);
});

it("bounds constant initializers and retains let/var declarations", () => {
  const source = `const huge = "${"x".repeat(100)}";\nlet mutable = 2;\nvar legacy = 3;`;
  const lines = formatEntries(
    extract(
      parseSource(source, "typescript").rootNode,
      source,
      typescriptProfile,
    ),
  );
  expect(lines[1]!.text).toContain("[truncated] [1]");
  expect(lines.map((l) => l.text)).toContain("vars:");
  expect(lines.map((l) => l.text)).toContain("  let mutable = 2 [2]");
  expect(lines.map((l) => l.text)).toContain("  var legacy = 3 [3]");
});
