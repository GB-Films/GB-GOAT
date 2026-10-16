#!/usr/bin/env node
// Read-only by default. --apply --backup-dir <private absolute directory>
// Copies exact Firestore values atomically, then strips only the protected keys.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { COMMERCIAL_FIELDS, splitProjectCommercial } = require('../functions/projectCommercial');
const apply = process.argv.includes('--apply');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const base = 'https://firestore.googleapis.com/v1/projects/gb-goat/databases/(default)/documents';
const fullName = id => `projects/gb-goat/databases/(default)/documents/projectCommercial/${id}`;

async function main() {
  const cli = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
  const { configstore } = require(path.join(cli, 'configstore'));
  const { getAccessToken } = require(path.join(cli, 'auth'));
  assert.equal(configstore.get('user')?.email, 'info@granbertafilms.com', 'Use the authorized company account');
  const token = await getAccessToken(configstore.get('tokens').refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']);
  const api = async (suffix, body) => {
    const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Firestore HTTP ${response.status}`);
    return response.json();
  };
  const projects = [];
  let pageToken;
  do {
    const page = await api('/projects?pageSize=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    projects.push(...(page.documents || [])); pageToken = page.nextPageToken;
  } while (pageToken);
  assert.ok(projects.length > 0, 'No projects found');
  const privateRows = await api(':batchGet', { documents: projects.map(p => fullName(p.name.split('/').pop())) });
  const privateByName = new Map(privateRows.filter(r => r.found).map(r => [r.found.name, r.found]));
  const plans = projects.map(project => {
    const id = project.name.split('/').pop();
    const existing = privateByName.get(fullName(id));
    for (const key of Object.keys(project.fields)) {
      assert.ok(!key.startsWith('controlTotal') || COMMERCIAL_FIELDS.includes(key), `Unknown commercial key: ${key}`);
    }
    const { publicData, commercial } = splitProjectCommercial(project.fields);
    for (const [key, value] of Object.entries(commercial)) {
      assert.ok(!existing?.fields?.[key] || isDeepStrictEqual(value, existing.fields[key]), `Conflicting private value for ${id}/${key}; stop for review`);
    }
    const fields = { ...(existing?.fields || {}), ...commercial };
    assert.ok(Object.keys(fields).every(k => COMMERCIAL_FIELDS.includes(k) || ['schemaVersion', 'updatedAt'].includes(k)), `Unknown private schema in ${id}`);
    for (const key of ['budgetTotal', 'controlTotalContractAmount', 'controlTotalContractArs', 'controlTotalContractUsd']) {
      const value = fields[key];
      if (value && !('nullValue' in value)) {
        const n = Number(value.integerValue ?? value.doubleValue);
        assert.ok(Number.isFinite(n) && n >= 0 && n <= 1e15, `Invalid amount in ${id}/${key}`);
      }
    }
    for (const [key, value] of Object.entries(fields)) if ('stringValue' in value) {
      const max = key.includes('Url') ? 2048 : key === 'controlTotalSourceWarning' ? 2000 : ['controlTotalConfirmationDate', 'controlTotalDeliveryDate'].includes(key) ? 100 : 500;
      assert.ok(value.stringValue.length <= max, `Oversized string in ${id}/${key}`);
      if (key.includes('Url')) assert.ok(value.stringValue === '' || value.stringValue.startsWith('https://'), `Invalid URL in ${id}/${key}`);
    }
    if (fields.controlTotalContractCurrency) assert.ok(['ARS', 'USD', ''].includes(fields.controlTotalContractCurrency.stringValue), `Invalid currency in ${id}`);
    if (fields.controlTotalImportedAt) assert.ok(fields.controlTotalImportedAt.timestampValue, `Invalid import timestamp in ${id}`);
    if (fields.controlTotalSourceRowAtImport) assert.ok(fields.controlTotalSourceRowAtImport.integerValue && Number(fields.controlTotalSourceRowAtImport.integerValue) >= 1 && Number(fields.controlTotalSourceRowAtImport.integerValue) <= 1e7, `Invalid source row in ${id}`);
    return { id, project, existing, publicData, commercial, fields, migrate: Object.keys(commercial).length > 0 || project.fields.commercialDataVersion?.integerValue !== '1' || !existing };
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', projects: plans.length, toMigrate: plans.filter(p => p.migrate).length, alreadyPrivate: plans.filter(p => !p.migrate).length, fields: [...new Set(plans.flatMap(p => Object.keys(p.commercial)))].sort() }));
  if (!apply) return;
  assert.ok(process.argv.includes('--backup-dir'), 'A private backup directory is required');
  const config = JSON.parse(fs.readFileSync('D:/Tomas/Dev/GB-DATA/admin.local.json', 'utf8'));
  const companyRoot = fs.realpathSync(config.companyRoot);
  const backupDir = path.resolve(arg('--backup-dir'));
  assert.ok(backupDir.toLowerCase().startsWith((companyRoot + path.sep).toLowerCase()), 'Backup must stay inside the private company library');
  assert.ok(!fs.existsSync(backupDir), 'Use a fresh backup directory');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'before.json'), JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), projects, commercial: [...privateByName.values()] }, null, 2), { flag: 'wx' });
  let migrated = 0;
  for (const plan of plans.filter(p => p.migrate)) {
    const { id, project, existing, publicData, fields } = plan;
    const nextPrivate = { ...fields, schemaVersion: { integerValue: '1' } };
    delete nextPrivate.updatedAt;
    const nextPublic = { ...publicData, commercialDataVersion: { integerValue: '1' } };
    delete nextPublic.updatedAt;
    const writes = [
      { update: { name: fullName(id), fields: nextPrivate }, currentDocument: existing ? { updateTime: existing.updateTime } : { exists: false }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] },
      { update: { name: project.name, fields: nextPublic }, currentDocument: { updateTime: project.updateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] },
    ];
    let commitError;
    try { await api(':commit', { writes }); } catch (error) { commitError = error; }
    const after = await api(':batchGet', { documents: [project.name, fullName(id)] });
    const publicAfter = after.find(r => r.found?.name === project.name)?.found;
    const privateAfter = after.find(r => r.found?.name === fullName(id))?.found;
    assert.ok(publicAfter && privateAfter, 'Missing after-image; stop');
    const actualPublic = { ...publicAfter.fields }; delete actualPublic.updatedAt;
    const actualPrivate = { ...privateAfter.fields }; delete actualPrivate.updatedAt;
    if (!isDeepStrictEqual(actualPublic, nextPublic) || !isDeepStrictEqual(actualPrivate, nextPrivate)) {
      throw commitError || new Error(`Readback mismatch for ${id}; stop without retry`);
    }
    assert.equal(Object.keys(splitProjectCommercial(actualPublic).commercial).length, 0);
    migrated++;
    fs.appendFileSync(path.join(backupDir, 'verified.jsonl'), JSON.stringify({ projectId: id, publicVersion: publicAfter.updateTime, privateVersion: privateAfter.updateTime, fieldsMoved: Object.keys(plan.commercial) }) + '\n');
  }
  console.log(JSON.stringify({ verified: true, projects: plans.length, migrated, backupDir, changedCollections: ['projects', 'projectCommercial'], financialSubcollectionsChanged: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
