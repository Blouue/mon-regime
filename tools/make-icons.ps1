# Génère les icônes de l'appli : fond dégradé tomate → rose, anneau blanc (comme l'anneau des calories), cœur au centre.
# Usage : powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\app\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$file, [double]$inset) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $c1 = [System.Drawing.ColorTranslator]::FromHtml('#ff7a45')   # tomate clair
  $c2 = [System.Drawing.ColorTranslator]::FromHtml('#e8417f')   # rose
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45.0
  $g.FillRectangle($bg, $rect)
  # Halo doux en haut à gauche
  $halo = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(22, 255, 255, 255))
  $g.FillEllipse($halo, [single](-$size * 0.25), [single](-$size * 0.25), [single]($size * 0.9), [single]($size * 0.9))

  # Zone utile (marge pour les icônes « maskable » qu'Android rogne en cercle)
  $s = $size * (1 - 2 * $inset); $o = $size * $inset
  $cx = $o + $s / 2; $cy = $o + $s / 2
  $r = $s * 0.30; $w = [single]($s * 0.085)
  $box = New-Object System.Drawing.RectangleF ([single]($cx - $r)), ([single]($cy - $r)), ([single](2 * $r)), ([single](2 * $r))
  # Piste de l'anneau, puis arc de progression (270°), bouts arrondis
  $trk = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), $w
  $g.DrawEllipse($trk, $box)
  $arc = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $w
  $arc.StartCap = 'Round'; $arc.EndCap = 'Round'
  $g.DrawArc($arc, $box, -90, 270)

  # Cœur blanc au centre
  $h = $r * 0.95
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $top = $cy - $h * 0.28
  $p.AddBezier([single]$cx, [single]($top + $h * 0.12), [single]($cx - $h * 0.05), [single]($top - $h * 0.22), [single]($cx - $h * 0.62), [single]($top - $h * 0.22), [single]($cx - $h * 0.6), [single]($top + $h * 0.2))
  $p.AddBezier([single]($cx - $h * 0.6), [single]($top + $h * 0.2), [single]($cx - $h * 0.58), [single]($top + $h * 0.52), [single]($cx - $h * 0.2), [single]($top + $h * 0.75), [single]$cx, [single]($top + $h * 0.95))
  $p.AddBezier([single]$cx, [single]($top + $h * 0.95), [single]($cx + $h * 0.2), [single]($top + $h * 0.75), [single]($cx + $h * 0.58), [single]($top + $h * 0.52), [single]($cx + $h * 0.6), [single]($top + $h * 0.2))
  $p.AddBezier([single]($cx + $h * 0.6), [single]($top + $h * 0.2), [single]($cx + $h * 0.62), [single]($top - $h * 0.22), [single]($cx + $h * 0.05), [single]($top - $h * 0.22), [single]$cx, [single]($top + $h * 0.12))
  $p.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), $p)

  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 'icon-192.png' 0
New-Icon 512 'icon-512.png' 0
New-Icon 512 'icon-maskable-512.png' 0.1
New-Icon 180 'apple-touch-icon.png' 0
Get-ChildItem $out | Select-Object Name, Length

