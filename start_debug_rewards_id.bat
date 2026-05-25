@echo off

if not exist node_modules\ (
    echo First time setup: Installing required libraries...
    call npm install
)
echo Starting Debug Rewards ID Script...
node debug-rewards_id.js
pause


