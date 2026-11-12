@echo off
title Sadarshop Server
echo Starting Sadarshop...
echo.

cd /d "%~dp0"

:: Open the browser to both the Storefront and the Admin panel
start http://localhost:3000
start http://localhost:3000/admin

:: Run the Node.js server
node --no-warnings server.js

:: If the server crashes or Node is not installed, this pause will keep the window open so you can read the error message.
echo.
echo If you see an error about "node" not being recognized, please make sure you installed Node.js from https://nodejs.org/
pause
