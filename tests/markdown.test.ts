import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { detectLanguage } from "../src/languages.js";
import { extractMarkdown, markdownHasError } from "../src/markdown.js";
import { formatEntries } from "../src/format.js";
import { parseSource } from "../src/parser.js";
import { indexPath } from "../src/tool.js";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES } from "../src/limits.js";

function outline(source: string) {
  const tree = parseSource(source, "markdown");
  expect(markdownHasError(tree.rootNode)).toBe(false);
  const entries = extractMarkdown(tree.rootNode);
  return { entries, lines: formatEntries(entries) };
}

it.each(["a.md", "a.markdown", "README.MD", "guide.MARKDOWN"])(
  "detects %s as Markdown",
  (path) => {
    expect(detectLanguage(path)).toBe("markdown");
  },
);

// Golden expectations from Maki's plugins/index/tests/lang/markdown.lua.
it("matches Maki's ATX heading section ranges", () => {
  const source =
    "# Main Title\n\n## Section 1\n\nSome text here.\n\n### Subsection 1.1\n\nMore content.\n\n## Section 2\n\n### Another Subsection 2.1\n\n#### Deep Heading 2.1.3\n\n# Footer Title\n\nAnd some more content\n";
  const { lines } = outline(source);
  expect(lines.map((line) => line.text)).toEqual([
    "headings:",
    "  # Main Title [1-16]",
    "  ## Section 1 [3-10]",
    "  ### Subsection 1.1 [7-10]",
    "  ## Section 2 [11-16]",
    "  ### Another Subsection 2.1 [13-16]",
    "  #### Deep Heading 2.1.3 [15-16]",
    "  # Footer Title [17-20]",
  ]);
});

it("matches Maki without a final newline", () => {
  const { lines } = outline("# Main Title\nSome text here\n# Footer Title");
  expect(lines.map((line) => line.text)).toEqual([
    "headings:",
    "  # Main Title [1-2]",
    "  # Footer Title [3]",
  ]);
});

it("matches Maki's Setext heading section ranges", () => {
  const source =
    "Heading 1\n=========\n\nSome text here\n\nHeading 1.1\n---------\n\nMore content\n\nHeading 2\n=========\n\nAnd some more content\n";
  const { lines } = outline(source);
  expect(lines.map((line) => line.text)).toEqual([
    "headings:",
    "  # Heading 1 [1-10]",
    "  ## Heading 1.1 [6-10]",
    "  # Heading 2 [11-15]",
  ]);
});

it("handles mixed heading levels, CRLF, Unicode and multiline Setext content", () => {
  const source =
    "# Café 😀\r\n\r\n### Deep\r\n\r\nMulti  *line*\r\n`title`\r\n------\r\n\r\n# End";
  const { lines } = outline(source);
  expect(lines.map((line) => line.text)).toEqual([
    "headings:",
    "  # Café 😀 [1-8]",
    "  ### Deep [3-4]",
    "  ## Multi *line* `title` [5-8]",
    "  # End [9]",
  ]);
});

it("walks quote/list containers but ignores fenced, indented and HTML code", () => {
  const source = [
    "# Top",
    "",
    "```md",
    "# Fake",
    "```",
    "",
    "~~~",
    "Hidden",
    "======",
    "~~~",
    "",
    "    # Indented",
    "",
    "<!--",
    "# Comment",
    "-->",
    "",
    "> ## Quoted",
    "",
    "- ### Listed",
    "",
    "# End",
  ].join("\n");
  const { lines } = outline(source);
  expect(lines.map((line) => line.text)).toEqual([
    "headings:",
    "  # Top [1-21]",
    "  ## Quoted [18-21]",
    "  ### Listed [20-21]",
    "  # End [22]",
  ]);
});

it("preserves heading markup while compacting whitespace like Maki", () => {
  const { lines } = outline("  ## A  [link](url) and `a  b` ###\n");
  expect(lines[1]!.text).toBe("  ## A [link](url) and `a b` ### [1-2]");
});

it("honors an already aborted extraction", () => {
  const controller = new AbortController();
  controller.abort();
  const tree = parseSource("# Title", "markdown");
  expect(() => extractMarkdown(tree.rootNode, controller.signal)).toThrow();
});

it("integrates Markdown with tool metadata, empty outlines and truncation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "index-markdown-test-"));
  let artifact: string | undefined;
  try {
    await writeFile(join(cwd, "guide.md"), "# Title\n\n## Child\ntext\n");
    const result = await indexPath("guide.md", cwd);
    expect(result.content[0]!.text).toBe(
      "headings:\n  # Title [1-5]\n  ## Child [3-5]",
    );
    expect(result.details.language).toBe("markdown");
    expect(result.details.entryCount).toBe(2);
    expect(result.details.sourceLineCount).toBe(5);
    expect(result.details.parseError).toBe(false);
    expect(result.details.lines).toEqual([
      { outputLine: 1, ranges: [] },
      { outputLine: 2, ranges: [{ startLine: 1, endLine: 5 }] },
      { outputLine: 3, ranges: [{ startLine: 3, endLine: 5 }] },
    ]);
    for (const source of [
      "",
      "Ordinary prose.\n",
      "```md\n# Not a heading\n```\n",
    ]) {
      await writeFile(join(cwd, "guide.md"), source);
      const empty = await indexPath("guide.md", cwd);
      expect(empty.content[0]!.text).toBe("");
      expect(empty.details.entryCount).toBe(0);
      expect(empty.details.lines).toEqual([]);
    }
    await writeFile(
      join(cwd, "guide.markdown"),
      Array.from({ length: 1500 }, (_, i) => `# Heading ${i}`).join("\n"),
    );
    const large = await indexPath("guide.markdown", cwd);
    artifact = large.details.fullOutputPath;
    expect(large.details.truncated).toBe(true);
    expect(large.details.entryCount).toBe(1500);
    expect(large.details.lines).toHaveLength(
      large.content[0]!.text.split("\n").length,
    );
    expect(large.details.lines.length).toBeLessThanOrEqual(MAX_OUTPUT_LINES);
    expect(Buffer.byteLength(large.content[0]!.text)).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(await readFile(artifact!, "utf8")).toContain(
      "# Heading 1499 [1500]",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    if (artifact) await rm(dirname(artifact), { recursive: true, force: true });
  }
});

it("does not report the grammar's EOF line-ending diagnostic as a syntax error", async () => {
  const tree = parseSource("# No final newline", "markdown");
  expect(tree.rootNode.hasError).toBe(true);
  expect(markdownHasError(tree.rootNode)).toBe(false);
  const cwd = await mkdtemp(join(tmpdir(), "index-markdown-eof-"));
  try {
    await writeFile(join(cwd, "guide.md"), "# No final newline");
    const result = await indexPath("guide.md", cwd);
    expect(result.details.parseError).toBe(false);
    expect(result.content[0]!.text).toBe("headings:\n  # No final newline [1]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
