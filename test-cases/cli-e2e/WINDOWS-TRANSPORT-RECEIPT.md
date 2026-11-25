# Windows native transport and legacy smoke

On 2026-11-25, the owned Windows synthetic-profile suite ran against these
locked local builds:

- Runtime: risense-ai/respire partial route PR #25 production source
  f8222384782e905c7392418339d01dd9e3a2f08c; Windows binary SHA-256
  a6741673cb6fd4e58f60d586ae6ac7b0a70fc6fec7371bdefcf2bdd1da7a3ddd.
- CLI: the apps/cli tree identical to risense-ai/respire
  0d37248329500f4daadf70812882707a4a221147; Windows binary SHA-256
  02a920d9eb560e6d76c7a527bcb315c63f5be462b253ab16ec9d80d984a9df1c.
- Resource test revision: d7d2e8a55648fdbb5eb94e4acc6ee0212a618990.

With the provided Runtime and CLI paths, the test-cases/cli-e2e/smoke.mjs
command with --verify and --synthetic-ready passed E2E-006 and E2E-007, with
no skips. This covers legacy status JSON, inject help, model catalog, and
read-only CLI dispatch over legacy RPC.

The test-cases/plugin-rpc/windows.mjs command with --verify and
--synthetic-ready passed independently for both --transport http and
--transport mcp. The HTTP payloads were 201,560 bytes in English and
203,060 in Chinese, with concurrent store and recall. The MCP payloads
were 201,664 and 203,164 bytes; show returned the exact stored content
and recall matched the stored ID. Both native routes used owned scratch
junctions, isolated synthetic Vault v4 profiles, and verified local
process identity. No personal data or unowned Runtime was used.

This receipt does not establish full OpenAPI route parity, complete CLI
or TUI behavior, online model uninstall, or packaged Client2 acceptance.
