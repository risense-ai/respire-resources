# Tasks: 006-multi-agent-automation-workflow

## 阶段一：角色提示词与只读隔离规范

- [ ] **T06-01** 在 `process/roles/` 沉淀六角色标准提示词与权限矩阵（重点固化 Verifier 只读沙箱与禁止自写自验边界）
- [ ] **T06-02** 为各端 `.coderabbit.yaml` 增加基于 `LESSONS.md` 的路径定向审查规则并全面启用严格审查

## 阶段二：确定性状态机 `respire-process` 与可信 Evidence

- [ ] **T06-03** 实现 `process/scripts/respire-process.mjs`（支持 `roles`、`next` 选卡、依赖 DAG 检查与 `verify-merge` Fail-Closed 门禁）
- [ ] **T06-04** 为 `respire-process.mjs` 编写完备单元测试（覆盖非法结构拒绝、无证据拒绝解锁、幂等评论更新）
- [ ] **T06-05** 在 `respire-resources` 与 `respire` 落地 `evidence-register.yml`（仅限受信 Bot 在 CI 全绿合入后登记可信验收证据）

## 阶段三：闭环试运行与夜间 `LESSONS` 复盘

- [ ] **T06-06** 实现定期复盘脚本与工作流：扫描近期 `fix:` 提交生成 `LESSONS.md` 候选草稿并标注 3 次升格告警
- [ ] **T06-07** 选取一个真实业务需求端到端跑通全自动闭环（Triager -> Maintainer 批准 -> Implementer -> 只读 Verifier + UI Preview -> Maintainer 合并 -> Archive）
- [ ] **T06-08** 验收归档：将 `specs/agent-workflow/spec.md` 合并至 `openspec/specs/`
