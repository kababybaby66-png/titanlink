# TitanLink Signaling Server

A lightweight WebSocket server for WebRTC signaling, designed to facilitate peer-to-peer connections for TitanLink remote desktop streaming.

## Deployment

### Deploy to Render.com (Recommended - Free Tier)

1. Create a [Render.com](https://render.com) account
2. Click "New" → "Web Service"
3. Connect your GitHub repository or use "Deploy from Git URL"
4. Configure:
   - **Name**: `titanlink-signaling`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click "Create Web Service"

Your server will be deployed at `wss://titanlink-signaling.onrender.com`

### Deploy to Railway.app

1. Create a [Railway.app](https://railway.app) account
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway will auto-detect Node.js and deploy

### Deploy to Glitch

1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Import from GitHub"
3. Enter your repository URL
4. Glitch will automatically deploy

### Local Development

```bash
npm install
npm start
```

Server runs on port 3001 by default (or `PORT` environment variable).

## API

### Health Check
```
GET /
```
Returns server status and active session count.

### WebSocket Protocol

Connect to `ws://[host]:[port]` for WebSocket signaling.

#### Messages (Client → Server)

**Create Session (Host)**
```json
{
  "type": "create-session",
  "sessionCode": "ABC123",
  "hostId": "unique-host-id"
}
```

**Join Session (Client)**
```json
{
  "type": "join-session",
  "sessionCode": "ABC123",
  "clientId": "unique-client-id"
}
```

**Signal (WebRTC signaling)**
```json
{
  "type": "signal",
  "sessionCode": "ABC123",
  "to": "target-peer-id",
  "payload": { /* SDP offer/answer or ICE candidate */ }
}
```

**Leave Session**
```json
{
  "type": "leave-session",
  "sessionCode": "ABC123"
}
```

#### Messages (Server → Client)

- `session-created` - Session was created successfully
- `session-joined` - Successfully joined a session
- `session-not-found` - The requested session doesn't exist
- `peer-joined` - A new peer joined the session (sent to host)
- `peer-left` - A peer left the session
- `host-left` - The host disconnected
- `signal` - A WebRTC signaling message from another peer
- `error` - An error occurred

## Environment Variables

- `PORT` - Server port (default: 3001)
