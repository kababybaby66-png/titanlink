# Deploy signaling server to VPS
# Usage: .\deploy.ps1
# Requires: SSH access to 129.159.142.124

$VPS_IP = "129.159.142.124"
$VPS_USER = "opc"  # Change if your SSH user is different
$REMOTE_DIR = "/home/$VPS_USER/signaling-server"  # Change to actual path on server

Write-Host "=== TitanLink Signaling Server Deployment ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will deploy the updated server.js to $VPS_IP" -ForegroundColor Yellow
Write-Host "Make sure you have SSH access configured." -ForegroundColor Yellow
Write-Host ""

# Copy server files
Write-Host "[1/3] Copying server.js to VPS..." -ForegroundColor Green
scp .\server.js "${VPS_USER}@${VPS_IP}:${REMOTE_DIR}/server.js"

Write-Host "[2/3] Copying package.json to VPS..." -ForegroundColor Green
scp .\package.json "${VPS_USER}@${VPS_IP}:${REMOTE_DIR}/package.json"

Write-Host "[3/3] Restarting server on VPS..." -ForegroundColor Green
ssh "${VPS_USER}@${VPS_IP}" "cd ${REMOTE_DIR} && npm install && pm2 restart signaling-server 2>/dev/null || (pkill -f 'node server.js'; nohup node server.js > /dev/null 2>&1 &)"

Write-Host ""
Write-Host "=== Deployment complete! ===" -ForegroundColor Green
Write-Host "Test: curl http://${VPS_IP}:3001/" -ForegroundColor Cyan
