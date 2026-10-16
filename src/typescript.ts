import type Parser from "tree-sitter";
import type { Entry, Section } from "./model.js";
import type { DeclarationProfile } from "./profile.js";

/** JavaScript/JSX and TypeScript/TSX share recognition, not parser grammars. */
export const typescriptProfile: DeclarationProfile = {
  kind: "declarations",
  isDocComment,
  extractNodes: (node, source, signal) => recognize(node, source, 0, signal),
};
import { sourceRange } from "./parser.js";
import { compactSource, preview } from "./preview.js";
import { MAX_DEPTH, checkAbort } from "./limits.js";
type Node = Parser.SyntaxNode;
const functions = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_signature",
  "function_expression",
  "generator_function",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "call_signature",
  "construct_signature",
]);
const structures = new Set([
  "class_declaration",
  "class",
  "abstract_class_declaration",
  "interface_declaration",
  "enum_declaration",
  "internal_module",
  "module",
]);
const members = new Set([
  "public_field_definition",
  "field_definition",
  "property_signature",
  "index_signature",
  "enum_assignment",
  "property_identifier",
]);
export function isDocComment(node: Node): boolean {
  return node.type === "comment" && node.text.startsWith("/**");
}
function text(source: string, start: number, end: number): string {
  return source.slice(start, end).trim();
}
function signature(node: Node, source: string, end: number): string {
  const replacements: { start: number; end: number; text: string }[] = [];
  function visit(current: Node, depth: number): void {
    if (current.startIndex >= end) return;
    if (depth > 64) {
      replacements.push({
        start: current.startIndex,
        end: Math.min(end, current.endIndex),
        text: "…",
      });
      return;
    }
    if (
      ["string", "template_string", "regex", "comment"].includes(current.type)
    ) {
      replacements.push({
        start: current.startIndex,
        end: Math.min(end, current.endIndex),
        text:
          current.type === "comment"
            ? " "
            : source.slice(current.startIndex, Math.min(end, current.endIndex)),
      });
      return;
    }
    const body = current.childForFieldName("body");
    for (const child of current.namedChildren) {
      if (child.startIndex >= end) continue;
      if (child === body)
        replacements.push({
          start: child.startIndex,
          end: Math.min(child.endIndex, end),
          text: "…",
        });
      else visit(child, depth + 1);
    }
  }
  visit(node, 0);
  let cursor = node.startIndex;
  let result = "";
  for (const replacement of replacements) {
    result +=
      source.slice(cursor, replacement.start).replace(/\s+/g, " ") +
      replacement.text;
    cursor = replacement.end;
  }
  return (result + source.slice(cursor, end).replace(/\s+/g, " ")).trim();
}
export function recognize(
  node: Node,
  source: string,
  depth = 0,
  signal?: AbortSignal,
): Entry[] {
  checkAbort(signal);
  if (depth > MAX_DEPTH || node.isError || node.isMissing) return [];
  const field = (name: string) => node.childForFieldName(name);
  const entry = (
    section: Section,
    signature: string,
    children?: Entry[],
  ): Entry[] =>
    signature
      ? [
          {
            section,
            kind: node.type,
            text: signature,
            range: sourceRange(node),
            ...(children ? { children } : {}),
          },
        ]
      : [];
  // TypeScript represents namespaces inside an expression_statement wrapper.
  if (
    node.type === "expression_statement" &&
    node.namedChildCount === 1 &&
    node.firstNamedChild?.type === "internal_module"
  ) {
    return recognize(node.firstNamedChild, source, depth, signal);
  }
  if (node.type === "export_statement" || node.type === "ambient_declaration") {
    const value = field("value");
    const declaration =
      field("declaration") ??
      (value && (functions.has(value.type) || structures.has(value.type))
        ? value
        : null) ??
      node.namedChildren.find(
        (n) =>
          n.type.endsWith("declaration") ||
          functions.has(n.type) ||
          n.type === "internal_module",
      );
    if (declaration) {
      const entries = recognize(declaration, source, depth, signal);
      const prefix = text(source, node.startIndex, declaration.startIndex);
      return entries.map((e) => ({
        ...e,
        text: `${prefix} ${e.text}`,
        range: sourceRange(node),
      }));
    }
  }
  if (
    node.type === "import_statement" ||
    (node.type === "export_statement" && field("source"))
  ) {
    if (node.hasError) return [];
    const path = field("source");
    if (!path) return [];
    const signature = compactSource(node, source).replace(/;$/, "");
    const keyword = node.type === "import_statement" ? "import" : "export";
    return [
      {
        section: "imports",
        kind: node.type,
        text: signature,
        range: sourceRange(node),
        importInfo: {
          keyword,
          path: path.text.slice(1, -1),
          separator: "/",
          bindings: text(source, node.startIndex, path.startIndex),
        },
      },
    ];
  }
  if (functions.has(node.type)) {
    const body = field("body");
    const end = body?.startIndex ?? node.endIndex;
    if (node.namedChildren.some((n) => n !== body && n.hasError)) return [];
    return entry(
      "functions",
      signature(node, source, end)
        .replace(/^(?:async\s+)?function\s*/, "")
        .replace(/;$/, ""),
    );
  }
  if (structures.has(node.type)) {
    const body = field("body");
    if (!body || node.namedChildren.some((n) => n !== body && n.hasError))
      return [];
    const children = body.namedChildren.flatMap((n) =>
      recognize(n, source, depth + 1, signal),
    );
    return entry(
      node.type === "internal_module" || node.type === "module"
        ? "modules"
        : "types",
      text(source, node.startIndex, body.startIndex),
      children,
    );
  }
  if (node.type === "type_alias_declaration") {
    if (node.hasError) return [];
    const value = field("value");
    return entry(
      "types",
      value
        ? text(source, node.startIndex, value.startIndex) +
            " " +
            preview(value.text, 80)
        : node.text.trim().replace(/;$/, ""),
    );
  }
  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    const keyword = node.children[0]?.text ?? "const";
    return node.namedChildren
      .filter((n) => n.type === "variable_declarator")
      .flatMap((n) => {
        if (n.hasError) return [];
        const value = n.childForFieldName("value");
        const head = compactSource(
          n,
          source,
          value ? value.startIndex : n.endIndex,
        ).replace(/\s*=\s*$/, "");
        const callable =
          value &&
          [
            "arrow_function",
            "function_expression",
            "generator_function",
          ].includes(value.type);
        const body = callable ? value.childForFieldName("body") : null;
        const callableSignature =
          callable && body
            ? signature(value, source, body.startIndex) + " …"
            : "…";
        return [
          {
            section: callable
              ? ("functions" as const)
              : keyword === "const"
                ? ("constants" as const)
                : ("variables" as const),
            kind: n.type,
            text: `${keyword === "const" ? "" : keyword + " "}${head}${value ? ` = ${callable ? callableSignature : preview(compactSource(value, source), 60)}` : ""}`,
            range: sourceRange(node),
          },
        ];
      });
  }
  if (members.has(node.type)) {
    if (node.hasError) return [];
    const value = field("value");
    const annotation = field("type");
    const objectType = annotation?.namedChildren.find(
      (n) => n.type === "object_type",
    );
    if (!value && objectType) {
      return entry(
        "variables",
        text(source, node.startIndex, objectType.startIndex) + " { … }",
        objectType.namedChildren.flatMap((n) =>
          recognize(n, source, depth + 1, signal),
        ),
      );
    }
    return entry(
      "variables",
      value
        ? text(source, node.startIndex, value.startIndex).replace(
            /\s*=\s*$/,
            "",
          ) + " = …"
        : node.text.trim().replace(/[;,]$/, ""),
    );
  }
  return [];
}
