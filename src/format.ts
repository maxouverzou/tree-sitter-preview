import type { Entry, RenderedLine, Section, SourceRange } from "./model.js";
import { renderImports } from "./imports.js";
export const SECTIONS: Section[] = [
  "moduleDoc",
  "imports",
  "modules",
  "constants",
  "variables",
  "types",
  "functions",
  "implementations",
  "classes",
  "headings",
];
const HEADERS: Record<Section, string> = {
  imports: "imports:",
  modules: "mod:",
  constants: "consts:",
  variables: "vars:",
  types: "types:",
  functions: "fns:",
  implementations: "impls:",
  headings: "headings:",
  classes: "classes:",
  moduleDoc: "module doc:",
};
function rangeLabel(range: SourceRange): string {
  return range.startLine === range.endLine
    ? `[${range.startLine}]`
    : `[${range.startLine}-${range.endLine}]`;
}
export function formatEntries(entries: Entry[]): RenderedLine[] {
  const lines: RenderedLine[] = [];
  function item(entry: Entry, indent: number): void {
    const prefix = "  ".repeat(indent);
    for (const attribute of entry.attributes ?? [])
      lines.push({ text: prefix + attribute, ranges: [entry.range] });
    const textLines = entry.text.replace(/\r\n?/g, "\n").split("\n");
    for (const [index, text] of textLines.entries()) {
      lines.push({
        text:
          prefix + text + (index === 0 ? ` ${rangeLabel(entry.range)}` : ""),
        ranges: [entry.range],
      });
    }
    for (const child of entry.children ?? []) item(child, indent + 1);
  }
  for (const section of SECTIONS) {
    const items = entries.filter((e) => e.section === section);
    if (!items.length) continue;
    if (lines.length) lines.push({ text: "", ranges: [] });
    if (section === "moduleDoc") {
      for (const entry of items)
        lines.push({
          text: `module doc: ${rangeLabel(entry.range)}`,
          ranges: [entry.range],
        });
    } else if (section === "imports") {
      const range = {
        startLine: items.reduce(
          (min, e) => Math.min(min, e.range.startLine),
          Infinity,
        ),
        endLine: items.reduce((max, e) => Math.max(max, e.range.endLine), 0),
      };
      lines.push({
        text: `imports: ${rangeLabel(range)}`,
        ranges: items.map((e) => e.range),
      });
      const pathImports = items.every((entry) => entry.importPaths);
      const imports = renderImports(items).map((line) => ({
        ...line,
        text: pathImports
          ? line.text
          : line.text
              .replace(/^import\s+/, "")
              .replace(/^export\s+/, "export: "),
      }));
      imports.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
      for (const line of imports)
        lines.push({ ...line, text: `  ${line.text}` });
    } else {
      lines.push({ text: HEADERS[section], ranges: [] });
      for (const entry of items) item(entry, 1);
    }
  }
  if (!lines.length)
    lines.push({
      text: "No recognized declarations (file may be empty).",
      ranges: [],
    });
  return lines;
}
export function countEntries(entries: Entry[]): number {
  return entries.reduce(
    (sum, e) => sum + 1 + countEntries(e.children ?? []),
    0,
  );
}
