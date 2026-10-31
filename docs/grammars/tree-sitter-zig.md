# Zig grammar provenance and rebuild

`vendor/tree-sitter-zig/` contains the grammar source, generated parser, metadata,
and MIT license from `@tree-sitter-grammars/tree-sitter-zig` 1.1.2
(`gitHead` `b670c8df85a1568f498aa5c8cae42f51a90473c0`). The source
archive is `https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-zig/-/tree-sitter-zig-1.1.2.tgz`
with SHA-256 `2512a88611e400dbafb9cb79b247c7f2671ed034e1714b33df29712ee93e534c`.

The four container declarations in `grammar.js` allow an empty member list.
That is the only source change from the pinned archive. The generated
`src/parser.c`, `src/grammar.json`, and `src/node-types.json` are checked in.
The grammar is built with tree-sitter CLI 0.27.0, ABI 15, using its standard
`build --wasm` path. The CLI downloads its pinned WASI toolchain when needed.
No Zig compiler is needed for normal indexing or the grammar build.

```bash
TREE_SITTER_CLI=/path/to/tree-sitter bash scripts/build-zig-grammar.sh
```

The script generates into a temporary directory, verifies SHA-256
`1c3aa3fc4f0f4bb0e22ed61e835afb0295348486f7144fb42422cf22bf9f850b`,
then copies the standard tree-sitter module to `src/extraction/wasm/`.
Two independent builds on macOS arm64 produced identical bytes. The module
imports only the standard tree-sitter `env` memory, table, and base globals.
The MIT notice is copied into `dist/extraction/wasm/` by `npm run copy-assets`.

Zig extraction and resolution scope and tests are documented in
[`docs/zig-production-audit.md`](../zig-production-audit.md).
