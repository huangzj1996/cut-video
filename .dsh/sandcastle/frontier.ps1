# 列出当前可以开工的 Sandcastle issue（确定性判断，不靠 LLM 猜依赖）。
#
# 一个 issue 算"可开工"必须同时满足：
#   - 状态 open
#   - 带 Sandcastle 标签（标签可由 -Label 覆盖）
#   - 没有 assignee（没人认领）
#   - 所有阻塞者都已关闭
#
# 阻塞者取两处并集：GitHub 原生 blocked_by 关系 + issue 正文里的
# "Blocked by: #1, #2" 文本（Sandcastle 约定要求正文也写，见 docs/agents/issue-tracker.md）。
#
# 用法：
#   pwsh .dsh/sandcastle/frontier.ps1              # 人类可读
#   pwsh .dsh/sandcastle/frontier.ps1 -Json        # 机器可读（编排用）
#   pwsh .dsh/sandcastle/frontier.ps1 -Limit 5     # 只取前 5 个（并发上限）
[CmdletBinding()]
param(
  [int]$Limit = 0,
  [string]$Label = 'Sandcastle',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# gh 是 Go 程序，不读 Windows 系统代理；Clash 在跑时自动补上环境变量。
function Enable-GhProxyIfNeeded {
  if ($env:HTTPS_PROXY -or $env:https_proxy) { return }
  $open = Test-NetConnection 127.0.0.1 -Port 7897 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($open) {
    $env:HTTPS_PROXY = 'http://127.0.0.1:7897'
    $env:HTTP_PROXY = $env:HTTPS_PROXY
  }
}

function Get-RepoRoot {
  $root = git rev-parse --show-toplevel 2>$null
  if (-not $root) { throw '当前目录不在 git 仓库内' }
  return $root.Trim()
}

Enable-GhProxyIfNeeded
$repo = Get-RepoRoot
Push-Location $repo
try {
  # 一次取全部 issue 的状态，避免逐个 issue 查状态。
  $states = @{}
  foreach ($i in (gh issue list --state all --limit 500 --json number,state | ConvertFrom-Json)) {
    $states[[string]$i.number] = $i.state
  }

  $open = gh issue list --state open --label $Label --limit 200 --json number,title,labels,assignees,body,url | ConvertFrom-Json

  $frontier = @()
  foreach ($issue in $open) {
    $number = [string]$issue.number
    if (@($issue.assignees).Count -gt 0) { continue }

    $blockers = New-Object 'System.Collections.Generic.SortedSet[int]'

    # 原生依赖关系
    try {
      $view = gh issue view $number --json blockedBy | ConvertFrom-Json
      foreach ($b in @($view.blockedBy.nodes)) {
        if ($null -ne $b) { [void]$blockers.Add([int]$b.number) }
      }
    } catch {
      Write-Warning "读取 #$number 的原生阻塞关系失败，仅按正文判断：$($_.Exception.Message)"
    }

    # 正文里的 Blocked by 文本（兼容 **Blocked by:** / - Blocked by:）
    foreach ($line in @($issue.body -split "`n")) {
      if ($line -match '(?i)^\s*[-*]?\s*\**\s*blocked\s+by\s*:?\s*\**\s*(.+)$') {
        foreach ($m in [regex]::Matches($Matches[1], '#(\d+)')) {
          [void]$blockers.Add([int]$m.Groups[1].Value)
        }
      }
    }

    $openBlockers = @($blockers | Where-Object {
        $key = [string]$_
        $_ -ne [int]$number -and $states[$key] -eq 'OPEN'
      })
    if ($openBlockers.Count -gt 0) { continue }

    $frontier += [pscustomobject]@{
      number   = [int]$number
      title    = $issue.title
      branch   = "sandcastle/issue-$number"
      url      = $issue.url
      blockers = @($blockers)
    }
  }

  $frontier = @($frontier | Sort-Object number)
  if ($Limit -gt 0) { $frontier = @($frontier | Select-Object -First $Limit) }

  if ($Json) {
    ConvertTo-Json -InputObject @($frontier) -Depth 4 -Compress
    return
  }

  if ($frontier.Count -eq 0) {
    Write-Output '没有可开工的 Sandcastle issue（全部被阻塞、已认领或已关闭）。'
    return
  }

  Write-Output ("可开工 {0} 个（并发上限内）：" -f $frontier.Count)
  $frontier | Format-Table number, branch, title -AutoSize | Out-String -Width 200
} finally {
  Pop-Location
}
