import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginCommand } from './commands/login';
import { createCommand } from './commands/create';
import { publishCommand } from './commands/publish';
import { serveCommand } from './commands/serve';
import { runCommand } from './commands/run';
import { localServerCommand } from './commands/local-server';
import { swapCommand } from './commands/swap';
import { revitCommand } from './commands/revit';
import { rhinoCommand } from './commands/rhino';
import { mcpCommand } from './commands/mcp';

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

let updateMessage: string | undefined;

// Under `thatopen mcp`, stdout is the MCP protocol stream — a banner printed
// into it is a parse error in the client, so the check is skipped outright.
const isMcp = process.argv.includes('mcp');

if (!isMcp) {
  fetch('https://registry.npmjs.org/@thatopen/services/latest', {
    signal: AbortSignal.timeout(3000),
  })
    .then((res) => res.ok && res.json())
    .then((data) => {
      if (data?.version && data.version !== pkg.version) {
        updateMessage =
          `\n  ⚠ Update available: ${pkg.version} → ${data.version}` +
          `\n  Run "npm install -g @thatopen/services@latest" to update.\n`;
      }
    })
    .catch(() => {});
}

process.on('exit', () => {
  if (updateMessage) console.log(updateMessage);
});

const program = new Command();

program
  .name('thatopen')
  .description('CLI for ThatOpen Engine Services')
  .version(pkg.version);

program.addCommand(loginCommand);
program.addCommand(createCommand);
program.addCommand(publishCommand);
program.addCommand(serveCommand);
program.addCommand(runCommand);
program.addCommand(localServerCommand);
program.addCommand(swapCommand);
program.addCommand(revitCommand);
program.addCommand(rhinoCommand);
program.addCommand(mcpCommand);

program.parse(process.argv);
