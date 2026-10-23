#!/usr/bin/env bash
# Supported entry point on the host: plain `docker compose` uses docker-compose.yml
# (source build) and skips docker-compose.host.yml.
set -euo pipefail

cd /opt/MailFlow
exec docker compose \
  -f docker-compose.ghcr.yml \
  -f docker-compose.host.yml \
  "$@"
