const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

test('cash worker boots alone, binds HTTP and rejects anonymous calls before touching cash', async () => {
  const code = `
    const assert = require('node:assert/strict');
    const express = require('express');
    const exported = require('./entrypoint');
    assert.deepEqual(Object.keys(exported), ['createCashSubdelivery']);
    const app = express(); app.use(express.json()); app.post('/', exported.createCashSubdelivery);
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const r = await fetch('http://127.0.0.1:' + server.address().port, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) });
        assert.equal(r.status, 401); assert.equal((await r.json()).error.status, 'UNAUTHENTICATED');
        console.log('Cash HTTP startup and auth passed');
      } catch (error) { console.error(error); process.exitCode = 1; }
      finally { server.close(); }
    });
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd: __dirname, env: { ...process.env, FUNCTION_TARGET: 'createCashSubdelivery', GCLOUD_PROJECT: 'demo-goat-cash-startup' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cash HTTP worker startup timed out')); }, 20000);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Cash HTTP startup and auth passed/);
});
