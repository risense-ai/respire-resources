/** Run every required observation, local cleanup and independent post-read.
 * Error collection is only for redacted reporting; any rejected phase fails. */
export async function requiredUiPhases({observe, disposeOperations, disposeLayout, verifyAfter, report}) {
  if (typeof observe !== 'function' || typeof verifyAfter !== 'function')
    throw new TypeError('Both observation and independent post-read are required');
  const phases = [
    ['browser-primary', observe],
    ['browser-dispose-ops', disposeOperations],
    ['browser-dispose-layout', disposeLayout],
    ['browser-post-read', verifyAfter],
  ];
  let result;
  const errors = [];
  for (const [stage, run] of phases) {
    if (typeof run !== 'function') continue;
    try {
      const value = await run();
      if (run === observe) result = value;
    } catch (error) {
      errors.push({stage,error});
    }
  }
  for (const {stage,error} of errors) {
    try { await report?.(stage,error); } catch { /* diagnostics cannot become acceptance */ }
  }
  if (errors.length) throw errors[0].error;
  return result;
}
