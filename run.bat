@echo off
cd /d %~dp0
start http://localhost:8765/index.html
"%LOCALAPPDATA%\Programs\Python\Python311\python.exe" server.py 8765
