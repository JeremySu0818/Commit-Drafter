#!/bin/bash

echo "[*] Starting build process for Auto-Commit..."
echo

echo "[*] Step 1: Installing dependencies..."
echo
npm install
if [ $? -ne 0 ]; then
    echo "[!] npm install failed"
    exit 1
fi

echo
echo "[*] Step 2: Compiling TypeScript..."
echo
npm run compile
if [ $? -ne 0 ]; then
    echo "[!] TypeScript compilation failed"
    exit 1
fi

echo
echo "[*] Step 3: Packaging VS Code Extension (.vsix)..."
echo
npx vsce package
if [ $? -ne 0 ]; then
    echo "[!] vsce package failed"
    exit 1
fi

echo
echo
echo "[*] Build completed successfully!"
echo "[*] You should see a .vsix file in the current directory."
echo
