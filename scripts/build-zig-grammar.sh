#!/usr/bin/env bash
# Rebuild the standard tree-sitter Zig WASM from checked-in source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="${TREE_SITTER_CLI:-tree-sitter}"
OUTPUT="${1:-$ROOT/src/extraction/wasm/tree-sitter-zig.wasm}"
EXPECTED='1c3aa3fc4f0f4bb0e22ed61e835afb0295348486f7144fb42422cf22bf9f850b'
[[ "$("$TS" --version)" == 'tree-sitter 0.27.0' ]] || { echo 'Requires tree-sitter-cli 0.27.0' >&2; exit 1; }
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codegraph-zig-grammar.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
cp -R "$ROOT/vendor/tree-sitter-zig" "$BUILD_DIR/grammar"
cd "$BUILD_DIR/grammar"
"$TS" generate --abi 15
"$TS" build --wasm -o "$BUILD_DIR/tree-sitter-zig.wasm"
ACTUAL="$(shasum -a 256 "$BUILD_DIR/tree-sitter-zig.wasm" | cut -d ' ' -f 1)"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo "Zig grammar build hash mismatch: $ACTUAL" >&2; exit 1; }
mkdir -p "$(dirname "$OUTPUT")"
cp "$BUILD_DIR/tree-sitter-zig.wasm" "$OUTPUT"
echo "Wrote $OUTPUT ($ACTUAL)"
