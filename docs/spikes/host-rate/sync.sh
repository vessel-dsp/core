#!/usr/bin/env bash
# Copy the harness into the measurement clone (the worktree nests inside the main checkout and would
# resolve into its stale dist, so every run happens in the clone). Usage: sync.sh <clone-root>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
clone="${1:?clone root}"
mkdir -p "$clone/docs/spikes/host-rate"
rsync -a --exclude logs --exclude '*.json' "$here/" "$clone/docs/spikes/host-rate/"
