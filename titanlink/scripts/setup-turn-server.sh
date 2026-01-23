#!/bin/bash
# =============================================================================
# TitanLink TURN Server Setup Script (coturn)
# =============================================================================
# This script installs and configures coturn as a TURN/STUN server
# Run this on a fresh Ubuntu 22.04+ VPS
#
# Usage: 
#   1. SSH into your VPS
#   2. Run: curl -sSL https://raw.githubusercontent.com/your-repo/setup-turn.sh | sudo bash
#   Or download and run: sudo bash setup-turn.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  TitanLink TURN Server Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Get the server's public IP
echo -e "${YELLOW}Detecting public IP...${NC}"
PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me)
if [ -z "$PUBLIC_IP" ]; then
    echo -e "${RED}Could not detect public IP. Please enter it manually:${NC}"
    read -p "Public IP: " PUBLIC_IP
fi
echo -e "${GREEN}Public IP: $PUBLIC_IP${NC}"

# Generate random credentials
TURN_USERNAME="titanlink"
TURN_PASSWORD=$(openssl rand -hex 16)
TURN_SECRET=$(openssl rand -hex 32)

echo ""
echo -e "${YELLOW}Installing coturn...${NC}"


# Update system
apt-get update -y

# Install coturn
apt-get install -y coturn

# Enable coturn service
echo "TURNSERVER_ENABLED=1" > /etc/default/coturn

# Create coturn configuration
echo -e "${YELLOW}Configuring coturn...${NC}"

cat > /etc/turnserver.conf << EOF
# TitanLink TURN Server Configuration
# ====================================

# Network settings
listening-port=3478
tls-listening-port=5349
alt-listening-port=3479
alt-tls-listening-port=5350

# External IP (your VPS public IP)
external-ip=$PUBLIC_IP

# Relay IP range (use your VPS IP)
relay-ip=$PUBLIC_IP

# Min and max ports for relay (UDP)
min-port=49152
max-port=65535

# Authentication
use-auth-secret
static-auth-secret=$TURN_SECRET

# Alternative: Static credentials (simpler but less secure)
# user=$TURN_USERNAME:$TURN_PASSWORD

# Realm (your domain or any identifier)
realm=titanlink.local

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
fingerprint
no-multicast-peers
no-cli

# Certificate paths (for TLS/DTLS)
# Uncomment and update if you have SSL certificates:
# cert=/etc/letsencrypt/live/your-domain/fullchain.pem
# pkey=/etc/letsencrypt/live/your-domain/privkey.pem

# Allow STUN binding requests
stale-nonce=600

# Disable old/insecure protocols
no-sslv3
no-tlsv1
no-tlsv1_1
EOF

# Configure firewall (if ufw is installed)
if command -v ufw &> /dev/null; then
    echo -e "${YELLOW}Configuring firewall...${NC}"
    ufw allow 3478/tcp
    ufw allow 3478/udp
    ufw allow 3479/tcp
    ufw allow 3479/udp
    ufw allow 5349/tcp
    ufw allow 5349/udp
    ufw allow 5350/tcp
    ufw allow 5350/udp
    ufw allow 49152:65535/udp
fi

# Start and enable coturn service
echo -e "${YELLOW}Starting coturn service...${NC}"
systemctl enable coturn
systemctl restart coturn

# Wait for service to start
sleep 3

# Check if service is running
if systemctl is-active --quiet coturn; then
    echo -e "${GREEN}✓ coturn is running!${NC}"
else
    echo -e "${RED}✗ coturn failed to start. Check logs with: journalctl -u coturn${NC}"
    exit 1
fi

# Generate temporary credentials for testing
# These expire after TTL (default 600 seconds)
TIMESTAMP=$(($(date +%s) + 86400))  # 24 hours from now
TEMP_USERNAME="${TIMESTAMP}:titanlink"
TEMP_PASSWORD=$(echo -n "$TEMP_USERNAME" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  TURN Server Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Server IP: ${YELLOW}$PUBLIC_IP${NC}"
echo -e "TURN Port: ${YELLOW}3478${NC} (UDP/TCP)"
echo -e "TURNS Port: ${YELLOW}5349${NC} (TLS)"
echo ""
echo -e "${YELLOW}Authentication Secret (save this!):${NC}"
echo -e "${GREEN}$TURN_SECRET${NC}"
echo ""
echo -e "${YELLOW}Test credentials (expires in 24h):${NC}"
echo -e "Username: ${GREEN}$TEMP_USERNAME${NC}"
echo -e "Password: ${GREEN}$TEMP_PASSWORD${NC}"
echo ""
echo -e "${YELLOW}STUN URL:${NC} stun:$PUBLIC_IP:3478"
echo -e "${YELLOW}TURN URL:${NC} turn:$PUBLIC_IP:3478"
echo ""
echo -e "${GREEN}Add these to TitanLink:${NC}"
echo ""
echo "TURN_SERVER_URL=turn:$PUBLIC_IP:3478"
echo "TURN_SERVER_SECRET=$TURN_SECRET"
echo ""

# Save credentials to file
cat > /root/titanlink-turn-credentials.txt << EOF
TitanLink TURN Server Credentials
==================================
Generated: $(date)

Server IP: $PUBLIC_IP
STUN URL: stun:$PUBLIC_IP:3478
TURN URL: turn:$PUBLIC_IP:3478
TURNS URL: turns:$PUBLIC_IP:5349

Authentication Secret: $TURN_SECRET

Environment Variables for TitanLink:
TURN_SERVER_URL=turn:$PUBLIC_IP:3478
TURN_SERVER_SECRET=$TURN_SECRET
EOF

echo -e "${GREEN}Credentials saved to: /root/titanlink-turn-credentials.txt${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy the TURN_SERVER_URL and TURN_SERVER_SECRET above"
echo "2. Add them to your TitanLink environment variables"
echo "3. Rebuild and test your app"
echo ""
