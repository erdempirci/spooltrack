@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SpoolTrack Manuel
".venv\Scripts\python.exe" -m streamlit run app.py --server.address 0.0.0.0 --server.port 8502
pause
