@echo off
title paneld dev server
cd /d "%~dp0"
echo Starting paneld dev server on port 5175...
call npm.cmd run dev
pause
