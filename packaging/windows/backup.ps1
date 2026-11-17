<#
.SYNOPSIS
  Backs up the cold-seance database with pg_dump (SC-122, DD-061).

.DESCRIPTION
  Dumps the database, in pg_dump's custom format, into a dated file in -Folder, then deletes the
  dumps of the same database in -Folder that are older than -KeepDays days. pg_restore restores
  such a dump. The password is never given to this script: pg_dump takes it from PostgreSQL's
  password file, %APPDATA%\postgresql\pgpass.conf, or the file named by -PassFile. The script exits
  with a non-zero code if the dump fails, which the scheduled task shows as its last result.

  The dump holds the database only. config.yaml and the GitHub App key files are not in it: back
  them up separately.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File backup.ps1 -Folder D:\backups\cold-seance
#>
param(
  [Parameter(Mandatory = $true)] [string] $Folder,
  [string] $Database = 'cold_seance',
  [string] $User = 'cold_seance',
  [string] $Server = 'localhost',
  [int] $Port = 5432,
  [int] $KeepDays = 7,
  [string] $PassFile,
  [string] $PgDump
)
$ErrorActionPreference = 'Stop'

# pg_dump from PATH, else from the newest PostgreSQL that its Windows installer put in Program Files.
if (-not $PgDump) {
  $found = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($found) {
    $PgDump = $found.Source
  } else {
    $PgDump = Get-ChildItem -Path "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
      Sort-Object { $n = 0.0; [void][double]::TryParse($_.Directory.Parent.Name, [ref]$n); $n } | Select-Object -Last 1 -ExpandProperty FullName
    if (-not $PgDump) { throw 'pg_dump was not found: install PostgreSQL, or give its path with -PgDump.' }
  }
}
if ($PassFile) { $env:PGPASSFILE = $PassFile }

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$file = Join-Path $Folder ('{0}-{1}.dump' -f $Database, (Get-Date -Format 'yyyy-MM-dd-HHmmss'))
& $PgDump --format=custom --no-password "--host=$Server" "--port=$Port" "--username=$User" "--file=$file" $Database
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
  Write-Error "pg_dump failed with exit code $LASTEXITCODE; no backup was taken." -ErrorAction Continue
  exit 1
}
Write-Output "Backed up $Database to $file"

# Only this database's dumps are pruned, never the one just taken.
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $Folder -Filter "$Database-*.dump" -File |
  Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName -ne $file } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName; Write-Output "Deleted $($_.Name)" }
