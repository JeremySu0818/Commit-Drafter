@echo off
setlocal enabledelayedexpansion

echo [*] Starting build process for Auto-Commit...

echo.
echo [*] Step 1: Installing dependencies...
echo.

call npm install
if %ERRORLEVEL% neq 0 (
    echo [!] npm install failed
    exit /b %ERRORLEVEL%
)

echo.
echo [*] Step 2: Compiling TypeScript...
echo.

call npm run compile
if %ERRORLEVEL% neq 0 (
    echo [!] TypeScript compilation failed
    exit /b %ERRORLEVEL%
)

echo.
echo [*] Step 3: Packaging VS Code Extension (.vsix)...
echo.

:: We use npx vsce package to create the extension bundle
:: --no-verify can be used if you want to skip some property checks in package.json
call npx vsce package
if %ERRORLEVEL% neq 0 (
    echo [!] vsce package failed
    exit /b %ERRORLEVEL%
)

echo.
echo.
echo [*] Build completed successfully!
echo [*] You should see a .vsix file in the current directory.
echo.

pause
