#!/usr/bin/env node
// Respire 确定性多 Agent 流程引擎（借鉴 ShiningRay/sebas-process，Fail-Closed）
// 退出码约定：
//   0 = 正常执行 / 找到可执行任务
//   1 = 非法参数、元数据缺失或校验失败（Fail-Closed）
//   2 = blocked / needs_human（全部卡均在等待 Maintainer 审批、人工干预或前置依赖）

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPOS = ["risense-ai/respire-resources", "risense-ai/respire"];
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

function gh(args, input = null) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: input ?? undefined,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function parseCardMetadata(body) {
  if (!body) return null;
  const m = body.match(/<!--\s*respire-card\s+([\s\S]*?)-->/);
  if (!m) return null;
  const meta = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      val = inner ? inner.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
    meta[key] = val;
  }
  if (!meta.id || !meta.change || !meta.milestone) return null;
  if (!Array.isArray(meta.depends_on)) meta.depends_on = [];
  return meta;
}

function fetchAllCards() {
  const cards = [];
  const byRef = new Map();
  const byId = new Map();

  for (const repo of REPOS) {
    const list = JSON.parse(gh(["api", "--paginate", `repos/${repo}/issues?state=all&per_page=100`]));
    for (const iss of list) {
      if (iss.pull_request) continue;
      const meta = parseCardMetadata(iss.body);
      if (!meta) continue;
      const ref = `${repo}#${iss.number}`;
      const labels = new Set((iss.labels || []).map((l) => l.name));
      const msMatch = meta.milestone.match(/^(M\d+)/);
      const msKey = msMatch ? msMatch[1] : "M9";
      const card = {
        ref,
        repo,
        number: iss.number,
        title: iss.title,
        state: iss.state,
        url: iss.html_url,
        milestone: iss.milestone?.title || meta.milestone,
        msKey,
        labels,
        meta,
      };
      cards.push(card);
      byRef.set(ref, card);
      byId.set(meta.id, card);
    }
  }

  cards.sort((a, b) => {
    if (a.msKey !== b.msKey) return a.msKey.localeCompare(b.msKey);
    return a.meta.id.localeCompare(b.meta.id);
  });

  return { cards, byRef, byId };
}

function classifyCard(card, byRef) {
  if (card.state === "closed") return { status: "DONE", reason: "Issue 已关闭" };
  if (card.labels.has("metadata:invalid")) return { status: "INVALID", reason: "带有 metadata:invalid 标签" };
  if (card.labels.has("agent:in-progress")) return { status: "IN_PROGRESS", reason: "已有 Agent 正在推进" };
  if (card.labels.has("agent:verify")) return { status: "VERIFYING", reason: "等待独立只读 Verifier 核验" };

  const unmetDeps = card.meta.depends_on.filter((depRef) => {
    const dep = byRef.get(depRef);
    return !dep || dep.state !== "closed";
  });

  if (card.labels.has("needs:human")) {
    return { status: "NEEDS_HUMAN", reason: "需要人类 Maintainer 执行/授权", unmetDeps };
  }
  if (!card.labels.has("spec:approved")) {
    return { status: "WAITING_APPROVAL", reason: "待 Maintainer 批准（缺少 spec:approved 标签）", unmetDeps };
  }
  if (unmetDeps.length > 0) {
    return { status: "BLOCKED", reason: `等待前置依赖关闭: ${unmetDeps.join(", ")}`, unmetDeps };
  }
  return { status: "READY", reason: "规范已批且依赖全部就绪，可认领执行", unmetDeps: [] };
}

