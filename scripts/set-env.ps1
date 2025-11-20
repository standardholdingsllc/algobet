# PowerShell script to set SX.bet environment variables
# Run this before testing: .\scripts\set-env.ps1

Write-Host "Setting SX.bet environment variables..." -ForegroundColor Green

# Set your actual values here
$SXBET_API_KEY = "your-actual-api-key-here"
$SXBET_WALLET_ADDRESS = "your-actual-wallet-address-here"
$SXBET_PRIVATE_KEY = "your-actual-private-key-here"

# Set environment variables for current session
$env:SXBET_API_KEY = $SXBET_API_KEY
$env:SXBET_WALLET_ADDRESS = $SXBET_WALLET_ADDRESS
$env:SXBET_PRIVATE_KEY = $SXBET_PRIVATE_KEY

Write-Host "Environment variables set!" -ForegroundColor Green
Write-Host "SXBET_API_KEY: $($env:SXBET_API_KEY ? 'Set' : 'Not set')" -ForegroundColor Yellow
Write-Host "SXBET_WALLET_ADDRESS: $($env:SXBET_WALLET_ADDRESS ? 'Set' : 'Not set')" -ForegroundColor Yellow
Write-Host "SXBET_PRIVATE_KEY: $($env:SXBET_PRIVATE_KEY ? 'Set' : 'Not set')" -ForegroundColor Yellow

Write-Host ""
Write-Host "Now run: npm run test-sxbet" -ForegroundColor Cyan
