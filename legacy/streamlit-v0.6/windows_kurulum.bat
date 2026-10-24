@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SpoolTrack Kurulum

where py >nul 2>&1
if %errorlevel%==0 (
  set PY=py
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    set PY=python
  ) else (
    echo HATA: Python bulunamadi.
    echo Python kurulumunda Add Python to PATH secenegini isaretleyin.
    pause
    exit /b 1
  )
)

if exist .venv rmdir /s /q .venv
%PY% -m venv .venv
if errorlevel 1 (
  echo HATA: Sanal ortam olusturulamadi.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo HATA: Paketler kurulamadi.
  pause
  exit /b 1
)

echo.
echo Kurulum tamamlandi.
pause
