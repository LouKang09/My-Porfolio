#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20 or newer and try again."
  exit 1
fi
echo "Starting Facebook Resume CMS..."
echo "Public website: http://localhost:3000"
echo "Admin login:    http://localhost:3000/admin.html"
echo "Keep this terminal open while using the website."
node hydrate-assets.js || exit 1
node server.js
