import assert from "node:assert/strict";
import {ownedProcess, withCleanup} from "../targets.mjs";

export function cliTarget(binary, {target, env, root}) {
  return {...target, async cli({args, format}) {
    const timeout = AbortSignal.timeout(30_000);
    const process = ownedProcess(binary, ["--client-only", ...args], {
      cwd: root, env, stdio: ["ignore", "pipe", "ignore"], signal: timeout
    });
    return withCleanup(async () => {
      const chunks = [];
      for await (const chunk of process.child.stdout) chunks.push(chunk);
      const {code, signal} = await process.closed;
      assert(!timeout.aborted, "CLI command timed out");
      assert(Number.isInteger(code), "CLI command did not exit normally" + (signal ? " (" + signal + ")" : ""));
      const output = Buffer.concat(chunks).toString("utf8");
      return {exit: code, data: format === "json" ? JSON.parse(output) : output};
    }, () => process.stop());
  }};
}
