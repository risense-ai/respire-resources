# core-abi — Core 与 Runtime 的 C FFI 边界契约

本目录用于锁定 `respire-core`（闭源纯计算内核）与 `respire-runtime`（宿主服务）之间的版本无关 FFI 契约。

## 核心准则

1. **纯内存数据交换**：Core 只接收宿主显式传入的内存缓冲区与配置结构体，返回不透明索引状态与计算结果，不触碰文件系统、SQLite 或网络。
2. **前向/后向兼容**：Wire DTO 必须通过“忽略未知字段”测试，任何版本组合的 Core SDK 与 Runtime 均可无缝运行。
3. **单源化迁移**：完成 Change `001` 与 `004` 后，现存 `respire-core/contracts/core-abi/` 的 `respire_core.h`、`request.schema.json`、`response.schema.json` 与 `core-api.json` 将统一收归本目录分发，避免多仓漂移。
