@echo off
rem Double-click after unzipping the repo zip. Installs a portable Node if needed, then downloads
rem game art. The window title shows the bytes downloaded so far. Docs: README.md (给朋友).
chcp 65001 >nul
setlocal EnableExtensions
title Stronghold Protocol - downloading
cd /d "%~dp0"

set "PORTABLE=%CD%\.cache\portable-node"
call :picknode
if errorlevel 1 (
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-portable-node.ps1"
  if errorlevel 1 goto :fail
  call :picknode
  if errorlevel 1 goto :fail
)

echo.
"%SP_NODE%" "%~dp0scripts\download-assets.mjs"
if errorlevel 1 goto :fail
echo.
pause
exit /b 0

:picknode
set "SP_NODE="
where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(Math.max(0, Math.sign(22 - parseInt(process.versions.node, 10))))"
  if not errorlevel 1 (
    set "SP_NODE=node"
    exit /b 0
  )
)
if exist "%PORTABLE%\node.exe" (
  set "PATH=%PORTABLE%;%PATH%"
  set "SP_NODE=%PORTABLE%\node.exe"
  exit /b 0
)
exit /b 1

:fail
echo.
echo Failed. Read the messages above, then double-click this file again.
echo.
pause
exit /b 1
