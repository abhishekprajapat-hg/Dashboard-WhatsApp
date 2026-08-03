import ivm from "isolated-vm";
import { config } from "../config.js";

// Runs user-supplied JS for the code_block automation node inside a real V8 isolate - a separate
// heap/global object from the host process, not node:vm (shares the host's realm/prototypes; well
// -known escapes exist, not a real security boundary) and not vm2 (deprecated, known-vulnerable).
// `context` is injected as plain copied data via ExternalCopy, never as live host objects or
// functions, so sandboxed code can only read/return data - it has no reference back into the host
// process, no require/process/fs, and no network access (no fetch is exposed). timeout and
// memoryLimit are real V8-level caps enforced by isolated-vm itself, not application-level checks.
export async function runSandboxedCode({ code, context, timeoutMs, memoryLimitMb }) {
  const source = String(code || "").trim();
  if (!source) throw new Error("No code provided");

  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb ?? config.codeBlock.memoryLimitMb });
  try {
    const vmContext = await isolate.createContext();
    await vmContext.global.set("context", new ivm.ExternalCopy(context ?? {}).copyInto());

    // Wrapped in an IIFE so the node's config can be a plain statement list ending in `return`,
    // the same convention as other code-node products (e.g. n8n's Code node) - no return means
    // the step's result is null, not an error.
    const script = await isolate.compileScript(`(function () {\n${source}\n})()`);
    const result = await script.run(vmContext, { timeout: timeoutMs ?? config.codeBlock.timeoutMs, copy: true });
    return result === undefined ? null : result;
  } finally {
    isolate.dispose();
  }
}
