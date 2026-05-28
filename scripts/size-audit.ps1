# scripts/size-audit.ps1
# Helper script to check cargo bloat and frontend bundle sizes.
Write-Host "Running frontend size audit..."
npm run build
Get-ChildItem -Path dist -Recurse | Measure-Object -Property Length -Sum

Write-Host "`nRunning backend size audit..."
cargo bloat --release --workspace
