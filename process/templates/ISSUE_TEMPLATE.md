---
name: OpenSpec Feature / Refactor Task
about: 提交受 OpenSpec 约束的功能开发或架构重构任务
title: "[Task] <简明描述目标>"
labels: ["triage"]
---

## 关联规范（必填，缺失不排期）

- **OpenSpec Change ID**: `00X-...`
- **Spec 节号 / 场景**: `openspec/changes/.../specs/.../spec.md §...`
- **关联 HTML 原型路径**（如涉及 UI）: `prototypes/pages/...` 或 `N/A`
- **关联 E2E 用例 ID**: `E2E-...`
- **前置依赖 Issue**: `#...` 或 `无`

## 目标与完成定义（DoD）

- [ ] 实现符合关联 OpenSpec 场景约束
- [ ] 已补充对应单元测试与黑盒 E2E 回归（若适用）
- [ ] 单文件行数与依赖边界符合 `AGENTS.md` 红线
- [ ] 由独立只读 Verifier 完成核验
