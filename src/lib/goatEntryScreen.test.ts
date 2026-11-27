import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GoatEntryScreen } from '../components/GoatEntryScreen';

const renderEntry = (props: Parameters<typeof GoatEntryScreen>[0]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GoatEntryScreen, props)));

test('la portada general ofrece el ingreso y los enlaces de información', () => {
  const html = renderEntry({ login: { onClick: () => {}, busy: false } });
  assert.match(html, />Ingresar al sistema<\/button>/);
  assert.match(html, /Usá tu cuenta de Google/);
  assert.match(html, /privacy\.html/);
  assert.doesNotMatch(html, /Darme de alta como proveedor/);
});

test('la portada de un enlace ofrece el alta únicamente cuando la invitación está habilitada', () => {
  const login = { href: '/login' };
  const invitation = { onStart: () => {}, checking: false };
  const valid = renderEntry({ login, invitation });
  assert.match(valid, />Darme de alta como proveedor<\/button>/);
  assert.match(valid, /href="\/login"[^>]*>/);
  for (const props of [{ login, status: 'Comprobando invitación…' }, { login, alert: 'Este enlace venció.' }]) {
    const html = renderEntry(props);
    assert.match(html, /Ingresar al sistema/);
    assert.doesNotMatch(html, /Darme de alta como proveedor/);
  }
  assert.match(renderEntry({ login, invitation: { ...invitation, checking: true } }), /disabled=""[^>]*>.*Comprobando invitación…<\/button>/);
});
