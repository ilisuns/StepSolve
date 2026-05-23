@echo off
cd /d E:\math-ai
taskkill /F /IM node.exe >nul 2>nul
timeout /t 1 /nobreak >nul
start /D E:\math-ai\backend cmd /k npm run start
timeout /t 2 /nobreak >nul
start /D E:\math-ai\frontend cmd /k npm run dev
exit
