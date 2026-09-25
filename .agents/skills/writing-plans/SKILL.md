---
name: writing-plans
description: Use when a requirement spans multiple steps or modules and needs an implementation task breakdown before code changes.
---

# Writing Plans

## Purpose

Turn a requirement into a short, executable task list. This is the project's lightweight adaptation of Superpowers `writing-plans`. Follow `AGENTS.md`: present the analysis, tasks, and approach to the developer and wait for explicit confirmation before changing business code.

## When to use

- Use for changes spanning multiple modules, interfaces, or dependent implementation steps.
- For a small, contained change, give a brief task list without loading this skill.
- Inspect existing code and project conventions before choosing task boundaries.

## Task breakdown

1. State the goal, affected areas, constraints, and any unresolved decision that changes implementation or acceptance.
2. Divide work into ordered tasks with a concrete deliverable for each. Show dependencies only where they affect execution order.
3. For each task, identify the relevant module or file group, expected behavior, and how to verify it. Specify interface or type changes when tasks depend on them.
4. End with acceptance scenarios and the commands or manual checks needed to verify the whole change.
5. Check that every requirement is covered once and that the plan can be implemented without guessing about a material decision.

Present the plan in the conversation. Save a plan document only when the developer requests one or the repository already uses one for the task.

## Execution

After explicit developer confirmation, implement tasks in order and verify the affected behavior. Choose tests according to risk and repository requirements. TDD, per-step commits, worktrees, subagents, and independent reviews are optional, not gates imposed by this skill. Before a commit, run the checks required by `AGENTS.md`.
