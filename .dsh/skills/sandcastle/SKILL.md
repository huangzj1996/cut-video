---
name: sandcastle
description: 用 Agent Teams 跑本仓库的 Sandcastle 工单流程：从 GitHub issue 取可开工的票，每票一个 git worktree + 一个 teammate 实现/评审，Lead 串行合并进基线分支并关闭 issue，循环到没有可开工的票。支持无人值守（goal 自动续轮）。
disable-model-invocation: true
---

# Sandcastle（DSH 版）

把 GitHub 上的 `Sandcastle` 工单变成已合并的代码。你（Lead）负责编排、校验、合并；teammate 负责实现与评审。

资产都在 `.dsh/sandcastle/`，先读 `README.md` 了解背景。

## 触发方式

用户说「跑一轮」「无人值守跑」「继续 Sandcastle」时执行本流程。若 `frontier` 为空则直接报告完成，不要硬造工作。

## 前置检查（每轮开始前，一条命令搞定）

```powershell
gh auth status; git -C . status --porcelain; git -C . branch --show-current
```

- `gh` 需要 Clash 在运行（`frontier.ps1` 会自动补 `HTTPS_PROXY`）。
- 当前分支必须是 `config.json` 里的 `baseBranch`；工作区有无关改动时先报告，不要替用户提交。
- 本轮先 `todo_write` 列出计划（取票 / 建 worktree / 派 teammate / 评审 / 合并 / 清理）。

## 一轮的步骤

### 1. 取 frontier（确定性，别自己猜依赖）

```powershell
pwsh -File .dsh/sandcastle/frontier.ps1 -Json -Limit 5
```

- `-Limit` 用 `config.json` 的 `concurrency`（当前 5）。
- 返回 `[]` → 跳到「收尾判断」。
- 每张票形如 `{ number, title, branch, url }`。

### 2. 为每张票准备 worktree

```powershell
pwsh -File .dsh/sandcastle/worktree-init.ps1 -Issue <N>
```

- 失败（例如分支被占用）→ 跳过该票并记录原因，不要让整轮失败。
- 输出里有 `worktree` 绝对路径，记下来给 teammate。

### 3. 登记共享任务并派 teammate（并发 ≤ 5）

对每张票：

1. `team_task_create`：subject 写 `#<N> <title>`，description 写工作目录、分支、验收标准来源，
   `write_scopes` 写 `[".worktrees/issue-<N>"]`。
2. `spawn_teammate`（`name: impl-issue-<N>`，`context: fresh`），prompt 必须**自包含**，包含：
   - 先 `read` 这些文件：`.dsh/sandcastle/prompts/implement.md`、`CODING_STANDARDS.md`、`AGENTS.md`
   - 参数替换：`{{ISSUE}}={{number}}`、`{{BRANCH}}={{branch}}`、`{{WORKTREE}}={{worktree 绝对路径}}`、
     `{{BASE_BRANCH}}=<config.baseBranch>`、`{{REPO}}=<仓库根绝对路径>`
   - 硬性边界：只在自己的 worktree 内写文件；不 merge、不关 issue、不碰其他 worktree；
     命令一律带 `workdir=<自己的 worktree>`
   - 完成契约：最后输出 `<promise>COMPLETE</promise>` + 中文报告（commit sha、改动、测试结果、遗留）
3. 把共享任务 id 与 teammate 名字对应记下来。

**所有票的 teammate 一起启动**（不要串行 spawn），然后：
`wait_agent` 循环 + `list_agents` 检查，直到所有 teammate inactive。

### 4. 收集并校验实现结果

对每张票执行：

```powershell
git -C <worktree> status --porcelain
git -C <worktree> log <base>..<branch> --oneline
```

- 没有 commit → 视为失败，不合并。
- 有 commit → 跑门禁：`pwsh -Command "pnpm typecheck" -workdir <worktree>`
  （在 worktree 里跑；慢但必须）。红了 → 不合并。
- 失败票：记入本轮报告；可以在**下一轮**重试（最多重试一次），本轮不再纠缠。

### 5. 评审（同一 worktree，第二个 teammate）

只对通过门禁的分支派 reviewer：

- `spawn_teammate`（`name: review-issue-<N>`，`context: fresh`），prompt 结构同上，改成读
  `.dsh/sandcastle/prompts/review.md`，并把实现者的报告一并给它。
- Reviewer 完成后再次跑门禁（`pnpm typecheck`），全绿才进入合并。

### 6. 串行合并（一次只合一个，合完立刻验证）

在主工作区（`baseBranch`）按 issue 号从小到大：

```powershell
git merge --no-ff <branch> --no-edit
pnpm typecheck
pnpm test
```

- 冲突：按「保留上游行为 + 补本 issue 部分」解决；解决不了就 `git merge --abort`，把该票记为未合并。
- 验证红：`git reset --hard <合并前的 commit>`，记为未合并。
- 合并成功：
  ```powershell
  gh issue close <N> --comment "Completed via Sandcastle (branch <branch>)"
  pwsh -File .dsh/sandcastle/worktree-remove.ps1 -Issue <N> -DeleteBranch
  ```
- 更新共享任务为 completed；把 teammate 的最终报告摘要记进本轮总结。

### 7. 回到第 1 步

合并会解锁新票。本轮结束时若 frontier 非空且还有余额度，继续下一轮；否则按下方判断收尾。

## 无人值守循环

用户说「无人值守跑 / 一直跑到没有票」时：

1. `create_goal`，objective 写明：「完成本仓库所有可开工的 Sandcastle 工单：#4 起按依赖顺序实现、评审、合并、关闭，
   直到 `frontier.ps1` 返回空且没有未合并的 `sandcastle/issue-*` 分支；每轮并发上限 5，合并前必须 typecheck+test 全绿」，
   `max_goal_rounds` 取 `config.json` 的 `maxRounds`（当前 10）。
2. 之后每个自动续轮执行「一轮的步骤」。
3. 满足完成条件时 `update_goal complete`；遇到需要人决策的阻塞时**停下**（保持仓库可恢复），
   写清楚卡在哪张票、哪一步、需要用户做什么，再 `update_goal blocked`（或直接报告后等待）。

## 幂等与恢复

- 分支名固定 `sandcastle/issue-<N>`，worktree 固定 `.worktrees/issue-<N>`，frontier 每轮重推。
- 开跑前先看 `git worktree list` 和 `git branch --list 'sandcastle/*'`：
  已存在且未合并的分支直接复用，已合并的直接清理，不要重复实现。
- 中断后重跑同一流程即可，不需要状态文件。

## 硬性规则

- **一个 teammate 只碰自己的 worktree**，主工作区只由 Lead 改（合并冲突除外）。
- **红着不合**：任何一次合并前 typecheck/test 必须绿；红了先回滚再报告。
- 不 force push、不 rebase 别人的分支、不删除未合并的分支（`worktree-remove` 用安全的 `-d`）。
- 不关闭未合并的 issue；不为留痕制造空提交。
- 不修改 `docs/agents/*`、`AGENTS.md` 等流程文档来完成业务票。
- 每轮结束给用户一段总结：合并了几张、关闭了哪几张、卡住哪几张、下一轮会做什么。
