@echo off
cd /d E:\math-ai
taskkill /F /IM node.exe >nul 2>nul
timeout /t 1 /nobreak >nul
start "V1 BACKEND" /D "E:\math-ai\backend" cmd /k "npm run start"
timeout /t 2 /nobreak >nul
start "V1 FRONTEND" /D "E:\math-ai\frontend" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/"
exit
