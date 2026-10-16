import type Parser from "tree-sitter";
import type { Entry } from "./model.js";
import type { CustomProfile } from "./profile.js";
import { sourceRange } from "./parser.js";
import { checkAbort } from "./limits.js";
import { preview } from "./preview.js";

type Node = Parser.SyntaxNode;
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const named = (node: Node, field: string) => node.childForFieldName(field);

function importEntry(node: Node): Entry | undefined {
  const paths: string[][] = [];
  const visit = (current: Node) => {
    if (current.type === "import_spec") {
      const path = named(current, "path")?.text;
      if (path) paths.push(path.slice(1, -1).split("/").filter(Boolean));
      return;
    }
    for (const child of current.namedChildren) visit(child);
  };
  visit(node);
  return paths.length
    ? {
        section: "imports",
        kind: node.type,
        text: node.text,
        range: sourceRange(node),
        importPaths: paths,
      }
    : undefined;
}

function functionEntry(node: Node): Entry | undefined {
  const name = named(node, "name");
  if (!name) return undefined;
  const params = named(node, "parameters")?.text ?? "()";
  const result = named(node, "result");
  return {
    section:
      node.type === "method_declaration" ? "implementations" : "functions",
    kind: node.type,
    text: compact(
      `${node.type === "method_declaration" ? `${named(node, "receiver")?.text ?? ""} ` : ""}${name.text}${params}${result ? ` ${result.text}` : ""}`,
    ),
    range: sourceRange(node),
  };
}

function typeEntries(node: Node): Entry[] {
  const entries: Entry[] = [];
  const specs = node.namedChildren.filter(
    (child) => child.type === "type_spec" || child.type === "type_alias",
  );
  for (const spec of specs) {
    const name = named(spec, "name");
    const type = named(spec, "type");
    if (!name || !type) continue;
    if (type.type === "struct_type") {
      const fields: Entry[] = [];
      const list = type.namedChildren.find(
        (child) => child.type === "field_declaration_list",
      );
      for (const field of list?.namedChildren ?? []) {
        if (field.type !== "field_declaration") continue;
        const fieldName = named(field, "name")?.text ?? "_";
        const fieldType = named(field, "type")?.text ?? "_";
        fields.push({
          section: "types",
          kind: field.type,
          text: compact(`${fieldName} ${fieldType}`),
          range: sourceRange(field),
        });
      }
      entries.push({
        section: "types",
        kind: spec.type,
        text: `struct ${name.text}`,
        range: sourceRange(spec),
        children: fields,
      });
    } else if (type.type === "interface_type") {
      const members: Entry[] = [];
      for (const member of type.namedChildren) {
        if (member.type === "method_elem") {
          const methodName = named(member, "name");
          if (methodName)
            members.push({
              section: "types",
              kind: member.type,
              text: compact(
                `${methodName.text}${named(member, "parameters")?.text ?? "()"}${named(member, "result") ? ` ${named(member, "result")!.text}` : ""}`,
              ),
              range: sourceRange(member),
            });
        } else if (member.type === "type_elem") {
          members.push({
            section: "types",
            kind: member.type,
            text: preview(member.text, 60),
            range: sourceRange(member),
          });
        }
      }
      entries.push({
        section: "types",
        kind: spec.type,
        text: `interface ${name.text}`,
        range: sourceRange(spec),
        children: members,
      });
    } else {
      entries.push({
        section: "types",
        kind: spec.type,
        text:
          spec.type === "type_alias"
            ? `type ${name.text} = ${type.text}`
            : `${name.text} ${preview(type.text, 60)}`,
        range: sourceRange(spec),
      });
    }
  }
  return entries;
}

function valueEntries(node: Node, isVar: boolean): Entry[] {
  const entries: Entry[] = [];
  const wanted = isVar ? "var_spec" : "const_spec";
  const visit = (current: Node) => {
    if (current.type === wanted) {
      const name = named(current, "name");
      if (name)
        entries.push({
          section: isVar ? "variables" : "constants",
          kind: current.type,
          text: `${isVar ? "var " : ""}${name.text}${named(current, "type") ? ` ${named(current, "type")!.text}` : ""}`,
          range: sourceRange(current),
        });
      return;
    }
    for (const child of current.namedChildren) visit(child);
  };
  visit(node);
  return entries;
}

export function extractGo(
  root: Node,
  source = root.text,
  signal?: AbortSignal,
): Entry[] {
  checkAbort(signal);
  const entries: Entry[] = [];
  let pendingDoc: Node | undefined;
  let previous: Node | undefined;
  for (const node of root.namedChildren) {
    checkAbort(signal);
    const gap = previous
      ? source.slice(previous.endIndex, node.startIndex)
      : "";
    if (/\n\s*\n/.test(gap)) pendingDoc = undefined;
    if (node.type === "comment") {
      pendingDoc ??= node;
      previous = node;
      continue;
    }
    let found: Entry[] = [];
    if (node.type === "import_declaration") {
      const entry = importEntry(node);
      if (entry) found = [entry];
    } else if (
      node.type === "function_declaration" ||
      node.type === "method_declaration"
    ) {
      const entry = functionEntry(node);
      if (entry) found = [entry];
    } else if (node.type === "type_declaration") found = typeEntries(node);
    else if (node.type === "const_declaration")
      found = valueEntries(node, false);
    else if (node.type === "var_declaration") found = valueEntries(node, true);
    if (pendingDoc && found[0])
      found[0].range.startLine = pendingDoc.startPosition.row + 1;
    entries.push(...found);
    pendingDoc = undefined;
    previous = node;
  }
  return entries;
}

export const goProfile: CustomProfile = {
  kind: "custom",
  emptyOutline: "empty",
  extract: extractGo,
};
