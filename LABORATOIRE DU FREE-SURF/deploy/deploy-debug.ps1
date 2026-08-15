param(
    [string]$RemoteUser = "root",
    [string]$RemoteHost = "146.19.230.203",
    [string]$RemotePath = "/opt/LABORATOIRE DU FREE-SURF",
    [int]$RemotePort = 22,
    [int]$AppPort = 8000,
    [switch]$DryRun,
    [switch]$VerboseReport,
    [switch]$SyncDotEnv,
    [switch]$SkipRequirements,
    [switch]$SkipAdminPasswordSync,
    [int]$HealthCheckRetries = 20,
    [int]$HealthCheckDelaySeconds = 2
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalPath = Split-Path -Parent $ScriptDir
$ArchiveName = "deploy_bundle.zip"
$ArchivePath = Join-Path $LocalPath $ArchiveName
$StagePath = Join-Path ([System.IO.Path]::GetTempPath()) ("lfs_deploy_" + [System.Guid]::NewGuid().ToString("N"))
$ReportStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportDir = Join-Path $LocalPath "deploy-reports"
$ReportPath = Join-Path $ReportDir ("deploy-report-" + $ReportStamp + ".txt")

function Get-ConfigDefault {
    param(
        [string]$Path,
        [string]$Pattern
    )

    if (!(Test-Path $Path)) {
        return ""
    }

    $raw = Get-Content $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return ""
    }
    $match = [regex]::Match($raw, $Pattern)
    if ($match.Success) {
        return $match.Groups[1].Value.Trim()
    }

    return ""
}

function New-BashLiteral {
    param([string]$Value)

    $safe = ""
    if ($null -ne $Value) {
        $safe = [string]$Value
    }

    $quoteEscape = "'" + [char]34 + "'" + [char]34 + "'"
    return "'" + $safe.Replace("'", $quoteEscape) + "'"
}

function Add-UniqueExistingPath {
    param(
        [System.Collections.Generic.List[string]]$List,
        [string]$RelativePath
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        return
    }

    $fullPath = Join-Path $LocalPath $RelativePath
    if ((Test-Path $fullPath) -and -not $List.Contains($RelativePath)) {
        [void]$List.Add($RelativePath)
    }
}

function Write-DeployReport {
    param(
        [string]$Status,
        [string]$Mode,
        [string]$Message = ""
    )

    if (-not $VerboseReport) {
        return
    }

    if (!(Test-Path $ReportDir)) {
        New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
    }

    $lines = @(
        "timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
        "status: $Status",
        "mode: $Mode",
        "target: ${RemoteUser}@${RemoteHost}:${RemotePort}",
        "remote_path: $RemotePath",
        "app_port: $AppPort",
        "sync_dotenv: $([bool]$SyncDotEnv)",
        "sync_admin_password: $([bool](-not $SkipAdminPasswordSync))",
        "reinstall_requirements: $([bool](-not $SkipRequirements))",
        "application_url: $PublicUrl",
        "technical_panel_url: $AdminUrl",
        "directories: $($ManagedDirectories -join ', ')",
        "root_files: $($ManagedRootFiles -join ', ')"
    )

    if ($Message) {
        $lines += "message: $Message"
    }

    Set-Content -Path $ReportPath -Value $lines -Encoding UTF8
    Write-Host "Rapport : $ReportPath" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== DEPLOIEMENT LABORATOIRE DU FREE-SURF ===" -ForegroundColor Cyan
Write-Host ""

if (!(Test-Path $LocalPath)) {
    Write-Host "Dossier local introuvable : $LocalPath" -ForegroundColor Red
    exit 1
}

Set-Location $LocalPath

foreach ($cmd in @("scp", "ssh")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Commande locale manquante : $cmd" -ForegroundColor Red
        exit 1
    }
}

$ConfigPath = Join-Path $LocalPath "config.py"
$PublicHost = Get-ConfigDefault -Path $ConfigPath -Pattern 'FS_WEB_PUBLIC_HOST",\s*"([^"]+)"'
$AdminHost = Get-ConfigDefault -Path $ConfigPath -Pattern 'FS_PANEL_ADMIN_HOST",\s*"([^"]+)"'
$PublicUrl = if ($PublicHost) { "https://$PublicHost" } else { "" }
$AdminUrl = if ($AdminHost) { "https://$AdminHost" } else { "" }

