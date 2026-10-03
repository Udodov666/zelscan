@echo off
chcp 65001 >nul
title Zelscan launcher
echo ============================================
echo   Zelscan - запуск (нужен Python 3.10+)
echo ============================================
cd /d "%~dp0"

if not exist ".local_setup_done" (
  echo.
  echo [i] Первый запуск: после старта откроется мастер настройки.
)

echo [1/2] Запускаю backend (:5050)...
start "Zelscan backend" cmd /k "python app\server.py"
timeout /t 3 /nobreak >nul

echo [2/2] Запускаю frontend (:8080)...
start "Zelscan frontend" cmd /k "python app\front_server.py"
timeout /t 3 /nobreak >nul

start "" http://localhost:8080
echo.
echo Готово: http://localhost:8080  (закрытие - просто закрой оба окна)
pause
