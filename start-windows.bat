@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Bagimliliklar kuruluyor...
  call npm install --cache .npm-cache
  if errorlevel 1 exit /b 1
)
echo Birikim Rotasi http://localhost:3000 adresinde baslatiliyor...
call npm run dev
