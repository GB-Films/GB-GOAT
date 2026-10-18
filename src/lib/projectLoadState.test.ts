import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectLoadStatus } from './projectLoadState';
import { ProjectDataBoundary } from '../pages/project-detail/ProjectDataBoundary';

test('old projects, accounts and retry attempts cannot publish a ready state into a new scope', () => {
  for (const scope of ['other-project', 'other-account', 'retry-2']) {
    assert.equal(projectLoadStatus({ scope: 'initial', ready: true, error: '' }, scope), 'loading');
    assert.equal(projectLoadStatus({ scope: 'initial', ready: false, error: 'Old error' }, scope), 'loading');
  }
});

test('a failed financial source remains an error even if other sources subsequently finish', () => {
  assert.equal(projectLoadStatus({ scope: 'p', ready: true, error: 'Missing cash movements' }, 'p'), 'error');
  assert.equal(projectLoadStatus({ scope: 'p', ready: true, error: '' }, 'p'), 'ready');
});

test('a pending financial view does not render synthetic zero balances or editable children', () => {
  const html = renderToStaticMarkup(createElement(ProjectDataBoundary, {
    scope: 'p', state: { scope: 'p', ready: false, error: '' }, onRetry() {},
    children: createElement('button', {}, 'Saldo $0'),
  }));
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Saldo|<button/);
});

test('failed sections explain the problem and expose retry, but never their incomplete contents', () => {
  const html = renderToStaticMarkup(createElement(ProjectDataBoundary, {
    scope: 'p', state: { scope: 'p', ready: false, error: 'No se pudieron cargar los movimientos' }, onRetry() {},
    children: createElement('span', {}, 'Saldo $0'),
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Volver a intentar/);
  assert.doesNotMatch(html, /Saldo/);
});

test('loaded sections preserve their exact children; stale errors are not shown after a route change', () => {
  const props = { scope: 'p', state: { scope: 'p', ready: true, error: '' }, onRetry() {}, children: createElement('span', {}, 'Saldo verificado') };
  assert.equal(renderToStaticMarkup(createElement(ProjectDataBoundary, props)), '<span>Saldo verificado</span>');
  const stale = renderToStaticMarkup(createElement(ProjectDataBoundary, { ...props, scope: 'new', state: { scope: 'p', ready: false, error: 'Error anterior' } }));
  assert.doesNotMatch(stale, /Error anterior|Saldo verificado|Volver a intentar/);
});
