@echo off
taskkill /FI "WINDOWTITLE eq FT FILA*" /F >nul 2>&1
echo Servico encerrado.