$ManagedDirectories = New-Object 'System.Collections.Generic.List[string]'
foreach ($dir in @("app", "static", "templates", "scripts")) {
    if (Test-Path (Join-Path $LocalPath $dir)) {
        [void]$ManagedDirectories.Add($dir)
    }
}

$ManagedRootFiles = New-Object 'System.Collections.Generic.List[string]'
Get-ChildItem -Path $LocalPath -File -Filter *.py |
    Where-Object { $_.Name -notmatch '^test_' -and $_.Name -ne 'deploy.ps1' } |
    Sort-Object Name |
    ForEach-Object { Add-UniqueExistingPath -List $ManagedRootFiles -RelativePath $_.Name }

foreach ($name in @("requirements.txt", "gcp_cidrs.json", "zero_rating_services.json")) {
    Add-UniqueExistingPath -List $ManagedRootFiles -RelativePath $name
}

if ($SyncDotEnv) {
    Add-UniqueExistingPath -List $ManagedRootFiles -RelativePath ".env"
}

if (-not $SkipAdminPasswordSync) {
    Add-UniqueExistingPath -List $ManagedRootFiles -RelativePath ".admin_password"
}

if ($ManagedDirectories.Count -eq 0 -and $ManagedRootFiles.Count -eq 0) {
    Write-Host "Aucun element runtime a deployer." -ForegroundColor Red
    exit 1
}

if ($DryRun) {
    Write-Host "DRY RUN - aucun envoi ni redemarrage ne sera execute." -ForegroundColor Yellow
    Write-Host "Cible VPS : ${RemoteUser}@${RemoteHost}:${RemotePort}" -ForegroundColor DarkGray
    Write-Host "Dossier distant : $RemotePath" -ForegroundColor DarkGray
    Write-Host "Port application : $AppPort" -ForegroundColor DarkGray
    Write-Host "Dossiers sync : $($ManagedDirectories -join ', ')" -ForegroundColor DarkGray
    Write-Host "Fichiers racine sync : $($ManagedRootFiles -join ', ')" -ForegroundColor DarkGray
    Write-Host "Sync .env : $([bool]$SyncDotEnv)" -ForegroundColor DarkGray
    Write-Host "Sync .admin_password : $([bool](-not $SkipAdminPasswordSync))" -ForegroundColor DarkGray
    Write-Host "Reinstall requirements : $([bool](-not $SkipRequirements))" -ForegroundColor DarkGray
    if ($PublicUrl) {
        Write-Host "URL application / APK : $PublicUrl" -ForegroundColor DarkGray
    }
    if ($AdminUrl) {
        Write-Host "URL panel technique / Remnawave : $AdminUrl" -ForegroundColor DarkGray
    }
    Write-DeployReport -Status "preview" -Mode "dry-run" -Message "Aucun envoi effectue."
    exit 0
}

