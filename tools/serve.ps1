# Petit serveur local pour tester l'appli sans Node : http://localhost:8080/
# Usage : powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8080]
param([int]$Port = 8080)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\app')).Path
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml'; '.woff2'='font/woff2'; '.json'='application/json' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Mon régime : http://localhost:$Port/  (Ctrl+C pour arrêter)"
try {
  while ($l.IsListening) {
    $c = $l.GetContext()
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/')
    if ($p -eq '') { $p = 'index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $root $p))
    if ($f.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -and (Test-Path $f -PathType Leaf)) {
      $b = [IO.File]::ReadAllBytes($f)
      $t = $types[[IO.Path]::GetExtension($f)]; if (-not $t) { $t = 'application/octet-stream' }
      $c.Response.ContentType = $t
      $c.Response.Headers.Add('Cache-Control', 'no-cache')
      $c.Response.ContentLength64 = $b.Length
      try { $c.Response.OutputStream.Write($b, 0, $b.Length) } catch { }
    } else { $c.Response.StatusCode = 404 }
    try { $c.Response.Close() } catch { }
  }
} finally { $l.Stop() }
