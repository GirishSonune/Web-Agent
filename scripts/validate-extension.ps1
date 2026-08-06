$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"

if (!(Test-Path $manifestPath)) {
  throw "manifest.json not found"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

if ($manifest.manifest_version -ne 3) {
  throw "Expected manifest_version 3"
}

$requiredFiles = @(
  "src/background/service-worker.js",
  "src/content/content.js",
  "src/popup/popup.html",
  "src/options/options.html",
  "src/voice/voice.html",
  "src/voice/voice.js",
  "node_modules/@huggingface/transformers/dist/transformers.web.js",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"
)

foreach ($file in $requiredFiles) {
  $path = Join-Path $root $file
  if (!(Test-Path $path)) {
    throw "Missing required file: $file"
  }
}

Write-Host "Extension structure looks valid."
