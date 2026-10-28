# 合并一批 Sandcastle 分支

在**主工作区**（基线分支 `{{BASE_BRANCH}}`）执行。一次只合一个分支，合完立刻验证。

## 待合并分支

{{BRANCHES}}

## 对应 issue

{{ISSUES}}

## 步骤

对每个分支（issue 号升序）执行一条命令：

```powershell
pwsh -File .dsh/sandcastle/merge.ps1 -Issue <N> -Json
```

脚本内部依次完成：`git merge --no-ff` → `pnpm typecheck && pnpm test` → 失败自动
`git reset --hard` 回滚 → `gh issue close` → 清理 worktree 与已合并分支 → 更新 `state.json`。
它是幂等的，重复执行安全。

根据返回的 `status` 处理：

- `merged` / `merged-with-warnings` / `already-merged`：记下 `mergeCommit` 与 warning；
  warning（关 issue 或清理失败）下一轮补做，不要重新合并。
- `conflict`：脚本已 `git merge --abort`。按「保留上游已有行为 + 补上本 issue 的部分」人工解决；
  解决不了就把该票记为未合并并报告原因。
- `gate-failed`：脚本已回滚到合并前；该票按未合并处理（state 已是 `failed`）。
- `error`：前置条件不满足（分支不存在 / 工作区有未提交改动 / 当前不在基线分支），
  按 `message` 修正；**不要**手工 `reset --hard` 或 `merge --abort` 绕过它。

## 禁止

- 不要手工 `git merge` / `git reset --hard` / `git branch -D` 绕过脚本判断。
- 不要关闭未合并的 issue，不要 force push。

## 收尾

- `pwsh -File .dsh/sandcastle/state.ps1 -Action List` 复核：成功票 `phase=merged`，失败票有 `notes`。
- 更新共享任务为 completed（仅成功票）。
- 输出 `<promise>COMPLETE</promise>`，并给出报告：
  - 每张票的 `status` 与 merge commit sha
  - 冲突文件与解决方式
  - 未合并的分支及原因
  - 全量验证结果
  - 已关闭的 issue 列表
