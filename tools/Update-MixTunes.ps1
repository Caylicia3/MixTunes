[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$PackagePath,
    [string]$ExpectedSha256,
    [string]$BackupDirectory,
    [switch]$NoOpenFolder
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$targetPath = Join-Path $installRoot 'MixTunes.exe'
$manifestPath = Join-Path $installRoot 'MixTunes-installed.json'
$legacyTargetPath = Join-Path $installRoot 'MixLink.exe'
$legacyManifestPath = Join-Path $installRoot 'MixLink-installed.json'
$stagePath = Join-Path $installRoot ('.MixTunes-update-' + [guid]::NewGuid().ToString('N') + '.tmp')
$manifestStagePath = Join-Path $installRoot ('.MixTunes-manifest-' + [guid]::NewGuid().ToString('N') + '.tmp')

function Assert-InstallFile([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($full), $installRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to change a file outside the player folder: $full"
    }
    $name = [IO.Path]::GetFileName($full)
    if ($name -notin @('MixTunes.exe', 'MixTunes-installed.json', 'MixLink.exe', 'MixLink-installed.json') -and
        $name -notmatch '^(MixTunes|MixLink)-\d+\.\d+\.\d+-win-x64\.exe$' -and
        $full -ne $stagePath -and $full -ne $manifestStagePath) {
        throw "Refusing to change an unrelated file: $full"
    }
    if (Test-Path -LiteralPath $full) {
        $item = Get-Item -LiteralPath $full -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to change a directory or symbolic link: $full"
        }
    }
    return $full
}

