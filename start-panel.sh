#!/bin/bash
# Starts the panel the way it actually needs to run:
#  - cwd is the repo (dotenv + relative server path depend on it)
#  - PASSWORD exported from .env (the server refuses to boot without it)
#  - `sudo -n -E` to keep that env while running as root
#
# The directory is resolved from this script's own location rather than
# hardcoded: the same file ships in the release tarball and must work on any
# install path, including a staged copy during a self-update.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
set -a
. ./.env
set +a

# Run as root only when we are not already root and sudo is available.
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  exec sudo -n -E /usr/bin/env node server/index.cjs
fi
exec node server/index.cjs
