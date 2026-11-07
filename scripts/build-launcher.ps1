# Builds the tiny native .NET Framework launcher that clears Electron-only
# environment variables and starts NiceToolsCore.exe.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    throw "Cannot find the .NET Framework C# compiler: $csc"
}

$source = Join-Path $root "build\Launcher.cs"
$icon = Join-Path $root "build\icon.ico"
$out = Join-Path $root "build\NiceToolsLauncher.exe"

& $csc /nologo /target:winexe /platform:anycpu /win32icon:"$icon" /out:"$out" `
    "$source" /r:System.Windows.Forms.dll /r:System.Drawing.dll
if ($LASTEXITCODE -ne 0) {
    throw "Launcher compilation failed"
}
Write-Host "launcher written: $out"
