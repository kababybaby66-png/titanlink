# Oracle Cloud Deployment Guide for TitanLink Relay Server

This guide walks you through deploying the TitanLink relay server to Oracle Cloud's Free Tier.

## Prerequisites

- Oracle Cloud Free Tier account
- SSH key pair for instance access
- Your Oracle Cloud instance already created

---

## Step 1: Build for Linux (Cross-Compilation from Windows)

Since you're developing on Windows but deploying to Linux (Oracle uses Ubuntu), you need to cross-compile.

### Option A: Using `cross` (Recommended)

```powershell
# Install cross (one-time setup)
cargo install cross

# Build for Linux
cd native\relay-server
cross build --release --target x86_64-unknown-linux-gnu

# The binary will be at:
# target\x86_64-unknown-linux-gnu\release\titanlink-relay
```

### Option B: Native Build (if you have WSL2)

```bash
# In WSL2 Ubuntu
cd /mnt/c/Users/YOUR_USERNAME/Desktop/Parsec\ clone/titanlink/native/relay-server
cargo build --release

# Binary at: target/release/titanlink-relay
```

---

## Step 2: Upload to Oracle VM

Replace `YOUR_ORACLE_IP` with your actual Oracle instance public IP.

```powershell
# From Windows (PowerShell)
scp native\relay-server\target\x86_64-unknown-linux-gnu\release\titanlink-relay ubuntu@YOUR_ORACLE_IP:~/

# If using identity file
scp -i path\to\your-key.pem native\relay-server\target\x86_64-unknown-linux-gnu\release\titanlink-relay ubuntu@YOUR_ORACLE_IP:~/
```

---

## Step 3: Configure Oracle Cloud Firewall

### 3.1 Security List (Oracle Cloud Console)

1. Go to **Oracle Cloud Console** → **Networking** → **Virtual Cloud Networks**
2. Click your VCN → **Security Lists** → **Default Security List**
3. Click **Add Ingress Rules**
4. Fill in:
   - **Source CIDR:** `0.0.0.0/0` (allow from anywhere)
   - **IP Protocol:** `UDP`
   - **Destination Port Range:** `5000`
   - **Description:** `TitanLink Relay Server`
5. Click **Add Ingress Rules**

### 3.2 Instance Firewall (Ubuntu)

SSH into your instance and allow port 5000:

```bash
ssh ubuntu@YOUR_ORACLE_IP

# Allow UDP port 5000
sudo iptables -I INPUT -p udp --dport 5000 -j ACCEPT

# Save the rule (persist across reboots)
sudo netfilter-persistent save

# If netfilter-persistent is not installed:
sudo apt update
sudo apt install iptables-persistent
sudo netfilter-persistent save
```

---

## Step 4: Run the Relay Server

### Quick Test (Foreground)

```bash
# SSH into Oracle VM
ssh ubuntu@YOUR_ORACLE_IP

# Make executable
chmod +x titanlink-relay

# Run server
./titanlink-relay
```

Expected output:
```
2026-02-05T16:30:00.123456Z  INFO titanlink_relay: 🚀 TitanLink Relay Server v0.1.0
2026-02-05T16:30:00.123789Z  INFO titanlink_relay: 📡 Starting UDP relay on port 5000
2026-02-05T16:30:00.124000Z  INFO titanlink_relay: ✅ Listening on 0.0.0.0:5000
```

Test from your PC:
```powershell
# From Windows
echo "PING" | nc -u YOUR_ORACLE_IP 5000
# Should receive: PONG
```

---

## Step 5: Run as systemd Service (Auto-Start)

### 5.1 Create Service File

```bash
sudo nano /etc/systemd/system/titanlink-relay.service
```

Paste this configuration:

```ini
[Unit]
Description=TitanLink UDP Relay Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/home/ubuntu/titanlink-relay
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/tmp

[Install]
WantedBy=multi-user.target
```

Save and exit (Ctrl+X, Y, Enter).

### 5.2 Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable (start on boot)
sudo systemctl enable titanlink-relay

# Start now
sudo systemctl start titanlink-relay

# Check status
sudo systemctl status titanlink-relay
```

Expected output:
```
● titanlink-relay.service - TitanLink UDP Relay Server
     Loaded: loaded
     Active: active (running)
```

### 5.3 View Logs

```bash
# Follow live logs
sudo journalctl -u titanlink-relay -f

# View last 100 lines
sudo journalctl -u titanlink-relay -n 100
```

---

## Step 6: Update TitanLink App Settings

### 6.1 Find Your Oracle VM Public IP

```bash
# From Oracle VM
curl ifconfig.me
# Example output: 123.45.67.89
```

### 6.2 Update settings.json

Edit `C:\Users\YOUR_USERNAME\AppData\Roaming\titanlink\settings.json`:

```json
{
  "relay_server": {
    "enabled": true,
    "ip": "123.45.67.89",
    "port": 5000
  }
}
```

*Note: If settings.json doesn't exist yet, create it with initial settings.*

### 6.3 Or Use Environment Variable

Alternatively, you can set an environment variable:

```powershell
# Windows
$env:TITANLINK_RELAY_IP = "123.45.67.89"

