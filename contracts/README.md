# contracts — 唯一接口契约目录

本目录为 Respire 全系统的**机器可读接口单一事实源（SSOT）**，禁止任何代码仓绕过本目录自行维护手写 DTO 或重复契约。

- **[runtime-api/openapi.yaml](runtime-api/openapi.yaml)**：OpenAPI 3.1.0 规范（REST + SSE），供 `apps/runtime`、`apps/cli`、`apps/client2`、MCP 与插件消费并自动生成 SDK（参见 OpenSpec `002`）。
- **[core-abi/README.md](core-abi/README.md)**：闭源 `respire-core` 与 `respire-runtime` 之间的 C FFI ABI 契约说明。
