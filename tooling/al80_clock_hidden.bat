@echo off
cd /d "%~dp0"
start "" /b wscript.exe "%~dp0run_hidden.vbs"
