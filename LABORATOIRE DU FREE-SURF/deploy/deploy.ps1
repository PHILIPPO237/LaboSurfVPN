param(
    [string]$RemoteHost = "146.19.230.203",
    [string]$RemoteUser = "root",
    [int]$RemotePort = 22,
    [string]$RemotePath = "/opt/LABORATOIRE DU FREE-SURF",
    [int]$AppPort = 8000,
    [string]$AppHost = "127.0.0.1",
    [string]$FsEnv = "production",
    [string]$ServiceName = "laboratoire-free-surf",
    [string]$PublicUrl = "",
    [string]$AdminUrl = "",
    [switch]$NoSystemd,
    [switch]$SkipRequirements
)

$LocalPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$TempZip = "$env:TEMP\deploy.zip"

function Escape-ShellValue {
    param([string]$Value)
    $quoteBreak = "'" + [char]34 + "'" + [char]34 + "'"
    return "'" + $Value.Replace("'", $quoteBreak) + "'"
}

$PythonCode = @"
import os
import zipfile


def make_zip(src, dst):
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d not in ['.git', '__pycache__', '.venv_local', 'deploy-reports', '.venv', 'node_modules']]
            for file_name in files:
                if file_name in ['deploy.ps1', 'deploy.py', 'deploy_robust.py', 'deploy_remote.sh', '.admin_password', '.env']:
                    continue
                if file_name.startswith('test_'):
                    continue
                path = os.path.join(root, file_name)
                arcname = os.path.relpath(path, src).replace('\\', '/')
                archive.write(path, arcname)

make_zip(r'$LocalPath', r'$TempZip')
print('OK')
"@

$InstallRequirements = if ($SkipRequirements) { '0' } else { '1' }
$UseSystemd = if ($NoSystemd) { '0' } else { '1' }

$RemoteVars = [ordered]@{
    REMOTE_PATH = $RemotePath
    ARCHIVE_PATH = '/tmp/lfs_deploy.zip'
    APP_PORT = [string]$AppPort
    APP_HOST = $AppHost
    FS_ENV = $FsEnv
    SERVICE_NAME = $ServiceName
    PUBLIC_URL = $PublicUrl
    ADMIN_URL = $AdminUrl
    INSTALL_REQUIREMENTS = $InstallRequirements
    USE_SYSTEMD = $UseSystemd
}

$RemoteEnv = ($RemoteVars.GetEnumerator() | ForEach-Object {
    '{0}={1}' -f $_.Key, (Escape-ShellValue ([string]$_.Value))
}) -join ' '
$RemoteCommand = "$RemoteEnv bash /tmp/deploy.sh"

Write-Host "1/3 Creating ZIP..." -ForegroundColor Yellow
python -c $PythonCode | Out-Null
Write-Host "  ZIP ready"

Write-Host "2/3 Uploading..." -ForegroundColor Yellow
& scp -P $RemotePort -o StrictHostKeyChecking=accept-new $TempZip "$RemoteUser@$RemoteHost`:/tmp/lfs_deploy.zip"
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nFAILED upload ZIP" -ForegroundColor Red
    exit 1
}

Write-Host "3/3 Deploying..." -ForegroundColor Yellow
& scp -P $RemotePort -o StrictHostKeyChecking=accept-new (Join-Path $LocalPath 'deploy_remote.sh') "$RemoteUser@$RemoteHost`:/tmp/deploy.sh"
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nFAILED upload deploy script" -ForegroundColor Red
    exit 1
}

& ssh -p $RemotePort -o StrictHostKeyChecking=accept-new "$RemoteUser@$RemoteHost" $RemoteCommand
if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSUCCESS" -ForegroundColor Green
}
else {
    Write-Host "`nFAILED" -ForegroundColor Red
    exit 1
}

Remove-Item $TempZip -Force -EA 0
