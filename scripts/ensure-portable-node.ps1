# Downloads the pinned Windows Node.js zip into .cache\portable-node when this PC has no Node 22+.
# Called by 下载素材.bat. Official nodejs.org first, then the npmmirror copy. The zip is checked
# against the same sha256 as scripts/make-windows-bundle.mjs (NODE_PIN).
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Version = 'v22.23.3'
$Folder = "node-$Version-win-x64"
$ZipName = "$Folder.zip"
$Sha256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
$Root = Split-Path -Parent $PSScriptRoot
$Cache = Join-Path $Root '.cache'
$Dest = Join-Path $Cache 'portable-node'
$NodeExe = Join-Path $Dest 'node.exe'

function Test-Node22([string]$Exe) {
  if (-not (Test-Path -LiteralPath $Exe)) { return $false }
  $ver = & $Exe -p "process.versions.node" 2>$null
  if (-not $ver) { return $false }
  $major = [int]($ver.Split('.')[0])
  return $major -ge 22
}

if (Test-Node22 $NodeExe) { exit 0 }

New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$Zip = Join-Path $Cache $ZipName
$Urls = @(
  "https://nodejs.org/dist/$Version/$ZipName",
  "https://npmmirror.com/mirrors/node/$Version/$ZipName"
)

$savedTitle = $Host.UI.RawUI.WindowTitle
$Host.UI.RawUI.WindowTitle = '卫戍协议 - 正在下载 Node.js（约 30 MB，只需一次）'
Write-Host ''
Write-Host '正在下载 Node.js 运行环境（约 30 MB，只需一次）。下面的进度条走完才会开始下载游戏素材。'
Write-Host ''

$got = $false
foreach ($url in $Urls) {
  Write-Host "来源：$url"
  if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
  & curl.exe -L --fail --retry 2 --progress-bar -o $Zip $url
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Zip)) {
    Write-Host '这个地址失败，换下一个。'
    continue
  }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Zip).Hash.ToLower()
  if ($hash -ne $Sha256) {
    Write-Host "校验不对（得到 $hash），不使用这个文件。"
    Remove-Item -LiteralPath $Zip -Force
    continue
  }
  $got = $true
  break
}

if (-not $got) {
  Write-Host 'Node.js 下载失败。请检查网络后再双击「下载素材.bat」。'
  exit 1
}

Write-Host '正在解压…'
$extract = Join-Path $Cache 'portable-node-extract'
if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
New-Item -ItemType Directory -Force -Path $extract | Out-Null
& tar.exe -xf $Zip -C $extract
if ($LASTEXITCODE -ne 0) {
  Write-Host '解压失败。'
  exit 1
}
$unpacked = Join-Path $extract $Folder
if (-not (Test-Path -LiteralPath (Join-Path $unpacked 'node.exe'))) {
  Write-Host '压缩包里没有 node.exe。'
  exit 1
}
if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
Move-Item -LiteralPath $unpacked -Destination $Dest
Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue

if (-not (Test-Node22 $NodeExe)) {
  Write-Host '解压后的 Node.js 无法运行。'
  exit 1
}
$Host.UI.RawUI.WindowTitle = $savedTitle
Write-Host 'Node.js 已准备好。'
exit 0
