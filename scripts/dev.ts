export {};

const processes = [
  Bun.spawn(['bun', '--watch', 'server/index.ts'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev:web'], { stdout: 'inherit', stderr: 'inherit' }),
];
const stop = () => { for (const process of processes) process.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const exit = await Promise.race(processes.map(process => process.exited));
stop();
process.exit(exit);
