$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$ownerEmail = Read-Host 'Designated verified administrator email'
$ownerPassword = Read-Host 'Current account password (hidden)' -AsSecureString
$ownerPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ownerPassword)
try {
    $ownerPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ownerPointer)
    @{email=$ownerEmail;password=$ownerPlain} | ConvertTo-Json -Compress | node scripts/provision-admin.js
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ownerPointer)
    $ownerPlain = $null
}
