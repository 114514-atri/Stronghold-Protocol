@echo off
rem Double-click to start after 下载素材.bat. Uses a portable Node from .cache\portable-node when
rem this PC has no Node 22+. Extra arguments are passed to scripts\start-windows.bat.
chcp 65001 >nul
setlocal EnableExtensions
title Stronghold Protocol
cd /d "%~dp0"

set "PORTABLE=%CD%\.cache\portable-node"
set "SP_NODE="
where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(Math.max(0, Math.sign(22 - parseInt(process.versions.node, 10))))"
  if not errorlevel 1 set "SP_NODE=node"
)
if not defined SP_NODE if exist "%PORTABLE%\node.exe" (
  set "PATH=%PORTABLE%;%PATH%"
  set "SP_NODE=%PORTABLE%\node.exe"
)
if not defined SP_NODE (
  echo.
  echo Node.js was not found. Double-click the download bat first, then this file.
  echo.
  pause
  exit /b 1
)

set "SP_ASSET_WINDOW=1"
call "%~dp0scripts\start-windows.bat" --no-local --no-scenes %*
exit /b %ERRORLEVEL%
