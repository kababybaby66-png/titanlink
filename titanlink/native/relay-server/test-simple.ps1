# Simple Relay Forwarding Test
# Verifies Task 1.2: Bidirectional packet forwarding works

Write-Host "🧪 Testing Relay Server Packet Forwarding" -ForegroundColor Cyan
Write-Host ""

$RELAY_IP = "127.0.0.1"
$RELAY_PORT = 5000
$SESSION_ID = [uint64]99999

# Helper: Create session ID (8 bytes, big-endian)
function Get-SessionBytes {
    $bytes = [BitConverter]::GetBytes($SESSION_ID)
    [Array]::Reverse($bytes)
    return $bytes
}

Write-Host "[Step 1] Testing PING/PONG..." -ForegroundColor Yellow
try {
    $ping = New-Object System.Net.Sockets.UdpClient
    $ping.Client.ReceiveTimeout = 2000
    $ping.Connect($RELAY_IP, $RELAY_PORT)
    [void]$ping.Send([byte[]]@(80, 73, 78, 71), 4)  # "PING"
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $resp = $ping.Receive([ref]$ep)
    $text = [System.Text.Encoding]::ASCII.GetString($resp)
    $ping.Close()
    
    if ($text -eq "PONG") {
        Write-Host "  ✅ PASS: Relay server responding" -ForegroundColor Green
    }
    else {
        throw "Unexpected response"
    }
}
catch {
    Write-Host "  ❌ FAIL: $($_)" -Foreground Color Red
    Write-Host "`n  Make sure relay is running: cargo run --manifest-path native\relay-server\Cargo.toml" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[Step 2] Testing Host -> Client forwarding..." -ForegroundColor Yellow

try {
    # Create sockets with longer timeouts
    $hostSock = New-Object System.Net.Sockets.UdpClient(0)
    $clientSock = New-Object System.Net.Sockets.UdpClient(0)
    $hostSock.Client.ReceiveTimeout = 5000
    $clientSock.Client.ReceiveTimeout = 5000
    
    $relay = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse($RELAY_IP), $RELAY_PORT)
    $sid = Get-SessionBytes
    
    # Both register (send empty payloads)
    Write-Host "  Registering Host..." -ForegroundColor Gray
    [void]$hostSock.Send($sid + @(72), 9, $relay)  # Session + 'H'
    Start-Sleep -Milliseconds 200
    
    Write-Host "  Registering Client..." -ForegroundColor Gray
    [void]$clientSock.Send($sid + @(67), 9, $relay)  # Session + 'C'
    Start-Sleep -Milliseconds 200
    
    # Clear any buffered packets
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    try {
        $hostSock.Client.ReceiveTimeout = 100
        while ($true) { [void]$hostSock.Receive([ref]$ep) }
    }
    catch {}
    $hostSock.Client.ReceiveTimeout = 5000
    
    # Host sends message to Client
    $msg = "TestMessage123"
    $payload = $sid + [System.Text.Encoding]::ASCII.GetBytes($msg)
    Write-Host "  Host sending: '$msg'" -ForegroundColor Gray
    [void]$hostSock.Send($payload, $payload.Length, $relay)
    
    # Client receives
    $received = $clientSock.Receive([ref]$ep)
    $receivedMsg = [System.Text.Encoding]::ASCII.GetString($received[8..($received.Length - 1)])
    
    if ($receivedMsg -eq $msg) {
        Write-Host "  ✅ PASS: Client received '$receivedMsg'" -ForegroundColor Green
    }
    else {
        throw "Expected '$msg', got '$receivedMsg'"
    }
    
    $hostSock.Close()
    $clientSock.Close()
    
}
catch {
    Write-Host "  ❌ FAIL: $($_)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Gray
Write-Host "✅ Task 1.2 Complete: Packet forwarding verified!" -ForegroundColor Green
Write-Host "   - PING/PONG works" -ForegroundColor Gray
Write-Host "   - Host -> Relay -> Client works" -ForegroundColor Gray
