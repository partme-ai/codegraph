#!/usr/bin/env bash
set -euo pipefail

# The upstream repository's existing Pages deployment remains unconditional.
if [[ "$GITHUB_REPOSITORY" == 'colbymchenry/codegraph' ]]; then
  printf 'deploy=true\n' >> "$GITHUB_OUTPUT"
  echo 'Official repository: deploy the built site.'
  exit 0
fi

# A fork can run the full site build without enabling Pages. This GET is the
# only repository query; a failed or malformed response must fail the job.
if ! has_pages="$(gh api "repos/$GITHUB_REPOSITORY" --jq '.has_pages')"; then
  echo "Could not read Pages configuration for $GITHUB_REPOSITORY." >&2
  exit 1
fi

case "$has_pages" in
  true)
    printf 'deploy=true\n' >> "$GITHUB_OUTPUT"
    echo "Pages is configured for $GITHUB_REPOSITORY; deploy the built site."
    ;;
  false)
    printf 'deploy=false\n' >> "$GITHUB_OUTPUT"
    echo "Pages is not configured for $GITHUB_REPOSITORY; the site build is complete and deployment is skipped."
    ;;
  *)
    echo "Unexpected Pages configuration response for $GITHUB_REPOSITORY: $has_pages" >&2
    exit 1
    ;;
esac
