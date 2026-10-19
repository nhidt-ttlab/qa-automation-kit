param(
    # Default: the two template workbooks in the skill's assets/ folder (resolved relative to this script).
    [string[]]$WorkbookPaths,
    [string]$OutputDirectory,
    [switch]$SkipEmptySheets
)

if (-not $WorkbookPaths) {
    $WorkbookPaths = @(
        (Join-Path $PSScriptRoot "..\assets\ProjectCode_IT_TestChecklist.xlsx"),
        (Join-Path $PSScriptRoot "..\assets\TestViewpoint_CommonTestCase.xlsx")
    )
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ColumnIndexFromReference {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CellReference
    )

    $letters = [regex]::Match($CellReference.ToUpperInvariant(), "^[A-Z]+").Value
    $index = 0
    foreach ($char in $letters.ToCharArray()) {
        $index = ($index * 26) + ([int][char]$char - [int][char]'A' + 1)
    }
    return $index
}

function ConvertTo-CsvValue {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    $escaped = $Value.Replace('"', '""')
    if ($escaped.IndexOfAny([char[]]@(',', '"', "`r", "`n")) -ge 0) {
        return '"' + $escaped + '"'
    }

    return $escaped
}

function Get-SharedStrings {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchive]$Zip
    )

    $entry = $Zip.GetEntry("xl/sharedStrings.xml")
    if ($null -eq $entry) {
        return @()
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        $xml = [xml]$reader.ReadToEnd()
    }
    finally {
        $reader.Close()
    }

    $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

    $items = New-Object System.Collections.Generic.List[string]
    foreach ($si in $xml.SelectNodes("//x:sst/x:si", $ns)) {
        $parts = foreach ($node in $si.SelectNodes(".//x:t", $ns)) {
            $node.InnerText
        }
        $items.Add(($parts -join ""))
    }

    return $items
}