try {
    Write-Host "1/5 - Preparation du bundle..." -ForegroundColor Yellow

    if (Test-Path $ArchivePath) {
        Remove-Item $ArchivePath -Force
    }

    if (Test-Path $StagePath) {
        Remove-Item $StagePath -Recurse -Force
    }

    New-Item -ItemType Directory -Path $StagePath | Out-Null

    foreach ($dir in $ManagedDirectories) {
        Copy-Item -Path (Join-Path $LocalPath $dir) -Destination (Join-Path $StagePath $dir) -Recurse -Force
    }

    foreach ($file in $ManagedRootFiles) {
        Copy-Item -Path (Join-Path $LocalPath $file) -Destination (Join-Path $StagePath $file) -Force
    }

    $ManifestPath = Join-Path $StagePath ".deploy_root_files.txt"
    $ManifestContent = if ($ManagedRootFiles.Count -gt 0) {
        ($ManagedRootFiles -join "`n") + "`n"
    } else {
        ""
    }
    [System.IO.File]::WriteAllText($ManifestPath, $ManifestContent, (New-Object System.Text.UTF8Encoding($false)))

    $StageItems = @(Get-ChildItem -Path $StagePath -Force | ForEach-Object { $_.FullName })
    if ($StageItems.Count -eq 0) {
        throw "Le bundle de deploiement est vide."
    }

    Compress-Archive -Path $StageItems -DestinationPath $ArchivePath -Force

    Write-Host "   Dossiers sync : $($ManagedDirectories -join ', ')" -ForegroundColor DarkGray
    Write-Host "   Fichiers racine sync : $($ManagedRootFiles -join ', ')" -ForegroundColor DarkGray
    Write-Host "   Sync .env : $([bool]$SyncDotEnv)" -ForegroundColor DarkGray
    Write-Host "   Sync .admin_password : $([bool](-not $SkipAdminPasswordSync))" -ForegroundColor DarkGray

    Write-Host "2/5 - Envoi vers le VPS..." -ForegroundColor Yellow

    $ScpArgs = @("-P", $RemotePort.ToString(), "-o", "StrictHostKeyChecking=accept-new")
    Write-Host "skip scp"
    $global:LASTEXITCODE = 0
    if ($LASTEXITCODE -ne 0) {
        throw "Echec de l'envoi SCP."
    }

    Write-Host "3/5 - Synchronisation et relance sur le VPS..." -ForegroundColor Yellow

    $InstallRequirementsFlag = if ($SkipRequirements) { "0" } else { "1" }

    $RemoteTemplate = @(
        'set -euo pipefail',
        '',
        'REMOTE_PATH=__REMOTE_PATH__',
        'ARCHIVE_NAME=__ARCHIVE_NAME__',
        'APP_PORT=__APP_PORT__',
        'PUBLIC_URL=__PUBLIC_URL__',
        'ADMIN_URL=__ADMIN_URL__',
        'INSTALL_REQUIREMENTS=__INSTALL_REQUIREMENTS__',
        'HEALTH_RETRIES=__HEALTH_RETRIES__',
        'HEALTH_DELAY=__HEALTH_DELAY__',
        '',
        'require_cmd() {',
        '  command -v "$1" >/dev/null 2>&1 || {',
        '    echo "Commande requise absente sur le VPS: $1" >&2',
        '    exit 1',
        '  }',
        '}',
        '',
        'for cmd in python3 curl pkill; do',
        '  require_cmd "$cmd"',
        'done',
        '',
        'TMP_DIR="$(mktemp -d /tmp/lfs_deploy_XXXXXX)"',
        'cleanup() {',
        '  rm -rf "$TMP_DIR"',
        '}',
        'trap cleanup EXIT',
        '',
        'mkdir -p "$REMOTE_PATH"',
        'if command -v unzip >/dev/null 2>&1; then',
        '  unzip -o "/tmp/$ARCHIVE_NAME" -d "$TMP_DIR" >/dev/null',
        'else',
        '  python3 - "/tmp/$ARCHIVE_NAME" "$TMP_DIR" <<''PY''',
        'import os',
        'import shutil',
        'import sys',
        'import zipfile',
        '',
        'archive_path, target_dir = sys.argv[1], sys.argv[2]',
        'target_dir = os.path.abspath(target_dir)',
        '',
        'with zipfile.ZipFile(archive_path) as zf:',
        '    for info in zf.infolist():',
        '        name = info.filename.replace("\\", "/").lstrip("/")',
        '        if not name:',
        '            continue',
        '        destination = os.path.abspath(os.path.normpath(os.path.join(target_dir, name)))',
        '        if destination != target_dir and not destination.startswith(target_dir + os.sep):',
        '            raise RuntimeError(f"Unsafe archive entry: {info.filename}")',
        '        if info.is_dir() or name.endswith("/"):',
        '            os.makedirs(destination, exist_ok=True)',
        '            continue',
        '        os.makedirs(os.path.dirname(destination), exist_ok=True)',
        '        with zf.open(info, "r") as src, open(destination, "wb") as dst:',
        '            shutil.copyfileobj(src, dst)',
        'PY',
        'fi',
        'rm -f "/tmp/$ARCHIVE_NAME"',
        '',
        'for dir in app static templates scripts; do',
        '  rm -rf "$REMOTE_PATH/$dir"',
        '  if [ -e "$TMP_DIR/$dir" ]; then',
        '    cp -a "$TMP_DIR/$dir" "$REMOTE_PATH/"',
        '  fi',
        'done',
        '',
        'OLD_MANIFEST="$REMOTE_PATH/.deploy_root_files.txt"',
        'NEW_MANIFEST="$TMP_DIR/.deploy_root_files.txt"',
        '',
        'if [ -f "$OLD_MANIFEST" ]; then',
        '  while IFS= read -r rel || [ -n "$rel" ]; do',
        '    rel="${rel%$''\r''}"',
        '    [ -n "$rel" ] || continue',
        '    if [ ! -f "$NEW_MANIFEST" ] || ! grep -Fxq "$rel" "$NEW_MANIFEST"; then',
        '      rm -f "$REMOTE_PATH/$rel"',
        '    fi',
        '  done < "$OLD_MANIFEST"',
        'fi',
        '',
        'if [ -f "$NEW_MANIFEST" ]; then',
        '  while IFS= read -r rel || [ -n "$rel" ]; do',
        '    rel="${rel%$''\r''}"',
        '    [ -n "$rel" ] || continue',
        '    cp -f "$TMP_DIR/$rel" "$REMOTE_PATH/$rel"',
        '  done < "$NEW_MANIFEST"',
        '  cp -f "$NEW_MANIFEST" "$OLD_MANIFEST"',
        'fi',
        '',
        'if [ -d "$REMOTE_PATH/scripts" ]; then',
        '  chmod +x "$REMOTE_PATH"/scripts/*.sh 2>/dev/null || true',
        'fi',
        '',
        'if [ ! -x "$REMOTE_PATH/.venv/bin/python" ]; then',
        '  python3 -m venv "$REMOTE_PATH/.venv"',
        'fi',
        '',
        'cd "$REMOTE_PATH"',
        '. .venv/bin/activate',
        '',
        'SHOULD_INSTALL=0',
        'if [ "$INSTALL_REQUIREMENTS" = "1" ] && [ -f requirements.txt ]; then',
        '  if ! command -v sha256sum >/dev/null 2>&1; then',
        '    SHOULD_INSTALL=1',
        '  else',
        '    REQ_HASH="$(sha256sum requirements.txt | awk ''{print $1}'')"',
        '    PREV_HASH="$(cat .requirements.sha256 2>/dev/null || true)"',
        '    if [ "$REQ_HASH" != "$PREV_HASH" ]; then',
        '      SHOULD_INSTALL=1',
        '    fi',
        '  fi',
        'fi',
        '',
        'if [ "$SHOULD_INSTALL" = "1" ]; then',
        '  python -m pip install --upgrade pip',
        '  python -m pip install -r requirements.txt',
        '  if command -v sha256sum >/dev/null 2>&1; then',
        '    printf ''%s'' "$REQ_HASH" > .requirements.sha256',
        '  fi',
        'fi',
        '',
        'export PYTHONPATH="$(pwd)"',
        '',
        'if [ -f uvicorn.pid ]; then',
        '  OLD_PID="$(cat uvicorn.pid 2>/dev/null || true)"',
        '  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then',
        '    kill "$OLD_PID" 2>/dev/null || true',
        '  fi',
        'fi',
        '',
        'pkill -f ''uvicorn main:app'' || true',
        'sleep 1',
        '',
        'nohup .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port "$APP_PORT" > uvicorn.log 2>&1 &',
        'NEW_PID=$!',
        'printf ''%s'' "$NEW_PID" > uvicorn.pid',
        '',
        'READY=0',
        'for attempt in $(seq 1 "$HEALTH_RETRIES"); do',
        '  if curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then',
        '    READY=1',
        '    break',
        '  fi',
        '  sleep "$HEALTH_DELAY"',
        'done',
        '',
        'if [ "$READY" != "1" ]; then',
        '  echo "--- ECHEC HEALTHCHECK LOCAL ---"',
        '  tail -n 60 uvicorn.log || true',
        '  exit 1',
        'fi',
        '',
        'echo "--- PORT $APP_PORT ---"',
        'if command -v ss >/dev/null 2>&1; then',
        '  ss -tulpen | grep "$APP_PORT" || true',
        'else',
        '  netstat -tulpen 2>/dev/null | grep "$APP_PORT" || true',
        'fi',
        '',
        'echo "--- DERNIERES LIGNES LOG ---"',
        'tail -n 20 uvicorn.log || true',
        '',
        'if [ -n "$PUBLIC_URL" ]; then',
        '  echo "--- APPLICATION WEB / APK ---"',
        '  echo "$PUBLIC_URL"',
        '  if curl -kLfsS -o /dev/null "$PUBLIC_URL"; then',
        '    echo "WEB CHECK: OK"',
        '  else',
        '    echo "WEB CHECK: WARNING"',
        '  fi',
        'fi',
        '',
        'if [ -n "$ADMIN_URL" ]; then',
        '  echo "--- PANEL TECHNIQUE / REMNAWAVE ---"',
        '  echo "$ADMIN_URL"',
        '  if curl -kLfsS -o /dev/null "$ADMIN_URL"; then',
        '    echo "ADMIN CHECK: OK"',
        '  else',
        '    echo "ADMIN CHECK: WARNING"',
        '  fi',
        'fi'
    ) -join "`n"

    $RemoteReplacements = @{
        "__REMOTE_PATH__" = New-BashLiteral -Value $RemotePath
        "__ARCHIVE_NAME__" = New-BashLiteral -Value $ArchiveName
        "__APP_PORT__" = $AppPort.ToString()
        "__PUBLIC_URL__" = New-BashLiteral -Value $PublicUrl
        "__ADMIN_URL__" = New-BashLiteral -Value $AdminUrl
        "__INSTALL_REQUIREMENTS__" = New-BashLiteral -Value $InstallRequirementsFlag
        "__HEALTH_RETRIES__" = $HealthCheckRetries.ToString()
        "__HEALTH_DELAY__" = $HealthCheckDelaySeconds.ToString()
    }

    $RemoteCommand = $RemoteTemplate
    foreach ($key in $RemoteReplacements.Keys) {
        $RemoteCommand = $RemoteCommand.Replace($key, $RemoteReplacements[$key])
    }

    $SshArgs = @("-p", $RemotePort.ToString(), "-o", "StrictHostKeyChecking=accept-new")
    [System.IO.File]::WriteAllText("G:\Mon Drive\PROJETS\LABORATOIRE DU FREE-SURF\remote-command-debug.sh", $RemoteCommand + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Dumped: G:\Mon Drive\PROJETS\LABORATOIRE DU FREE-SURF\remote-command-debug.sh"
    $global:LASTEXITCODE = 0
    if ($LASTEXITCODE -ne 0) {
        throw "Echec du script distant."
    }

    Write-Host "4/5 - Nettoyage local..." -ForegroundColor Yellow
    if (Test-Path $ArchivePath) {
        Remove-Item $ArchivePath -Force
    }

    Write-Host ""
    Write-Host "5/5 - Deploiement termine." -ForegroundColor Green
    Write-Host "Teste maintenant :" -ForegroundColor Cyan
    if ($PublicUrl) {
        Write-Host $PublicUrl -ForegroundColor White
    }
    if ($AdminUrl) {
        Write-Host $AdminUrl -ForegroundColor White
    }
    Write-Host "http://$RemoteHost`:$AppPort" -ForegroundColor White
    Write-Host ""
    Write-DeployReport -Status "success" -Mode "deploy" -Message "Deploiement termine avec healthcheck local OK."
}
catch {
    Write-DeployReport -Status "error" -Mode "deploy" -Message $_.Exception.Message
    throw
}
finally {
    if (Test-Path $StagePath) {
        Remove-Item $StagePath -Recurse -Force
    }
}


