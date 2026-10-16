$ErrorActionPreference='Stop'
$testRoot=Join-Path $PSScriptRoot ('verification-save\test-'+[guid]::NewGuid().ToString('N'))
$source=Join-Path $testRoot 'source\20260101-000000'
New-Item -ItemType Directory -Path $source -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $source 'snapshot.usvx'),'fixture save bytes')
$metadata=Join-Path $testRoot 'metadata.json'
@{title='Custom save';map='AnotherCity';gameVersion=1;characters=@(@{id=9001;household=10;name='Host'},@{id=9002;household=20;name='Guest'})} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadata -Encoding UTF8
$share=Join-Path $testRoot 'share'
& (Join-Path $PSScriptRoot 'prepare-save.ps1') -SaveRoot (Join-Path $testRoot 'source') -Folder '20260101-000000' -File 'snapshot' -Metadata $metadata -ShareRoot $share | Out-Null
$prepared=Get-Content -LiteralPath (Join-Path $share 'save-info.json') -Raw|ConvertFrom-Json
if($prepared.map -ne 'AnotherCity' -or $prepared.characters[1].id -ne 9002){throw 'Snapshot metadata was hardcoded'}
$archive=Join-Path $testRoot 'save.zip'
Compress-Archive -LiteralPath $source -DestinationPath $archive
$hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$target=Join-Path $testRoot 'installed'
& (Join-Path $PSScriptRoot 'install-save.ps1') -Archive $archive -ExpectedSha256 $hash -SaveRoot $target -DestinationFolder '20260102-000000' | Out-Null
if ([IO.File]::ReadAllText((Join-Path $target '20260102-000000\snapshot.usvx')) -ne 'fixture save bytes') {throw 'Extraction failed'}
$refused=$false
try { & (Join-Path $PSScriptRoot 'install-save.ps1') -Archive $archive -ExpectedSha256 $hash -SaveRoot $target -DestinationFolder '20260102-000000' | Out-Null } catch {$refused=$true}
if(-not $refused){throw 'Existing save was not protected'}
$refused=$false
try { & (Join-Path $PSScriptRoot 'install-save.ps1') -Archive $archive -ExpectedSha256 ('0'*64) -SaveRoot $target | Out-Null } catch {$refused=$true}
if(-not $refused){throw 'Bad checksum was accepted'}
$bad=Join-Path $testRoot 'bad.zip'
$zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Create)
$entry=$zip.CreateEntry('20260101-000000/../../outside.txt');$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write('unsafe');$writer.Dispose();$zip.Dispose()
$refused=$false
try { & (Join-Path $PSScriptRoot 'install-save.ps1') -Archive $bad -ExpectedSha256 (Get-FileHash -LiteralPath $bad).Hash -SaveRoot $target | Out-Null } catch {$refused=$true}
if(-not $refused){throw 'Traversal archive was accepted'}
Write-Output 'PASS: install to separate folder, existing save protection, checksum, ZIP traversal'
