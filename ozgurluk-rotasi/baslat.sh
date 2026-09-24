#!/bin/sh
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npm run web
