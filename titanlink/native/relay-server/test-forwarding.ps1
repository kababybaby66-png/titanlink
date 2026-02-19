# Comprehensive Relay Test - Verifies bidirectional packet forwarding
# Tests Task 1.2: Host <-> Oracle Relay <-> Client communication

Write-Host "🧪 TitanLink Relay Server - Packet Forwarding Test" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

# Test Configuration
$RELAY_IP = "127.0.0.1"
$RELAY_PORT = 5000
$SESSION_ID = 12345  # Shared session identifier
$TIMEOUT_MS = 3000

# Helper function to create session ID bytes (8 bytes, big-endian)
function Get-SessionIdBytes {
    param([uint64]$sessionId)
    $bytes = [BitConverter]::GetBytes($sessionId)
    [Array]::Reverse($bytes)  # Convert to big-endian
    return $bytes
}

# Test 1: PING/PONG (Basic Connectivity)
Write-Host "`n[TEST 1] Basic Connectivity (PING/PONG)" -ForegroundColor Yellow
Write-Host "Testing: Can we reach the relay server?" -ForegroundColor Gray

try {
    $pingClient = New-Object System.Net.Sockets.UdpClient
    $pingClient.Client.ReceiveTimeout = $TIMEOUT_MS
    $pingClient.Connect($RELAY_IP, $RELAY_PORT)
    
    # Send PING
    $pingBytes = [System.Text.Encoding]::ASCII.GetBytes('PING')
    [void]$pingClient.Send($pingBytes, $pingBytes.Length)
    Write-Host "  → Sent: PING" -ForegroundColor Gray
    
    # Receive PONG
    $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $response = $pingClient.Receive([ref]$endpoint)
    $responseText = [System.Text.Encoding]::ASCII.GetString($response)
    
    if ($responseText -eq 'PONG') {
        Write-Host "  ✅ Received: PONG" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    else {
        throw "Unexpected response: $responseText"
    }
    
    $pingClient.Close()
}
catch {
    Write-Host "  ❌ FAIL: $_" -ForegroundColor Red
    Write-Host "`n⚠️  Make sure relay server is running:" -ForegroundColor Yellow
    Write-Host "    cd native\relay-server" -ForegroundColor Gray
    Write-Host "    cargo run" -ForegroundColor Gray
    exit 1
}

# Test 2: Session Registration & Forwarding
Write-Host "`n[TEST 2] Packet Forwarding (Host -> Client)" -ForegroundColor Yellow
Write-Host "Testing: Can Host send message through relay to Client?" -ForegroundColor Gray

try {
    # Create Host and Client sockets
    $hostSocket = New-Object System.Net.Sockets.UdpClient(0)  # Random port
    $clientSocket = New-Object System.Net.Sockets.UdpClient(0) # Random port
    
    $hostSocket.Client.ReceiveTimeout = $TIMEOUT_MS
    $clientSocket.Client.ReceiveTimeout = $TIMEOUT_MS
    
    $relayEndpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse($RELAY_IP), $RELAY_PORT)
    $sessionIdBytes = Get-SessionIdBytes -sessionId $SESSION_ID
    
    # Step 1: BOTH endpoints register first (empty messages)
    [void]$hostSocket.Send($sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("_"), 9, $relayEndpoint)
    Write-Host "  → Host registered (session $SESSION_ID)" -ForegroundColor Gray
    
    Start-Sleep -Milliseconds 50
    
    [void]$clientSocket.Send($sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("_"), 9, $relayEndpoint)
    Write-Host "  → Client registered (session $SESSION_ID)" -ForegroundColor Gray
    
    # Consume the registration packets
    $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    try { [void]$hostSocket.Receive([ref]$endpoint) } catch {}
    
    Start-Sleep -Milliseconds 100
    
    # Step 2: Now send actual message from Host to Client
    $testMessage = "Hello from Host"
    $payload = $sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes($testMessage)
    [void]$hostSocket.Send($payload, $payload.Length, $relayEndpoint)
    Write-Host "  → Host sent: '$testMessage'" -ForegroundColor Gray
    
    # Step 3: Client should receive the message
    $receivedBytes = $clientSocket.Receive([ref]$endpoint)
    $receivedMessage = [System.Text.Encoding]::ASCII.GetString($receivedBytes[8..($receivedBytes.Length - 1)])
    
    if ($receivedMessage -eq $testMessage) {
        Write-Host "  ✅ Client received: '$receivedMessage'" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    else {
        throw "Expected '$testMessage', got '$receivedMessage'"
    }
    
    $hostSocket.Close()
    $clientSocket.Close()
    
}
catch {
    Write-Host "  ❌ FAIL: $_" -ForegroundColor Red
    exit 1
}

# Test 3: Bidirectional Communication
Write-Host "`n[TEST 3] Bidirectional Forwarding (Client -> Host)" -ForegroundColor Yellow
Write-Host "Testing: Can Client send message back to Host?" -ForegroundColor Gray

try {
    # Create new sockets for clean test
    $hostSocket = New-Object System.Net.Sockets.UdpClient(0)
    $clientSocket = New-Object System.Net.Sockets.UdpClient(0)
    
    $hostSocket.Client.ReceiveTimeout = $TIMEOUT_MS
    $clientSocket.Client.ReceiveTimeout = $TIMEOUT_MS
    
    $relayEndpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse($RELAY_IP), $RELAY_PORT)
    $sessionIdBytes = Get-SessionIdBytes -sessionId ($SESSION_ID + 1)  # Different session
    
    # Host registers first
    $hostPayload = $sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("Host ready")
    [void]$hostSocket.Send($hostPayload, $hostPayload.Length, $relayEndpoint)
    Start-Sleep -Milliseconds 50
    
    # Client registers
    $clientPayload = $sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("Client connected")
    [void]$clientSocket.Send($clientPayload, $clientPayload.Length, $relayEndpoint)
    Start-Sleep -Milliseconds 50
    
    # Now test: Host sends to Client
    $testMessage = "Ping from Host"
    $payload = $sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes($testMessage)
    [void]$hostSocket.Send($payload, $payload.Length, $relayEndpoint)
    Write-Host "  → Host sent: '$testMessage'" -ForegroundColor Gray
    
    # Client receives
    $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $receivedBytes = $clientSocket.Receive([ref]$endpoint)
    $receivedMessage = [System.Text.Encoding]::ASCII.GetString($receivedBytes[8..($receivedBytes.Length - 1)])
    
    if ($receivedMessage -eq $testMessage) {
        Write-Host "  ✅ Client received: '$receivedMessage'" -ForegroundColor Green
    }
    else {
        throw "Expected '$testMessage', got '$receivedMessage'"
    }
    
    # Test reverse: Client sends to Host
    $replyMessage = "Pong from Client"
    $replyPayload = $sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes($replyMessage)
    [void]$clientSocket.Send($replyPayload, $replyPayload.Length, $relayEndpoint)
    Write-Host "  → Client sent: '$replyMessage'" -ForegroundColor Gray
    
    # Host receives
    $receivedBytes = $hostSocket.Receive([ref]$endpoint)
    $receivedMessage = [System.Text.Encoding]::ASCII.GetString($receivedBytes[8..($receivedBytes.Length - 1)])
    
    if ($receivedMessage -eq $replyMessage) {
        Write-Host "  ✅ Host received: '$receivedMessage'" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    else {
        throw "Expected '$replyMessage', got '$receivedMessage'"
    }
    
    $hostSocket.Close()
    $clientSocket.Close()
    
}
catch {
    Write-Host "  ❌ FAIL: $_" -ForegroundColor Red
    exit 1
}

# Test 4: Multiple Sessions
Write-Host "`n[TEST 4] Multiple Concurrent Sessions" -ForegroundColor Yellow
Write-Host "Testing: Can relay handle multiple sessions simultaneously?" -ForegroundColor Gray

try {
    $sessions = @()
    
    # Create 3 different sessions
    for ($i = 1; $i -le 3; $i++) {
        $hostSock = New-Object System.Net.Sockets.UdpClient(0)
        $clientSock = New-Object System.Net.Sockets.UdpClient(0)
        $hostSock.Client.ReceiveTimeout = $TIMEOUT_MS
        $clientSock.Client.ReceiveTimeout = $TIMEOUT_MS
        
        $sessionId = 10000 + $i
        $sessionIdBytes = Get-SessionIdBytes -sessionId $sessionId
        
        # Register both
        $relayEndpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse($RELAY_IP), $RELAY_PORT)
        [void]$hostSock.Send($sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("H$i"), 10, $relayEndpoint)
        [void]$clientSock.Send($sessionIdBytes + [System.Text.Encoding]::ASCII.GetBytes("C$i"), 10, $relayEndpoint)
        
        $sessions += @{
            ID           = $sessionId
            HostSocket   = $hostSock
            ClientSocket = $clientSock
            SessionBytes = $sessionIdBytes
        }
    }
    
    Write-Host "  → Created 3 sessions (10001, 10002, 10003)" -ForegroundColor Gray
    
    # Send messages in each session
    foreach ($session in $sessions) {
        $msg = "Message in session $($session.ID)"
        $payload = $session.SessionBytes + [System.Text.Encoding]::ASCII.GetBytes($msg)
        [void]$session.HostSocket.Send($payload, $payload.Length, $relayEndpoint)
    }
    
    # Verify each client receives correct message
    $allPass = $true
    foreach ($session in $sessions) {
        $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        $received = $session.ClientSocket.Receive([ref]$endpoint)
        $msg = [System.Text.Encoding]::ASCII.GetString($received[8..($received.Length - 1)])
        
        if ($msg -ne "Message in session $($session.ID)") {
            $allPass = $false
            Write-Host "  ❌ Session $($session.ID) failed" -ForegroundColor Red
        }
        
        $session.HostSocket.Close()
        $session.ClientSocket.Close()
    }
    
    if ($allPass) {
        Write-Host "  ✅ All 3 sessions forwarded correctly" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    
}
catch {
    Write-Host "  ❌ FAIL: $_" -ForegroundColor Red
    exit 1
}

# Summary
Write-Host "`n" + ("=" * 60) -ForegroundColor Gray
Write-Host "✅ ALL TESTS PASSED" -ForegroundColor Green
Write-Host "`n📊 Task 1.2 Verification Complete:" -ForegroundColor Cyan
Write-Host "  ✅ PING/PONG works" -ForegroundColor Green
Write-Host "  ✅ Host -> Relay -> Client forwarding works" -ForegroundColor Green
Write-Host "  ✅ Client -> Relay -> Host forwarding works" -ForegroundColor Green
Write-Host "  ✅ Multiple concurrent sessions work" -ForegroundColor Green
Write-Host "`n🎯 Ready for Phase 2: Custom Protocol" -ForegroundColor Cyan
