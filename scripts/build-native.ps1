# Builds the small native Windows helpers used by NiceTools:
#   NiceToolsLauncher.exe  - clears Electron-only env vars and starts NiceToolsCore.exe
#   NiceToolsMem.exe       - EmptyWorkingSet helper for the safe memory cleanup
#   NiceToolsUpdater.exe   - legacy updater entry point
#   NiceToolsUpdater2.exe  - current no-delete updater entry point
#
# Requires Windows .NET Framework 4.x (csc.exe is installed with Windows).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  throw "Cannot find the .NET Framework C# compiler: $csc"
}

function Compile([string]$source, [string]$out, [string[]]$refs, [string]$icon) {
  $compilerArgs = @('/nologo', '/target:winexe', '/platform:anycpu')
  if ($icon) {
    $compilerArgs += "/win32icon:$icon"
  }
  $compilerArgs += "/out:$out"
  $compilerArgs += (Join-Path $root $source)
  if ($refs) {
    $compilerArgs += $refs
  }
  & $csc @compilerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Compilation failed: $source"
  }
  Write-Host "written: $out"
}

$icon = Join-Path $root 'build\icon.ico'

Compile 'build\Launcher.cs' (Join-Path $root 'build\NiceToolsLauncher.exe') @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll') $icon
Compile 'build\MemHelper.cs' (Join-Path $root 'build\NiceToolsMem.exe') @() ''
Compile 'build\Updater.cs' (Join-Path $root 'build\NiceToolsUpdater.exe') @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.FileSystem.dll') $icon
Compile 'build\Updater.cs' (Join-Path $root 'build\NiceToolsUpdater2.exe') @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.FileSystem.dll') $icon
