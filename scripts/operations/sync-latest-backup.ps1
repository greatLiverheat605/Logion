[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$RemoteHostName,
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$RemoteUser = "root",
    [string]$BackupRoot = "F:\LogionBackups",
    [string]$IdentityFile = "$HOME\.ssh\logion_aliyun_ed25519",
    [string]$KnownHostsFile = "$HOME\.ssh\known_hosts",
    [ValidateRange(2, 3650)]
    [int]$KeepDaily = 30,
    [ValidateRange(0, 120)]
    [int]$KeepMonthly = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$encryptedDirectory = Join-Path $BackupRoot "encrypted"
$logDirectory = Join-Path $BackupRoot "logs"
$statusDirectory = Join-Path $BackupRoot "status"
$temporaryDirectory = Join-Path $BackupRoot "tmp"
$statusFile = Join-Path $statusDirectory "last-run.json"
$taskStartedAt = [DateTimeOffset]::Now
$logFile = Join-Path $logDirectory ("pull-{0}.log" -f $taskStartedAt.ToString("yyyyMMdd"))
$latestName = $null

function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)

    $line = "{0} {1}" -f [DateTimeOffset]::Now.ToString("o"), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = & $FilePath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $detail = ($output | Out-String).Trim()
        throw "$FilePath exited with code $LASTEXITCODE. $detail"
    }
    return ($output | Out-String).Trim()
}

function Assert-SafeDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Unsafe backup directory: $Path"
    }
    return $item.FullName.TrimEnd("\")
}

function Test-BackupChecksum {
    param(
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [Parameter(Mandatory = $true)][string]$ChecksumPath
    )

    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
        throw "Backup file is missing: $BackupPath"
    }
    if (-not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
        throw "Checksum file is missing: $ChecksumPath"
    }
    if ((Get-Item -LiteralPath $BackupPath).Length -le 0) {
        throw "Backup file is empty: $BackupPath"
    }

    $checksumLine = Get-Content -LiteralPath $ChecksumPath -TotalCount 1
    $backupName = Split-Path -Leaf $BackupPath
    $expectedPattern = '^\s*([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($backupName) + '\s*$'
    if ($checksumLine -notmatch $expectedPattern) {
        throw "Checksum file has an invalid format or filename: $ChecksumPath"
    }
    $expected = $Matches[1].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Backup checksum mismatch for $backupName"
    }
    return $actual
}

function Remove-ExpiredBackups {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $resolvedDirectory = (Assert-SafeDirectory -Path $Directory) + "\"
    $backups = @(Get-ChildItem -LiteralPath $Directory -File -Filter "logion-*.backup" |
            Where-Object { $_.Name -match '^logion-\d{8}T\d{6}Z-[A-Za-z0-9._-]+\.backup$' } |
            Sort-Object Name -Descending)

    $keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($backup in ($backups | Select-Object -First $KeepDaily)) {
        [void]$keep.Add($backup.Name)
    }

    $months = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($backup in $backups) {
        if ($backup.Name -notmatch '^logion-(\d{6})\d{2}T') {
            continue
        }
        $month = $Matches[1]
        if ($months.Count -ge $KeepMonthly) {
            break
        }
        if ($months.Add($month)) {
            [void]$keep.Add($backup.Name)
        }
    }

    foreach ($backup in $backups) {
        if ($keep.Contains($backup.Name)) {
            continue
        }
        if (-not $backup.FullName.StartsWith($resolvedDirectory, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a backup outside the managed directory: $($backup.FullName)"
        }
        if ($backup.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to remove a reparse-point backup: $($backup.FullName)"
        }

        $checksum = "$($backup.FullName).sha256"
        Remove-Item -LiteralPath $backup.FullName -Force
        if (Test-Path -LiteralPath $checksum -PathType Leaf) {
            $checksumItem = Get-Item -LiteralPath $checksum -Force
            if (-not $checksumItem.FullName.StartsWith(
                    $resolvedDirectory,
                    [StringComparison]::OrdinalIgnoreCase
                )) {
                throw "Refusing to remove a checksum outside the managed directory: $checksum"
            }
            Remove-Item -LiteralPath $checksumItem.FullName -Force
        }
        Write-Log "Removed expired encrypted backup $($backup.Name)."
    }
}

foreach ($directory in @(
        $BackupRoot,
        $encryptedDirectory,
        $logDirectory,
        $statusDirectory,
        $temporaryDirectory
    )) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [void](Assert-SafeDirectory -Path $directory)
}

