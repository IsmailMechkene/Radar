// Headless entry point: `cli scan | remind | export`. Commands are implemented in later milestones.
const COMMANDS = ['scan', 'remind', 'export'] as const;
const USAGE = `Usage: radar <${COMMANDS.join('|')}>`;

const [command] = process.argv.slice(2);

if (!command || !(COMMANDS as readonly string[]).includes(command)) {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  console.error(`radar ${command}: not implemented yet`);
  process.exitCode = 1;
}
