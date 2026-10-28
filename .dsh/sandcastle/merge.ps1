# 把一个 Sandcastle 分支合并进基线分支，并把收尾动作一次做完：
# 合并 → 门禁（typecheck/test）→ 失败回滚 → 关闭 issue → 清理 worktree/分支 → 更新编排状态。
#
# 幂等：分支已经合并过就跳过合并，仍补做关闭 issue / 清理 / 状态更新。
# 安全：门禁失败自动 `git reset --hard` 回合并前；冲突自动 `git merge --abort`；不 force 任何东西。
# 不做脏活：基线工作区有未提交的「已跟踪文件」改动时直接拒绝（不替用户提交或 stash）。
#
# 用法：
#   pwsh .dsh/sandcastle/merge.ps1 -Issue 4
#   pwsh .dsh/sandcastle/merge.ps1 -Issue 4 -Json          # 只输出一行 JSON，给 Lead 解析
#   pwsh .dsh/sandcastle/merge.ps1 -Issue 4 -DryRun        # 预演：只检查并报告，不动仓库
#   pwsh .dsh/sandcastle/merge.ps1 -Issue 4 -SkipGates -SkipClose
#
# 退出码：0 成功 / 无需操作；1 前置条件不满足；2 合并冲突（已 abort）；3 门禁失败（已回滚）；
#         4 合并成功但收尾有告警（issue 未关闭 / worktree 未清理）。
[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Issue,
  [string]$BaseBranch,
  [string[]]$Gates = @('typecheck', 'test'),
  [switch]$SkipGates,
  [switch]$SkipClose,
  [switch]$SkipCleanup,
  [switch]$DryRun,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$human = -not $Json

function Say([string]$Message) { if ($human) { Write-Host $Message } }

function Enable-GhProxyIfNeeded {
  if ($env:HTTPS_PROXY -or $env:https_proxy) { return }
  $open = Test-NetConnection 127.0.0.1 -Port 7897 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($open) {
    $env:HTTPS_PROXY = 'http://127.0.0.1:7897'
    $env:HTTP_PROXY = $env:HTTPS_PROXY
  }
}

$repo = (git rev-parse --show-toplevel 2>$null)
if (-not $repo) { throw '当前目录不在 git 仓库内' }
$repo = $repo.Trim()

$configPath = Join-Path $repo '.dsh\sandcastle\config.json'
if (-not (Test-Path $configPath)) { $configPath = Join-Path $PSScriptRoot 'config.json' }
$config = if (Test-Path $configPath) { Get-Content $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$prefix = if ($config.branchPrefix) { $config.branchPrefix } else { 'sandcastle/issue-' }
$wtDir = if ($config.worktreeDir) { $config.worktreeDir.Trim('\') } else { '.worktrees' }
$base = if ($BaseBranch) { $BaseBranch } elseif ($config.baseBranch) { $config.baseBranch } else { '' }

$branch = "$prefix$Issue"
$worktree = Join-Path $repo "$wtDir\issue-$Issue"
$stateScript = Join-Path $PSScriptRoot 'state.ps1'
$removeScript = Join-Path $PSScriptRoot 'worktree-remove.ps1'
$statePath = Join-Path $repo '.dsh\sandcastle\state.json'
$runsDir = Join-Path $repo '.dsh\sandcastle\runs'
$logPath = Join-Path $runsDir "issue-$Issue-merge.log"

function Append-Log([string]$Text) {
  if ($DryRun) { return }
  if (-not (Test-Path -LiteralPath $runsDir)) { New-Item -ItemType Directory -Force -Path $runsDir | Out-Null }
  Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) -Encoding UTF8
}

function Set-LoopState([hashtable]$Fields) {
  if ($DryRun) { return }
  $stateArgs = @('-NoProfile', '-File', $stateScript, '-Action', 'Set', '-Issue', "$Issue", '-StatePath', $statePath)
  foreach ($name in $Fields.Keys) { $stateArgs += @("-$name", "$($Fields[$name])") }
  & pwsh @stateArgs | Out-Null
}

function Get-IssueState {
  try {
    Enable-GhProxyIfNeeded
    $view = & gh issue view $Issue --json state 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($view)) { return $null }
    return ($view | ConvertFrom-Json).state
  } catch { return $null }
}

function Close-Issue {
  if ($SkipClose) { return @{ Closed = $false; Warning = $null } }
  $current = Get-IssueState
  if ($current -eq 'CLOSED') { return @{ Closed = $true; Warning = $null } }
  if ($null -eq $current) {
    return @{ Closed = $false; Warning = "无法读取 issue #$Issue 状态（gh 不可用或代理未开）" }
  }
  try {
    $out = & gh issue close $Issue --comment "Completed via Sandcastle (branch $branch)" 2>&1 | Out-String
    Append-Log "gh issue close $Issue`n$out"
    if ($LASTEXITCODE -ne 0) {
      return @{ Closed = $false; Warning = "关闭 issue 失败：$((($out -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 3) -join ' / ')" }
    }
  } catch {
    return @{ Closed = $false; Warning = "关闭 issue 失败：$($_.Exception.Message)" }
  }
  return @{ Closed = $true; Warning = $null }
}

function Remove-Worktree {
  if ($SkipCleanup) { return @{ Cleaned = $false; Warning = $null } }
  if (-not (Test-Path -LiteralPath $worktree)) { return @{ Cleaned = $false; Warning = $null } }
  try {
    $out = & pwsh -NoProfile -File $removeScript -Issue $Issue -DeleteBranch 2>&1 | Out-String
    Append-Log "worktree-remove $Issue`n$out"
    if ($LASTEXITCODE -ne 0) {
      return @{ Cleaned = $false; Warning = "worktree 清理失败：$($out.Trim())" }
    }
  } catch {
    return @{ Cleaned = $false; Warning = "worktree 清理失败：$($_.Exception.Message)" }
  }
  return @{ Cleaned = $true; Warning = $null }
}

function New-Result {
  param([string]$Status, [int]$ExitCode)
  [ordered]@{
    status      = $Status
    exitCode    = $ExitCode
    issue       = $Issue
    branch      = $branch
    base        = $base
    worktree    = $worktree
    preMerge    = $script:preMerge
    mergeCommit = $script:mergeCommit
    gates       = @($Gates)
    closed      = $script:closed
    cleaned     = $script:cleaned
    warnings    = @($script:warnings)
    detail      = $script:detail
    log         = $logPath
  }
}

function Invoke-MergeWork {
  $script:preMerge = $null
  $script:mergeCommit = $null
  $script:closed = $false
  $script:cleaned = $false
  $script:warnings = @()
  $script:detail = $null

  $current = (git branch --show-current).Trim()
  if (-not $base) { $base = $current }
  if ($current -ne $base) {
    throw "当前分支是 '$current'，不是基线分支 '$base'。先切回基线分支再合并。"
  }
  if (git rev-parse -q --verify MERGE_HEAD 2>$null) {
    throw '仓库正处于合并中（MERGE_HEAD 存在），先处理冲突或 git merge --abort。'
  }

  $dirty = @(git status --porcelain --untracked-files=no)
  if ($dirty.Count -gt 0) {
    throw ("基线工作区有未提交的已跟踪文件改动，拒绝合并（不要替用户提交或 stash）：`n  " + ($dirty -join "`n  "))
  }

  $branchExists = $false
  git show-ref --verify --quiet "refs/heads/$branch"
  $branchExists = ($LASTEXITCODE -eq 0)

  $alreadyMerged = $false
  if ($branchExists) {
    git merge-base --is-ancestor $branch $base 2>$null
    $alreadyMerged = ($LASTEXITCODE -eq 0)
  } else {
    $mergedLog = & git log --oneline --fixed-strings --grep "Merge branch '$branch'" -1 2>$null
    if ($mergedLog) { $alreadyMerged = $true }
  }

  $script:preMerge = (git rev-parse $base).Trim()

  if ($DryRun) {
    $script:detail = [ordered]@{
      branchExists  = $branchExists
      alreadyMerged = $alreadyMerged
      trackedDirty  = @()
      wouldMerge    = ($branchExists -and -not $alreadyMerged)
    }
    return (New-Result -Status 'dry-run' -ExitCode 0)
  }

  if ($alreadyMerged) {
    Say "分支 $branch 已合并进 $base，跳过合并，只做收尾。"
    Set-LoopState @{ Phase = 'merged'; Branch = $branch; Worktree = $worktree }
    $close = Close-Issue
    if ($close.Warning) { $script:warnings += $close.Warning }
    $script:closed = $close.Closed
    $clean = Remove-Worktree
    if ($clean.Warning) { $script:warnings += $clean.Warning }
    $script:cleaned = $clean.Cleaned
    $script:mergeCommit = (git rev-parse $base).Trim()
    Append-Log "already merged: $branch"
    return (New-Result -Status 'already-merged' -ExitCode 0)
  }

  if (-not $branchExists) {
    throw "分支 $branch 不存在：既没有合并记录，也没有可合并的分支。"
  }

  Say "合并 $branch → $base（合并前 $($script:preMerge)）"
  Set-LoopState @{ Phase = 'merging'; Branch = $branch; Worktree = $worktree }
  Append-Log "merge $branch into $base at $($script:preMerge)"

  $mergeOut = & git merge --no-ff $branch --no-edit 2>&1 | Out-String
  Append-Log "git merge --no-ff $branch`n$mergeOut"
  if ($LASTEXITCODE -ne 0) {
    if (git rev-parse -q --verify MERGE_HEAD 2>$null) { & git merge --abort 2>&1 | Out-Null }
    Set-LoopState @{ Phase = 'blocked'; Notes = "merge conflict: $branch into $base" }
    $script:detail = [ordered]@{
      mergeOutput = (($mergeOut -split "`r?`n") | Select-Object -Last 30) -join "`n"
    }
    Say '合并冲突，已 abort。需要人工解决（不要用新 agent 重做）。'
    return (New-Result -Status 'conflict' -ExitCode 2)
  }

  if (-not $SkipGates -and $Gates.Count -gt 0) {
    foreach ($gate in $Gates) {
      Say "门禁：pnpm $gate"
      try {
        $gateOut = & pnpm $gate 2>&1 | Out-String
        $gateCode = $LASTEXITCODE
      } catch {
        $gateOut = $_.Exception.Message
        $gateCode = 1
      }
      Append-Log "pnpm $gate -> exit $gateCode`n$gateOut"
      if ($gateCode -ne 0) {
        & git reset --hard $script:preMerge 2>&1 | Out-Null
        Set-LoopState @{ Phase = 'failed'; Notes = "gate 'pnpm $gate' failed; rolled back to $($script:preMerge)" }
        $script:detail = [ordered]@{
          gate      = $gate
          gateTail  = (($gateOut -split "`r?`n") | Select-Object -Last 25) -join "`n"
          rolledBackTo = $script:preMerge
        }
        Say "门禁 pnpm $gate 失败，已回滚到 $($script:preMerge)。"
        return (New-Result -Status 'gate-failed' -ExitCode 3)
      }
    }
  }

  $script:mergeCommit = (git rev-parse HEAD).Trim()
  Say "合并完成：$($script:mergeCommit)"

  $close = Close-Issue
  if ($close.Warning) { $script:warnings += $close.Warning }
  $script:closed = $close.Closed

  $clean = Remove-Worktree
  if ($clean.Warning) { $script:warnings += $clean.Warning }
  $script:cleaned = $clean.Cleaned

  Set-LoopState @{
    Phase       = 'merged'
    Branch      = $branch
    Worktree    = $worktree
    MergeCommit = $script:mergeCommit
  }
  Append-Log "merged $branch -> $($script:mergeCommit); closed=$($script:closed); cleaned=$($script:cleaned)"

  $status = if ($script:warnings.Count -eq 0) { 'merged' } else { 'merged-with-warnings' }
  return (New-Result -Status $status -ExitCode 0)
}

Push-Location $repo
try {
  $result = Invoke-MergeWork
} catch {
  $result = [ordered]@{
    status   = 'error'
    exitCode = 1
    issue    = $Issue
    branch   = $branch
    base     = $base
    message  = $_.Exception.Message
    log      = $logPath
  }
} finally {
  Pop-Location
}

$result | ConvertTo-Json -Depth 8 -Compress
exit $result.exitCode
