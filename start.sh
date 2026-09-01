#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --cache .npm-cache
fi
echo "Birikim Rotası http://localhost:3000 adresinde başlatılıyor..."
npm run dev
