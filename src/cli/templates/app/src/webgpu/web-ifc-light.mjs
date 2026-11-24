// 🔴 web-ifc WITHOUT ITS IFC READER (Antonio 24-11: IFC files are converted by the platform when uploaded, never in the browser).
// The engine libraries import web-ifc whole (5.8 MB of the app's bundle) and use, from it, its constants (an IFC class's code,
// enums such as the log levels) and the reader, which this app never runs. `thatopen serve` and the vite build answer `web-ifc`
// with the module this writes: every constant of the installed web-ifc with its own value, read from it at build time (so it
// follows a new web-ifc by itself), and in place of everything else (the reader, the schemas' classes) a stand-in that says why
// when it is used. Not imported by the app: run at build time only.
import { createRequire } from "node:module";
import { join } from "node:path";

const isPlain = (value) => value === null || ["number", "string", "boolean"].includes(typeof value);

/** The source of the light web-ifc, from the one installed in the app at `cwd`. */
export function lightWebIfc(cwd) {
  const require = createRequire(join(cwd, "package.json"));
  const real = require("web-ifc");
  const lines = [
    `const unavailable = (what) => { throw new Error(\`\${what}: IFC files are converted by the platform when uploaded, not in this app.\`); };`,
    // (Anything but a constant: made, read into and called freely; it says why only when it is asked to do something.)
    `const standIn = (what) => new Proxy(function () {}, {`,
    `  get: (_, key) => (key === "then" || typeof key === "symbol" ? undefined : key === "prototype" ? {} : standIn(\`\${what}.\${key}\`)),`,
    `  apply: () => unavailable(what),`,
    `  construct: () => new Proxy({}, { get: (_, key) => (key === "then" || typeof key === "symbol" ? undefined : (...args) => unavailable(\`\${what}.\${String(key)}\`)) }),`,
    `});`,
  ];
  for (const name of Object.keys(real)) {
    if (name === "default" || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const value = real[name];
    if (isPlain(value)) lines.push(`export const ${name} = ${JSON.stringify(value)};`);
    // (An enum, as the log levels: its values as they are.)
    else if (value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isPlain))
      lines.push(`export const ${name} = ${JSON.stringify(value)};`);
    else lines.push(`export const ${name} = standIn(${JSON.stringify(name)});`);
  }
  return lines.join("\n");
}
