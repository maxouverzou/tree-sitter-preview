import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseSource, sourceRange } from "../src/parser.js";
import { extract } from "../src/extract.js";
import { typescriptProfile } from "../src/typescript.js";
import { formatEntries } from "../src/format.js";
import { detectLanguage } from "../src/languages.js";
const outline = (source: string) =>
  extract(
    parseSource(source, "typescript").rootNode,
    source,
    typescriptProfile,
  );
describe("native parsing and extraction", () => {
  it("uses UTF-16 offsets and CRLF rows, with cursor and query APIs", async () => {
    const { default: Parser } = await import("tree-sitter");
    const { loadGrammar } = await import("../src/languages.js");
    const source = 'const café = "😀";\r\nfunction f() {}';
    const tree = parseSource(source, "typescript");
    for (const node of tree.rootNode.namedChildren)
      expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
    expect(tree.rootNode.namedChildren[1]!.startPosition).toEqual({
      row: 1,
      column: 0,
    });
    expect(tree.walk().gotoFirstChild()).toBe(true);
    expect(
      new Parser.Query(
        loadGrammar("typescript"),
        "(function_declaration) @f",
      ).captures(tree.rootNode),
    ).toHaveLength(1);
    expect(
      sourceRange({
        startPosition: { row: 2, column: 1 },
        endPosition: { row: 4, column: 0 },
      }),
    ).toEqual({ startLine: 3, endLine: 4 });
  });
  it.each([
    ["a.js", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.jsx", "jsx"],
    ["a.ts", "typescript"],
    ["a.mts", "typescript"],
    ["a.cts", "typescript"],
    ["a.tsx", "tsx"],
  ] as const)("detects %s", (path, language) => {
    expect(detectLanguage(path)).toBe(language);
    expect(
      parseSource(
        language === "tsx" || language === "jsx"
          ? "const view = <Box />;"
          : "const x = 1;",
        language,
      ).rootNode.hasError,
    ).toBe(false);
  });
  it("outlines declarations without implementations", () => {
    const source = readFileSync(
      new URL("./fixtures/declarations.txt", import.meta.url),
      "utf8",
    );
    const entries = outline(source);
    const text = formatEntries(entries)
      .map((l) => l.text)
      .join("\n");
    expect(text).not.toMatch(
      /secretImplementation|hiddenInitializer|return value|return x/,
    );
    expect(text).toContain("export café<T>({value}: {value: T}): T");
    expect(text).toContain("method({x}: {x: number}): number");
    expect(text).toContain("type { Foo as Alias }");
    expect(
      entries.find((e) => e.kind === "function_declaration")?.range,
    ).toEqual({ startLine: 1, endLine: 5 });
    expect(text).toMatchSnapshot();
  });
  it("attaches only contiguous documentation", () => {
    const entries = outline(
      "/** yes */\nfunction a() {}\n/** no */\n\nfunction b() {}\n/** no */\nconsole.log(1);\nfunction c() {}\n// no\nfunction d() {}",
    );
    expect(entries.map((e) => e.range.startLine)).toEqual([1, 5, 8, 10]);
  });
  it("handles overloads, async functions, arrow expressions and errors", () => {
    const source =
      "function f(x: string): string;\nasync function f(x: string) { return x; }\nconst g = ({x}: {x: number}) => x + 123;\nfunction broken( {\n";
    const root = parseSource(source, "typescript").rootNode;
    expect(root.hasError).toBe(true);
    const text = formatEntries(extract(root, source, typescriptProfile))
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("f(x: string) [2]");
    expect(text).not.toContain("123");
  });
  it("handles namespace wrappers, default exports and nested object members", () => {
    const source =
      "namespace N { export const x = () => 2; }\nexport default function() { return 123; }\nexport default class { method() { return 456; } }\ndeclare function f(): void;\ninterface X { nested: { a: string; f(): void }; [key: string]: unknown }";
    const text = formatEntries(outline(source))
      .map((l) => l.text)
      .join("\n");
    expect(text).toContain("mod:");
    expect(text).toContain("namespace N");
    expect(text).toContain("export default ()");
    expect(text).toContain("export default class");
    expect(text).toContain("declare f()");
    expect(text).toContain("nested: { … }");
    expect(text).toContain("[key: string]: unknown");
    expect(text).not.toMatch(/123|456|=> 2/);
  });
  it("elides implementation-heavy defaults inside signatures", () => {
    const source =
      "function f(cb = () => { const secret = 123; }, {x = 456} = {}) { return cb; }";
    const text = formatEntries(outline(source))
      .map((l) => l.text)
      .join("\n");
    expect(text).not.toMatch(/secret|123|return cb/);
    expect(text).toContain("f(cb = () => …, {x = 456} = {})");
  });
  it("never treats test calls as declarations", () => {
    expect(
      outline('describe("suite", () => { function nested() {} });'),
    ).toEqual([]);
    expect(outline("")).toEqual([]);
  });
});
