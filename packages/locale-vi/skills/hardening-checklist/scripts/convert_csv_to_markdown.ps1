param(
    # Default: every CSV in the skill's assets/ folder (resolved relative to this script).
    [string[]]$CsvPaths,
    [string]$OutputDirectory,
    [int]$HeaderSearchLimit = 10,
    [switch]$IncludePreamble
)

if (-not $CsvPaths) {
    $CsvPaths = @(Join-Path $PSScriptRoot "..\assets\*.csv")
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName Microsoft.VisualBasic

function Resolve-InputFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    $resolvedFiles = New-Object System.Collections.Generic.List[string]
    foreach ($path in $Paths) {
        $items = Get-ChildItem -Path $path -File -ErrorAction Stop
        foreach ($item in $items) {
            $resolvedFiles.Add($item.FullName)
        }
    }

    return $resolvedFiles | Sort-Object -Unique
}

function Read-CsvRows {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($Path, [System.Text.Encoding]::UTF8)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(",")
    $parser.HasFieldsEnclosedInQuotes = $true
    $parser.TrimWhiteSpace = $false

    $rows = New-Object System.Collections.Generic.List[object]
    try {
        while (-not $parser.EndOfData) {
            $fields = $parser.ReadFields()
            if ($null -eq $fields) {
                continue
            }

            $rows.Add(@($fields))
        }
    }
    finally {
        $parser.Close()
    }

    return $rows
}

function Get-NonEmptyCellCount {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Row
    )

    $cells = @($Row)
    $count = 0
    foreach ($cell in $cells) {
        if (-not [string]::IsNullOrWhiteSpace($cell)) {
            $count++
        }
    }
    return $count
}

function Get-HeaderRowIndex {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows,
        [Parameter(Mandatory = $true)]
        [int]$SearchLimit
    )

    $bestIndex = 0
    $bestScore = -1
    $limit = [Math]::Min($SearchLimit, $Rows.Count)

    for ($i = 0; $i -lt $limit; $i++) {
        $score = Get-NonEmptyCellCount -Row $Rows[$i]
        if ($score -gt $bestScore) {
            $bestScore = $score
            $bestIndex = $i
        }
    }

    return $bestIndex
}

function Normalize-RowWidth {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows,
        [Parameter(Mandatory = $true)]
        [int]$Width
    )

    $normalized = New-Object System.Collections.Generic.List[object]
    foreach ($row in $Rows) {
        $sourceCells = @($row)
        $cells = New-Object string[] $Width
        for ($i = 0; $i -lt $Width; $i++) {
            if ($i -lt $sourceCells.Count) {
                $cells[$i] = [string]$sourceCells[$i]
            }
            else {
                $cells[$i] = ""
            }
        }
        $normalized.Add($cells)
    }

    return $normalized
}

function Get-EffectiveWidth {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    $width = 0
    foreach ($row in $Rows) {
        $count = @($row).Count
        if ($count -gt $width) {
            $width = $count
        }
    }
    return $width
}

function ConvertTo-MarkdownCell {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    $normalized = $Value.Replace("`r`n", "<br>").Replace("`n", "<br>").Replace("`r", "<br>")
    $normalized = $normalized.Replace("|", "\|")
    return $normalized.Trim()
}

function Get-SafeHeaderName {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [int]$ColumnNumber
    )

    $header = ConvertTo-MarkdownCell -Value $Value
    if ([string]::IsNullOrWhiteSpace($header)) {
        return "Column $ColumnNumber"
    }
    return $header
}

function Test-RowHasContent {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Row
    )

    foreach ($cell in @($Row)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$cell)) {
            return $true
        }
    }

    return $false
}

function Get-ContentRows {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    $filteredRows = New-Object System.Collections.Generic.List[object]
    foreach ($row in $Rows) {
        if (Test-RowHasContent -Row $row) {
            $filteredRows.Add($row)
        }
    }

    return $filteredRows
}

