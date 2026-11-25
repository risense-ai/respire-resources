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


In the follow-up [hosted Windows run](https://github.com/risense-ai/respire-resources/actions/runs/45539057852),
the fixture ACL and owned Runtime startup completed. The native test then
received an unconfirmed result rather than the expected refusal for deliberately
modified model bytes. The test failed, so it provides no accepted online
uninstall receipt, no configured-junction proof, and no Paused cleanup proof.

## Hosted native acceptance, 2026-11-25

The [clean Windows run](https://github.com/risense-ai/respire-resources/actions/runs/45550495763)
passed the actual TestRealRuntimeOwnedModelUninstallWindows and package
checks with neither skip nor diagnostics injected into Runtime. It built
Respire d7ffd2d9d0cbacb1cae534a1208f3a49abd247f0, version 2.0.0-dev.31,
Windows SHA-256 1567e74b5a6508869d05ea758c7cd63636325d40393099525a5ceceef3975ebe.
The runner's enabled administrator membership, default owner different
from user, and default owner equal to Builtin Administrators were all true.

The fixture supplies both exact pinned Small and M3 pairs. The test
asserts refusal of active removal, refusal of altered Small weights,
exact valid Small publication and online removal, and real M3 download
and desktop uninstall. The external copy is unchanged and the serving
Runtime keeps its verified process, instance, account and generation.
This is a real hosted Windows test with a disposable profile, not a
claim about a configured junction or lingering Paused markers.
