@echo off
rem Same, but with Vite + HMR on :5173 for working on the UI.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" -Dev %*
if errorlevel 1 pause
