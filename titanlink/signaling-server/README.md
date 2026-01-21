# TitanLink Signaling Server

A lightweight WebRTC signaling server for TitanLink P2P connections.

## Deployment

### Glitch

1. Create a new project on [Glitch](https://glitch.com)
2. Import from GitHub or upload these files
3. The server will automatically start
4. Copy your Glitch URL (e.g., `https://your-project.glitch.me`)

### Railway

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repo or deploy directly
3. Railway will auto-detect Node.js and run `npm start`

### Heroku

```bash
heroku create titanlink-signaling
git push heroku main
```

### Self-hosted

```bash
npm install
npm start
```

## Environment Variables

- `PORT` - Server port (default: 3001)

## API

### WebSocket Events

**Client → Server:**
- `create-session` - Host creates a new session
- `join-session` - Client joins an existing session
- `signal` - Forward WebRTC signaling data
- `leave-session` - Leave current session

**Server → Client:**
- `session-created` - Session successfully created
- `session-joined` - Successfully joined session
- `session-not-found` - Session code not found
- `peer-joined` - A peer joined the session
- `peer-left` - A peer left the session
- `host-left` - Host disconnected
- `signal` - Forwarded signaling data
- `error` - Error message
