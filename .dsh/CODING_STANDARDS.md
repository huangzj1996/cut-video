# Coding Standards

Reviewer 与 implementer 都按这份标准执行。内容来自仓库现有配置，改配置时同步改这里。

## 工具链

- pnpm workspace（`apps/*`、`packages/*`），`packageManager: pnpm@10.28.1`，`nodeLinker: hoisted`。
- 类型检查：每个包 `tsc --noEmit -p tsconfig.json`；根目录 `pnpm typecheck`（`pnpm -r --if-present typecheck`）。
- 测试：每个包 `vitest run`；根目录 `pnpm test`。
- Lint / 格式：根目录 `pnpm lint`、`pnpm format:check`。

## TypeScript

- `strict: true`，另有 `noUncheckedIndexedAccess`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。
- `verbatimModuleSyntax`：类型导入必须写成 `import type { X } from '...'`。
- `isolatedModules`：不要用 `export =` / 依赖跨文件类型重新导出的隐式行为。
- 不用 `any`；确实需要时用 `unknown` + 收窄，或在边界处显式断言并写注释。
- 索引访问可能返回 `undefined`（`noUncheckedIndexedAccess`），要显式处理，不要用 `!` 糊过去。

## ESLint / Prettier

- ESLint：`@eslint/js` recommended + `typescript-eslint` recommended。
- 未使用变量用 `_` 前缀忽略；类型导入统一走 `consistent-type-imports`。
- Prettier：分号、单引号、尾部逗号 all、行宽 100、缩进 2 空格。提交前保持 `pnpm format:check` 通过。

## 代码风格

- 改动聚焦：只动与本 issue 相关的文件，不做顺手重排。
- 命名与领域词一致：用 `GLOSSARY.md` / AGENTS.md 里的术语（分镜、时间线、字幕、音乐片段等），不要造同义词。
- 复杂逻辑加简短中文注释解释"为什么"，不解释"是什么"。
- 不新增依赖，除非 issue 明确要求；需要加依赖时在报告里说明理由。

## 测试

- 行为变更必须有测试覆盖；优先在公开接口层写集成测试，而不是给私有函数补测试。
- 测试名描述期望行为，不写"should work"。
- 修 bug 先写一个会红的测试（RGR），再改实现。

## 提交

- Conventional Commits：`feat: ...` / `fix: ...` / `refactor: ...` / `chore: ...` / `test: ...`。
- 正文用 `-` 列表写关键决策，结尾引用 issue：`Refs #<issue>`。
- 一个 issue 一个分支（`issue-<N>`），不在分支里混入其他 issue 的改动。