function cmdStatus() {
  const { cards, byRef } = fetchAllCards();
  if (cards.length === 0) {
    console.error("未找到任何带 respire-card 元数据的编排 Issue。");
    process.exit(1);
  }

  const byMs = new Map();
  for (const card of cards) {
    const cls = classifyCard(card, byRef);
    card.cls = cls;
    if (!byMs.has(card.msKey)) byMs.set(card.msKey, { title: card.milestone, items: [] });
    byMs.get(card.msKey).items.push(card);
  }

  console.log("=== Respire OpenSpec 里程碑总览 ===");
  for (const [msKey, group] of [...byMs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const done = group.items.filter((c) => c.cls.status === "DONE").length;
    const ready = group.items.filter((c) => c.cls.status === "READY").length;
    const inProg = group.items.filter((c) => c.cls.status === "IN_PROGRESS").length;
    console.log(`\n[${group.title}] (${done}/${group.items.length} DONE, ${ready} READY, ${inProg} IN_PROGRESS)`);
    for (const c of group.items) {
      console.log(`  - ${c.meta.id} | ${c.cls.status.padEnd(16)} | ${c.ref} | ${c.title}`);
      if (c.cls.status !== "DONE" && c.cls.status !== "READY") {
        console.log(`      原因: ${c.cls.reason}`);
      }
    }
  }
}

function cmdNext(asJson) {
  const { cards, byRef } = fetchAllCards();
  const classified = cards.map((c) => ({ card: c, cls: classifyCard(c, byRef) }));

  const inProgress = classified.filter((x) => x.cls.status === "IN_PROGRESS");
  const ready = classified.filter((x) => x.cls.status === "READY");

  if (ready.length === 0) {
    const waitingApproval = classified.filter((x) => x.cls.status === "WAITING_APPROVAL").length;
    const needsHuman = classified.filter((x) => x.cls.status === "NEEDS_HUMAN").length;
    const blocked = classified.filter((x) => x.cls.status === "BLOCKED").length;
    const payload = {
      status: inProgress.length > 0 ? "in_progress_only" : "blocked",
      in_progress: inProgress.map((x) => ({ id: x.card.meta.id, ref: x.card.ref, url: x.card.url })),
      summary: { waiting_approval: waitingApproval, needs_human: needsHuman, blocked },
      hint:
        waitingApproval > 0
          ? "请 Maintainer 批准目标里程碑（例如运行: node process/scripts/respire-process.mjs approve-milestone M1）"
          : "请先完成 needs:human 卡或推进已认领中的任务。",
    };
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log("当前没有新任务处于 READY 状态（Fail-Closed 拦截）。");
      if (inProgress.length > 0) {
        console.log("正在推进中的卡片:");
        for (const x of inProgress) console.log(`  - ${x.card.meta.id} (${x.card.ref}): ${x.card.url}`);
      }
      console.log(`统计: 待批准=${waitingApproval}, 待人工=${needsHuman}, 依赖阻塞=${blocked}`);
      console.log(`下一步建议: ${payload.hint}`);
    }
    process.exit(2);
  }

  const chosen = ready[0].card;
  const targetDir = chosen.meta.target_repo?.split("/")[1] || "respire";
  const worktreeCmd = `git -C ${targetDir} worktree add ../.worktrees/${chosen.meta.id.toLowerCase()}/${targetDir} -b feat/${chosen.meta.id.toLowerCase()}`;
  const out = {
    status: "ready",
    card_id: chosen.meta.id,
    ref: chosen.ref,
    url: chosen.url,
    title: chosen.title,
    milestone: chosen.milestone,
    change: chosen.meta.change,
    target_repo: chosen.meta.target_repo,
    spec_dir: `openspec/changes/${chosen.meta.change}`,
    claim_command: `node process/scripts/respire-process.mjs claim ${chosen.ref}`,
    worktree_command: worktreeCmd,
    pr_requirements: [
      `PR 必须关联 Milestone: ${chosen.milestone}`,
      `PR 正文必须包含: Fixes ${chosen.ref}`,
    ],
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`=== 推荐认领下一张任务卡: ${out.card_id} ===`);
    console.log(`Issue      : ${out.ref} (${out.url})`);
    console.log(`Title      : ${out.title}`);
    console.log(`Milestone  : ${out.milestone}`);
    console.log(`OpenSpec   : ${out.spec_dir}`);
    console.log(`Target Repo: ${out.target_repo}`);
    console.log(`\n执行步骤:`);
    console.log(`  1. 认领锁定: ${out.claim_command}`);
    console.log(`  2. 建工作树: ${out.worktree_command}`);
    console.log(`  3. 按 ${out.spec_dir}/{design.md,tasks.md,specs/*/spec.md} 施工并跑本地校验`);
    console.log(`  4. 提 PR 时务必设置 Milestone「${out.milestone}」并写「Fixes ${out.ref}」`);
  }
}

function cmdClaim(arg) {
  if (!arg) {
    console.error("用法: respire-process.mjs claim <CARD-XXX | owner/repo#number>");
    process.exit(1);
  }
  const { byRef, byId } = fetchAllCards();
  const card = byId.get(arg.toUpperCase()) || byRef.get(arg);
  if (!card) {
    console.error(`未找到编排卡片: ${arg}`);
    process.exit(1);
  }
  const cls = classifyCard(card, byRef);
  if (cls.status !== "READY") {
    console.error(`拒绝认领 ${card.meta.id} (${card.ref})，当前状态为 ${cls.status}: ${cls.reason}`);
    process.exit(2);
  }
  gh([
    "issue",
    "edit",
    String(card.number),
    "--repo",
    card.repo,
    "--add-label",
    "agent:in-progress",
    "--remove-label",
    "agent:ready",
  ]);
  console.log(`已认领 ${card.meta.id} (${card.ref}) -> 添加 agent:in-progress`);
}

