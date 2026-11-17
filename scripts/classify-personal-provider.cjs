#!/usr/bin/env node
'use strict';
// No login, tokens on disk, impersonation, custom tokens, bank or membership writes.
// Run by the authorized production operator. Default is a read-only preview.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { classifyPersonalProvider } = require('../functions/providerPersonalClassification');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function officialAccessToken(cli, account, now = Date.now()) {
  assert(account.tokens?.refresh_token, 'Falta la sesión oficial local; no se inicia login desde esta herramienta.');
  // Firebase CLI 15.36 auth.js SCOPES for the original interactive login.
  // Requesting only cloud/firebase downscopes the token and userinfo returns401.
  // Restore only those originally granted CLI scopes, never start another login.
  const originalLoginScopes = ['email', 'openid', 'https://www.googleapis.com/auth/cloudplatformprojects.readonly',
    'https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/cloud-platform'];
  const granted = new Set([...(account.tokens.scopes || []), ...(account.tokens.scope || '').split(' ')]);
  const hasIdentityScope = granted.has('email') || granted.has('https://www.googleapis.com/auth/userinfo.email');
  const oauth = account.tokens.expires_at > now + 60000 && hasIdentityScope ? account.tokens
    : await cli.getAccessToken(account.tokens.refresh_token, originalLoginScopes);
  // CLI's legacy CI-token fallback returns refresh_token as access_token after a
  //400/401 refresh response. It is never an acceptable administrative identity.
  assert(oauth.access_token && oauth.access_token !== account.tokens.refresh_token && oauth.expires_at > now + 60000,
    'La CLI no devolvió un access token vigente para comprobar identidad. No se inicia login ni se escribe en GOAT.');
  return oauth.access_token;
}
function privateDirectory(folder, localRoot = process.env.LOCALAPPDATA) {
  assert(localRoot && path.isAbsolute(folder), 'El respaldo debe estar en un directorio privado de LOCALAPPDATA.');
  const root = fs.realpathSync(localRoot), target = path.resolve(folder), relative = path.relative(root, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'El respaldo debe quedar dentro de LOCALAPPDATA.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'No se permiten enlaces en la ruta del respaldo.');
    else fs.mkdirSync(current);
  }
  return target;
}
async function main() {
  const args = process.argv.slice(2), inputPath = args.find(arg => !arg.startsWith('--'));
  assert(inputPath && args.every(arg => arg === inputPath || arg === '--apply'), 'Uso: node scripts/classify-personal-provider.cjs <JSON-privado> [--apply]');
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { authorizationFile, localBackupDir, firebaseCliPath = process.env.FIREBASE_CLI_JS, ...input } = raw;
  assert.equal(sha(fs.readFileSync(authorizationFile)), input.authorizationSha256, 'La fuente de autorización cambió.');
  const output = privateDirectory(localBackupDir);
  assert(firebaseCliPath && path.isAbsolute(firebaseCliPath), 'Indicá la instalación oficial vigente de Firebase CLI (firebaseCliPath).');
  const cliRoot = path.resolve(path.dirname(firebaseCliPath), '../..');
  assert.equal(JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')).name, 'firebase-tools', 'La ruta no corresponde a Firebase CLI oficial.');
  const cli = require(path.join(cliRoot, 'lib/auth'));
  const account = cli.getGlobalDefaultAccount();
  assert.equal(account?.user?.email, input.operatorEmail, 'La cuenta oficial local no coincide con el operador.');
  const token = await officialAccessToken(cli, account);
  assert(token, 'Falta el acceso oficial vigente.');
  const identityResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  assert(identityResponse.ok, 'No se pudo verificar la identidad de la sesión oficial.');
  const identity = await identityResponse.json();
  assert(identity.email === input.operatorEmail && identity.email_verified === true, 'La sesión real no corresponde al operador verificado.');
  const findAccountByUid = async uid => {
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/projects/gb-goat/accounts:lookup', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }), signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, `No se pudo comprobar Auth (HTTP ${response.status}); no se continúa.`);
    const result = await response.json();
    assert.equal(result.users?.length, 1, 'No existe una cuenta única para el UID indicado.');
    const user = result.users[0];
    return { uid: user.localId, email: user.email, emailVerified: user.emailVerified, disabled: user.disabled || false,
      providerData: (user.providerUserInfo || []).map(provider => ({ providerId: provider.providerId })) };
  };
  const req = createRequire(require.resolve('../functions/node_modules/google-gax'));
  const { OAuth2Client, GoogleAuth } = req('google-auth-library');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token });
  const { Firestore, FieldValue } = require('../functions/node_modules/@google-cloud/firestore');
  const db = new Firestore({ projectId: 'gb-goat', preferRest: true, auth: new GoogleAuth({ authClient }) });
  try {
    const result = await classifyPersonalProvider({ db, input, operatorEmail: identity.email, findAccountByUid,
      apply: args.includes('--apply'), timestamp: () => FieldValue.serverTimestamp(), backupBefore: async snapshot => {
        const file = path.join(output, `before-${sha(input.operationKey).slice(0, 20)}-${snapshot.provider.version}.json`);
        const contents = JSON.stringify(snapshot, null, 2);
        if (fs.existsSync(file)) assert.equal(fs.readFileSync(file, 'utf8'), contents, 'Ya existe un respaldo distinto; detener.');
        else fs.writeFileSync(file, contents, { flag: 'wx' });
      } });
    const resultFile = path.join(output, `${args.includes('--apply') ? 'apply' : 'preview'}-${sha(input.operationKey).slice(0, 20)}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, privateResultFile: resultFile }));
    if (result.verification === 'failed_after_commit') process.exitCode = 1;
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch(error => { console.error(error.code === 'ERR_ASSERTION' ? error.message : 'La operación se detuvo. Revisar el resultado privado y el estado antes de reintentar.'); process.exitCode = 1; });
module.exports = { privateDirectory, officialAccessToken };
