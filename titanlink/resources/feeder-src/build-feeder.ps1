# build-feeder.ps1 - Build vigem-feeder.exe using .NET SDK
# Run this script to compile the virtual controller feeder

$ErrorActionPreference = "Stop"

$srcDir = $PSScriptRoot
$outputDir = Join-Path (Split-Path $srcDir -Parent) "bin"

Write-Host "Building vigem-feeder.exe..." -ForegroundColor Cyan

# Check for .NET SDK
$dotnetVersion = $null
try {
    $dotnetVersion = & dotnet --version 2>$null
} catch {}

if (-not $dotnetVersion) {
    Write-Host ""
    Write-Host "ERROR: .NET SDK is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "To build vigem-feeder.exe, please install the .NET 6.0 SDK or later:" -ForegroundColor Yellow
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/6.0" -ForegroundColor White
    Write-Host ""
    Write-Host "After installing, run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host ".NET SDK version: $dotnetVersion" -ForegroundColor Green

# Create output directory
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Restore and publish as self-contained single file
Write-Host "Restoring NuGet packages..." -ForegroundColor Cyan
Push-Location $srcDir
try {
    & dotnet restore

    Write-Host "Publishing self-contained executable..." -ForegroundColor Cyan
    & dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=true -o $outputDir

    if ($LASTEXITCODE -eq 0) {
        $exePath = Join-Path $outputDir "vigem-feeder.exe"
        if (Test-Path $exePath) {
            $size = (Get-Item $exePath).Length / 1MB
            Write-Host ""
            Write-Host "SUCCESS! Built vigem-feeder.exe" -ForegroundColor Green
            Write-Host "  Location: $exePath" -ForegroundColor White
            Write-Host "  Size: $([math]::Round($size, 2)) MB" -ForegroundColor White
        }
    } else {
        Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}
