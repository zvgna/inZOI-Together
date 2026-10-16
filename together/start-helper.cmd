@echo off
cd /d "%~dp0"
if exist "%~dp0node.exe" (
  "%~dp0node.exe" "%~dp0companion.cjs"
) else (
  node "%~dp0companion.cjs"
)
pause
