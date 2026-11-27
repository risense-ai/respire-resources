# CARD-021 evidence for M6 / T06-07

Single-ticket dry run: show Desktop Runtime connection status on Overview.

| Stage | Exact evidence |
| --- | --- |
| Triage | [Product issue #100](https://github.com/risense-ai/respire/issues/100): scoped change and acceptance criteria. |
| Maintainer approval | [Approval before implementation](https://github.com/risense-ai/respire/issues/100#issuecomment-7209503729). |
| Implementation | [Product PR #102](https://github.com/risense-ai/respire/pull/102), reviewed head `84da07f932fad931bddeeecbb4a47485f5fff073`. Reused desktop connection state; no additional requests or polling changes. |
| Independent verification | [PASS on the exact head](https://github.com/risense-ai/respire/pull/102#issuecomment-7213570197); [CI](https://github.com/risense-ai/respire/actions/runs/45955102331) and [three-OS compiled acceptance](https://github.com/risense-ai/respire/actions/runs/45955102304) passed. |
| UI preview | [Trusted bilingual preview](https://github.com/risense-ai/respire/tree/030ed21d21311acecb2b6e636c07225e1e258a6e/pr-102/84da07f932fad931bddeeecbb4a47485f5fff073). [Separate browser qualification](https://github.com/risense-ai/respire/actions/runs/45956774187/job/140364961585) passed all 12 combinations of two languages, two widths, and connected/disconnected/reconnected states, including overflow and live-region continuity checks. |
| Merge | [Squash commit](https://github.com/risense-ai/respire/commit/be7e1926a935695aa8b48a2f3d28fadfe4e0eaa1) closed product issue #100. |
| Bot Evidence | [Evidence Register receipt on #100](https://github.com/risense-ai/respire/issues/100#issuecomment-7213587731) binds the issue, merged PR, and squash SHA to [run 45965984961](https://github.com/risense-ai/respire/actions/runs/45965984961). |

The [browser proof bundle](https://github.com/risense-ai/respire/actions/runs/45956774187/artifacts/15178593470) has SHA-256 `7635336406eb90dcf2b4d10666394aaea050a38d1c766b952d9f0417e71f3fe3`. The run records the checked-out product SHA independently of the qualification branch.

This receipt is the evidence input to Scribe. It does not mark T06-07 complete, close CARD-020, or archive Change 002 or 006. Move this receipt with Change 006 when the independent archive gates and periodic lessons-audit evidence are satisfied.
