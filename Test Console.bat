@echo off
rem Double-click this to start the test console: builds the UI if needed,
rem starts the backend, and opens the browser when it answers.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
if errorlevel 1 pause