function cmdApproveMilestone(target) {
  if (!target) {
    console.error("用法: respire-process.mjs approve-milestone <M1|M2|M3|M4|M5|M6|all>");
    process.exit(1);
  }
  const norm = target.toUpperCase();
  const { cards, byRef } = fetchAllCards();
  const matched = cards.filter((c) => c.state === "open" && (norm === "ALL" || c.msKey === norm));
  if (matched.length === 0) {
    console.error(`未找到属于 ${target} 的未关闭卡片。`);
    process.exit(1);
  }

  for (const card of matched) {
    const addLabels = [];
    const removeLabels = [];
    if (!card.labels.has("spec:approved")) addLabels.push("spec:approved");
    if (card.labels.has("spec:proposed")) removeLabels.push("spec:proposed");

    const unmet = card.meta.depends_on.filter((depRef) => {
      const dep = byRef.get(depRef);
      return !dep || dep.state !== "closed";
    });
    if (
      unmet.length === 0 &&
      !card.labels.has("needs:human") &&
      !card.labels.has("agent:in-progress") &&
      !card.labels.has("agent:ready")
    ) {
      addLabels.push("agent:ready");
    }

    if (addLabels.length > 0 || removeLabels.length > 0) {
      const args = ["issue", "edit", String(card.number), "--repo", card.repo];
      for (const l of addLabels) args.push("--add-label", l);
      for (const l of removeLabels) args.push("--remove-label", l);
      gh(args);
      console.log(
        `已更新 ${card.meta.id} (${card.ref}): +[${addLabels.join(",")}] -[${removeLabels.join(",")}]`
      );
    } else {
      console.log(`跳过 ${card.meta.id} (${card.ref}): 无需变更标签`);
    }
  }
}

function cmdRoles(args) {
  const oneLine = args.includes("--one-line");
  const roleName = args.find((a) => !a.startsWith("--"));
  const rolesDir = path.join(ROOT, "process", "roles");

  if (oneLine) {
    const prompts = {
      implementer:
        "你是 Respire Implementer：先读 respire-resources/AGENTS.md 与 openspec/AGENT_EXECUTION_GUIDE.md，跑 `node process/scripts/respire-process.mjs next` 认领任务，在独立 .worktrees/ 按 tasks.md 实施并提交绑定 Milestone 与 Fixes #的 PR，禁止自写自验。",
      verifier:
        "你是 Respire 只读 Verifier（必须新会话/只读）：严禁改文件/Issue；读目标 PR Diff 与关联 OpenSpec，实跑测试与 test-cases/，按 PASS/CONDITIONAL/REJECT 出具实证报告，跑不了如实写未实测。",
      triager:
        "你是 Respire Triager：负责整理需求与起草 OpenSpec Change 四件套、维护 Issue 元数据标签；严禁替 Maintainer 批准 spec:approved 或修改产品源码。",
      scribe:
        "你是 Respire Scribe：将已验收 Change 归档进 openspec/specs/、更新 ROADMAP.md 与 LESSONS.md，确保 validate-openspec.mjs 全绿。",
      "release-manager":
        "你是 Respire Release Manager：按 Maintainer 指定的组件版本号核对绿灯 CI，推送 runtime-v*/cli-v*/client2-v* Tag，校验新仓、老仓镜像与 NPM 产物一致。",
    };
    if (roleName) {
      if (!prompts[roleName]) {
        console.error(`未知角色: ${roleName}`);
        process.exit(1);
      }
      console.log(prompts[roleName]);
    } else {
      for (const [k, v] of Object.entries(prompts)) console.log(`[${k}] ${v}`);
    }
    return;
  }

  const targetFile = roleName ? path.join(rolesDir, `${roleName}.md`) : path.join(rolesDir, "README.md");
  if (!fs.existsSync(targetFile)) {
    console.error(`未找到角色文档: ${targetFile}`);
    process.exit(1);
  }
  console.log(fs.readFileSync(targetFile, "utf8"));
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "status":
    cmdStatus();
    break;
  case "next":
    cmdNext(rest.includes("--json"));
    break;
  case "claim":
    cmdClaim(rest[0]);
    break;
  case "approve-milestone":
    cmdApproveMilestone(rest[0]);
    break;
  case "roles":
    cmdRoles(rest);
    break;
  default:
    console.log(
      [
        "Respire Process CLI — 多 Agent 确定性编排工具",
        "用法:",
        "  node process/scripts/respire-process.mjs status",
        "  node process/scripts/respire-process.mjs next [--json]",
        "  node process/scripts/respire-process.mjs claim <CARD-XXX | owner/repo#num>",
        "  node process/scripts/respire-process.mjs approve-milestone <M1|M2|M3|M4|M5|M6|all>",
        "  node process/scripts/respire-process.mjs roles [implementer|verifier|triager|scribe|release-manager] [--one-line]",
      ].join("\n")
    );
    if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
}
