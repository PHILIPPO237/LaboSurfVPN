# fix-deploy.ps1 - Auto-correction de deploy.ps1 (Python 2 -> Python 3)
# Exécutez: .\fix-deploy.ps1

$ErrorActionPreference = "Stop"
$deployFile = Join-Path $PSScriptRoot "templates\deploy.ps1"

if (!(Test-Path $deployFile)) {
    Write-Host "❌ Erreur: $deployFile non trouvé" -ForegroundColor Red
    exit 1
}

Write-Host "📝 Lecture du fichier..." -ForegroundColor Cyan
$content = Get-Content $deployFile -Raw

Write-Host "🔧 Application des corrections..." -ForegroundColor Yellow

# Correction 1: pip upgrade
$before1 = "'  python -m pip install --upgrade pip',"
$after1 = "'  python3 -m pip install --upgrade pip',"
$content = $content.Replace($before1, $after1)
Write-Host "   ✓ Correction 1/3: python → python3 (pip upgrade)" -ForegroundColor DarkGray

# Correction 2: pip install requirements
$before2 = "'  python -m pip install -r requirements.txt',"
$after2 = "'  python3 -m pip install -r requirements.txt',"
$content = $content.Replace($before2, $after2)
Write-Host "   ✓ Correction 2/3: python → python3 (pip requirements)" -ForegroundColor DarkGray

# Correction 3: uvicorn launch
$before3 = "'nohup .venv/bin/python -m uvicorn main:app"
$after3 = "'nohup .venv/bin/python3 -m uvicorn main:app"
$content = $content.Replace($before3, $after3)
Write-Host "   ✓ Correction 3/3: python → python3 (uvicorn launch)" -ForegroundColor DarkGray

Write-Host "💾 Sauvegarde..." -ForegroundColor Yellow
Set-Content -Path $deployFile -Value $content -Encoding UTF8

Write-Host ""
Write-Host "✅ Fichier corrigé avec succès!" -ForegroundColor Green
Write-Host "   Fichier: $deployFile" -ForegroundColor DarkGray
Write-Host ""