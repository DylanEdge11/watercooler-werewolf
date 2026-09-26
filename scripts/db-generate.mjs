import './lib/stable-euid.mjs';

process.argv = [process.argv[0], 'drizzle-kit', 'generate', ...process.argv.slice(2)];
await import('../node_modules/drizzle-kit/bin.cjs');
