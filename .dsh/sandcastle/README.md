# Sandcastle（DSH 版）

把 GitHub 上的 `Sandcastle` 工单变成已合并的代码。原 `.sandcastle/`（TypeScript + Docker + Claude Code CLI）已删除，
这里用 DSH 原生能力重写：**git worktree 做隔离，Agent Teams 做并发，Lead 做合并**。

## 一轮流程

```
frontier.ps1 ──► 每票一个 worktree ──► 每票一个 teammate ──► 串行合并 ──► 关闭 issue ──► 回到起点
（确定性筛选）    （sandcastle/issue-N）   （implement + review）    （Lead 在主工作区）  （gh issue close）
```

- **计划**：不再让 LLM 猜依赖图，直接查 GitHub 原生 `blocked_by` + 正文 `Blocked by`，确定性筛出可开工的票。
- **执行**：每个 issue 一个 `git worktree`（分支 `sandcastle/issue-<N>`）+ 一个 teammate；并发上限 5。
- **评审**：实现者在自己的 worktree 里提交后，reviewer 在同一 worktree 上按 `CODING_STANDARDS.md` 精修。
- **合并**：Lead 在主工作区**串行**合并，每次合并后跑 `pnpm typecheck && pnpm test`，绿了才继续。
- **循环**：合并会解锁新票，重复直到 frontier 为空。无人值守由 DSH goal（自动续轮）驱动。
- **状态**：每张票的 impl / review / 阶段 / worktree 记在 `state.json`（用 `state.ps1` 读写），
  续轮恢复和返工唤醒都靠它。

## 文件

| 路径                            | 作用                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `config.json`                   | 标签、基线分支、分支前缀、worktree 目录、并发上限、最大轮数 |
| `frontier.ps1`                  | 列出可开工的 issue（`-Json` 给编排用，`-Limit N` 限并发）   |
| `worktree-init.ps1`             | 建分支 + worktree + 装依赖（`install` / `link` / `none`）   |
| `worktree-remove.ps1`           | 合并后清理 worktree，可选安全删除分支                       |
| `state.ps1`                     | 读写编排状态 `state.json`（issue → teammate / 阶段 / worktree） |
| `merge.ps1`                     | 合并 + 门禁 + 失败回滚 + 关 issue + 清理 + 更新状态（幂等）  |
| `CODING_STANDARDS.md`           | reviewer/implementer 共同遵守的规范（来自仓库真实配置）     |
| `prompts/implement.md`          | 实现者提示词（TDD、验证、提交、报告）                       |
| `prompts/review.md`             | 评审者提示词（code-review 双轴 + 精修）                     |
| `prompts/merge.md`              | 合并步骤（Lead 或合并 agent 用）                            |
| `../skills/sandcastle/SKILL.md` | 编排 SOP：一轮怎么做、无人值守怎么跑                        |

## 相对旧版的变化

| 旧 Sandcastle                                     | 现在                                                               | 收益                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Docker 容器每票一个                               | git worktree                                                       | 不用 Docker Desktop；依赖走 `D:\.pnpm-store` 硬链接，额外占用很小 |
| 容器内 `pnpm install`（~10 分钟）                 | 宿主机 worktree 内安装（`--prefer-offline`，跳过 electron 二进制） | 几秒到几十秒                                                      |
| `claudeCode()` + Anthropic 兼容网关 + `.env` 令牌 | DSH 的 subagent / teammate                                         | 不需要任何模型 key 或网关配置                                     |
| `.env` 里的 `GH_TOKEN`                            | gh keyring 登录                                                    | 不需要把 token 写进仓库                                           |
| LLM 建依赖图                                      | `gh` 原生依赖 + 正文阻塞                                           | 确定性、可复现、不烧 token                                        |
| `Output.object` 结构化输出                        | teammate 的结构化报告 + Lead 校验                                  | 简化                                                              |
| 内置 `maxIterations`                              | agent 自终止 + 完成契约 `<promise>COMPLETE</promise>`              | 简化                                                              |
| `claudeCode()` 每票一个一次性 agent               | impl/review teammate 按票内生命周期复用（返工、复审、回归唤醒原 agent） | 少付 onboarding 成本，也不撞 Team 的 8 个名额                         |

## 前置条件

1. **Clash 必须在运行**：`gh` 是 Go 程序、不读 Windows 系统代理；`frontier.ps1` 会自动检测 `127.0.0.1:7897` 并补 `HTTPS_PROXY`，但代理本身得开着。
2. **gh 已登录**：`gh auth status` 应为 `huangzj1996`。
3. **git 写权限**：在 DSH 沙箱下，`.git` 目录属于"既有文件"，会被 Low integrity 挡写；建 worktree / 合并 / 提交需要把会话切到**完全权限**（full access），或由你在自己的终端执行 git 操作。
4. `D:\.pnpm-store` 与仓库同盘，worktree 安装依赖才有硬链接收益。

## 手动跑一轮

```powershell
pwsh .dsh/sandcastle/frontier.ps1                 # 看有哪些票可开工
pwsh .dsh/sandcastle/worktree-init.ps1 -Issue 4   # 预备一个 worktree
# 派 teammate 实现 → 评审 → Lead 合并 → 关闭 issue
pwsh .dsh/sandcastle/worktree-remove.ps1 -Issue 4 -DeleteBranch
```

或直接用技能：`/sandcastle`，然后说「跑一轮」。

## 无人值守

对 Lead 说「无人值守跑 Sandcastle」。Lead 会用 DSH goal 建立持久目标，之后每轮自动继续，
直到 frontier 为空且没有未合并分支；遇到无法自动决策的阻塞（合并冲突解决不了、测试长期红、gh 掉线）会停下报告。

幂等性：分支名与 worktree 路径固定，`frontier` 每轮重新推导，编排状态记在 `state.json`，
所以进程中断后重跑不会重复劳动，也不会重复合并已合并的分支。
