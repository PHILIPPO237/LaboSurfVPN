param(
    [string]$MirrorRoot = $(
        if ($env:LOCALAPPDATA) {
            Join-Path $env:LOCALAPPDATA 'FreeSurfLab\app-local'
        } else {
            Join-Path $PSScriptRoot '.app-local'
        }
    ),
    [string]$ListenHost = '127.0.0.1',
    [int]$Port = 8000,
    [switch]$Reload,
    [switch]$SyncOnly
)

$ErrorActionPreference = 'Stop'

function Resolve-PythonExe {
    param([string]$SourceRoot)

    $candidates = @(
        (Join-Path $SourceRoot '.venv_local\Scripts\python.exe'),
        (Join-Path $SourceRoot '.venv\Scripts\python.exe')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    throw 'python.exe introuvable.'
}

function Invoke-RobocopyChecked {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$Arguments
    )

    if (-not (Test-Path $Source)) {
        return
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    & robocopy $Source $Destination @Arguments | Out-Null
    $exitCode = $LASTEXITCODE
    if ($exitCode -gt 7) {
        throw "robocopy a echoue ($exitCode) pour $Source -> $Destination"
    }
}

$sourceRoot = $PSScriptRoot
$pythonExe = Resolve-PythonExe -SourceRoot $sourceRoot
$mirrorRoot = [System.IO.Path]::GetFullPath($MirrorRoot)
$dbPath = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'FreeSurfLab\labo.db'
} else {
    Join-Path $mirrorRoot 'labo.db'
}

$copyArgs = @('/FFT', '/R:1', '/W:1', '/NP', '/NFL', '/NDL', '/NJH', '/NJS')
$mirrorArgs = $copyArgs + @('/MIR')
$treeArgs = $copyArgs + @('/E')

$rootFiles = @(
    'main.py',
    'config.py',
    'database.py',
    'engine.py',
    'payment_providers.py',
    '.env',
    '.admin_license',
    '.admin_password',
    'gcp_cidrs.json',
    'zero_rating_services.json',
    'important_subdomains.txt'
) | Where-Object { Test-Path (Join-Path $sourceRoot $_) }

if ($rootFiles.Count -gt 0) {
    Invoke-RobocopyChecked -Source $sourceRoot -Destination $mirrorRoot -Arguments ($copyArgs + $rootFiles)
}

$mirroredDirs = @('app', 'templates', 'static\css', 'static\js', 'static\logos')
foreach ($relativePath in $mirroredDirs) {
    $src = Join-Path $sourceRoot $relativePath
    $dst = Join-Path $mirrorRoot $relativePath
    Invoke-RobocopyChecked -Source $src -Destination $dst -Arguments $mirrorArgs
}

$persistentDirs = @('static\avatars', 'static\ads')
foreach ($relativePath in $persistentDirs) {
    $src = Join-Path $sourceRoot $relativePath
    $dst = Join-Path $mirrorRoot $relativePath
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Invoke-RobocopyChecked -Source $src -Destination $dst -Arguments $treeArgs
}

Write-Host "Miroir local synchronise dans: $mirrorRoot"
Write-Host "Base SQLite conservee sur: $dbPath"

if ($SyncOnly) {
    return
}

Push-Location $mirrorRoot
try {
    $env:FS_DB_PATH = $dbPath
    $env:PYTHONDONTWRITEBYTECODE = '1'

    $uvicornArgs = @('-m', 'uvicorn', 'main:app', '--host', $ListenHost, '--port', [string]$Port)
    if ($Reload) {
        $uvicornArgs += '--reload'
    }

    Write-Host "Demarrage depuis le miroir local..."
    & $pythonExe @uvicornArgs
} finally {
    Pop-Location
}



