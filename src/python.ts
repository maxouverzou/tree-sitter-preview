import type Parser from "tree-sitter";
import type { Entry } from "./model.js";
import type { CustomProfile } from "./profile.js";

export const pythonProfile: CustomProfile = {
  kind: "custom",
  emptyOutline: "empty",
  extract: (root, _source, signal) => extractPython(root, signal),
};
import { sourceRange } from "./parser.js";
import { preview } from "./preview.js";
import { checkAbort } from "./limits.js";

type Node = Parser.SyntaxNode;
const compact = (text: string) => text.replace(/\s+/g, " ").trim();

function functionEntry(node: Node, wrapper = node): Entry | undefined {
  const name = node.childForFieldName("name");
  const parameters = node.childForFieldName("parameters");
  const returnType = node.childForFieldName("return_type");
  const body = node.childForFieldName("body");
  if (
    !name ||
    node.namedChildren.some((child) => child !== body && child.hasError)
  )
    return undefined;
  return {
    section: "functions",
    kind: node.type,
    text: compact(
      `${name.text}${parameters?.text ?? "()"}${returnType ? ` -> ${returnType.text}` : ""}`,
    ),
    range: sourceRange(wrapper),
  };
}

function importEntry(node: Node): Entry | undefined {
  if (node.hasError) return undefined;
  const module = node.childForFieldName("module_name");
  const names = node.namedChildren.filter(
    (child) =>
      child !== module &&
      ["dotted_name", "aliased_import", "wildcard_import"].includes(child.type),
  );
  // Keep relative dots and parse parenthesized/comma-separated imports as AST
  // names rather than copying Maki's lossy raw-text splitting in those cases.
  const base = module?.text ?? "";
  const prefix = base ? base.split(".") : [];
  if (base.endsWith(".")) prefix.pop();
  const paths = names.map((name) => {
    const value =
      name.type === "aliased_import" ? name.childForFieldName("name")! : name;
    const alias = name.childForFieldName("alias");
    const parts = value.text.split(".");
    if (alias) parts[parts.length - 1] += ` as ${alias.text}`;
    return [...prefix, ...parts];
  });
  if (!paths.length) return undefined;
  return {
    section: "imports",
    kind: node.type,
    text: compact(node.text),
    range: sourceRange(node),
    importPaths: paths,
  };
}

/** Top-level Python symbols only; class bodies contribute direct methods. */
export function extractPython(root: Node, signal?: AbortSignal): Entry[] {
  checkAbort(signal);
  const entries: Entry[] = [];
  let inModuleDocs = true;
  let moduleDoc: Entry | undefined;
  for (const wrapper of root.namedChildren) {
    checkAbort(signal);
    if (wrapper.type === "comment") continue;
    const first = wrapper.firstNamedChild;
    if (
      inModuleDocs &&
      wrapper.type === "expression_statement" &&
      first?.type === "string" &&
      first.text.startsWith('"""') &&
      !wrapper.hasError
    ) {
      if (moduleDoc) moduleDoc.range.endLine = sourceRange(wrapper).endLine;
      else {
        moduleDoc = {
          section: "moduleDoc",
          kind: "docstring",
          text: "",
          range: sourceRange(wrapper),
        };
        entries.push(moduleDoc);
      }
      continue;
    }
    inModuleDocs = false;
    const node =
      wrapper.type === "decorated_definition"
        ? wrapper.childForFieldName("definition")
        : wrapper;
    if (!node || node.isError || node.isMissing) continue;
    if (
      node.type === "import_statement" ||
      node.type === "import_from_statement"
    ) {
      const entry = importEntry(node);
      if (entry) entries.push(entry);
    } else if (node.type === "function_definition") {
      const entry = functionEntry(node, wrapper);
      if (entry) entries.push(entry);
    } else if (node.type === "class_definition") {
      const name = node.childForFieldName("name");
      const body = node.childForFieldName("body");
      if (
        !name ||
        !body ||
        node.namedChildren.some((child) => child !== body && child.hasError)
      )
        continue;
      const methods: Entry[] = [];
      for (const child of body.namedChildren) {
        checkAbort(signal);
        const method =
          child.type === "decorated_definition"
            ? child.childForFieldName("definition")
            : child;
        if (method?.type !== "function_definition") continue;
        const entry = functionEntry(method);
        if (entry) {
          if (child.type === "decorated_definition")
            entry.attributes = child.namedChildren
              .filter((n) => n.type === "decorator")
              .map((n) => compact(n.text));
          methods.push(entry);
        }
      }
      entries.push({
        section: "classes",
        kind: node.type,
        text: name.text,
        range: sourceRange(wrapper),
        children: methods,
      });
    } else if (
      node.type === "expression_statement" &&
      first?.type === "assignment" &&
      !first.hasError
    ) {
      const left = first.childForFieldName("left");
      const right = first.childForFieldName("right");
      if (left && /^[A-Z_]+$/.test(left.text))
        entries.push({
          section: "constants",
          kind: first.type,
          text: left.text + (right ? ` = ${preview(right.text, 60)}` : ""),
          range: sourceRange(first),
        });
    }
  }
  return entries;
}
