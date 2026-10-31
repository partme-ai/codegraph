# CodeGraph Zig v1.6.2-zig

This PartMe fork prerelease adds Zig indexing on the current upstream CodeGraph 1.6.2 base. It uses a vendored, MIT-licensed tree-sitter Zig grammar with a reproducible WASM build. The existing languages and upstream release scripts are unchanged in the contribution commits.

Download the archive for your operating system and architecture, or install the attached `partme.ai-codegraph-1.6.2-zig.tgz` with `npm install -g ./partme.ai-codegraph-1.6.2-zig.tgz` (Node 22 or 24). The archives include Node 24.22.1 and the matching native extraction kernel. Check files against `SHA256SUMS`.

The Zig graph supports declarations, imports, calls, lexical ownership, aliases, type dependencies, and incremental re-indexing. Compiler syntax parity was checked on 36 controlled fixtures. Nine named three-hop flows were present across three real Zig repositories. Current ZLS and Zig compiler development trees still have grammar recovery in some files; the measured agent comparison did not meet the stricter faster-in-every-run target. See `docs/zig-production-audit.md` for the measured results and limits.

This release belongs to `partme-ai/codegraph`. It does not publish to the original author's npm namespace.