function Read-InstalledManifest([string]$Path) {
    $checked = Assert-InstallFile $Path
    if (-not (Test-Path -LiteralPath $checked -PathType Leaf)) { return $null }
    try {
        $data = Get-Content -Raw -LiteralPath $checked -Encoding UTF8 | ConvertFrom-Json
        if (-not $data -or $data.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installed version.' }
        return [pscustomobject]@{ Data = $data; Version = [version]$data.version; Path = $checked }
    } catch { throw "Invalid installed manifest: $checked. $($_.Exception.Message)" }
}

function Assert-PlayerStopped {
    # Block both brands, including helper processes and versioned launch files.
    # No process is terminated by this updater.
    $filter = "Name = 'MixTunes.exe' OR Name = 'MixLink.exe' OR Name LIKE 'MixTunes-%-win-x64.exe' OR Name LIKE 'MixLink-%-win-x64.exe'"
    $running = @(Get-CimInstance -ClassName Win32_Process -Filter $filter)
    if ($running.Count -gt 0) {
        throw 'MixTunes or MixLink is running. Exit the player, then run this updater again. No process was stopped.'
    }
}

function Open-PlayerFolder {
    if (-not $NoOpenFolder -and $PSCmdlet.ShouldProcess($installRoot, 'Open player folder')) {
        try { Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('/select,"{0}"' -f $targetPath) }
        catch { Write-Warning "Update succeeded, but Explorer could not open. Folder: $installRoot" }
    }
}

function Copy-VerifiedFile([string]$From, [string]$To) {
    Copy-Item -LiteralPath $From -Destination $To -Force
    if ((Get-FileHash -LiteralPath $From -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $To -Algorithm SHA256).Hash) {
        throw "Copy verification failed: $To"
    }
}

$targetPath = Assert-InstallFile $targetPath
$manifestPath = Assert-InstallFile $manifestPath
$legacyTargetPath = Assert-InstallFile $legacyTargetPath
$legacyManifestPath = Assert-InstallFile $legacyManifestPath
$stagePath = Assert-InstallFile $stagePath
$manifestStagePath = Assert-InstallFile $manifestStagePath
$installed = Read-InstalledManifest $manifestPath
$legacyInstalled = Read-InstalledManifest $legacyManifestPath
$installedRecords = @(@($installed, $legacyInstalled) | Where-Object { $null -ne $_ } | Sort-Object Version -Descending)

if (-not $PackagePath) {
    $candidates = @(Get-ChildItem -LiteralPath $installRoot -File | ForEach-Object {
        if ($_.Name -match '^MixTunes-(\d+\.\d+\.\d+)-win-x64\.exe$') {
            [pscustomobject]@{ File = $_; Version = [version]$Matches[1] }
        }
    } | Sort-Object Version -Descending)
    if ($candidates.Count -gt 0) { $PackagePath = $candidates[0].File.FullName }
}

if (-not $PackagePath) {
    if ($installed -and (Test-Path -LiteralPath $targetPath -PathType Leaf) -and
        (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -eq $installed.Data.sha256 -and
        ($installedRecords.Count -eq 0 -or $installed.Version -ge $installedRecords[0].Version)) {
        Assert-PlayerStopped
        Write-Host "MixTunes $($installed.Data.version) is already installed: $targetPath"
        Open-PlayerFolder
        return
    }
    throw 'Put the new MixTunes-x.y.z-win-x64.exe and matching MixTunes-x.y.z-SHA256.txt beside this script.'
}

# An explicitly supplied build outside this folder is read-only input. Only a
# redundant package directly beside this script may be removed after success.
$package = Get-Item -LiteralPath $PackagePath
if ($package.PSIsContainer -or $package.Name -notmatch '^MixTunes-(\d+\.\d+\.\d+)-win-x64\.exe$') {
    throw 'The package must be a versioned MixTunes-x.y.z-win-x64.exe file.'
}
$newVersion = $Matches[1]
$packageFull = [IO.Path]::GetFullPath($package.FullName)
if ($installedRecords.Count -gt 0 -and [version]$newVersion -lt $installedRecords[0].Version) {
    throw 'Refusing to install an older version, including a version older than the legacy MixLink installation.'
}
if (-not $ExpectedSha256) {
    $checksumPath = Join-Path $package.DirectoryName "MixTunes-$newVersion-SHA256.txt"
    $checksumLines = @(Get-Content -LiteralPath $checksumPath -Encoding UTF8)
    $checksumPattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($package.Name) + '$'
    $checksums = @($checksumLines | ForEach-Object { if ($_.Trim() -match $checksumPattern) { $Matches[1] } })
    if ($checksums.Count -ne 1) { throw 'The checksum file must contain exactly one matching SHA256 entry.' }
    $ExpectedSha256 = $checksums[0]
}
if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid SHA256 value.' }
$ExpectedSha256 = $ExpectedSha256.ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $packageFull -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedSha256) { throw 'SHA256 mismatch. Nothing was changed.' }

$oldFiles = @()
if (Test-Path -LiteralPath $legacyTargetPath -PathType Leaf) { $oldFiles += $legacyTargetPath }
$oldFiles += @(Get-ChildItem -LiteralPath $installRoot -File | Sort-Object Name | Where-Object {
    $_.Name -match '^(MixTunes|MixLink)-(\d+\.\d+\.\d+)-win-x64\.exe$' -and [version]$Matches[2] -le [version]$newVersion -and
    -not [string]::Equals($_.FullName, $packageFull, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Assert-InstallFile $_.FullName })
Assert-PlayerStopped

if (-not $BackupDirectory) { $BackupDirectory = Join-Path $installRoot '.mixtunes-backups' }
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
if ([string]::Equals($backupRoot.TrimEnd('\'), $installRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup folder must differ from the player folder.' }
# Reject reparse points in every existing backup ancestor, so the destination
# cannot silently move outside the explicitly selected backup directory.
$backupAncestor = $backupRoot
while ($backupAncestor) {
    if (Test-Path -LiteralPath $backupAncestor) {
        $ancestorItem = Get-Item -LiteralPath $backupAncestor -Force
        if (-not $ancestorItem.PSIsContainer -or ($ancestorItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Backup path must contain real directories only.' }
    }
    $backupParent = [IO.Path]::GetDirectoryName($backupAncestor.TrimEnd('\'))
    if ($backupParent -eq $backupAncestor) { break }
    $backupAncestor = $backupParent
}
$backupPath = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Write-Host "Verified MixTunes $newVersion. Install: $targetPath"
Write-Host "Old brand/version executables to remove: $($oldFiles.Count). Backup: $backupPath"
if (-not $PSCmdlet.ShouldProcess($installRoot, "Install MixTunes $newVersion and replace old brand/version executables")) { return }

$hadTarget = Test-Path -LiteralPath $targetPath -PathType Leaf
$hadManifest = Test-Path -LiteralPath $manifestPath -PathType Leaf
$committed = $false
$manifestTouched = $false
$removed = @()
try {
    New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
    if ($hadTarget) { Copy-VerifiedFile $targetPath (Join-Path $backupPath 'MixTunes.exe') }
    if ($hadManifest) { Copy-VerifiedFile $manifestPath (Join-Path $backupPath 'MixTunes-installed.json') }
    if ($legacyInstalled) { Copy-VerifiedFile $legacyManifestPath (Join-Path $backupPath 'MixLink-installed.json') }
    foreach ($oldFile in $oldFiles) { Copy-VerifiedFile $oldFile (Join-Path $backupPath ([IO.Path]::GetFileName($oldFile))) }
    Copy-Item -LiteralPath $packageFull -Destination $stagePath
    if ((Get-FileHash -LiteralPath $stagePath -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Staged copy failed verification.' }
    # NullString is required by Windows PowerShell 5.1's File.Replace interop.
    if ($hadTarget) { [IO.File]::Replace($stagePath, $targetPath, [System.Management.Automation.Language.NullString]::Value) }
    else { Move-Item -LiteralPath $stagePath -Destination $targetPath }
    $committed = $true
    if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Installed file failed verification.' }
    foreach ($oldFile in $oldFiles) {
        # Log before deletion, so a deletion that partly succeeds can be undone.
        $removed += $oldFile
        Remove-Item -LiteralPath (Assert-InstallFile $oldFile)
    }
    $manifest = [ordered]@{ version = $newVersion; sha256 = $actualHash; executable = 'MixTunes.exe'; updatedAt = (Get-Date).ToUniversalTime().ToString('o'); backup = $backupPath }
    [IO.File]::WriteAllText($manifestStagePath, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    $stagedManifest = Get-Content -Raw -LiteralPath $manifestStagePath -Encoding UTF8 | ConvertFrom-Json
    if ($stagedManifest.version -ne $newVersion -or $stagedManifest.sha256 -ne $actualHash) { throw 'Staged manifest failed verification.' }
    $manifestTouched = $true
    if ($hadManifest) { [IO.File]::Replace($manifestStagePath, $manifestPath, [System.Management.Automation.Language.NullString]::Value) }
    else { Move-Item -LiteralPath $manifestStagePath -Destination $manifestPath }
} catch {
    $updateError = $_
    $recoveryErrors = New-Object 'System.Collections.Generic.List[string]'
    foreach ($oldFile in $removed) {
        try { Copy-VerifiedFile (Join-Path $backupPath ([IO.Path]::GetFileName($oldFile))) (Assert-InstallFile $oldFile) }
        catch { $recoveryErrors.Add($_.Exception.Message) }
    }
    if ($committed) {
        try {
            if ($hadTarget) { Copy-VerifiedFile (Join-Path $backupPath 'MixTunes.exe') (Assert-InstallFile $targetPath) }
            elseif (Test-Path -LiteralPath $targetPath) { Remove-Item -LiteralPath (Assert-InstallFile $targetPath) }
        } catch { $recoveryErrors.Add($_.Exception.Message) }
    }
    if ($manifestTouched) {
        try {
            if ($hadManifest) { Copy-VerifiedFile (Join-Path $backupPath 'MixTunes-installed.json') (Assert-InstallFile $manifestPath) }
            elseif (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath (Assert-InstallFile $manifestPath) }
        } catch { $recoveryErrors.Add($_.Exception.Message) }
    }
    if ($recoveryErrors.Count -gt 0) { throw "$($updateError.Exception.Message) Recovery errors: $($recoveryErrors -join '; '). Backup: $backupPath" }
    throw $updateError
} finally {
    foreach ($temporary in @($stagePath, $manifestStagePath)) {
        if (Test-Path -LiteralPath $temporary) {
            try { Remove-Item -LiteralPath (Assert-InstallFile $temporary) }
            catch { Write-Warning "Temporary file could not be removed: $temporary" }
        }
    }
}

if ([string]::Equals($package.DirectoryName, $installRoot, [StringComparison]::OrdinalIgnoreCase)) {
    try { Remove-Item -LiteralPath (Assert-InstallFile $packageFull) }
    catch { Write-Warning 'The new version is installed; the versioned package could not be removed.' }
}
Write-Host "Updated successfully. Playlists and platform sessions were not changed. Backup: $backupPath"
Open-PlayerFolder
