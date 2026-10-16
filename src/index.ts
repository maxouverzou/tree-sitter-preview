import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { indexPath } from "./tool.js";
export default function treeSitterIndex(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "index",
    label: "Index",
    description:
      "Use index first on individual source or Markdown files to see a compact outline with line ranges, then use read on the relevant sections. Lists directories too; does not search or recursively index a repository.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Source file, Markdown document, or directory path, relative to the working directory",
      }),
    }),
    execute: async (_id, params, signal, _update, ctx) =>
      indexPath(params.path, ctx.cwd, signal),
  });
}
