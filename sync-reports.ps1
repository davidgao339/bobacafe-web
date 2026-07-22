# sync-reports.ps1
# Copies generated HTML reports from boba-cafe-databricks into internal/reports/
# and regenerates the index. Run this after pulling boba-cafe-databricks.
#
# Usage:
#   .\sync-reports.ps1
#   .\sync-reports.ps1 -SourceDir "C:\other\path\to\analysis-html"

param(
    [string]$SourceDir = "..\boba-cafe-databricks\weekly-analysis\analysis-html"
)

$DestDir = "$PSScriptRoot\internal\reports"

if (-not (Test-Path $SourceDir)) {
    Write-Error "Source not found: $SourceDir"
    exit 1
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

# Copy all HTML report files, excluding any pre-existing index.html in the source
$files = Get-ChildItem -Path $SourceDir -Filter "*.html" |
         Where-Object { $_.Name -ne "index.html" } |
         Sort-Object Name -Descending

if ($files.Count -eq 0) {
    Write-Host "No HTML files found in $SourceDir"
    exit 0
}

# Pass 1: read + decode + validate everything in memory FIRST.
# Some Databricks exports wrap the HTML as {"content":"<base64>","file_type":""}.
# A raw copy of that JSON renders as a blank white page, so decode it here.
# Nothing is written to disk until every file passes validation, so a bad
# export aborts the whole publish instead of pushing broken reports live.
$outputs = @()
foreach ($f in $files) {
    $raw = Get-Content -LiteralPath $f.FullName -Raw

    if ($raw.TrimStart() -match '^\{\s*"content"\s*:') {
        try {
            $obj  = $raw | ConvertFrom-Json
            $html = [System.Text.Encoding]::UTF8.GetString(
                        [System.Convert]::FromBase64String($obj.content))
        } catch {
            Write-Error "Failed to decode wrapped report $($f.Name): $($_.Exception.Message). Nothing was published."
            exit 1
        }
        $action = "Decoded"
    } else {
        $html   = $raw
        $action = "Copied "
    }

    # Sanity check: output must be an HTML document, not leftover JSON or junk.
    if ($html.TrimStart() -notmatch '(?i)^(<!DOCTYPE|<html)') {
        $head = $html.Substring(0, [Math]::Min(40, $html.Length))
        Write-Error "Aborting: $($f.Name) is not valid HTML after processing (starts with '$head'). Nothing was published."
        exit 1
    }

    $outputs += [PSCustomObject]@{ Name = $f.Name; Html = $html; Action = $action }
}

# Pass 2: only reached if every file validated — write them all out.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
foreach ($o in $outputs) {
    [System.IO.File]::WriteAllText("$DestDir\$($o.Name)", $o.Html, $utf8NoBom)
    Write-Host "$($o.Action) $($o.Name)"
}

# --- Build index entries ---

$ruMonthsGen = @{
    "01" = "января"; "02" = "февраля"; "03" = "марта";    "04" = "апреля"
    "05" = "мая";    "06" = "июня";    "07" = "июля";     "08" = "августа"
    "09" = "сентября"; "10" = "октября"; "11" = "ноября"; "12" = "декабря"
}
$ruMonthsNom = @{
    "01" = "Январь"; "02" = "Февраль"; "03" = "Март";    "04" = "Апрель"
    "05" = "Май";    "06" = "Июнь";    "07" = "Июль";   "08" = "Август"
    "09" = "Сентябрь"; "10" = "Октябрь"; "11" = "Ноябрь"; "12" = "Декабрь"
}

$weekly  = @()
$monthly = @()

foreach ($f in $files) {
    $n = $f.BaseName
    if ($n -match '^(\d{4})-(\d{2})-(\d{2})_weekly') {
        $weekly += [PSCustomObject]@{
            File  = $f.Name
            Label = "$([int]$Matches[3]) $($ruMonthsGen[$Matches[2]]) $($Matches[1])"
        }
    } elseif ($n -match '^(\d{4})-(\d{2})_(.+)') {
        $monthly += [PSCustomObject]@{
            File  = $f.Name
            Title = (Get-Culture).TextInfo.ToTitleCase(($Matches[3] -replace "_", " "))
            Label = "$($ruMonthsNom[$Matches[2]]) $($Matches[1])"
        }
    }
}

function New-ReportItem($file, $title, $label, $icon) {
    return "        <a href=`"$file`" class=`"report-item`">`n" +
           "            <div class=`"report-icon`">$icon</div>`n" +
           "            <div class=`"report-info`">`n" +
           "                <div class=`"report-name`">$title</div>`n" +
           "                <div class=`"report-date`">$label</div>`n" +
           "            </div>`n" +
           "            <span class=`"report-arrow`">›</span>`n" +
           "        </a>"
}

$weeklyRows  = ($weekly  | ForEach-Object { New-ReportItem $_.File "Еженедельный отчёт" $_.Label "📈" }) -join "`n"
$monthlyRows = ($monthly | ForEach-Object { New-ReportItem $_.File $_.Title $_.Label "📊" }) -join "`n"

$weeklySect = ""
if ($weekly.Count -gt 0) {
    $weeklySect = "`n    <div class=`"section-label`">Еженедельные</div>`n    <div class=`"report-list`">`n$weeklyRows`n    </div>"
}

$monthlySect = ""
if ($monthly.Count -gt 0) {
    $monthlySect = "`n    <div class=`"section-label`">Ежемесячные</div>`n    <div class=`"report-list`">`n$monthlyRows`n    </div>"
}

$index = @"
<!DOCTYPE html>
<html lang="ru">
<head>
    <script>
      if (sessionStorage.getItem('bc_pin_reports') !== '1') {
        window.location.replace('/internal/');
      }
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Отчёты — Боба Кролик</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg:        #f8f9fa;
            --surface:   #ffffff;
            --border:    #dadce0;
            --text-1:    #202124;
            --text-2:    #5f6368;
            --text-3:    #80868b;
            --accent:    #8d6e63;
            --accent-bg: #f4ede9;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Roboto', Arial, sans-serif;
            background: var(--bg);
            color: var(--text-1);
            min-height: 100vh;
            font-size: 16px;
        }

        nav {
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            height: 64px;
            padding: 0 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .nav-back {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 15px;
            font-weight: 500;
            color: var(--accent);
            text-decoration: none;
        }
        .nav-back:hover { text-decoration: underline; }

        .nav-title {
            font-size: 18px;
            font-weight: 700;
            color: var(--text-1);
        }

        .page {
            max-width: 1100px;
            margin: 0 auto;
            padding: 48px 24px 80px;
        }

        .page-title {
            font-size: 32px;
            font-weight: 700;
            color: var(--text-1);
            letter-spacing: -0.02em;
            margin-bottom: 8px;
        }

        .page-sub {
            font-size: 16px;
            color: var(--text-2);
            margin-bottom: 40px;
        }

        .section-label {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-3);
            margin-bottom: 12px;
        }

        .report-list {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 32px;
        }

        .report-item {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px 20px;
            text-decoration: none;
            color: inherit;
            border-bottom: 1px solid var(--border);
            transition: background 0.1s;
        }
        .report-item:last-child { border-bottom: none; }
        .report-item:hover { background: #f8f9fa; }

        .report-icon {
            width: 40px;
            height: 40px;
            background: var(--accent-bg);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }

        .report-info { flex: 1; }

        .report-name {
            font-size: 15px;
            font-weight: 500;
            color: var(--text-1);
        }

        .report-date {
            font-size: 13px;
            color: var(--text-3);
            margin-top: 2px;
        }

        .report-arrow {
            color: var(--text-3);
            font-size: 18px;
            font-weight: 300;
        }

        footer {
            text-align: center;
            padding: 20px;
            font-size: 13px;
            color: var(--text-3);
            border-top: 1px solid var(--border);
        }
        footer a { color: var(--accent); text-decoration: none; }
        footer a:hover { text-decoration: underline; }

        @media (max-width: 640px) {
            .page { padding: 32px 16px 60px; }
            .page-title { font-size: 26px; }
        }
    </style>
</head>
<body>

<nav>
    <a href="/internal/" class="nav-back">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
            <path d="M7 1L1 7l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Портал
    </a>
    <span class="nav-title">Отчёты</span>
    <div style="width:72px"></div>
</nav>

<div class="page">
    <h1 class="page-title">Отчёты</h1>
    <p class="page-sub">Внутренняя аналитика — обновляется автоматически</p>
$weeklySect
$monthlySect
</div>

<footer>
    <a href="/internal/">← Внутренний портал</a>
</footer>

</body>
</html>
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$DestDir\index.html", $index, $utf8NoBom)
Write-Host "Index   internal/reports/index.html  ($($files.Count) report(s))"
Write-Host ""
Write-Host "Done. Commit and push bobacafe-web to publish."
