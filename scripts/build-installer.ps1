# Builds NiceToolsUninstall.exe, NiceToolsUpdater.exe, the single EXE setup,
# the portable zip and an update zip/manifest for the current version.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Cannot find csc.exe" }

$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$dist = Join-Path $root "dist\NiceTools"
$build = Join-Path $root "build"
$icon = Join-Path $build "icon.ico"
if (-not (Test-Path $dist)) { throw "Run build-portable.mjs first" }

# Helper executables
$uninstaller = Join-Path $dist "NiceToolsUninstall.exe"
$updater = Join-Path $dist "NiceToolsUpdater.exe"

& $csc /nologo /target:winexe /platform:anycpu /win32icon:"$icon" /out:"$uninstaller" `
    (Join-Path $build "Uninstaller.cs") /r:System.Windows.Forms.dll /r:System.Drawing.dll
if ($LASTEXITCODE -ne 0) { throw "Uninstaller compilation failed" }

& $csc /nologo /target:winexe /platform:anycpu /win32icon:"$icon" /out:"$updater" `
    (Join-Path $build "Updater.cs") /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.FileSystem.dll
if ($LASTEXITCODE -ne 0) { throw "Updater compilation failed" }

# Installer payload (contents at root)
$payload = Join-Path $build "installer-payload.zip"
if (Test-Path $payload) { Remove-Item $payload -Force }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $payload -C $dist .
if ($LASTEXITCODE -ne 0) { throw "Payload zip failed" }

$setup = Join-Path $root "dist\NiceTools-Setup-$version.exe"
& $csc /nologo /target:winexe /platform:anycpu /win32icon:"$icon" /out:"$setup" `
    (Join-Path $build "Installer.cs") `
    /resource:"$payload,NiceToolsPayload" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll
if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed" }

# Portable zip with helpers included
$portable = Join-Path $root "dist\NiceTools-portable.zip"
if (Test-Path $portable) { Remove-Item $portable -Force }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $portable -C (Join-Path $root "dist") NiceTools
if ($LASTEXITCODE -ne 0) { throw "Portable zip failed" }

# Update payload (root files) and manifest
$updateZip = Join-Path $root ("dist\NiceTools-update-$version.zip")
if (Test-Path $updateZip) { Remove-Item $updateZip -Force }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $updateZip -C $dist .
if ($LASTEXITCODE -ne 0) { throw "Update zip failed" }
$hash = (Get-FileHash $updateZip -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    version = $version
    publishedAt = (Get-Date).ToUniversalTime().ToString("o")
    url = "https://example.com/NiceTools-update-$version.zip"
    sha256 = $hash
    notes = "NiceTools $version"
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root "dist\update.json") -Encoding UTF8

Copy-Item $setup (Join-Path $env:USERPROFILE "Desktop\NiceTools-Setup-$version.exe") -Force
Copy-Item $portable (Join-Path $env:USERPROFILE "Desktop\NiceTools-portable.zip") -Force
Remove-Item $payload -Force -ErrorAction SilentlyContinue

Write-Host "setup: $setup"
Write-Host "portable: $portable"
Write-Host "update: $updateZip"
Write-Host "manifest: dist\update.json"
