# 维护 Sandcastle 编排状态：issue → teammate / 阶段 / worktree 的映射。
#
# 为什么需要它：teammate 名字永久、worktree 与分支固定，但"哪个 issue 由哪个 agent 负责、
# 处于哪个阶段、返工过几次"只存在于 Lead 的上下文里。中断恢复、返工唤醒、复审唤醒都依赖
# 这份映射；它是编排状态（状态文件），不是代码状态（代码状态仍以 git 为准）。
#
# 用法：
#   pwsh .dsh/sandcastle/state.ps1 -Action List
#   pwsh .dsh/sandcastle/state.ps1 -Action Get -Issue 4
#   pwsh .dsh/sandcastle/state.ps1 -Action Set -Issue 4 -Phase implementing -Impl impl-issue-4 -Review review-issue-4 -Branch sandcastle/issue-4 -Worktree <绝对路径>
#   pwsh .dsh/sandcastle/state.ps1 -Action Set -Issue 4 -Phase rework -ReworkCount 1 -Notes "评审 P1：相邻字幕共享边界"
#   pwsh .dsh/sandcastle/state.ps1 -Action Set -Issue 4 -Phase merged -MergeCommit <sha>
#   pwsh .dsh/sandcastle/state.ps1 -Action Remove -Issue 4
#
# 状态文件默认 <repo>/.dsh/sandcastle/state.json（已在 .gitignore 中忽略），可用 -StatePath 覆盖。
# 输出统一为 JSON（Compact），方便 Lead 直接解析。
[CmdletBinding()]
param(
  [ValidateSet('List', 'Get', 'Set', 'Remove')][string]$Action = 'List',
  [int]$Issue,
  [ValidateSet('pending', 'worktree', 'implementing', 'reviewing', 'rework', 'merging', 'merged', 'failed', 'blocked')]
  [string]$Phase,
  [string]$Impl,
  [string]$Review,
  [string]$Branch,
  [string]$Worktree,
  [int]$ReworkCount = -1,
  [string]$Notes,
  [string]$MergeCommit,
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $StatePath) { $StatePath = Join-Path $PSScriptRoot 'state.json' }
$StatePath = [System.IO.Path]::GetFullPath($StatePath)

function New-State {
  [ordered]@{
    version   = 1
    updatedAt = (Get-Date).ToString('o')
    issues    = [ordered]@{}
  }
}

function Read-State {
  if (-not (Test-Path -LiteralPath $StatePath)) { return (New-State) }
  $raw = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8
  if ([string]::IsNullOrWhiteSpace($raw)) { return (New-State) }

  $state = $raw | ConvertFrom-Json -AsHashtable
  if ($null -eq $state) { return (New-State) }
  if ($null -eq $state['issues']) { $state['issues'] = [ordered]@{} }
  if ($null -eq $state['version']) { $state['version'] = 1 }
  return $state
}

function Write-State($state) {
  $state['updatedAt'] = (Get-Date).ToString('o')
  $dir = Split-Path -Parent $StatePath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  # 先写临时文件再原子替换：避免中断留下半截 JSON。
  $tmp = "$StatePath.tmp"
  $json = $state | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $StatePath -Force
}

function Out-Result($obj) { $obj | ConvertTo-Json -Depth 12 -Compress }

if ($Issue -le 0 -and $Action -ne 'List') { throw "$Action 需要 -Issue <工单号>" }

switch ($Action) {
  'List' {
    $state = Read-State
    Out-Result ([ordered]@{
        statePath = $StatePath
        updatedAt = $state['updatedAt']
        issues    = $state['issues']
      })
  }

  'Get' {
    $state = Read-State
    $entry = $state['issues'][[string]$Issue]
    Out-Result ([ordered]@{
        issue     = $Issue
        statePath = $StatePath
        entry     = $entry
      })
  }

  'Set' {
    $updates = @{}
    if ($PSBoundParameters.ContainsKey('Phase')) { $updates['phase'] = $Phase }
    if ($PSBoundParameters.ContainsKey('Impl')) { $updates['impl'] = $Impl }
    if ($PSBoundParameters.ContainsKey('Review')) { $updates['review'] = $Review }
    if ($PSBoundParameters.ContainsKey('Branch')) { $updates['branch'] = $Branch }
    if ($PSBoundParameters.ContainsKey('Worktree')) { $updates['worktree'] = $Worktree }
    if ($PSBoundParameters.ContainsKey('ReworkCount')) { $updates['reworkCount'] = $ReworkCount }
    if ($PSBoundParameters.ContainsKey('Notes')) { $updates['notes'] = $Notes }
    if ($PSBoundParameters.ContainsKey('MergeCommit')) { $updates['mergeCommit'] = $MergeCommit }
    if ($updates.Count -eq 0) {
      throw 'Set 至少需要一个字段：-Phase / -Impl / -Review / -Branch / -Worktree / -ReworkCount / -Notes / -MergeCommit'
    }

    $state = Read-State
    $key = [string]$Issue
    $entry = $state['issues'][$key]
    if ($null -eq $entry) {
      $entry = [ordered]@{ createdAt = (Get-Date).ToString('o') }
    }
    foreach ($name in $updates.Keys) { $entry[$name] = $updates[$name] }
    $entry['updatedAt'] = (Get-Date).ToString('o')
    $state['issues'][$key] = $entry

    Write-State $state
    Out-Result ([ordered]@{
        action    = 'set'
        issue     = $Issue
        statePath = $StatePath
        entry     = $entry
      })
  }

  'Remove' {
    $state = Read-State
    $key = [string]$Issue
    $existed = $null -ne $state['issues'][$key]
    if ($existed) {
      $state['issues'].Remove($key)
      Write-State $state
    }
    Out-Result ([ordered]@{
        action    = 'remove'
        issue     = $Issue
        statePath = $StatePath
        removed   = $existed
      })
  }
}
