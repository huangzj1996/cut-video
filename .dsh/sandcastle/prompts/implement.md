# 实现一张 Sandcastle 票

你是一个**并发实现者**，只负责一个 issue、一个 worktree。其他 worktree 属于别的 agent，绝对不要碰。

## 分配给你的参数

- Issue：`#{{ISSUE}}`
- 分支：`{{BRANCH}}`
- 你的 worktree（所有文件改动与命令都在这里）：`{{WORKTREE}}`
- 基线分支（只读参考，不要合并进它）：`{{BASE_BRANCH}}`
- 仓库根目录（只读参考）：`{{REPO}}`

## 第一步：把任务读全

1. `gh issue view {{ISSUE}} --json number,title,body,labels,comments`（在仓库根目录执行，gh 已登录）。
2. 正文里有 `Parent PRD: #N` 时，把父 PRD 也读一遍：`gh issue view N --json title,body`。
3. 读 `{{REPO}}/AGENTS.md` 和 `{{REPO}}/.dsh/sandcastle/CODING_STANDARDS.md`。
4. 读 `{{WORKTREE}}/docs/agents/domain.md`，按里面的规则使用领域词汇。

## 第二步：探索

在 worktree 里读相关代码、组件、测试，弄清现有实现和约定。**先看清楚再动手**。

## 第三步：实现（TDD）

- 用 `skill` 工具加载 `tdd` 技能，按其红-绿-重构循环推进。
- 每次只做一个可验证的小切片；一个切片绿了再做下一个。
- 所有命令都用 worktree 作为工作目录（pwsh 的 `-workdir`，或 `git -C {{WORKTREE}}`）。

## 第四步：自检（必须全绿才能提交）

```powershell
# 在 {{WORKTREE}} 下
pnpm typecheck
pnpm test
```

如果全量测试太慢，至少跑改动包的 `pnpm --filter @miaoma/<包名> typecheck` 和 `pnpm --filter @miaoma/<包名> test`，
最后再跑一次全量 `pnpm typecheck && pnpm test`。

## 第五步：提交

在 `{{WORKTREE}}` 下提交到当前分支（`{{BRANCH}}`）：

- 提交信息格式见 `CODING_STANDARDS.md`：`feat: ...` / `fix: ...`，正文列关键决策，结尾 `Refs #{{ISSUE}}`。
- 不要 rebase、不要 force push、不要合并基线分支、不要关闭 issue。
- 可以提交多次；每次提交都要是一个可编译的状态。

## 边界

- 只在 `{{WORKTREE}}` 内写文件；不要改主工作区和其他 `.worktrees/issue-*`。
- 不要执行 `pnpm install`（依赖已准备好）；确实需要新依赖时，先停下并在报告里说明。
- 不要运行 `git worktree`、`git merge`、`git checkout` 到别的分支。
- 已经做完的事不要回退；冲突时保留上游已有实现，只补本 issue 的部分。

## 结束

完成后输出一行：

```
<promise>COMPLETE</promise>
```

并在最终回复里给出**简短报告**（中文）：
- 分支与最后 commit sha
- 改了哪些文件（分组）
- 测试与类型检查结果（贴关键输出行）
- 遗留问题 / 给 reviewer 的提示
- 是否完全满足 issue 的验收标准（是/否 + 理由）
