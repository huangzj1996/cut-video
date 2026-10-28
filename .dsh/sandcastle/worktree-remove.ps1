# 清理某个 Sandcastle issue 的 worktree（合并完成后执行）。
#
# 用法：
#   pwsh .dsh/sandcastle/worktree-remove.ps1 -Issue 4              # 只删 worktree 目录
#   pwsh .dsh/sandcastle/worktree-remove.ps1 -Issue 4 -DeleteBranch # 连分支一起删（确认已合并）
#
# 注意：-DeleteBranch 用 git branch -d（安全删除，未合并会拒绝），
# 需要强制删除时手工执行 git branch -D。
[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Issue,
  [switch]$DeleteBranch
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
  if (Test-Path $worktree) {
    git worktree remove --force $worktree
    if ($LASTEXITCODE -ne 0) { throw "git worktree remove 失败（exit $LASTEXITCODE）" }
  }
  git worktree prune

  $deleted = $false
  if ($DeleteBranch) {
    git branch -d $branch 2>$null | Out-Null
    $deleted = ($LASTEXITCODE -eq 0)
    if (-not $deleted) {
      Write-Warning "分支 $branch 未删除（可能还没合并）：需要时手工 git branch -D $branch"
    }
  }

  [pscustomobject]@{
    issue          = $Issue
    branch         = $branch
    worktree       = $worktree
    branchDeleted  = $deleted
  } | ConvertTo-Json -Compress
} finally {
  Pop-Location
}
