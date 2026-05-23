@echo off 
cd /d E:\math-ai 
echo Restoring V1 stable from docs\backup-2026-05-23-public-beta-front-full-pass 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\frontend\src\App.tsx" "frontend\src\App.tsx" >nul 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\frontend\src\App.css" "frontend\src\App.css" >nul 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\backend\src\app.controller.ts" "backend\src\app.controller.ts" >nul 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\backend\src\main.ts" "backend\src\main.ts" >nul
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\check-v1-build.bat" "check-v1-build.bat" >nul 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\start-v1-two-windows-safe.bat" "start-v1-two-windows-safe.bat" >nul 
copy /Y "docs\backup-2026-05-23-public-beta-front-full-pass\start-v1-three-windows-safe.bat" "start-v1-three-windows-safe.bat" >nul 
echo RESTORE_DONE 
pause 
