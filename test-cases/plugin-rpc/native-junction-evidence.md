# Native Windows junction and host configuration

This focused fixture requires a disposable Windows runner with a preverified
native Runtime executable, an owned mock profile, and scoped outbound firewall
rules installed and verified before launching the executable tree. Do not run
it against a real workspace or supply login credentials.

Run `node test-cases/plugin-rpc/host-config-junction.mjs <absolute-runtime.exe>`
only inside that qualification boundary. The fixture creates and resolves
the synthetic NTFS junction, compares both typed HTTP payloads byte for byte,
reads back an authenticated language change, restores the entire original
configuration, and samples the maintenance marker three times.

[Hosted job 139696666921](https://github.com/risense-ai/respire-resources/actions/runs/45756631807/job/139696666921)
passed on Windows x64. It verified 591 manifest-listed kit files and its
program-scoped firewall blocks before launch, compared 201,560 English bytes
and 203,060 Chinese bytes, and confirmed configuration restore, all three
marker samples, and firewall cleanup. The tested Runtime source was
`4da41a593ea1663a8199b4b9a1475eb05b8620a8`.
Disposable [PR #37](https://github.com/risense-ai/respire-resources/pull/37)
closed without merge. The temporary workflow is not installed.

This fixture does not cover OneDrive hydration, continuous Paused-state
observation, model cleanup, or complete platform or CLI parity.
