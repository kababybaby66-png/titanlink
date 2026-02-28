# TitanLink Relay Server

Ultra-lightweight UDP relay server for TitanLink cloud gaming. Designed to run on Oracle Cloud Free Tier VM.

## 🎯 Purpose

This relay server acts as a "middleman" for users behind restrictive NATs/firewalls that can't establish direct peer-to-peer connections. It simply forwards UDP packets between the Host and Client.

## 📊 Performance Characteristics

- **Memory:** < 10 MB RAM
- **CPU:** Negligible (packet forwarding only)
- **Latency Overhead:** < 5ms
- **Bandwidth:** Forwards packets 1:1 (no encoding/decoding)

## 🚀 Building

### Development Build
```bash
cd native/relay-server
cargo build
```

### Production Build (Optimized for Oracle VM)
```bash
cd native/relay-server
cargo build --release
```

The binary will be at: `target/release/titanlink-relay` (or `titanlink-relay.exe` on Windows)

## 🔧 Running Locally (Testing)

```bash
# Run the relay server
cargo run

# Or run the compiled binary
./target/release/titanlink-relay
```

Expected output:
```
🚀 TitanLink Relay Server v0.1.0
📡 Starting UDP relay on port 5000
✅ Listening on 0.0.0.0:5000
```

## ✅ Testing with netcat

### Terminal 1: Start the relay
```bash
cargo run
```

### Terminal 2: Send a PING
```bash
echo -n "PING" | nc -u localhost 5000
```

Expected response: `PONG`

## 📦 Oracle Cloud Deployment

### Step 1: Build the binary on your PC
```bash
# On Windows (cross-compile for Linux)
cargo install cross
cross build --release --target x86_64-unknown-linux-gnu

# The binary will be at: target/x86_64-unknown-linux-gnu/release/titanlink-relay
```

### Step 2: Upload to Oracle VM
```bash
scp target/x86_64-unknown-linux-gnu/release/titanlink-relay ubuntu@<ORACLE_VM_IP>:~/
```

### Step 3: SSH into Oracle VM and run
```bash
ssh ubuntu@<ORACLE_VM_IP>
chmod +x titanlink-relay
sudo ./titanlink-relay
```

### Step 4: Configure Firewall (Oracle Cloud Security List)

1. Go to Oracle Cloud Console
2. Networking → Virtual Cloud Networks → Your VCN → Security Lists
3. Add Ingress Rule:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** UDP
   - **Destination Port:** 5000

### Step 5: Run as systemd service (Optional - Auto-restart)

Create `/etc/systemd/system/titanlink-relay.service`:
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

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable titanlink-relay
sudo systemctl start titanlink-relay
sudo systemctl status titanlink-relay
```

## 🔍 Monitoring

Check logs:
```bash
sudo journalctl -u titanlink-relay -f
```

## 🧪 Protocol Specification

### Packet Format (for real game data)
```
[8 bytes] Session ID (u64, big-endian)
[N bytes] Payload (forwarded as-is)
```

### Session Logic
1. **First packet from Host:** Creates new session with SessionID
2. **First packet from Client:** Registers client for that session
3. **Subsequent packets:** Forwarded between Host ↔ Client

### Ping/Pong (Health Check)
- **Send:** `PING` (4 bytes ASCII)
- **Receive:** `PONG` (4 bytes ASCII)

## 🛡️ Security Notes

- Session IDs act as a basic "shared secret" - only peers with the same ID can communicate
- For production: Add authentication token in packet header
- The relay does NOT decrypt or inspect packets (end-to-end encryption happens in TitanLink client)

## 📈 Future Improvements

- [ ] Add authentication via shared token
- [ ] Metrics endpoint (Prometheus)
- [ ] Rate limiting per IP
- [ ] Bandwidth usage tracking
