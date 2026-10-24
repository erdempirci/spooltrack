@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SpoolTrack

if not exist ".venv\Scripts\python.exe" (
  echo Once windows_kurulum.bat dosyasini calistirin.
  pause
  exit /b 1
)

start "SpoolTrack Server" cmd /k ""%CD%\.venv\Scripts\python.exe" -m streamlit run "%CD%\app.py" --server.address 0.0.0.0 --server.port 8502"
timeout /t 8 /nobreak >nul
start "" "http://127.0.0.1:8502"
