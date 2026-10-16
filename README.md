# Tree-sitter index

An on-demand, read-only `index` tool for Pi. It outlines a source file or Markdown document with inclusive, 1-based line ranges, or lists a directory without recursion.

```sh
pi install npm:@maxouverzou/pi-extension-tree-sitter-index
```

Call `index` with `{ "path": "src/example.ts" }`, then call `read` with the selected source range (`offset` = start line, `limit` = end − start + 1).

```text
fns:
  export indexSource(source: string): Outline [5-14]
```

## CLI

The package also provides a standalone command:

```sh
npm install -g @maxouverzou/pi-extension-tree-sitter-index
tree-sitter-index path/to/file.ts
```

Pass exactly one file or directory path. Relative paths resolve from the current
working directory. The command prints the same text as the `index` tool to stdout
(with a trailing newline), including any warnings or truncation notices. Usage
and indexing errors go to stderr with exit status 1. No Pi session is required.

## Supported behavior

- JavaScript (`.js`, `.mjs`, `.cjs`), JSX (`.jsx`), TypeScript (`.ts`, `.mts`, `.cts`), and TSX (`.tsx`). JSX is also accepted in JavaScript files.
- Imports/re-exports, functions/overloads, direct callable variables, classes, interfaces, enums, type aliases, and TypeScript namespaces. Method bodies are omitted; JSDoc extends the following declaration's range when contiguous.
- Maki-style sections: `imports:`, `mod:`, `consts:`, `vars:`, `types:`, `fns:`. Imports are sorted with a shared section range; other declarations retain source order and place ranges after their signatures. Function signatures omit `function`/`async` and compact layout whitespace without changing literals. Constant values and parameter defaults remain visible; nested function bodies in defaults are elided.
- Adjacent, distinct side-effect imports with a shared path prefix may appear as `paths "./setup/": "a", "b"`. This is outline notation, not executable JavaScript. Bindings, aliases, type-only imports, re-exports, and duplicates remain separate lossless declarations.
- Type-alias values use raw source previews capped at 80 characters; non-callable variable initializers use compact previews capped at 60 characters. Longer previews end in `[truncated]`. Classes and interfaces include member outlines.
- Relative paths use Pi's working directory. Explicit symlinks are followed; directory child symlinks are only labeled, never followed. Directory names are JSON-quoted and sorted; directories have `/`, symlinks have `(symlink)`.
- Parse errors yield a warning and intact recognized declarations. Unsupported syntax is omitted, not guessed. Empty/unrecognized files succeed.

The outline format is inspired by Maki, but is not an exact compatibility implementation. This is not semantic search, a persistent symbol index, or a test classifier. No ignore rules, configuration hooks, recursive crawling, or repository restrictions are added.

## Python

Python source (`.py`) and stubs (`.pyi`, case-insensitive) produce outlines like this:

```sh
tree-sitter-index path/to/module.py
```

```text
module doc: [1-3]

imports: [5-6]
  os
  typing.{List, Optional}

consts:
  MAX_RETRIES = 3 [8]

fns:
  process(data: list) -> dict [10-12]

classes:
  Service [14-18]
    @staticmethod
    validate(token: str) -> bool [16-18]
```

- Top-level functions and direct class methods show names, parameters/defaults,
  and return annotations, without `def`/`async` or implementation bodies.
- Class names omit bases and fields. Method decorators are displayed; top-level
  decorators are included in the declaration's range but not printed.
- Imports sort and merge dotted paths using brace notation. Aliases,
  relative dots, multiline imports, and grouped source ranges are retained.
- Constants use an uppercase/underscore-only name rule (`[A-Z_]+`, no
  digits). Type annotations are omitted; values use raw 60-character previews.
- Initial triple-double-quoted module docstrings appear only as a range.
  Other docstrings, nested functions/classes, and conditional declarations are
  omitted. Files without recognized entries produce an empty outline.
- Signature whitespace is compacted throughout, including literals.

## Go

Go source (`.go`, case-insensitive) supports imports, top-level constants and variables, type declarations, functions, and methods:

```go
package store

import "io"

type Reader interface {
    Read([]byte) error
    io.Closer
}

func Open(path string) (*Reader, error) { /* body omitted */ }
```

Struct fields and interface members appear as children of their type. Function bodies are omitted; contiguous preceding comments extend the first declaration's range. Go import aliases are not included in the rendered paths, matching Maki's Go outline behavior. Empty Go files produce an empty outline.

## Markdown

Markdown (`.md`, `.markdown`, case-insensitive) uses heading outlines:

```sh
tree-sitter-index README.md
```

```text
headings:
  # Guide [1-12]
  ## Setup [3-8]
  ## Usage [9-12]
```

ATX (`#`) and Setext (`===`/`---`) headings appear in source order as a flat list.
Each range covers the heading's whole section, ending just before the next
same-or-shallower heading or at the end of the document. A final
newline adds a trailing empty line to that last range. Setext headings normalize
to `#`/`##`; inline markup is retained and whitespace compacted. Headings inside
quotes and lists are included; code blocks, HTML blocks, and ordinary prose are
not. Documents without headings produce an empty outline.

## Limits and native installation

Input is capped at 5 MiB. Text must be valid UTF-8 and contain no NUL bytes. Parsing has a one-second timeout and may briefly block Pi; cancellation takes effect after parsing finishes.

Declaration-level previews are independent of output truncation: full artifacts retain those previews, not omitted source text. Use the source range to read the complete declaration.

Output is bounded to 1,000 lines and 32 KiB (with room reserved for a truncation notice). Truncated outlines are saved to private `pi-index-*/outline.txt` files in the OS temporary directory. These are deliberately retained for follow-up `read` calls, including after Pi exits. Users or OS temporary-file cleanup own removal. Directory listings keep only the first 1,000 entries; full artifacts include that bounded listing, not omitted children.

Native dependencies ship prebuilds for Linux x64, macOS x64/arm64, and Windows x64. Other platforms (including Linux arm64) require Python, make, a C/C++ compiler, Node headers, and enabled npm install scripts. No WASM fallback is used.

On NixOS, supply `LD_LIBRARY_PATH` pointing to the matching compiler runtime's `lib` directory. See [ARCHITECTURE.md](ARCHITECTURE.md) for runtime evidence and extraction boundaries.

## License

MIT.
