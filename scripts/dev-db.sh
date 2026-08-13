#!/usr/bin/env bash

set -euo pipefail

container_name='family-app-postgres'
volume_name='family-app-postgres-data'
database_url='postgres://family:family@127.0.0.1:54329/family'

case "${1:-}" in
  start)
    if docker container inspect "$container_name" >/dev/null 2>&1; then
      docker start "$container_name" >/dev/null
    else
      docker run \
        --detach \
        --name "$container_name" \
        --publish '127.0.0.1:54329:5432' \
        --volume "$volume_name:/var/lib/postgresql/data" \
        --env POSTGRES_DB=family \
        --env POSTGRES_USER=family \
        --env POSTGRES_PASSWORD=family \
        postgres:17-alpine >/dev/null
    fi
    printf 'PostgreSQL is running at %s\n' "$database_url"
    ;;
  stop)
    docker stop "$container_name"
    ;;
  url)
    printf '%s\n' "$database_url"
    ;;
  *)
    printf 'Usage: %s {start|stop|url}\n' "$0" >&2
    exit 1
    ;;
esac
