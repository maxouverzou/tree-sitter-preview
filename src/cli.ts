import { indexPath } from "./tool.js";

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0]) {
  console.error("Usage: tree-sitter-index <path>");
  process.exitCode = 1;
} else {
  try {
    const result = await indexPath(args[0], process.cwd());
    for (const content of result.content) {
      process.stdout.write(`${content.text}\n`);
    }
  } catch (error) {
    console.error(
      `tree-sitter-index: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
