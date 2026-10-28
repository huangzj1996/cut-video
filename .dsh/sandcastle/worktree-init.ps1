# 为一个 Sandcastle issue 准备 git worktree，并装好依赖。
#
# 分支：sandcastle/issue-<N>（已存在则复用，保证重跑幂等）
# 目录：<repo>/.worktrees/issue-<N>
#
# 用法：
#   pwsh .dsh/sandcastle/worktree-init.ps1 -Issue 4
#   pwsh .dsh/sandcastle/worktree-init.ps1 -Issue 4 -Prepare link   # 用 junction 共享主仓 node_modules
#   pwsh .dsh/sandcastle/worktree-init.ps1 -Issue 4 -Prepare none   # 只建 worktree
#
# -Prepare install（默认）：在 worktree 内 pnpm install --frozen-lockfile --prefer-offline。
#   跳过 electron 二进制下载（单测/类型检查用不到）；需要跑 electron 时用 link 复用主仓依赖。
[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Issue,
  [ValidateSet('install', 'link', 'none')][string]$Prepare = 'install',
  [string]$BaseRef = 'HEAD'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repo = (git rev-parse --show-toplevel).Trim()
if (-not $repo) { throw '当前目录不在 git 仓库内' }
$configPath = Join-Path $repo '.dsh\sandcastle\config.json'
$config = if (Test-Path $configPath) { Get-Content $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$prefix = if ($config.branchPrefix) { $config.branchPrefix } else { 'sandcastle/issue-' }
$wtDir = if ($config.worktreeDir) { $config.worktreeDir.Trim('\') } else { '.worktrees' }

$branch = "$prefix$Issue"
$worktree = Join-Path $repo "$wtDir\issue-$Issue"

Push-Location $repo
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $repo $wtDir) | Out-Null

  $listed = @(git worktree list --porcelain)
  $already = $listed | Where-Object { $_.StartsWith('worktree ') -and $_.Substring(9).Trim() -eq $worktree }
  if (-not $already) {
    $branchExists = $false
    git show-ref --verify --quiet "refs/heads/$branch"
    $branchExists = ($LASTEXITCODE -eq 0)
    if ($branchExists) {
      git worktree add $worktree $branch | Out-Null
    } else {
      git worktree add -b $branch $worktree $BaseRef | Out-Null
    }
    # 原生命令失败不会抛异常，必须显式检查：否则会输出"成功"却什么都没建。
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $worktree)) {
      throw "git worktree add 失败（exit $LASTEXITCODE）：分支 $branch / 目录 $worktree"
    }
  }

  switch ($Prepare) {
    'install' {
      if (-not (Test-Path (Join-Path $worktree 'node_modules'))) {
        Push-Location $worktree
        try {
          $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
          $env:ELECTRON_SKIP_BINARY_DOWNLOAD_FOR_TESTS = '1'
          pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
          if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（exit $LASTEXITCODE）" }
        } finally {
          Pop-Location
        }
      }
    }
    'link' {
      $target = Join-Path $worktree 'node_modules'
      if (-not (Test-Path $target)) {
        $mainModules = Join-Path $repo 'node_modules'
        if (-not (Test-Path $mainModules)) { throw "主仓没有 node_modules，先跑一次 pnpm install" }
        cmd /c mklink /J "$target" "$mainModules" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "创建 node_modules junction 失败（exit $LASTEXITCODE）" }
      }
    }
    'none' { }
  }

  [pscustomobject]@{
    issue    = $Issue
    branch   = $branch
    worktree = $worktree
    prepare  = $Prepare
  } | ConvertTo-Json -Compress
} finally {
  Pop-Location
}
