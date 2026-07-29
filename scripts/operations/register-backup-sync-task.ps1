[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$RemoteHostName,
    [string]$TaskName = "Logion Encrypted Backup Pull",
    [string]$BackupRoot = "F:\LogionBackups",
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$DailyAt = "20:00"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourceScript = Join-Path $PSScriptRoot 'sync-latest-backup.ps1'
if (-not (Test-Path -LiteralPath $sourceScript -PathType Leaf)) {
    throw "The backup sync script is missing."
}

$automationDirectory = Join-Path $BackupRoot 'automation'
New-Item -ItemType Directory -Path $automationDirectory -Force | Out-Null
$automationItem = Get-Item -LiteralPath $automationDirectory -Force
if (-not $automationItem.PSIsContainer -or
    ($automationItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "The automation directory is unsafe."
}
$installedScript = Join-Path $automationDirectory 'Sync-LatestLogionBackup.ps1'
Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument (
        "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass " +
        "-File `"$installedScript`" -RemoteHostName `"$RemoteHostName`""
    ) `
    -WorkingDirectory $automationDirectory
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentIdentity `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($dailyTrigger, $logonTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description "Downloads and verifies the latest encrypted Logion backup while this user is signed in." `
    -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
