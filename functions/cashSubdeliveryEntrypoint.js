const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createCashSubdeliveryHandler } = require('./cashSubdelivery');
if (!admin.apps.some(app => app?.name === '[DEFAULT]')) admin.initializeApp();
exports.createCashSubdelivery = onCall({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 2, memory: '256MiB' }, createCashSubdeliveryHandler({
  db: admin.firestore(), timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}));
