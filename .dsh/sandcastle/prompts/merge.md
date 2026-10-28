# 合并一批 Sandcastle 分支

在**主工作区**（基线分支 `{{BASE_BRANCH}}`）执行。一次只合一个分支，合完立刻验证。

## 待合并分支

{{BRANCHES}}

## 对应 issue

{{ISSUES}}

## 步骤

对每个分支，按顺序：

1. 确认工作区干净：`git status --porcelain`（有无关改动就先停下报告，不要顺手提交别人的文件）。
2. `git merge <branch> --no-edit`。
3. 有冲突时：读两侧实现，按"保留上游已有行为 + 补上本 issue 的部分"解决，不要整段丢弃另一侧。
4. 解决后立刻验证：`pnpm typecheck && pnpm test`。
5. 验证不通过：`git merge --abort`（或 `git reset --hard` 回到合并前），把该分支标记为**未合并**并在报告里说明原因，继续处理下一个分支。
6. 验证通过：保留合并提交（不要 squash），继续下一个分支。

## 收尾

- 全部合并完成后，跑一次全量 `pnpm typecheck && pnpm test`。
- 对每个**成功合并**的分支，关闭对应 issue：
  ```
  gh issue close <ID> --comment "Completed via Sandcastle (branch <branch>)"
  ```
- 清理 worktree 与已合并分支：`pwsh .dsh/sandcastle/worktree-remove.ps1 -Issue <ID> -DeleteBranch`
- 不要关闭未合并的 issue，不要删除未合并的分支。

## 报告

输出 `<promise>COMPLETE</promise>`，并给出：

- 合并成功的分支与 commit sha
- 冲突文件与解决方式
- 未合并的分支及原因
- 全量验证结果
- 已关闭的 issue 列表
