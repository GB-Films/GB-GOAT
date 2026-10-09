#!/usr/bin/env node
'use strict';

// Read-only smoke test: anonymous denial and narrowly scoped service IAM.
// No sale/project is invented or created, no service-account key is exported.
const path = require('node:path');
const project = 'gb-goat';
const url = 'https://importcrmproject-xydezfivga-uc.a.run.app';

async function main() {
  const anonymous = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000) });
  if (![401, 403].includes(anonymous.status)) throw new Error(`Acceso anónimo inesperado: ${anonymous.status}`);
  console.log(`Sin autorización: HTTP ${anonymous.status}, bloqueado.`);
  const toolsDir = process.env.FIREBASE_TOOLS_DIR || (process.env.APPDATA ? path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools') : null);
  if (!toolsDir) throw new Error('Indicar FIREBASE_TOOLS_DIR.');
  const account = require(path.join(toolsDir, 'lib/auth')).findAccountByEmail('info@granbertafilms.com');
  if (!account) throw new Error('Autorizar el CLI con la cuenta de la empresa.');
  await require(path.join(toolsDir, 'lib/requireAuth')).requireAuth({ project, nonInteractive: true, user: account.user, tokens: account.tokens });
  const { Client } = require(path.join(toolsDir, 'lib/apiv2'));
  const run = new Client({ urlPrefix: 'https://run.googleapis.com', apiVersion: 'v2' });
  const policy = await run.request({
    method: 'GET', path: `projects/${project}/locations/us-central1/services/importcrmproject:getIamPolicy`, timeout: 30000,
  });
  const bindings = policy.body.bindings || [];
  if (bindings.some(binding => binding.members.some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)))) throw new Error('El servicio tiene acceso público.');
  if (!bindings.some(binding => binding.role === 'roles/run.invoker' && binding.members.includes(`serviceAccount:crm-goat-caller@${project}.iam.gserviceaccount.com`))) throw new Error('Falta el permiso de la cuenta llamadora.');
  console.log('IAM del servicio: privado; la cuenta dedicada del CRM tiene permiso de invocación.');
  console.log('La prueba de autorización efectiva se ejecuta desde el workflow oficial del CRM, con verificar_goat=true; no requiere dar permisos nuevos a una persona.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
