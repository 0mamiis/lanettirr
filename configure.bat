@echo off
setlocal EnableDelayedExpansion
set "LANETTIRR_PORT="
set "FALLBACK_PORT="
if exist "%~dp0.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0.env") do (
    set "K=%%~A"
    set "V=%%~B"
    set "K=!K: =!"
    set "K=!K:	=!"
    if defined V (
      set "V=!V:"=!"
      set "V=!V:'=!"
      set "V=!V: =!"
      set "V=!V:	=!"
      if "!V:~0,1!"=="#" (
        set "V="
      ) else (
        for /f "tokens=1 delims=#" %%C in ("!V!") do set "V=%%C"
      )
    )
    if /i "!K!"=="MEGA_PORT" if not "!V!"=="" set "LANETTIRR_PORT=!V!"
    if /i "!K!"=="PORT" if not "!V!"=="" set "FALLBACK_PORT=!V!"
  )
)
if "!LANETTIRR_PORT!"=="" set "LANETTIRR_PORT=!FALLBACK_PORT!"
if "!LANETTIRR_PORT!"=="" set "LANETTIRR_PORT=17410"
for /f "delims=0123456789" %%X in ("!LANETTIRR_PORT!") do set "LANETTIRR_PORT=17410"
start "" "http://127.0.0.1:!LANETTIRR_PORT!/configure"
