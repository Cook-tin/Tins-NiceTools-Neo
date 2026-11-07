@echo off
setlocal
set "TARGET=%LOCALAPPDATA%\NiceTools"
if /I "%~dp0"=="%TARGET%\" goto launch
if exist "%TARGET%\NiceTools.exe" goto launch

echo.
echo   Installing NiceTools to %TARGET% ...
echo   (first run only, about 0.6 GB)
echo.
robocopy "%~dp0." "%TARGET%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo.
  echo   Copy failed. Please move the whole NiceTools folder to C:\NiceTools
  echo   or your Desktop, then run NiceTools.exe there.
  echo.
  pause
  exit /b 1
)

:launch
start "" "%TARGET%\NiceTools.exe"
endlocal
