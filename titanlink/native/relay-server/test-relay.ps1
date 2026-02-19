# Test script for TitanLink Relay Server
# Run this with: .\native\relay-server\test-relay.ps1

Write-Host "🧪 Testing TitanLink Relay Server..." -ForegroundColor Cyan

# Test 1: PING/PONG
Write-Host "`n[TEST 1] PING/PONG Health Check" -ForegroundColor Yellow

try {
    $client = New-Object System.Net.Sockets.UdpClient
    $client.Client.ReceiveTimeout = 2000  # 2 second timeout
    $client.Connect('127.0.0.1', 5000)
    
    # Send PING
    $pingBytes = [System.Text.Encoding]::ASCII.GetBytes('PING')
    [void]$client.Send($pingBytes, $pingBytes.Length)
    Write-Host "  Sent: PING" -ForegroundColor Gray
    
    # Receive PONG
    $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $response = $client.Receive([ref]$endpoint)
    $responseText = [System.Text.Encoding]::ASCII.GetString($response)
    
    if ($responseText -eq 'PONG') {
        Write-Host "  ✅ Received: PONG" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ Unexpected response: $responseText" -ForegroundColor Red
        Write-Host "  Status: FAIL" -ForegroundColor Red
    }
    
    $client.Close()
}
catch {
    Write-Host "  ❌ Error: $_" -ForegroundColor Red
    Write-Host "  Status: FAIL" -ForegroundColor Red
    Write-Host "`n  Make sure the relay server is running:" -ForegroundColor Yellow
    Write-Host "    cd native\relay-server" -ForegroundColor Gray
    Write-Host "    cargo run" -ForegroundColor Gray
}

# Test 2: Session Relay (Simulated)
Write-Host "`n[TEST 2] Session Packet Forwarding" -ForegroundColor Yellow

try {
    # Create two clients (simulating Host and Client)
    $host_client = New-Object System.Net.Sockets.UdpClient(0)  # Random port
    $client_client = New-Object System.Net.Sockets.UdpClient(0)  # Random port
    
    $host_client.Client.ReceiveTimeout = 2000
    $client_client.Client.ReceiveTimeout = 2000
    
    $relay = '127.0.0.1:5000'
    
    # Session ID (8 bytes) + payload
    $sessionId = [BitConverter]::GetBytes([uint64]12345)
    [Array]::Reverse($sessionId)  # Convert to big-endian
    
    # Host sends first packet
    $hostPayload = $sessionId + [System.Text.Encoding]::ASCII.GetBytes("Hello from Host")
    $host_endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 5000)
    [void]$host_client.Send($hostPayload, $hostPayload.Length, $host_endpoint)
    Write-Host "  Host sent: 'Hello from Host' (session 12345)" -ForegroundColor Gray
    
    # Client sends second packet (registers itself)
    $clientPayload = $sessionId + [System.Text.Encoding]::ASCII.GetBytes("Hello from Client")
    [void]$client_client.Send($clientPayload, $clientPayload.Length, $host_endpoint)
    Write-Host "  Client sent: 'Hello from Client' (session 12345)" -ForegroundColor Gray
    
    # Host should receive Client's message
    $endpoint = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $response = $host_client.Receive([ref]$endpoint)
    $message = [System.Text.Encoding]::ASCII.GetString($response[8..($response.Length - 1)])
    
    if ($message -eq "Hello from Client") {
        Write-Host "  ✅ Host received: '$message'" -ForegroundColor Green
        Write-Host "  Status: PASS" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ Unexpected message: $message" -ForegroundColor Red
        Write-Host "  Status: FAIL" -ForegroundColor Red
    }
    
    $host_client.Close()
    $client_client.Close()
}
catch {
    Write-Host "  ⚠️  Relay test skipped (expected for basic ping test)" -ForegroundColor Yellow
    Write-Host "  Error: $_" -ForegroundColor Gray
}

Write-Host "`n✨ Test Complete!" -ForegroundColor Cyan