try {
    $backupDrive = Split-Path -Qualifier (Resolve-Path -LiteralPath $BackupRoot).Path
    $driveLetter = $backupDrive.TrimEnd(':', '\')
    $volume = Get-Volume -DriveLetter $driveLetter
    if ($volume.FileSystem -notin @("NTFS", "ReFS")) {
        throw "$backupDrive must use NTFS or ReFS so local access controls remain enforceable."
    }
    if ($volume.SizeRemaining -lt 1GB) {
        throw "$backupDrive has less than 1 GB free space."
    }
    foreach ($requiredFile in @($IdentityFile, $KnownHostsFile)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required SSH file is missing: $requiredFile"
        }
    }

    $sshExe = (Get-Command ssh.exe -ErrorAction Stop).Source
    $scpExe = (Get-Command scp.exe -ErrorAction Stop).Source
    $remoteTarget = "$RemoteUser@$RemoteHostName"
    $commonOptions = @(
        "-i", (Resolve-Path -LiteralPath $IdentityFile).Path,
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=15",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "UserKnownHostsFile=$((Resolve-Path -LiteralPath $KnownHostsFile).Path)"
    )

    Write-Log "Starting encrypted backup pull."
    $remoteProbe = @'
set -eu
mount="$(docker volume inspect logion_backup_data -f '{{.Mountpoint}}')"
latest="$(find "$mount" -maxdepth 1 -type f -name 'logion-*.backup' -printf '%f\n' | sort | tail -1)"
test -n "$latest"
size="$(stat -c '%s' "$mount/$latest")"
printf '%s\t%s\t%s\n' "$mount" "$latest" "$size"
'@
    $probeOutput = Invoke-CheckedNative -FilePath $sshExe -Arguments (
        @("-n") + $commonOptions + @($remoteTarget, $remoteProbe)
    )
    $probeLine = @($probeOutput -split "`r?`n") |
        Where-Object { $_ -match '^/[A-Za-z0-9._/-]+\tlogion-\d{8}T\d{6}Z-[A-Za-z0-9._-]+\.backup\t\d+$' } |
        Select-Object -Last 1
    if (-not $probeLine) {
        throw "The server did not report a valid encrypted backup."
    }
    $remoteMount, $latestName, $remoteSizeText = $probeLine -split "`t"
    [long]$remoteSize = 0
    if (-not [long]::TryParse($remoteSizeText, [ref]$remoteSize) -or $remoteSize -le 0) {
        throw "The server reported an invalid backup size."
    }
    if ($volume.SizeRemaining -lt ($remoteSize + 1GB)) {
        throw "$backupDrive does not have enough safety margin for the backup download."
    }

    $finalBackup = Join-Path $encryptedDirectory $latestName
    $finalChecksum = "$finalBackup.sha256"
    $downloaded = $false
    if ((Test-Path -LiteralPath $finalBackup -PathType Leaf) -and
        (Test-Path -LiteralPath $finalChecksum -PathType Leaf)) {
        $digest = Test-BackupChecksum -BackupPath $finalBackup -ChecksumPath $finalChecksum
        Write-Log "Latest encrypted backup already exists and passed checksum verification: $latestName ($digest)."
    }
    else {
        $runTemporaryDirectory = Join-Path $temporaryDirectory ([Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $runTemporaryDirectory | Out-Null
        [void](Assert-SafeDirectory -Path $runTemporaryDirectory)
        try {
            [void](Invoke-CheckedNative -FilePath $scpExe -Arguments (
                    @("-q") + $commonOptions + @(
                        "${remoteTarget}:$remoteMount/$latestName*",
                        $runTemporaryDirectory
                    )
                ))
            $temporaryBackup = Join-Path $runTemporaryDirectory $latestName
            $temporaryChecksum = "$temporaryBackup.sha256"
            if ((Get-Item -LiteralPath $temporaryBackup).Length -ne $remoteSize) {
                throw "Downloaded backup size does not match the server."
            }
            $digest = Test-BackupChecksum -BackupPath $temporaryBackup -ChecksumPath $temporaryChecksum
            Move-Item -LiteralPath $temporaryChecksum -Destination $finalChecksum -Force
            Move-Item -LiteralPath $temporaryBackup -Destination $finalBackup -Force
            $downloaded = $true
            Write-Log "Downloaded and verified encrypted backup $latestName ($digest)."
        }
        finally {
            if (Test-Path -LiteralPath $runTemporaryDirectory -PathType Container) {
                Get-ChildItem -LiteralPath $runTemporaryDirectory -File -Force |
                    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
                Remove-Item -LiteralPath $runTemporaryDirectory -Force
            }
        }
    }

    Remove-ExpiredBackups -Directory $encryptedDirectory
    [ordered]@{
        status = "success"
        checked_at = [DateTimeOffset]::Now.ToString("o")
        latest_backup = $latestName
        downloaded = $downloaded
        sha256 = $digest
        source = $RemoteHostName
    } | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding utf8
    Write-Log "Encrypted backup pull completed successfully."
    Write-Output "Verified encrypted backup: $finalBackup"
}
catch {
    $message = $_.Exception.Message
    Write-Log "Encrypted backup pull failed: $message"
    [ordered]@{
        status = "failed"
        checked_at = [DateTimeOffset]::Now.ToString("o")
        latest_backup = $latestName
        error = $message
        source = $RemoteHostName
    } | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding utf8
    throw
}
