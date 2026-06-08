# scripts/fetch-opencode-binary.ps1
# Compiles mock_opencode and places it in tauri/binaries/

Write-Host "Building mock opencode binary..."
cargo build --package aurora-sidecar --bin mock_opencode

$TargetDir = "tauri/binaries"
if (!(Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
}

$Triple = "x86_64-pc-windows-msvc"
$SourceFile = "target/debug/mock_opencode.exe"
$DestFile = "$TargetDir/opencode-$Triple.exe"

if (Test-Path $SourceFile) {
    Copy-Item $SourceFile $DestFile -Force
    Write-Host "Copied $SourceFile to $DestFile"
} else {
    Write-Error "Could not find compiled binary at $SourceFile"
}

Write-Host "Done!"
