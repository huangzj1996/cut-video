---
name: sandcastle
description: 用 Agent Teams 跑本仓库的 Sandcastle 工单流程：从 GitHub issue 取可开工的票，每票一个 git worktree + 一个 teammate 实现/评审，Lead 串行合并进基线分支并关闭 issue，循环到没有可开工的票。teammate 按票内生命周期复用（返工、复审、回归），编排状态落在 state.json。支持无人值守（goal 自动续轮）。
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
pwsh -File .dsh/sandcastle/state.ps1 -Action List
```

- `gh` 需要 Clash 在运行（`frontier.ps1` 会自动补 `HTTPS_PROXY`）。
- 当前分支必须是 `config.json` 里的 `baseBranch`；工作区有无关改动时先报告，不要替用户提交。
- **先读 state**：`state.ps1 -Action List` 给出 issue → teammate → 阶段 + worktree 的映射。
  已 `merged` 的票不用再跑；`implementing / reviewing / rework` 的票要顺着续做，不要重新派 agent。
- **看名额预算**：`list_agents` 数一下 roster。Team 的 `maxMembers` 是 8（profile bundle 配置；
  名字永久占位，创建失败的也占），每张票最多占 2 个名字（impl + review），所以一个会话大约只跑得动
  4 张票。剩余名额不足时：
  - 优先**唤醒**已有 agent（`send_message`），不要 `spawn_teammate`；
  - 确实要新开，先让用户把 profile 的 `agent-team.maxMembers` 调大（`cordis.patch.yml`），
    调不了就报告阻塞，不要硬派到 `TEAM_MEMBER_LIMIT`。
- 本轮先 `todo_write` 列出计划（取票 / 恢复状态 / 建 worktree / 派 teammate / 评审 / 合并 / 清理）。

## 一轮的步骤

### 1. 取 frontier（确定性，别自己猜依赖）

```powershell
pwsh -File .dsh/sandcastle/frontier.ps1 -Json -Limit 5
```

- `-Limit` 用 `config.json` 的 `concurrency`（当前 5）。
- 返回 `[]` → 跳到「收尾判断」。
- 每张票形如 `{ number, title, branch, url }`。

### 2. 用状态过滤器挑票

- 对照 `state.ps1 -Action List`：跳过已 `merged` / `blocked` 的票；`implementing / reviewing / rework`
  的票走续做路径（检查 agent 是否 inactive、worktree 是否还在）。
- 对照 `git worktree list`：worktree 已存在的票直接复用，不要让 `worktree-init` 重建。
- 本轮实际处理的票 = frontier 里真正需要新工作的票，按 issue 号升序。

### 3. 为每张票准备 worktree

```powershell
pwsh -File .dsh/sandcastle/worktree-init.ps1 -Issue <N>
```

- 失败（例如分支被占用）→ 跳过该票并记录原因，不要让整轮失败。
- 输出里有 `worktree` 绝对路径，记下来给 teammate，并写进 state。

### 4. 登记共享任务并派 teammate（复用优先，并发 ≤ 5）

对每张票：

1. **先查名字**：`list_agents` / state 里已有 `impl-issue-<N>` 就**不能 spawn**（名字永久，重复会失败），
   只能 `send_message` 唤醒它续做。
2. `team_task_create`：subject 写 `#<N> <title>`，description 写工作目录、分支、验收标准来源，
   `write_scopes` 写 `[".worktrees/issue-<N>"]`。
3. `spawn_teammate`（`name: impl-issue-<N>`，`context: fresh`），prompt 必须**自包含**，包含：
   - 先 `read` 这些文件：`.dsh/sandcastle/prompts/implement.md`、`CODING_STANDARDS.md`、`AGENTS.md`
   - 参数替换：`{{ISSUE}}={{number}}`、`{{BRANCH}}={{branch}}`、`{{WORKTREE}}={{worktree 绝对路径}}`、
     `{{BASE_BRANCH}}=<config.baseBranch>`、`{{REPO}}=<仓库根绝对路径>`
   - 硬性边界：只在自己的 worktree 内写文件；不 merge、不关 issue、不碰其他 worktree；
     命令一律带 `workdir=<自己的 worktree>`
   - 完成契约：最后输出 `<promise>COMPLETE</promise>` + 中文报告（commit sha、改动、测试结果、遗留）
