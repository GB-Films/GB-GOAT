// One administrative fact, default preview. No public endpoint or SDK rule grant.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { authorizeContract } = require('../functions/crmContractAuthorization');
async function main() {
  const args = process.argv.slice(2), inputPath = args.find(a => !a.startsWith('--'));
  assert(inputPath && args.every(a => a === inputPath || a === '--apply'), 'Uso: node scripts/authorize-crm-contract.cjs <JSON-privado> [--apply]');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const bytes = fs.readFileSync(input.sourceFile), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, input.sourceSha256, 'La evidencia humana cambió o no coincide con su huella');
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth'));
  const account = auth.getGlobalDefaultAccount(); assert(account?.user?.email && account.user.email === input.operatorEmail, 'La sesión oficial no corresponde al operador indicado');
  const token = account.tokens.expires_at > Date.now() + 60000 ? account.tokens : await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const req = createRequire(require.resolve('../functions/node_modules/google-gax'));
  const { OAuth2Client, GoogleAuth } = req('google-auth-library');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token.access_token });
  const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
  const db = new Firestore({ projectId: 'gb-goat', preferRest: true, auth: new GoogleAuth({ authClient }) });
  try {
    const result = await authorizeContract({ db, input, operatorEmail: account.user.email, apply: args.includes('--apply') });
    if (args.includes('--apply')) assert.deepEqual((await db.collection('crmProjectImportAuthorizations').doc(result.authorizationId).get()).data(), result.record, 'Lectura posterior no coincide');
    console.log(JSON.stringify(result));
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
