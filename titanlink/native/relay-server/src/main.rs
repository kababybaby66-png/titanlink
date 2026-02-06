use anyhow::Result;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::RwLock;
use tracing::{info, warn, error, debug};

/// Session identifier (8 bytes from packet header)
type SessionId = u64;

/// Relay state: maps SessionID -> (Host Address, Client Address)
#[derive(Debug, Clone)]
struct SessionRoute {
    host: SocketAddr,
    client: Option<SocketAddr>,
    last_activity: std::time::Instant,
}

type SessionMap = Arc<RwLock<HashMap<SessionId, SessionRoute>>>;

const RELAY_PORT: u16 = 5000;
const SESSION_TIMEOUT_SECS: u64 = 300; // 5 minutes of inactivity = cleanup
const MAX_PACKET_SIZE: usize = 65535;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("titanlink_relay=debug,tokio=info")
        .init();

    info!("🚀 TitanLink Relay Server v0.1.0");
    info!("📡 Starting UDP relay on port {}", RELAY_PORT);

    // Bind UDP socket
    let socket = UdpSocket::bind(format!("0.0.0.0:{}", RELAY_PORT)).await?;
    info!("✅ Listening on {}", socket.local_addr()?);

    // Shared session state
    let sessions: SessionMap = Arc::new(RwLock::new(HashMap::new()));

    // Spawn cleanup task
    let cleanup_sessions = sessions.clone();
    tokio::spawn(async move {
        cleanup_task(cleanup_sessions).await;
    });

    // Main relay loop
    relay_loop(socket, sessions).await?;

    Ok(())
}

async fn relay_loop(socket: UdpSocket, sessions: SessionMap) -> Result<()> {
    let socket = Arc::new(socket);
    let mut buf = vec![0u8; MAX_PACKET_SIZE];

    loop {
        // Receive packet
        let (len, from_addr) = match socket.recv_from(&mut buf).await {
            Ok(result) => result,
            Err(e) => {
                error!("Failed to receive packet: {}", e);
                continue;
            }
        };

        let packet = &buf[..len];
        
        // Fast path: Ping/Pong (no session ID needed)
        if packet.len() == 4 && &packet[..4] == b"PING" {
            debug!("Received PING from {}", from_addr);
            if let Err(e) = socket.send_to(b"PONG", from_addr).await {
                warn!("Failed to send PONG to {}: {}", from_addr, e);
            }
            continue;
        }

        // Extract session ID from packet (first 8 bytes)
        if packet.len() < 8 {
            warn!("Packet too short ({} bytes) from {}", len, from_addr);
            continue;
        }

        let session_id = u64::from_be_bytes(packet[..8].try_into().unwrap());
        
        // Forward the packet
        let socket_clone = socket.clone();
        let sessions_clone = sessions.clone();
        let packet_owned = packet.to_vec();
        
        tokio::spawn(async move {
            if let Err(e) = handle_packet(
                socket_clone,
                sessions_clone,
                session_id,
                from_addr,
                packet_owned,
            ).await {
                warn!("Error handling packet: {}", e);
            }
        });
    }
}

async fn handle_packet(
    socket: Arc<UdpSocket>,
    sessions: SessionMap,
    session_id: SessionId,
    from_addr: SocketAddr,
    packet: Vec<u8>,
) -> Result<()> {
    let mut sessions_lock = sessions.write().await;
    
    // Get or create session
    let route = sessions_lock.entry(session_id).or_insert_with(|| {
        info!("📝 New session: {} from {}", session_id, from_addr);
        SessionRoute {
            host: from_addr,
            client: None,
            last_activity: std::time::Instant::now(),
        }
    });

    // Update last activity
    route.last_activity = std::time::Instant::now();

    // Determine forwarding logic
    let forward_to = if from_addr == route.host {
        // Packet from Host -> Forward to Client (if connected)
        if let Some(client_addr) = route.client {
            debug!("Host -> Client: {} bytes (session {})", packet.len(), session_id);
            Some(client_addr)
        } else {
            debug!("Client not yet connected for session {}", session_id);
            None
        }
    } else {
        // Packet from Client -> Register and forward to Host
        if route.client.is_none() {
            info!("🔗 Client connected: {} for session {}", from_addr, session_id);
            route.client = Some(from_addr);
        }
        debug!("Client -> Host: {} bytes (session {})", packet.len(), session_id);
        Some(route.host)
    };

    // Forward the packet
    if let Some(target) = forward_to {
        if let Err(e) = socket.send_to(&packet, target).await {
            error!("Failed to forward packet to {}: {}", target, e);
        }
    }

    Ok(())
}

/// Cleanup task: Remove inactive sessions every 60 seconds
async fn cleanup_task(sessions: SessionMap) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
    
    loop {
        interval.tick().await;
        
        let mut sessions_lock = sessions.write().await;
        let before_count = sessions_lock.len();
        
        sessions_lock.retain(|session_id, route| {
            let inactive_duration = route.last_activity.elapsed().as_secs();
            if inactive_duration > SESSION_TIMEOUT_SECS {
                info!("🗑️  Removing inactive session: {} (inactive for {}s)", session_id, inactive_duration);
                false
            } else {
                true
            }
        });
        
        let removed = before_count - sessions_lock.len();
        if removed > 0 {
            info!("Cleaned up {} inactive sessions ({} active)", removed, sessions_lock.len());
        }
    }
}
