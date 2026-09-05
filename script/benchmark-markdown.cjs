// Measures rendering cost only: this is not a packaged WKWebView latency test.
process.env.NODE_ENV = 'production';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
const revision = process.argv[2];
const filename = 'src/components/markdown-text.tsx';
const source = revision ? execFileSync('git', ['show', `${revision}:${filename}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, filename), 'utf8') + '\nexport { markdownExcerpt } from "../lib/items";';
(async () => {
  const result = await esbuild.build({ stdin: { contents: source, resolveDir: path.join(root, 'src/components'), loader: 'tsx' }, jsx: 'automatic', bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'process.env.NODE_ENV': '"production"' }, external: ['react', 'react-dom', 'react/jsx-runtime'] });
  const mod = new Module(path.join(root, '__readonly_benchmark.cjs'), module);
  mod.filename = path.join(root, '__readonly_benchmark.cjs');
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(result.outputFiles[0].text, mod.filename);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const unit = '## Follow-up prompt\n\n- Keep **source details** and `code` intact.\n- Check [reference](https://example.com).\n\n| Input | Outcome |\n| --- | --- |\n| Local note | Saved capture |\n\n';
  const results = [];
  for (const bytes of [1024, 10240, 102400]) {
    const content = unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
    const render = () => renderToStaticMarkup(React.createElement(mod.exports.MarkdownText, { content: mod.exports.markdownExcerpt ? mod.exports.markdownExcerpt(content) : content, compact: true }));
    for (let i = 0; i < 3; i++) render();
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      render();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({ inputBytes: bytes, medianMs: (samples[14] + samples[15]) / 2, p95Ms: samples[28] });
  }
  console.log(JSON.stringify({ layer: 'production Node SSR component; not native UI', revision: revision || 'working tree', samples: 30, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
