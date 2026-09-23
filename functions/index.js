const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');
const { fetchProjects, canRefresh } = require('./catalog');

const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });

exports.refreshControlTotalProjectCatalog = onCall({
  region: 'us-central1',
  serviceAccount: 'goat-catalog-reader@gb-goat.iam.gserviceaccount.com',
  memory: '256MiB',
  maxInstances: 2,
  timeoutSeconds: 60,
}, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Iniciá sesión en GOAT.');
  if (!canRefresh(request.auth)) {
    throw new HttpsError('permission-denied', 'Esta cuenta no puede actualizar el catálogo G.');
  }

  try {
    const client = await googleAuth.getClient();
    const getJson = async url => {
      const headers = await client.getRequestHeaders(url);
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          throw new Error('La cuenta técnica no puede leer Control Total. Revisar su permiso de lector.');
        }
        throw new Error(`No se pudo consultar Control Total (${response.status}).`);
      }
      return response.json();
    };
    const projects = await fetchProjects(getJson);
    return { projects };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('No se pudo actualizar el catálogo G:', error);
    throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'No se pudo actualizar el catálogo G.');
  }
});
