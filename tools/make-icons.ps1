# Génère les icônes de l'appli (étiquette nutritionnelle : papier, filets noirs, chiffre tomate).
# Usage : powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\app\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$file, [double]$inset) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $paper = [System.Drawing.ColorTranslator]::FromHtml('#fffdf8')
  $ink = [System.Drawing.ColorTranslator]::FromHtml('#161616')
  $tom = [System.Drawing.ColorTranslator]::FromHtml('#d8401f')
  $g.Clear($paper)
  $s = $size * (1 - 2 * $inset); $o = $size * $inset   # zone utile (marge pour les icônes « maskable »)
  $pen = New-Object System.Drawing.Pen $ink, ([single]($s * 0.06))
  $pad = $s * 0.12
  $g.DrawRectangle($pen, [single]($o + $pad), [single]($o + $pad), [single]($s - 2 * $pad), [single]($s - 2 * $pad))
  $inkB = New-Object System.Drawing.SolidBrush $ink
  $tomB = New-Object System.Drawing.SolidBrush $tom
  # Filet épais sous le titre
  $g.FillRectangle($inkB, [single]($o + $pad * 1.6), [single]($o + $s * 0.38), [single]($s - 3.2 * $pad), [single]($s * 0.05))
  # Titre « kcal »
  $f1 = New-Object System.Drawing.Font 'Arial Black', ([single]($s * 0.13)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString('kcal', $f1, $inkB, [single]($o + $pad * 1.55), [single]($o + $s * 0.2))
  # Barres de macros
  $y = $o + $s * 0.5
  foreach ($w in 0.62, 0.45, 0.3) {
    $g.FillRectangle($tomB, [single]($o + $pad * 1.6), [single]$y, [single](($s - 3.2 * $pad) * $w), [single]($s * 0.07))
    $y += $s * 0.11
  }
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 'icon-192.png' 0
New-Icon 512 'icon-512.png' 0
New-Icon 512 'icon-maskable-512.png' 0.1
New-Icon 180 'apple-touch-icon.png' 0.04
Get-ChildItem $out | Select-Object Name, Length
