import test from 'node:test';
import assert from 'node:assert/strict';
import { openSigningProject } from './projectSigningActions';

test('opening GB Sign reserves a tab during the click and checks project access before navigating', async () => {
  const events: string[] = [];
  const destination = { opener: {}, closed: false, location: { replace: (url: string) => events.push(url) }, close: () => events.push('closed') };
  const result = await openSigningProject('project-1', {
    openWindow: () => { events.push('open'); return destination; },
    request: async input => { assert.deepEqual(input, { action: 'connectProject', projectId: 'project-1' }); events.push('authorized'); return { url: 'https://example.test/sign' }; },
    isCurrent: () => true,
  });
  assert.deepEqual(events, ['open', 'authorized', 'https://example.test/sign']);
  assert.equal(destination.opener, null);
  assert.deepEqual(result, { opened: true, url: 'https://example.test/sign' });
});

test('a blocked popup returns a usable link; a denied connection closes the blank tab and surfaces the error', async () => {
  const fallback = await openSigningProject('p', { openWindow: () => null, request: async () => ({ url: 'https://example.test/sign' }), isCurrent: () => true });
  assert.deepEqual(fallback, { opened: false, url: 'https://example.test/sign' });
  let closed = false;
  await assert.rejects(openSigningProject('p', { openWindow: () => ({ opener: null, closed: false, location: { replace: () => assert.fail('must not navigate') }, close: () => { closed = true; } }),
    request: async () => { throw new Error('Permission denied'); }, isCurrent: () => true }), /Permission denied/);
  assert.equal(closed, true);
});

test('leaving the project before access is ready closes the tab without opening the former project', async () => {
  let closed = false;
  const result = await openSigningProject('p', { openWindow: () => ({ opener: null, closed: false, location: { replace: () => assert.fail('stale navigation') }, close: () => { closed = true; } }),
    request: async () => ({ url: 'https://example.test/sign' }), isCurrent: () => false });
  assert.equal(result, null);
  assert.equal(closed, true);
});
