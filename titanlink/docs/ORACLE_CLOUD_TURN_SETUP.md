# Setting Up Free TURN Server on Oracle Cloud

This guide walks you through setting up a **forever-free** TURN server using Oracle Cloud's Always Free tier.

## Prerequisites

- A credit/debit card for verification (you won't be charged)
- About 15-20 minutes

---

## Step 1: Create Oracle Cloud Account

1. Go to **https://www.oracle.com/cloud/free/**
2. Click **"Start for free"**
3. Fill in your details and verify email
4. Add payment method (for verification only - you won't be charged for Always Free resources)
5. Complete the sign-up process

---

## Step 2: Create a Free VM Instance

1. Log into **Oracle Cloud Console**: https://cloud.oracle.com
2. Click the **hamburger menu (☰)** → **Compute** → **Instances**
3. Click **"Create Instance"**

### Instance Configuration:

| Setting | Value |
|---------|-------|
| **Name** | `titanlink-turn` |
| **Placement** | Leave default |
| **Image** | **Ubuntu 22.04** (click "Change image" → Ubuntu → 22.04) |
| **Shape** | Click "Change shape" → **Ampere** → **VM.Standard.A1.Flex** |
| | OCPUs: **1** |
| | Memory: **6 GB** |

> ⚠️ If Ampere is unavailable, use **VM.Standard.E2.1.Micro** (AMD) - also free!

### Networking:
- Select your VCN or let it create a new one
- **Assign a public IPv4 address**: ✅ Yes

### Add SSH Keys:
- Choose **"Generate a key pair for me"**
- **Download both keys** (public and private) - you'll need these!

4. Click **"Create"** and wait for the instance to be **RUNNING** (2-3 minutes)

---

## Step 3: Configure Security Rules (Firewall)

Oracle Cloud blocks ports by default. We need to open TURN ports.

1. Go to **Networking** → **Virtual Cloud Networks**
2. Click on your VCN (e.g., `vcn-xxxxxxxx`)
3. Click on the **Subnet** (e.g., `subnet-xxxxxxxx`)
4. Click on the **Security List** (e.g., `Default Security List for vcn-xxx`)
5. Click **"Add Ingress Rules"**

Add these rules one by one:

### Rule 1: STUN/TURN UDP
| Field | Value |
|-------|-------|
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | UDP |
| Destination Port Range | `3478` |
| Description | TURN UDP |

### Rule 2: STUN/TURN TCP
| Field | Value |
|-------|-------|
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port Range | `3478` |
| Description | TURN TCP |

### Rule 3: TURNS (TLS)
| Field | Value |
|-------|-------|
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port Range | `5349` |
| Description | TURNS TLS |

### Rule 4: TURN Relay Ports (UDP)
| Field | Value |
|-------|-------|
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | UDP |
| Destination Port Range | `49152-65535` |
| Description | TURN relay |

---

## Step 4: Connect to Your VM

### On Windows (PowerShell):
```powershell
ssh -i "path\to\your\private-key" ubuntu@YOUR_PUBLIC_IP
```

### On Mac/Linux:
```bash
chmod 400 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR_PUBLIC_IP
```

Replace `YOUR_PUBLIC_IP` with the public IP shown in your instance details.

---

## Step 5: Install TURN Server

Once connected via SSH, run:

```bash
# Download and run the setup script
curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/titanlink/master/scripts/setup-turn-server.sh | sudo bash
```

Or manually:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install coturn
sudo apt install -y coturn

# Enable coturn service
echo "TURNSERVER_ENABLED=1" | sudo tee /etc/default/coturn

# Generate a secret
TURN_SECRET=$(openssl rand -hex 32)
PUBLIC_IP=$(curl -s https://api.ipify.org)

# Create config
sudo tee /etc/turnserver.conf << EOF
listening-port=3478
tls-listening-port=5349
external-ip=$PUBLIC_IP
relay-ip=$PUBLIC_IP
min-port=49152
max-port=65535
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=titanlink.local
fingerprint
no-cli
verbose
EOF

# Configure Ubuntu firewall (in addition to Oracle security lists)
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 49152:65535 -j ACCEPT

# Save iptables rules
sudo apt install -y iptables-persistent
sudo netfilter-persistent save

# Start coturn
sudo systemctl enable coturn
sudo systemctl restart coturn

# Show credentials
echo ""
echo "=========================================="
echo "TURN Server Ready!"
echo "=========================================="
echo "TURN_SERVER_URL=turn:$PUBLIC_IP:3478"
echo "TURN_SERVER_SECRET=$TURN_SECRET"
echo "=========================================="
```

---

## Step 6: Configure TitanLink

After setup, you'll see something like:
```
TURN_SERVER_URL=turn:129.146.xxx.xxx:3478
TURN_SERVER_SECRET=a1b2c3d4e5f6...
```

### Option A: Environment Variables
Create a `.env` file in your TitanLink folder:
```env
TURN_SERVER_URL=turn:YOUR_IP:3478
TURN_SERVER_SECRET=your_secret_here
```

### Option B: Configure in App
Use the settings page (if implemented) to enter these values.

---

## Step 7: Test Your TURN Server

Visit https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Enter:
- **STUN or TURN URI**: `turn:YOUR_IP:3478`
- **TURN username**: `1234567890:titanlink` (any timestamp:username)
- **TURN credential**: Run this to generate: 
  ```bash
  echo -n "1234567890:titanlink" | openssl dgst -sha1 -hmac "YOUR_SECRET" -binary | base64
  ```

Click "Gather candidates" - you should see `relay` candidates!

---

## Troubleshooting

### Can't connect to VM?
- Check that you're using the correct private key
- Verify the public IP is correct
- Wait a few minutes after instance creation

### TURN not working?
1. Check coturn is running: `sudo systemctl status coturn`
2. Check logs: `sudo tail -f /var/log/turnserver.log`
3. Verify security list rules in Oracle Cloud console
4. Check Ubuntu firewall: `sudo iptables -L`

### Getting "relay" candidates but connection still fails?
- Make sure firewall rules allow the relay port range (49152-65535 UDP)
- Check your home router isn't blocking outbound UDP

---

## Free Tier Limits

Oracle Cloud Always Free includes:
- ✅ 2 AMD VM instances (1 GB RAM each) OR
- ✅ Up to 4 Ampere A1 instances (total 24 GB RAM, 4 OCPUs)
- ✅ 200 GB block storage
- ✅ 10 TB outbound data transfer per month

**For TURN:** 10TB/month is roughly **100+ hours** of video streaming relay - more than enough!

---

## Cost Summary

| Item | Cost |
|------|------|
| Oracle Cloud VM | **$0/month** (Always Free) |
| Coturn software | **$0** (open source) |
| Bandwidth (10TB/month) | **$0** (included) |
| **Total** | **$0/month** ✅ |

---

## Next Steps

Once your TURN server is running:
1. Add the environment variables to TitanLink
2. Rebuild the app: `npm run electron:build`
3. Test cross-network connections - they should work now!
