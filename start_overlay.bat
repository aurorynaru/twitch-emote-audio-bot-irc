@echo off
title Emote Overlay Server

if not exist node_modules\ (
    echo First time setup: Installing required libraries...
    call npm install
)

echo Starting Emote Overlay Server...
node app.js
pause
