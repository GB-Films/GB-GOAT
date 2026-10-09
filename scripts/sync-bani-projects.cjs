const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
const { createRequire } = require('node:module');
const requireGax = createRequire(require.resolve('../functions/node_modules/google-gax'));
const { OAuth2Client, GoogleAuth } = requireGax('google-auth-library');
const { syncGoatProject } = require('../functions/baniProjectSync');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ownerUid = process.env.BANI_OWNER_UID;
  if (!ownerUid) throw new Error('BANI_OWNER_UID is required');
  const links = new Map(args.filter(value => value.startsWith('--link=')).map(value => value.slice(7).split('=')));
  if ([...links.values()].some(value => !value || value.includes('/'))) throw new Error('Invalid link');
  if (new Set(links.values()).size !== links.size) throw new Error('Multiple GOAT projects cannot share one BANI project');

  // OAuth credentials remain in memory. Normal deployments use Application Default Credentials.
  const authClient = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ? new OAuth2Client() : undefined;
  if (authClient) authClient.setCredentials({ access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
  const auth = authClient ? new GoogleAuth({ authClient }) : undefined;
  const sourceDb = new Firestore({ projectId: 'gb-goat', preferRest: true, ...(auth ? { auth } : {}) });
  const targetDb = new Firestore({ projectId: 'gran-berta-films', databaseId: 'ai-studio-1ef504c9-77ed-4378-b361-4b3659b5d837', preferRest: true, ...(auth ? { auth } : {}) });
  const source = await sourceDb.collection('projects').select('name').get();
  const target = await targetDb.collection('users').doc(ownerUid).collection('postProjects').select('name', 'goatProjectId').get();
  const plan = [];
  for (const [sourceId, targetId] of links) {
    if (!source.docs.some(item => item.id === sourceId)) throw new Error(`GOAT project not found: ${sourceId}`);
    const existing = target.docs.find(item => item.id === targetId);
    if (!existing) throw new Error(`BANI project not found: ${targetId}`);
    if (existing.data().goatProjectId && existing.data().goatProjectId !== sourceId) throw new Error(`BANI project already linked: ${targetId}`);
  }
  for (const item of source.docs) {
    const linked = target.docs.filter(project => project.data().goatProjectId === item.id);
    if (linked.length > 1) throw new Error(`Duplicate GOAT link: ${item.id}`);
    const targetId = linked[0]?.id || links.get(item.id) || `goat-${item.id}`;
    const existing = target.docs.find(project => project.id === targetId);
    plan.push({ projectId: item.id, name: item.data().name, targetId, action: existing ? 'link/update' : 'create' });
  }
  console.table(plan);
  if (!apply) {
    console.log('Preview only. Review the links, then repeat with --apply.');
    return;
  }
  for (const item of plan) {
    const result = await syncGoatProject({ sourceDb, targetDb, ownerUid, projectId: item.projectId, targetId: item.targetId });
    console.log(JSON.stringify(result));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