function Write-MarkdownTable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$MarkdownPath,
        [Parameter(Mandatory = $true)]
        [string[]]$Header,
        [Parameter()]
        [object[]]$Rows,
        [string[]]$Preamble
    )

    $utf8Bom = [System.Text.UTF8Encoding]::new($true)
    $writer = [System.IO.StreamWriter]::new($MarkdownPath, $false, $utf8Bom)
    try {
        if ($Preamble.Count -gt 0) {
            foreach ($line in $Preamble) {
                $writer.WriteLine($line)
            }
            $writer.WriteLine()
        }

        $writer.WriteLine("| " + (($Header | ForEach-Object { ConvertTo-MarkdownCell $_ }) -join " | ") + " |")
        $writer.WriteLine("| " + (($Header | ForEach-Object { "---" }) -join " | ") + " |")

        foreach ($row in $Rows) {
            $markdownCells = @($row | ForEach-Object { ConvertTo-MarkdownCell $_ })
            if (@($markdownCells | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -eq 0) {
                continue
            }

            $writer.WriteLine("| " + ($markdownCells -join " | ") + " |")
        }
    }
    finally {
        $writer.Close()
    }
}

function Get-SafeFileName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $safe = $Name
    foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
        $safe = $safe.Replace($char, "_")
    }
    return $safe.Trim()
}

$csvFiles = @(Resolve-InputFiles -Paths $CsvPaths)
if ($csvFiles.Count -eq 0) {
    throw "No CSV files matched the provided paths."
}

foreach ($csvFile in $csvFiles) {
    $rows = Read-CsvRows -Path $csvFile
    if ($rows.Count -eq 0) {
        Write-Host "Skipped empty CSV: $csvFile"
        continue
    }

    $headerIndex = Get-HeaderRowIndex -Rows $rows -SearchLimit $HeaderSearchLimit
    $effectiveWidth = Get-EffectiveWidth -Rows $rows
    $normalizedRows = Normalize-RowWidth -Rows $rows -Width $effectiveWidth

    $headerRow = $normalizedRows[$headerIndex]
    $header = for ($i = 0; $i -lt $headerRow.Count; $i++) {
        Get-SafeHeaderName -Value $headerRow[$i] -ColumnNumber ($i + 1)
    }

    $dataRows = if ($headerIndex + 1 -lt $normalizedRows.Count) {
        $normalizedRows[($headerIndex + 1)..($normalizedRows.Count - 1)]
    }
    else {
        @()
    }
    $dataRows = Get-ContentRows -Rows $dataRows

    $preamble = @()
    if ($IncludePreamble -and $headerIndex -gt 0) {
        foreach ($row in $normalizedRows[0..($headerIndex - 1)]) {
            if (-not (Test-RowHasContent -Row $row)) {
                continue
            }

            $nonEmptyCells = @($row | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            if ($nonEmptyCells.Count -eq 1) {
                if ($preamble.Count -eq 0) {
                    $preamble += "# " + $nonEmptyCells[0].Trim()
                }
                else {
                    $preamble += $nonEmptyCells[0].Trim()
                }
            }
            elseif ($nonEmptyCells.Count -gt 1) {
                $preamble += ($nonEmptyCells -join " | ")
            }
        }
    }

    $targetDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        Split-Path -Parent $csvFile
    }
    else {
        $resolvedOutputDirectory = Resolve-Path -LiteralPath $OutputDirectory -ErrorAction SilentlyContinue
        if ($null -ne $resolvedOutputDirectory) {
            $resolvedOutputDirectory.Path
        }
        else {
            [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
        }
    }

    [System.IO.Directory]::CreateDirectory($targetDirectory) | Out-Null

    $markdownFileName = (Get-SafeFileName -Name ([System.IO.Path]::GetFileNameWithoutExtension($csvFile))) + ".md"
    $markdownPath = Join-Path $targetDirectory $markdownFileName

    Write-MarkdownTable -MarkdownPath $markdownPath -Header $header -Rows $dataRows -Preamble $preamble
    Write-Host "Created: $markdownPath"
}
