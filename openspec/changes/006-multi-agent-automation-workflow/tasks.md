# Tasks: 006-multi-agent-automation-workflow

## 阶段一：角色提示词与可信白名单定型

- [x] **T06-01** 在 `process/roles/` 建立六角色职责规范与一句话冷启动提示词速查表
- [x] **T06-02** 创建 `.github/agents.yml`（声明 `maintainers` 与 `trusted_bots` 白名单），并将最新 `process/templates/coderabbit.yaml` 同步应用到 `risense-ai/respire`（`respire-core` 见 `CARD-002`）

## 阶段二：确定性流程引擎 `respire-process.mjs` 与 Evidence 自动化

- [ ] **T06-03** 在已有 MVP（`status`、`next`、`claim`、`approve-milestone`、`roles`）基础上，补全 `process/scripts/respire-process.mjs` 的 `verify-merge` 与 `evidence-register` 命令及全套 Fail-Closed 校验
- [ ] **T06-04** 为 `respire-process.mjs` 编写 Node 内置 `node:test` 单元测试套件（验证 Fail-Closed、DAG 依赖阻塞、白名单校验与幂等评论）
- [ ] **T06-05** 在 `respire-resources` 与 `respire` 落地 `.github/workflows/evidence-register.yml`（PR 合并且全绿后由 Bot 自动登记 Evidence 解锁下游任务）

## 阶段三：端到端实战试运行与夜间 `LESSONS` 闭环

- [ ] **T06-06** 实现定期 `lessons-audit` 脚本/工作流：自动提取近期 `fix:` 提交生成 `LESSONS.md` 审计报告，并对累计 ≥ 3 次问题自动提议 `guardrail` Issue
- [ ] **T06-07** 选取一个真实业务需求端到端跑通完整自动化闭环（Triager 起草 -> Maintainer 批准 -> Implementer 隔离开发 -> 只读 Verifier 实测 + UI Preview -> Maintainer 合并 -> Bot 登记 Evidence -> Scribe 归档）
- [ ] **T06-08** 验收归档：演练闭环通过后由 Scribe 将 `specs/agent-workflow/spec.md` 合并至 `openspec/specs/`

## 验收命令

```sh
node process/scripts/respire-process.mjs status
node --test process/scripts/respire-process.test.mjs
node process/scripts/validate-openspec.mjs
```
