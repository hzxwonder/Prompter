import esbuild from 'esbuild';

await Promise.all([
  esbuild.build({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
    external: ['vscode'],
    logLevel: 'info'
  }),
  esbuild.build({
    entryPoints: ['webview/src/main.tsx'],
    outfile: 'dist/webview/main.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    sourcemap: true,
    logLevel: 'info'
  })
]);
