# Windows online model uninstall fixture

This adapter requires a disposable, offline Windows environment stocked with a
reviewed Respire source commit, a SHA-256-pinned Runtime binary, native Go
build tools with the pinned modules cached, and the exact pinned BGE-small and
BGE-M3 model/tokenizer pairs. Never point it at an installed profile or
personal OneDrive directory. The operator must mark the isolated environment
with CARD018_DISPOSABLE_MODEL_FIXTURE=1.

Run verify-online-model-win.mjs with the absolute source repository path,
full reviewed commit, absolute Runtime binary path, its lowercase SHA-256,
exact Runtime version, and absolute synthetic fixture roots for BGE-small and
BGE-M3. The adapter archives only reviewed Client2 and contract inputs into
owned scratch and invokes TestRealRuntimeOwnedModelUninstallWindows; it does
not delete a model itself. It requires the real test and package to pass.
Missing prerequisites, skipped tests and failed bootstrap are not evidence.

This exercises actual online inactive model removal, refusal of the active
model, same Runtime scope and retention of unowned fixture files when the
product test executes. The currently recorded adapter launch did not get past
native listener process ownership on the restricted machine; no uninstall
validation is claimed for that run. Positive Windows configured junction
behavior and zero lingering Paused markers require their own assertions.

The isolated test copy adapts its PowerShell ACL provider path to the equivalent local DOS alias and verifies the owner ACL. The real Runtime and Client2 production files in the source archive are not modified.
