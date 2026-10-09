#!/usr/bin/env node
'use strict';

// Uses the already-authorized Firebase CLI account in memory. No key/token file.
// Default is a read-only preview. --apply provisions only this integration.
const path = require('node:path');
const apply = process.argv.includes('--apply');
const project = 'gb-goat';
const number = '305015252000';
const repositoryId = '1324272374';
const ownerId = '280508939';
const runtime = `crm-project-import@${project}.iam.gserviceaccount.com`;
const caller = `crm-goat-caller@${project}.iam.gserviceaccount.com`;
const roleName = `projects/${project}/roles/crmProjectImport`;
const pool = `projects/${number}/locations/global/workloadIdentityPools/crm-goat`;
const provider = `${pool}/providers/github`;
const service = `projects/${project}/locations/us-central1/services/importcrmproject`;
const permissions = ['datastore.databases.get', 'datastore.entities.get', 'datastore.entities.list', 'datastore.entities.create'];
const condition = `assertion.repository_id == '${repositoryId}' && assertion.repository_owner_id == '${ownerId}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'Klausstin/gran-crm/.github/workflows/code-generator.yml@refs/heads/main'`;
const principal = `principalSet://iam.googleapis.com/${pool}/attribute.repository_id/${repositoryId}`;

let Client;
async function request(host, version, method, resource, body) {
  const [resourcePath, query] = resource.split('?');
  const result = await new Client({ urlPrefix: `https://${host}.googleapis.com`, apiVersion: version }).request({
    method, path: resourcePath, body, timeout: 30000,
    ...(query ? { queryParams: Object.fromEntries(new URLSearchParams(query)) } : {}),
  });
  return result.body;
}
async function getOrNull(host, version, resource) {
  try { return await request(host, version, 'GET', resource); }
  catch (error) { if (error.status === 404 || error.context?.response?.statusCode === 404) return null; throw error; }
}
async function waitOperation(host, version, operation) {
  for (let attempt = 0; !operation.done && attempt < 12; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    operation = await request(host, version, 'GET', operation.name);
  }
  if (operation.error) throw new Error(operation.error.message);
  if (!operation.done) throw new Error('La operación sigue pendiente; repetir la configuración para verificar.');
  return operation.response;
}
async function ensureAccount(accountId, displayName) {
  const email = `${accountId}@${project}.iam.gserviceaccount.com`;
  const found = await getOrNull('iam', 'v1', `projects/${project}/serviceAccounts/${email}`);
  if (found) {
    if (found.disabled) throw new Error(`Cuenta deshabilitada: ${email}`);
    console.log(`Cuenta existente: ${email}`);
    return;
  }
  console.log(`${apply ? 'Crear' : 'Se crearía'} cuenta: ${email}`);
  if (apply) await request('iam', 'v1', 'POST', `projects/${project}/serviceAccounts`, { accountId, serviceAccount: { displayName } });
}
async function addBinding(host, version, resource, role, member, bindingCondition) {
  let policy;
  const usesPost = host === 'cloudresourcemanager' || host === 'iam';
  try {
    policy = usesPost
      ? await request(host, version, 'POST', `${resource}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })
      : await request(host, version, 'GET', `${resource}:getIamPolicy?options.requestedPolicyVersion=3`);
  } catch (error) {
    if (!apply && (error.status === 404 || error.context?.response?.statusCode === 404)) {
      console.log(`Se concedería ${role} a ${member} en ${resource}${bindingCondition ? ` (${bindingCondition.expression})` : ''}`);
      return;
    }
    throw error;
  }
  const binding = (policy.bindings || []).find(item => item.role === role && (item.condition?.expression || '') === (bindingCondition?.expression || ''));
  if (binding?.members.includes(member)) {
    console.log(`Permiso ya configurado: ${role} en ${resource}`);
    return;
  }
  if (binding) binding.members.push(member);
  else (policy.bindings ||= []).push({ role, members: [member], ...(bindingCondition ? { condition: bindingCondition } : {}) });
  policy.version = 3;
  console.log(`${apply ? 'Conceder' : 'Se concedería'} ${role} a ${member} en ${resource}${bindingCondition ? ` (${bindingCondition.expression})` : ''}`);
  if (apply) await request(host, version, 'POST', `${resource}:setIamPolicy`, { policy });
}

async function main() {
  const toolsDir = process.env.FIREBASE_TOOLS_DIR || (process.env.APPDATA ? path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools') : null);
  if (!toolsDir) throw new Error('Indicar FIREBASE_TOOLS_DIR (carpeta del CLI autorizado).');
  const auth = require(path.join(toolsDir, 'lib/auth'));
  const account = auth.findAccountByEmail('info@granbertafilms.com');
  if (!account) throw new Error('Autorizar primero el CLI con info@granbertafilms.com.');
  await require(path.join(toolsDir, 'lib/requireAuth')).requireAuth({ project, nonInteractive: true, user: account.user, tokens: account.tokens });
  Client = require(path.join(toolsDir, 'lib/apiv2')).Client;
  console.log(apply ? 'APLICAR configuración CRM → GOAT' : 'VISTA PREVIA (sin escrituras) CRM → GOAT');
  const billing = await request('cloudbilling', 'v1', 'GET', `projects/${project}/billingInfo`);
  if (!billing.billingEnabled) throw new Error('GOAT no tiene facturación habilitada. Este script no cambia planes ni cuentas de facturación.');
  for (const api of ['iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com']) {
    const resource = `projects/${number}/services/${api}`;
    const state = await request('serviceusage', 'v1', 'GET', resource);
    if (state.state !== 'ENABLED') {
      console.log(`${apply ? 'Habilitar' : 'Se habilitaría'} API: ${api}`);
      if (apply) await waitOperation('serviceusage', 'v1', await request('serviceusage', 'v1', 'POST', `${resource}:enable`, {}));
    }
  }
  await ensureAccount('crm-project-import', 'CRM → GOAT: create-only project importer');
  await ensureAccount('crm-goat-caller', 'CRM code generator: invoke GOAT importer only');
  const role = await getOrNull('iam', 'v1', roleName);
  if (role) {
    if (role.deleted || JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify([...permissions].sort())) {
      throw new Error('El rol existente no coincide con lectura/creación sin update/delete. Revisar antes de cambiar permisos.');
    }
  } else {
    console.log(`${apply ? 'Crear' : 'Se crearía'} rol ${roleName}: ${permissions.join(', ')}`);
    if (apply) await request('iam', 'v1', 'POST', `projects/${project}/roles`, {
      roleId: 'crmProjectImport', role: { title: 'CRM project importer', description: 'Read and create GOAT projects/receipts; no update/delete or Auth access.', includedPermissions: permissions, stage: 'GA' },
    });
  }
  await addBinding('cloudresourcemanager', 'v1', `projects/${project}`, roleName, `serviceAccount:${runtime}`, {
    title: 'crm-goat-default-database', expression: `resource.name == 'projects/${project}/databases/(default)'`,
  });
  const foundPool = await getOrNull('iam', 'v1', pool);
  if (foundPool?.disabled) throw new Error('El pool está deshabilitado; revisar antes de habilitarlo.');
  if (!foundPool) {
    console.log(`${apply ? 'Crear' : 'Se crearía'} pool ${pool}`);
    if (apply) await waitOperation('iam', 'v1', await request('iam', 'v1', 'POST', `projects/${number}/locations/global/workloadIdentityPools?workloadIdentityPoolId=crm-goat`, {
      displayName: 'CRM to GOAT', description: 'Only the official CRM Code Generator workflow may call the private importer.',
    }));
  }
  const foundProvider = foundPool || apply ? await getOrNull('iam', 'v1', provider) : null;
  const mapping = { 'google.subject': 'assertion.sub', 'attribute.repository_id': 'assertion.repository_id' };
  if (foundProvider) {
    if (foundProvider.disabled || foundProvider.attributeCondition !== condition
        || foundProvider.oidc?.issuerUri !== 'https://token.actions.githubusercontent.com'
        || Object.entries(mapping).some(([key, value]) => foundProvider.attributeMapping?.[key] !== value)
        || (foundProvider.oidc?.allowedAudiences?.length || 0) > 0) throw new Error('El provider existente tiene otra frontera de confianza; no se modificó.');
  } else {
    console.log(`${apply ? 'Crear' : 'Se crearía'} provider: ${provider}`);
    console.log(`Restricción: ${condition}`);
    if (apply) await waitOperation('iam', 'v1', await request('iam', 'v1', 'POST', `${pool}/providers?workloadIdentityPoolProviderId=github`, {
      displayName: 'CRM GitHub Actions', attributeMapping: mapping, attributeCondition: condition,
      oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
    }));
  }
  await addBinding('iam', 'v1', `projects/${project}/serviceAccounts/${caller}`, 'roles/iam.workloadIdentityUser', principal);
  const cloudRun = await getOrNull('run', 'v2', service);
  if (cloudRun) {
    const policy = await request('run', 'v2', 'GET', `${service}:getIamPolicy`);
    if ((policy.bindings || []).some(binding => (binding.members || []).some(member => member === 'allUsers' || member === 'allAuthenticatedUsers'))) {
      throw new Error('El servicio tiene un permiso público; revisar su política antes de activar el CRM.');
    }
    await addBinding('run', 'v2', service, 'roles/run.invoker', `serviceAccount:${caller}`);
    console.log(`GOAT_PROJECT_IMPORT_URL=${cloudRun.uri}`);
  } else console.log('Servicio todavía no creado. Repetir después de desplegar sólo functions:importCrmProject.');
  console.log(`GOAT_WORKLOAD_IDENTITY_PROVIDER=${provider}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
