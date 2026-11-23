# Delta Spec: Multi-Agent Automation & Lessons Loop (`006`)

## ADDED Requirements

### Requirement: 独立只读 Verifier 强制做验分离
每个实现 PR 在合并前 MUST 由运行在独立进程与只读权限沙箱中的 Verifier Agent 完成核验并跑通关联 E2E 用例；Implementer 不得为自己的代码出具验收通过结论。

#### Scenario: Implementer 尝试自写自合
- **GIVEN** Implementer 提交了一个实现功能的 PR 但缺少独立只读 Verifier 的核验记录
- **WHEN** 运行 `respire-process verify-merge` 检查
- **THEN** 门禁 MUST 处于阻断状态并返回非零退出码

### Requirement: Fail-Closed 的可信 Evidence 与依赖解锁
下游依赖 Issue MUST 仅在前置 Issue 合并至主干、CI 全绿且由 `trusted_bots` 或人类 Maintainer 登记合法 `Evidence` 后才允许进入可执行队列；任何缺失或结构非法元数据 MUST 被拒绝而非静默跳过。

#### Scenario: 前置 Issue 尚未登记可信 Evidence
- **GIVEN** Issue B 声明依赖 Issue A，而 Issue A 虽已关闭但缺少可信 `Evidence` 记录
- **WHEN** Agent 运行 `respire-process next` 选卡
- **THEN** Issue B MUST 保持 `blocked` 状态并明确报告缺少前置 Evidence

### Requirement: 事故三振出局护栏升格机制
重复出现 ≥ 3 次的同类型缺陷 MUST 从 `LESSONS.md` 升格为 `respire` 或 `respire-core` 的永久自动化 CI 守护测试或拦截规则。

#### Scenario: 同类故障第三次在复盘中被识别
- **GIVEN** 夜间审计脚本发现某类接口吞错或字段漏加问题已在 `LESSONS.md` 记录满 3 次
- **WHEN** 生成复盘报告
- **THEN** 系统 MUST 自动创建标记为 `guardrail` 的待立项 Issue，要求将其转化为自动化守护测试
