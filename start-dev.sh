#!/usr/bin/env sh
# Linux/macOS/Termux twin of start-dev.bat: syncs dependencies, then starts the server and the web app from the repo root.
set -e
cd "$(dirname "$0")"

# Prints a header, then runs the rest of the arguments as a command.
step() {
  printf '\n=== %s ===\n' "$1"
  shift
  "$@"
}

step "Syncing dependencies" npm install --no-audit --no-fund
step "Starting dev server" exec npm run dev
