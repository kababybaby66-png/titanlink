/// NAPI-RS bindings for TitanLink custom UDP protocol
/// Exposes Rust networking to TypeScript/Electron
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use crate::network::*;

/// UDP Network Client for TitanLink
#[napi]
pub struct NetworkClient {
    transport: Arc<Mutex<Option<UdpTransport>>>,
    reliable: Arc<Mutex<ReliableChannel>>,
}

#[napi]
impl NetworkClient {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            transport: Arc::new(Mutex::new(None)),
            reliable: Arc::new(Mutex::new(ReliableChannel::new(ReliableConfig::default()))),
        }
    }

    /// Connect to remote peer (or relay server)
    #[napi]
    pub fn connect(&self, remote_ip: String, remote_port: u16, session_id: String) -> Result<()> {
        let session_id_u64 = session_id
            .parse::<u64>()
            .map_err(|_| Error::from_reason("Invalid session ID"))?;

        let remote_addr: SocketAddr = format!("{}:{}", remote_ip, remote_port)
            .parse()
            .map_err(|_| Error::from_reason("Invalid remote address"))?;

        let transport = UdpTransport::new("0.0.0.0:0", remote_addr, session_id_u64)
            .map_err(|e| Error::from_reason(format!("Failed to create transport: {}", e)))?;

        *self.transport.lock().unwrap() = Some(transport);

        Ok(())
    }

    /// Send handshake to initiate session
    #[napi]
    pub fn send_handshake(&self) -> Result<()> {
        let mut transport_guard = self.transport.lock().unwrap();
        if let Some(transport) = transport_guard.as_mut() {
            transport
                .send_handshake()
                .map_err(|e| Error::from_reason(format!("Failed to send handshake: {}", e)))?;
            Ok(())
        } else {
            Err(Error::from_reason("Not connected"))
        }
    }

    /// Send video frame (fire-and-forget)
    #[napi]
    pub fn send_video_frame(
        &self,
        frame_number: u32,
        codec: u8,
        is_keyframe: bool,
        frame_data: Buffer,
    ) -> Result<()> {
        let mut transport_guard = self.transport.lock().unwrap();
        if let Some(transport) = transport_guard.as_mut() {
            transport
                .send_video_frame(frame_number, codec, is_keyframe, &frame_data)
                .map_err(|e| Error::from_reason(format!("Failed to send video frame: {}", e)))?;
            Ok(())
        } else {
            Err(Error::from_reason("Not connected"))
        }
    }

    /// Send controller input (reliable)
    #[napi]
    pub fn send_controller_input(
        &self,
        controller_index: u8,
        buttons: u16,
        left_stick_x: i16,
        left_stick_y: i16,
        right_stick_x: i16,
        right_stick_y: i16,
        left_trigger: u8,
        right_trigger: u8,
    ) -> Result<()> {
        let mut transport_guard = self.transport.lock().unwrap();
        if let Some(transport) = transport_guard.as_mut() {
            let input = ControllerInputData {
                controller_index,
                buttons,
                left_stick_x,
                left_stick_y,
                right_stick_x,
                right_stick_y,
                left_trigger,
                right_trigger,
            };

            transport
                .send_controller_input(input)
                .map_err(|e| Error::from_reason(format!("Failed to send input: {}", e)))?;
            Ok(())
        } else {
            Err(Error::from_reason("Not connected"))
        }
    }

    /// Send keep-alive packet
    #[napi]
    pub fn send_keep_alive(&self) -> Result<()> {
        let mut transport_guard = self.transport.lock().unwrap();
        if let Some(transport) = transport_guard.as_mut() {
            transport
                .send_keep_alive()
                .map_err(|e| Error::from_reason(format!("Failed to send keep-alive: {}", e)))?;
            Ok(())
        } else {
            Err(Error::from_reason("Not connected"))
        }
    }

    /// Disconnect and cleanup
    #[napi]
    pub fn disconnect(&self) -> Result<()> {
        let mut transport_guard = self.transport.lock().unwrap();
        if let Some(transport) = transport_guard.as_ref() {
            transport.stop();
        }
        *transport_guard = None;

        let mut reliable_guard = self.reliable.lock().unwrap();
        reliable_guard.clear();

        Ok(())
    }

    /// Start listening for incoming packets
    #[napi]
    pub fn start_listening(
        &self,
        #[napi(ts_arg_type = "(data: Buffer) => void")] callback: JsFunction,
    ) -> Result<()> {
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;

        let transport = self.transport.clone();

        std::thread::spawn(move || {
            loop {
                // Short scope for lock to allow sending
                let packet_opt = {
                    let mut guard = transport.lock().unwrap();
                    if let Some(transport) = guard.as_ref() {
                        if !transport.is_running() {
                            return;
                        }
                        transport.recv_packet().ok().flatten()
                    } else {
                        // Transport gone (disconnected)
                        return;
                    }
                };

                if let Some(packet) = packet_opt {
                    let bytes = packet.to_bytes();
                    tsfn.call(bytes, ThreadsafeFunctionCallMode::Blocking);
                } else {
                    // Avoid busy loop
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        });

        Ok(())
    }

    /// Check if connected
    #[napi]
    pub fn is_connected(&self) -> bool {
        let transport_guard = self.transport.lock().unwrap();
        transport_guard.is_some()
    }
}
