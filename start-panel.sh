#!/bin/bash
# Starts the panel the way it actually needs to run:
#  - cwd is the repo (dotenv + relative server path depend on it)
#  - PASSWORD exported from .env (the server refuses to boot without it)
#  - `sudo -n -E` to keep that env while running as root
cd /home/ubuntu/vps-manager || exit 1
set -a
. ./.env
set +a
exec sudo -n -E /usr/bin/node server/index.cjs
