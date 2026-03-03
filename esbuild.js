const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: isProd ? false : true,
  minify: isProd,
};

if (watch) {
  esbuild.context(buildOptions).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log('Extension built successfully.');
  }).catch(() => process.exit(1));
}
