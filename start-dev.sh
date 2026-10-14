#!/usr/bin/env sh
# Linux/macOS/Termux twin of start-dev.bat: starts the server and the web app from the repo root.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
exec npm run dev
