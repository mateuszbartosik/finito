@echo off
setlocal
cd /d "%~dp0"
where node 1>NUL 2>NUL
if errorlevel 1 (
  echo.
  echo   Finito needs Node.js 20 or newer: https://nodejs.org
  echo.
  pause
  exit /b 1
)
title Finito demo
node scripts\demo.js --open
if errorlevel 1 pause
