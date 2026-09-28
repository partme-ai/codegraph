# PartMe Zig distribution

Release contract: publish `@partme.ai/codegraph@1.6.0-zig` and six matching
platform packages, with GitHub prerelease `v1.6.0-zig` in `partme-ai/codegraph`.
The npm `latest` tag intentionally selects this version so the unversioned
`npx @partme.ai/codegraph` command works. This is a fork distribution, not an
upstream release.

The fork-only build workflow stages the identity/version changes with
`scripts/prepare-partme-release.mjs`. Run that script only in a disposable
checkout with `CODEGRAPH_RELEASE_STAGE=1`. It keeps upstream defaults in the
contribution branch. Published launchers, SDK resolution, install and upgrade
paths must all use the PartMe namespace; upstream license notices remain intact.

Acceptance: six native platform builds contain their matching kernel, bundled
Node, viewer, Zig grammar and notices; installed CLI reports `1.6.0-zig`; SDK
loads from the matching platform package; Zig package graph checks pass with
normal and forced-worker resolution. Linux additionally runs kernel parity.
All six archives and SHA256SUMS are attached to the GitHub prerelease. Publish
platform packages before the main shim, then verify registry metadata and an
isolated `npx` execution. Do not publish the root source package or the private
UI component workspace.

Build policy: ordinary branch pushes and pull requests must not launch builds.
The fork distribution workflow runs only on `v*-zig*` tags or manual dispatch;
Zig validation is manual/reusable only. Do not also subscribe to release events,
which would build the same version twice. Reuse successful immutable artifacts
when only documentation or workflow triggers change. For this already-built
release, the trigger-only commit uses `[skip ci]` so creating its tag does not
repeat the six native builds. The release notes identify the tested source SHA.

Publication recovery uses the same workflow with `publish_only=true` and
`artifact_run=36454692736`. This skips all native builds, checks that the source
build and Zig validation succeeded at the same commit, and uses the repository's
`NPM_TOKEN` secret to publish the staged packages. For this release:

```sh
gh workflow run partme-release-build.yml --repo partme-ai/codegraph \
  --ref feat/zig-supported -f publish_only=true -f artifact_run=36454692736
```

The publisher checks exact npm tarball integrity before skipping existing
versions, waits up to ten minutes per batch for new registry metadata, and fails
if a version remains unavailable. Platform packages become visible before the
main launcher is published. A successful `npm publish` exit alone is not
release evidence. Already uploaded GitHub assets are verified and preserved;
the original `BUILD.json` upload provenance is retained across retries.

README packaging was corrected after `1.6.0-zig` had already begun publication.
The next release will retain the complete upstream usage guide with PartMe
installation commands and include a root README in each platform package. The
staging regression test checks the generated npm package's file list. Do not
replace existing npm versions to retrofit documentation. Recovery of
`1.6.0-zig` deliberately loads its original staging transform from the verified
build commit, preserving its published package integrity and release manifest.
