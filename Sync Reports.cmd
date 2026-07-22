@echo off
setlocal
title Sync Reports - Boba Rabbit

REM Always run from the folder this file lives in
cd /d "%~dp0"

echo ============================================================
echo   Boba Rabbit - Sync Reports and Publish
echo ============================================================
echo.

REM --- Step 1: Pull latest reports from the Databricks repo ---
echo [1/4] Pulling latest reports from boba-cafe-databricks...
if exist "..\boba-cafe-databricks\.git" (
    pushd "..\boba-cafe-databricks"
    git pull
    popd
) else (
    echo   ^(Skipped: ..\boba-cafe-databricks not found next to this repo^)
)
echo.

REM --- Step 2: Run the sync script ---
echo [2/4] Copying reports and rebuilding the index...
powershell -ExecutionPolicy Bypass -File ".\sync-reports.ps1"
if errorlevel 1 (
    echo.
    echo   ERROR: sync-reports.ps1 failed. Nothing was published.
    goto :end
)
echo.

REM --- Step 3: Stage and commit ---
echo [3/4] Committing changes...
git add internal/reports/
git diff --cached --quiet
if not errorlevel 1 (
    echo   Nothing new to publish - reports are already up to date.
    goto :end
)
git commit -m "sync: update reports"
echo.

REM --- Step 4: Push to publish ---
echo [4/4] Pushing to GitHub ^(publishes to bobacafe.net^)...
git push
echo.
echo ============================================================
echo   Done! The live site will update in a minute or two.
echo ============================================================

:end
echo.
pause
