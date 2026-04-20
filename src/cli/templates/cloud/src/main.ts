// Cloud Component Entry Point
//
// Your component runs on the server as a Node.js process.
// The execution engine provides these globals — do NOT import them:
//
//   thatOpenServices  — pre-authenticated EngineServicesClient
//   executionParams   — parameters passed by the caller (shape defined in ../declarations.json)
//   executionReporter — { message(msg), progress(pct) } for live feedback
//   OBC              — @thatopen/components (BIM engine)
//   THREE            — three (3D math/geometry)
//   WEBIFC           — web-ifc (low-level IFC parser, may not be available)
//   fs               — Node.js filesystem module
//
// Parameters are declared in `declarations.json` at the project root. That
// file is bundled alongside this code at publish time so the platform (and
// the CLI's `thatopen run`) knows which parameters the component accepts
// and their types. Whenever you add, remove, or rename a parameter in this
// file you MUST update `declarations.json` to match — `thatopen publish`
// fails if they drift.
//
// Return value — must be { type, message }:
//   type: "SUCCESS" | "FAIL" | "WARNING"

// Globals injected by the execution engine at runtime — keep these for type checking
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const thatOpenServices: import("thatopen-services").EngineServicesClient;
declare const executionParams: Record<string, unknown>;
declare const executionReporter: {
  message(msg: string): void;
  progress(pct: number): void;
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const OBC: typeof import("@thatopen/components");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const THREE: typeof import("three");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const fs: typeof import("fs");

export async function main() {
  const projectName = executionParams.projectName as string | undefined;
  const iterations = Number(executionParams.iterations);

  executionReporter.message(
    `Starting for "${projectName ?? "(unnamed)"}"`,
  );
  executionReporter.message(`Will run ${iterations} iteration(s)`);

  if (!projectName) {
    return { type: "FAIL", message: "projectName parameter is required" };
  }
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return { type: "FAIL", message: "iterations must be a positive number" };
  }

  for (let i = 1; i <= iterations; i++) {
    executionReporter.message(`Iteration ${i} of ${iterations}`);
    executionReporter.progress(Math.round((i / iterations) * 100));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  executionReporter.message("All iterations completed");

  return {
    type: "SUCCESS",
    message: `Processed "${projectName}" across ${iterations} iteration(s)`,
  };
}
