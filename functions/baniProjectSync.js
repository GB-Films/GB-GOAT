const text = value => typeof value === 'string' ? value.trim() : '';

function sourceMetadata(data) {
  return {
    name: text(data.name),
    client: text(data.clientName),
    company: text(data.companyName),
    brand: text(data.brandName),
    description: text(data.description),
    projectCode: text(data.projectCode),
    status: text(data.status),
  };
}

function compareVersions(a, b) {
  return Number(a?.seconds || 0) - Number(b?.seconds || 0)
    || Number(a?.nanoseconds || 0) - Number(b?.nanoseconds || 0);
}

function buildBaniPatch({ projectId, data, version, existing, now = Date.now() }) {
  if (!projectId || projectId.includes('/')) throw new Error('Invalid GOAT project ID');
  const source = sourceMetadata(data);
  if (!source.name) throw new Error('GOAT project has no name');
  if (existing?.goatProjectId && existing.goatProjectId !== projectId) {
    throw new Error('BANI project is linked to another GOAT project');
  }
  if (existing?.goatSyncedVersion && compareVersions(version, existing.goatSyncedVersion) <= 0) return null;

  const patch = {
    goatProjectId: projectId,
    goatProjectUrl: `https://gb-films.github.io/GB-GOAT/#/proyectos/${encodeURIComponent(projectId)}`,
    goatProjectCode: source.projectCode,
    goatSource: source,
    goatSyncedVersion: version,
    goatSyncedAt: now,
  };

  if (!existing) {
    return {
      ...patch,
      id: `goat-${projectId}`,
      name: source.name,
      client: source.client,
      clientFinal: '',
      projectCode: '',
      projectPhase: 'budget',
      status: 'Brief',
      stage: 'Presupuesto',
      progress: 0,
      budgetVersions: [],
      calendarVersions: [],
      assignedTeam: [],
      assignedTeamMemberIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  // Linking a legacy project preserves its identity and every BANI-only field.
  // Later changes from GOAT update identity, but never production/financial data.
  if (existing.goatSource && source.name !== existing.goatSource.name) patch.name = source.name;
  if (existing.goatSource && source.client !== existing.goatSource.client) {
    patch.client = source.client;
    if (existing.clientFinal) patch.clientFinal = source.client;
  }
  return patch;
}

async function syncGoatProject({ sourceDb, targetDb, ownerUid, projectId, targetId }) {
  if (!ownerUid || ownerUid.includes('/')) throw new Error('Invalid BANI workspace owner');
  const source = await sourceDb.collection('projects').doc(projectId).get();
  // Deleting in GOAT must never delete hours, budgets or other BANI history.
  if (!source.exists) return { outcome: 'source-missing', projectId };
  const version = { seconds: source.updateTime.seconds, nanoseconds: source.updateTime.nanoseconds };
  const collection = targetDb.collection('users').doc(ownerUid).collection('postProjects');
  return targetDb.runTransaction(async transaction => {
    const linked = await transaction.get(collection.where('goatProjectId', '==', projectId).limit(2));
    if (linked.size > 1) throw new Error(`Multiple BANI projects linked to GOAT ${projectId}`);
    const ref = linked.empty ? collection.doc(targetId || `goat-${projectId}`) : linked.docs[0].ref;
    if (targetId && ref.id !== targetId) throw new Error('GOAT project already has another BANI link');
    const snapshot = await transaction.get(ref);
    const patch = buildBaniPatch({ projectId, data: source.data(), version, existing: snapshot.exists ? snapshot.data() : null });
    if (!patch) return { outcome: 'unchanged', projectId, targetId: ref.id };
    if (snapshot.exists) transaction.update(ref, patch);
    else transaction.create(ref, patch);
    return { outcome: snapshot.exists ? 'updated' : 'created', projectId, targetId: ref.id };
  });
}

module.exports = { sourceMetadata, compareVersions, buildBaniPatch, syncGoatProject };
