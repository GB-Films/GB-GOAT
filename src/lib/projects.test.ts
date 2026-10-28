import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROJECT_WORKFLOW_STATUSES, PROJECT_STATUSES, ARCHIVED_PROJECT_STATUSES, matchesProjectScope } from './projects';
import { ProjectCommercialSummary } from '../pages/project-detail/ProjectCommercialSummary';

test('historical classification is available without entering the five active workflow columns', () => {
  assert.equal(PROJECT_WORKFLOW_STATUSES.length, 5);
  for (const status of ARCHIVED_PROJECT_STATUSES) {
    assert.ok(PROJECT_STATUSES.includes(status));
    assert.equal(matchesProjectScope({ status }, 'current'), false);
    assert.equal(matchesProjectScope({ status }, 'historical'), true);
    assert.equal(matchesProjectScope({ status }, 'all'), true);
  }
  assert.equal(matchesProjectScope({ status: 'Rodaje' }, 'historical'), false);
  assert.equal(matchesProjectScope({ status: 'Presupuesto' }, 'current'), true);
});

test('pending price and conversion provenance appear only in the admin commercial summary', () => {
  const project = { name: 'Histórico', controlTotalSourceWarning: 'Precio pendiente. USD convertido con BNA del día.' };
  assert.equal(renderToStaticMarkup(React.createElement(ProjectCommercialSummary, { project, isProjectAdmin: false })), '');
  const admin = renderToStaticMarkup(React.createElement(ProjectCommercialSummary, { project, isProjectAdmin: true }));
  assert.match(admin, /Precio pendiente/); assert.match(admin, /BNA del día/);
});
