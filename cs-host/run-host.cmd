@echo off
setlocal EnableExtensions
set "CS_DIR=%~dp0"
cd /d "%CS_DIR%"

set "JAVA_EXE="
set "FALLBACK_JAVA="
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"

if not defined JAVA_EXE (
  for /f "delims=" %%I in ('where java 2^>nul') do call :try_where_java "%%~fI"
)

if not defined JAVA_EXE call :scan_root "C:\Program Files\Eclipse Adoptium"
if not defined JAVA_EXE call :scan_root "C:\Program Files\Microsoft"
if not defined JAVA_EXE call :scan_root "C:\Program Files\Java"

if not defined JAVA_EXE if defined FALLBACK_JAVA (
  set "JAVA_EXE=%FALLBACK_JAVA%"
  for %%I in ("%FALLBACK_JAVA%") do for %%P in ("%%~dpI..") do set "JAVA_HOME=%%~fP"
)

if not defined JAVA_EXE (
  echo [cs-host] ERROR: Java 21+ not found. Set JAVA_HOME or install JDK 21+.>> "%CS_DIR%host.log"
  echo [cs-host] ERROR: Java 21+ not found. Set JAVA_HOME or install JDK 21+. 1>&2
  exit /b 1
)

set "PATH=%JAVA_HOME%\bin;%PATH%"
set "BB_DEX2JAR=%CS_DIR%tools\dex-tools-v2.4"
set "CP=%CS_DIR%out;%CS_DIR%lib\builtins;%CS_DIR%lib\okhttp-jvm.jar;%CS_DIR%lib\kotlin-reflect.jar;%CS_DIR%lib\cryptography-provider-jdk-jvm.jar;%CS_DIR%lib\cryptography-provider-optimal-jvm.jar;%CS_DIR%lib\cryptography-core-jvm.jar;%CS_DIR%lib\cryptography-provider-base-jvm.jar;%CS_DIR%lib\cryptography-random-jvm.jar;%CS_DIR%lib\cryptography-serialization-asn1-jvm.jar;%CS_DIR%lib\cryptography-serialization-asn1-modules-jvm.jar;%CS_DIR%lib\cryptography-serialization-pem-jvm.jar;%CS_DIR%lib\cryptography-bigint-jvm.jar;%CS_DIR%lib\cs-app.jar;%CS_DIR%lib\android.jar"
if not defined CS_HOST_XMX set "CS_HOST_XMX=512m"
if exist "%CS_DIR%host.log" for %%F in ("%CS_DIR%host.log") do if %%~zF GTR 2097152 move /y "%CS_DIR%host.log" "%CS_DIR%host.log.old" >nul 2>&1
"%JAVA_EXE%" -Xms48m -Xmx%CS_HOST_XMX% -XX:+UseG1GC -XX:MaxHeapFreeRatio=25 -XX:MinHeapFreeRatio=10 -cp "%CP%" Host >> "%CS_DIR%host.log" 2>&1
exit /b %ERRORLEVEL%

:try_where_java
if defined JAVA_EXE exit /b 0
if not defined FALLBACK_JAVA set "FALLBACK_JAVA=%~1"
call :check_java_21 "%~1" || exit /b 0
set "JAVA_EXE=%~1"
for %%P in ("%~dp1..") do set "JAVA_HOME=%%~fP"
exit /b 0

:scan_root
if defined JAVA_EXE exit /b 0
if not exist "%~1" exit /b 0
for /d %%D in ("%~1\jdk-21*" "%~1\jdk-22*" "%~1\jdk-23*" "%~1\jdk-24*" "%~1\jdk-25*") do (
  if not defined JAVA_EXE if exist "%%~fD\bin\java.exe" (
    set "JAVA_HOME=%%~fD"
    set "JAVA_EXE=%%~fD\bin\java.exe"
  )
)
exit /b 0

:check_java_21
set "_JVER="
for /f "tokens=3" %%V in ('""%~1" -version 2^>^&1" ^| findstr /i "version"') do if not defined _JVER set "_JVER=%%~V"
if not defined _JVER exit /b 1
for /f "tokens=1 delims=.-_" %%M in ("%_JVER%") do set "_JMAJ=%%M"
if "%_JMAJ%"=="" exit /b 1
if %_JMAJ% GEQ 21 exit /b 0
exit /b 1