# Or add to System Environment Variables for persistence
```

---

## Step 7: Verify Deployment

### 7.1 Test from Your Windows PC

```powershell
# Test PING/PONG
cd C:\Users\YOUR_USERNAME\Desktop\Parsec clone\titanlink
.\native\relay-server\test-simple.ps1
```

Update the test script to use your Oracle IP:
```powershell
$RELAY_IP = "123.45.67.89"  # Your Oracle IP
```

### 7.2 Monitor Resource Usage

```bash
# SSH into Oracle VM
ssh ubuntu@YOUR_ORACLE_IP

# Watch resource usage
htop  # (install with: sudo apt install htop)

# Or use top
top
```

Expected resource usage:
- **CPU:** < 1% (idle)
- **Memory:** ~5-10 MB

---

## Maintenance Commands

```bash
# Stop server
sudo systemctl stop titanlink-relay

# Restart server
sudo systemctl restart titanlink-relay

# Check if running
sudo systemctl is-active titanlink-relay

# Disable auto-start
sudo systemctl disable titanlink-relay

# Update binary (after rebuilding)
# 1. Stop service
sudo systemctl stop titanlink-relay

# 2. Upload new binary from Windows
# (run from Windows PowerShell)
scp native\relay-server\target\x86_64-unknown-linux-gnu\release\titanlink-relay ubuntu@YOUR_ORACLE_IP:~/

# 3. Restart service
sudo systemctl start titanlink-relay
```

---

## Troubleshooting

### Issue: Connection refused

**Check firewall:**
```bash
# Oracle Cloud Security List (check console)
# Instance firewall
sudo iptables -L -n | grep 5000

# If not listed, add rule
sudo iptables -I INPUT -p udp --dport 5000 -j ACCEPT
sudo netfilter-persistent save
```

### Issue: Service fails to start

**Check logs:**
```bash
sudo journalctl -u titanlink-relay -n 50 --no-pager
```

**Common causes:**
- Binary not executable: `chmod +x /home/ubuntu/titanlink-relay`
- Port already in use: `sudo netstat -tulpn | grep 5000`

### Issue: High memory usage

- Check number of active sessions: Look for "New session" in logs
- Inactive sessions cleanup every 60s (5min timeout)
- If issue persists, restart service: `sudo systemctl restart titanlink-relay`

---

## Cost Estimation (Oracle Free Tier)

| Resource | Free Tier Limit | Relay Usage | Status |
|----------|-----------------|-------------|--------|
| Compute | 2x E2.1.Micro (1 OCPU, 1GB RAM) | ~10 MB RAM, <1% CPU | ✅ FREE |
| Bandwidth | 10 TB/month | Depends on usage* | ✅ FREE |
| Storage | 200 GB | ~3 MB binary | ✅ FREE |

**Bandwidth estimate:**
- Each relayed session ~10-50 Mbps (depending on video quality)
- 10 GB = ~30 minutes of 4K 60fps streaming
- 100 GB =  ~5 hours of 4K streaming on Oracle Free tier is doable.

---

## Security Recommendations

### 1. Add Authentication (Future Enhancement)

The current relay has no authentication. Anyone who knows your IP can use it.

**Planned improvement (Phase 2):**
- Add auth token in packet header
- Rate limiting per IP
- IP whitelist for trusted users

### 2. Change Default Port (Optional)

```bash
# Edit service file
sudo nano /etc/systemd/system/titanlink-relay.service

# Modify ExecStart to:
ExecStart=/home/ubuntu/titanlink-relay --port 5555

# Then:
sudo systemctl daemon-reload
sudo systemctl restart titanlink-relay

# Update Oracle Cloud Security List and iptables for new port
```

### 3. Monitor Logs for Abuse

```bash
# Check for unusual activity
sudo journalctl -u titanlink-relay | grep "New session" | tail -20
```

---

## Quick Reference Card

```bash
# Start/Stop/Status
sudo systemctl start titanlink-relay
sudo systemctl stop titanlink-relay
sudo systemctl status titanlink-relay

# Logs
sudo journalctl -u titanlink-relay -f

# Test from local PC
echo "PING" | nc -u YOUR_ORACLE_IP 5000

# Update binary
scp new-binary ubuntu@YOUR_ORACLE_IP:~/titanlink-relay
sudo systemctl restart titanlink-relay
```

---

✅ **Deployment Complete!** Your relay server should now be accessible at `YOUR_ORACLE_IP:5000`.
