@echo off
setlocal
cd /d "%~dp0"
where node 1>NUL 2>NUL
if errorlevel 1 (
  echo.
  echo   Spent needs Node.js 20 or newer: https://nodejs.org
  echo.
  pause
  exit /b 1
)
title Spent
node server.js --open
if errorlevel 1 pause
