/** Mirrors the platform-supplied `executionContext` global (see cloud-component template). */
export interface EngineExecutionContext {
  projectId?: string;
  executionId: string;
  toolId: string;
  toolVersion: string;
}

/**
 * Generates the local execution engine script.
 *
 * Mirrors the server-side `v1/thatOpenEngine.js` template:
 * - Provides the same globals (OBC, THREE, WEBIFC, fs, executionReporter,
 *   thatOpenServices, executionParams, executionContext).
 * - Inlines the IIFE bundle code (which ends with `var main = ...`).
 * - Calls `main()` and sends the result back via IPC.
 */
export function buildEngineScript(
  bundleCode: string,
  accessToken: string,
  apiUrl: string,
  executionParams: object,
  executionContext: EngineExecutionContext,
): string {
  return `/* eslint-disable */
const { EngineServicesClient } = require('@thatopen/services');

// Engine globals are BEST-EFFORT: a cloud component that doesn't touch the 3D
// engine (e.g. one that only uses thatOpenServices) must still run. Each is
// optional, and @thatopen/components also resolves the beta package — under
// --beta the dep is installed as @thatopen-platform/components-beta, so a hard
// require('@thatopen/components') would throw before main() runs.
const tryRequire = (...names) => { for (const n of names) { try { return require(n); } catch {} } return undefined; };
const OBC = tryRequire('@thatopen/components', '@thatopen-platform/components-beta');
const THREE = tryRequire('three');
const WEBIFC = tryRequire('web-ifc');
const fs = require('fs');

const executionReporter = {
  message: (message) => {
    process.send({ type: 'MESSAGE', message });
  },
  progress: (message) => {
    process.send({ type: 'PROGRESS', message });
  },
};

let thatOpenServices, executionParams;
const executionContext = ${JSON.stringify(executionContext)};

// --- User bundle code (IIFE) ---
${bundleCode}
// --- End user bundle code ---

if (typeof main !== 'function') {
  process.send({ type: 'FAIL', message: 'Bundle does not export a main() function' });
  process.exit(1);
}

const executeAndReportProcess = async (newThatOpenServices, newExecutionParams) => {
  thatOpenServices = newThatOpenServices;
  executionParams = newExecutionParams;

  try {
    const result = await main();
    if (!result) {
      process.send({
        type: 'WARNING',
        message: 'No result returned from main function of the component',
      });
      return;
    }
    process.send(result);
  } catch (error) {
    process.send({
      type: 'FAIL',
      message: error.message,
    });
  }
};

// Start execution immediately
const thatOpenServicesInstance = new EngineServicesClient(
  ${JSON.stringify(accessToken)},
  ${JSON.stringify(apiUrl)},
);

executeAndReportProcess(thatOpenServicesInstance, ${JSON.stringify(executionParams)});
`;
}
