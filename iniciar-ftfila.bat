@echo off
title FT FILA - Servico de Filas
cd /d "%~dp0"
node src/server.js >> "%TEMP%\ftfila.log" 2>&1