4. 立刻写状态，避免中断后失忆：

   ```powershell
   pwsh -File .dsh/sandcastle/state.ps1 -Action Set -Issue <N> -Phase implementing `
     -Impl impl-issue-<N> -Branch sandcastle/issue-<N> -Worktree <绝对路径>
   ```

5. 把共享任务 id 与 teammate 名字对应记下来。

**所有票的 impl teammate 一起启动**（不要串行 spawn），然后：
`wait_agent` 循环 + `list_agents` 检查，直到所有 teammate inactive。

### 5. 收集并校验实现结果

对每张票执行：

```powershell
git -C <worktree> status --porcelain
git -C <worktree> log <base>..<branch> --oneline
```

- 没有 commit → 视为失败，不合并（state → `failed`，notes 写原因）。
- 有 commit → 跑门禁：`pwsh -Command "pnpm typecheck" -workdir <worktree>`
  （在 worktree 里跑；慢但必须）。红了 → 不合并。
- 失败票：记入本轮报告；可以在**下一轮**重试（最多重试一次），本轮不再纠缠。

### 6. 评审（同一 worktree，第二个 teammate；返工不新开 agent）

只对通过门禁的分支派 reviewer：

- `spawn_teammate`（`name: review-issue-<N>`，`context: fresh`），prompt 结构同上，改成读
  `.dsh/sandcastle/prompts/review.md`，并把实现者的报告一并给它。
- 完成后 `state.ps1 -Action Set -Issue <N> -Phase reviewing -Review review-issue-<N>`，并再跑一次门禁。

评审结论分两种：

- **通过** → 进入合并。
- **有阻塞问题（P0/P1）** → **不要新开 agent**：
  1. `state.ps1 -Action Set -Issue <N> -Phase rework -ReworkCount <当前+1> -Notes "<问题摘要>"`；
  2. `send_message` 给 `impl-issue-<N>`，带上评审发现、复现证据、必须满足的验收点，让它回自己的 worktree 修；
  3. 修完后 `send_message` 唤醒 `review-issue-<N>` **复审**（保留同一评审上下文）；
  4. **同一张票最多 2 轮返工**，超过就停下报告（`state` → `blocked`），不要无限循环。

### 7. 串行合并（用 merge.ps1，一次只合一个）

在主工作区（`baseBranch`）按 issue 号从小到大：

```powershell
pwsh -File .dsh/sandcastle/merge.ps1 -Issue <N> -Json
```

`merge.ps1` 一次做完：`git merge --no-ff` → `pnpm typecheck && pnpm test` → 失败自动 `reset --hard`
回滚 → `gh issue close` → 清理 worktree/分支 → 更新 state。它幂等，重复执行安全。

读返回的 `status`：

| status | 含义 | 你要做的 |
| --- | --- | --- |
| `merged` | 合并、门禁、关 issue、清理全成功 | 更新共享任务为 completed，记摘要 |
| `merged-with-warnings` | 合并成功，但关 issue 或清理失败 | 记下 warning，下一轮补做（不要重新合并） |
| `already-merged` | 分支之前就合过了，已补收尾 | 同上，不要重复合并 |
| `conflict` | 冲突，已自动 abort | 按「保留上游行为 + 补本 issue 部分」人工解决；解决不了记 `blocked` 并报告 |
| `gate-failed` | 门禁红了，已回滚到合并前 | state 已是 `failed`；按实现失败处理（下一轮重试或报告） |
| `error` | 前置条件不满足（分支不在 / 工作区脏 / 分支不对） | 按 `message` 修正；**不要**手工 `reset --hard` 绕过它 |

- 合并成功才关 issue（脚本已处理）；不合并就不关 issue。
- 冲突或门禁失败时，不要用新 agent 重做整张票；先按上表处理，必要时唤醒 `impl-issue-<N>`。

### 8. 回到第 1 步

合并会解锁新票。本轮结束时若 frontier 非空且还有余额度，继续下一轮；否则按下方判断收尾。

## 复用与生命周期

一次性 fresh agent 对**相互独立**的票是正确默认（隔离干净、可并行）。复用只发生在生命周期接缝上：

- **impl-N 是 #N 的 owner**，直到该 issue 关闭、且依赖它的直接后继票合并（或你显式释放）。
- **票内返工 / 复审**：`send_message` 唤醒原 agent，不要新开。原 agent 有自己写过的代码、worktree、
  测试与失败上下文，比新 agent 更准，也不用重新 onboarding。
- **票后回归**：后续票暴露的回归（例如 #13 的浮点边界来自 #4/#5 的预览链路）优先唤醒该模块的原 owner；
  它的 worktree 被清掉也能直接改新 worktree。
- **跨票新功能**：仍然 `fresh`，不共享上下文，避免把上一张票的陈旧假设带进新票。
- 复用的代价：上下文膨胀、旧假设过期、一个 agent 卡住拖累多票。限制：同一票最多 2 轮返工；
  一个 agent 只负责一张票/一个模块。
- 不为复用而复用：票本身小、彼此独立时，fresh 的一次性 agent 更便宜。
- **roster 属于当前 Lead 会话**：换新会话/新 goal 后，state 里记的 `impl-*` / `review-*` 名字不再可唤醒
  （名字只在原会话内有效），只当历史保留；新会话从空 roster 开始，按第 2 步重新对齐 git 与 frontier 再派。

## 状态文件 state.json

```powershell
pwsh -File .dsh/sandcastle/state.ps1 -Action List      # 全部状态
pwsh -File .dsh/sandcastle/state.ps1 -Action Get -Issue 7
pwsh -File .dsh/sandcastle/state.ps1 -Action Set -Issue 7 -Phase reviewing -Review review-issue-7
pwsh -File .dsh/sandcastle/state.ps1 -Action Set -Issue 7 -Phase merged -MergeCommit <sha>
pwsh -File .dsh/sandcastle/state.ps1 -Action Remove -Issue 7   # 仅历史清理用，一般保留
```

字段：`phase`（`pending / worktree / implementing / reviewing / rework / merging / merged / failed / blocked`）、
`impl`、`review`、`branch`、`worktree`、`reworkCount`、`mergeCommit`、`notes`、`createdAt`、`updatedAt`。

- 每轮开始 `List`，派活/返工/合并后 `Set`；不要手工编辑 JSON。
- 状态文件是**编排状态**，代码状态仍以 git 与 GitHub 为准；两者冲突时以 git 为准，再修正 state。
- `state.json` 与 `runs/` 已在 `.gitignore` 中忽略。

## 无人值守循环

用户说「无人值守跑 / 一直跑到没有票」时：

1. `create_goal`，objective 写明：「完成本仓库所有可开工的 Sandcastle 工单：#4 起按依赖顺序实现、评审、合并、关闭，
   直到 `frontier.ps1` 返回空且没有未合并的 `sandcastle/issue-*` 分支；每轮并发上限 5，合并前必须 typecheck+test 全绿；
   返工与复审复用原 teammate，不新开 agent」，
   `max_goal_rounds` 取 `config.json` 的 `maxRounds`（当前 10）。
2. 之后每个自动续轮执行「一轮的步骤」，每轮开始先读 `state.ps1 -Action List`。
3. 满足完成条件时 `update_goal complete`；遇到需要人决策的阻塞时**停下**（保持仓库可恢复），
   写清楚卡在哪张票、哪一步、需要用户做什么，再 `update_goal blocked`（或直接报告后等待）。

## 幂等与恢复

- 分支名固定 `sandcastle/issue-<N>`，worktree 固定 `.worktrees/issue-<N>`，frontier 每轮重推。
- 开跑前对齐三样东西：`state.ps1 -Action List`、`git worktree list`、`git branch --list 'sandcastle/*'`。
  已合并的票直接清理，已存在未合并的分支直接复用，不要重复实现。
- 中断后重跑同一流程即可：state 给出"谁在做哪张票"，git 给出"代码到哪了"。

## 硬性规则

- **一个 teammate 只碰自己的 worktree**，主工作区只由 Lead 改（合并冲突除外）。
- **红着不合**：任何一次合并前 typecheck/test 必须绿；红了先回滚再报告。
- **合并只用 `merge.ps1`**；不要手工 `git reset --hard`，也不要绕过它自己的回滚判断。
- **返工 / 复审复用原 agent**；名字永久占位，新开 agent 既浪费名额又丢上下文。
- 不 force push、不 rebase 别人的分支、不删除未合并的分支（`worktree-remove` 用安全的 `-d`）。
- 不关闭未合并的 issue；不为留痕制造空提交。
- 不修改 `docs/agents/*`、`AGENTS.md` 等流程文档来完成业务票。
- 每轮结束给用户一段总结：合并了几张、关闭了哪几张、卡住哪几张、下一轮会做什么。