function Get-WorkbookSheetMap {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchive]$Zip
    )

    $workbookEntry = $Zip.GetEntry("xl/workbook.xml")
    $relsEntry = $Zip.GetEntry("xl/_rels/workbook.xml.rels")
    if ($null -eq $workbookEntry -or $null -eq $relsEntry) {
        throw "Workbook relationship metadata is missing."
    }

    $workbookReader = [System.IO.StreamReader]::new($workbookEntry.Open())
    $relsReader = [System.IO.StreamReader]::new($relsEntry.Open())
    try {
        $workbookXml = [xml]$workbookReader.ReadToEnd()
        $relsXml = [xml]$relsReader.ReadToEnd()
    }
    finally {
        $workbookReader.Close()
        $relsReader.Close()
    }

    $workbookNs = [System.Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
    $workbookNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    $workbookNs.AddNamespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")

    $relsNs = [System.Xml.XmlNamespaceManager]::new($relsXml.NameTable)
    $relsNs.AddNamespace("r", "http://schemas.openxmlformats.org/package/2006/relationships")

    $targetById = @{}
    foreach ($relationship in $relsXml.SelectNodes("//r:Relationship", $relsNs)) {
        $targetById[$relationship.Id] = $relationship.Target
    }

    $sheets = New-Object System.Collections.Generic.List[object]
    foreach ($sheet in $workbookXml.SelectNodes("//x:sheets/x:sheet", $workbookNs)) {
        $relationshipId = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        $target = $targetById[$relationshipId]
        if ([string]::IsNullOrWhiteSpace($target)) {
            continue
        }

        $normalizedTarget = $target.Replace('\', '/')
        if (-not $normalizedTarget.StartsWith("/")) {
            $normalizedTarget = "xl/$normalizedTarget"
        }
        $normalizedTarget = $normalizedTarget.TrimStart("/")

        $sheets.Add([pscustomobject]@{
            Name = $sheet.name
            Path = $normalizedTarget
        })
    }

    return $sheets
}

function Get-CellText {
    param(
        [Parameter(Mandatory = $true)]
        [System.Xml.XmlElement]$Cell,
        [Parameter(Mandatory = $true)]
        [string[]]$SharedStrings,
        [Parameter(Mandatory = $true)]
        [System.Xml.XmlNamespaceManager]$NamespaceManager
    )

    $cellType = $Cell.GetAttribute("t")

    if ($cellType -eq "inlineStr") {
        $textNodes = $Cell.SelectNodes("./x:is//x:t", $NamespaceManager)
        return (($textNodes | ForEach-Object { $_.InnerText }) -join "")
    }

    $valueNode = $Cell.SelectSingleNode("./x:v", $NamespaceManager)
    if ($null -eq $valueNode) {
        $textNodes = $Cell.SelectNodes(".//x:t", $NamespaceManager)
        if ($textNodes.Count -gt 0) {
            return (($textNodes | ForEach-Object { $_.InnerText }) -join "")
        }
        return ""
    }

    $rawValue = $valueNode.InnerText
    switch ($cellType) {
        "s" {
            $sharedIndex = 0
            if ([int]::TryParse($rawValue, [ref]$sharedIndex) -and $sharedIndex -ge 0 -and $sharedIndex -lt $SharedStrings.Count) {
                return $SharedStrings[$sharedIndex]
            }
            return $rawValue
        }
        "b" {
            if ($rawValue -eq "1") { return "TRUE" }
            if ($rawValue -eq "0") { return "FALSE" }
            return $rawValue
        }
        default {
            return $rawValue
        }
    }
}

function Export-WorksheetToCsv {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchive]$Zip,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Sheet,
        [Parameter(Mandatory = $true)]
        [string[]]$SharedStrings,
        [Parameter(Mandatory = $true)]
        [string]$CsvPath,
        [switch]$SkipEmptySheet
    )

    $entry = $Zip.GetEntry($Sheet.Path)
    if ($null -eq $entry) {
        throw "Worksheet '$($Sheet.Name)' was not found at '$($Sheet.Path)'."
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        $xml = [xml]$reader.ReadToEnd()
    }
    finally {
        $reader.Close()
    }

    $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

    $rows = $xml.SelectNodes("//x:worksheet/x:sheetData/x:row", $ns)
    if ($SkipEmptySheet -and $rows.Count -eq 0) {
        return $false
    }

    $utf8Bom = [System.Text.UTF8Encoding]::new($true)
    $writer = [System.IO.StreamWriter]::new($CsvPath, $false, $utf8Bom)
    try {
        foreach ($row in $rows) {
            $valuesByIndex = @{}
            $maxColumnIndex = 0

            foreach ($cell in $row.SelectNodes("./x:c", $ns)) {
                $cellReference = $cell.r
                if ([string]::IsNullOrWhiteSpace($cellReference)) {
                    continue
                }

                $columnIndex = Get-ColumnIndexFromReference -CellReference $cellReference
                $valuesByIndex[$columnIndex] = Get-CellText -Cell $cell -SharedStrings $SharedStrings -NamespaceManager $ns
                if ($columnIndex -gt $maxColumnIndex) {
                    $maxColumnIndex = $columnIndex
                }
            }

            $columns = for ($i = 1; $i -le $maxColumnIndex; $i++) {
                ConvertTo-CsvValue -Value $valuesByIndex[$i]
            }
            $writer.WriteLine(($columns -join ","))
        }
    }
    finally {
        $writer.Close()
    }

    return $true
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

foreach ($workbookPath in $WorkbookPaths) {
    $resolvedWorkbookPath = Resolve-Path -LiteralPath $workbookPath
    $targetDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        Split-Path -Parent $resolvedWorkbookPath
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

    $zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedWorkbookPath)
    try {
        $sharedStrings = Get-SharedStrings -Zip $zip
        $sheets = Get-WorkbookSheetMap -Zip $zip
        $workbookBaseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedWorkbookPath)

        Write-Host "Workbook: $resolvedWorkbookPath"
        foreach ($sheet in $sheets) {
            $csvFileName = "{0} - {1}.csv" -f $workbookBaseName, (Get-SafeFileName -Name $sheet.Name)
            $csvPath = Join-Path $targetDirectory $csvFileName
            $written = Export-WorksheetToCsv -Zip $zip -Sheet $sheet -SharedStrings $sharedStrings -CsvPath $csvPath -SkipEmptySheet:$SkipEmptySheets
            if ($written) {
                Write-Host "  Created: $csvPath"
            }
            else {
                Write-Host "  Skipped empty sheet: $($sheet.Name)"
            }
        }
    }
    finally {
        $zip.Dispose()
    }
}
