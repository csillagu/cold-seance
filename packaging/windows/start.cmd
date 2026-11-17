@echo off
rem Starts cold-seance from this folder (SC-120, DD-061): the backend, which also serves the
rem frontend, on the Node.js runtime in this folder. It reads config.yaml from this folder, or the
rem file named by COLD_SEANCE_CONFIG_FILE, and listens on 127.0.0.1:3000 unless configured
rem otherwise. Ctrl+C stops it cleanly.
setlocal
cd /d "%~dp0"
set NODE_ENV=production
"%~dp0node.exe" "%~dp0backend\dist\server.js"
exit /b %ERRORLEVEL%
