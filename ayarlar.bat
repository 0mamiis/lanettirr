@echo off
setlocal EnableDelayedExpansion
set "LANETTIRR_PORT=17410"
if exist "%~dp0.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do (
    set "K=%%~A"
    set "V=%%~B"
    if /i "!K!"=="MEGA_PORT" if not "!V!"=="" set "LANETTIRR_PORT=!V!"
    if /i "!K!"=="PORT" if not "!V!"=="" set "LANETTIRR_PORT=!V!"
  )
)
start "" "http://127.0.0.1:!LANETTIRR_PORT!/configure"
