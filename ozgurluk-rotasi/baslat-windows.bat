@echo off
chcp 65001 >nul
cd /d %~dp0
echo Ozgurluk Rotasi paneli baslatiliyor...
call npm install --no-audit --no-fund
start "" http://localhost:4173
npm run web
