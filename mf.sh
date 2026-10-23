#!/usr/bin/env bash
cd /opt/MailFlow && exec docker compose \
  -f docker-compose.ghcr.yml -f docker-compose.host.yml "$@"
