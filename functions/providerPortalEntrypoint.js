const { onCall } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { createProviderPortalHandler } = require("./providerPortal");
const { createProviderPortalAdminHandler } = require("./providerPortalAdmin");
const { createSignBridge } = require("./providerPortalSign");
if (!getApps().length) initializeApp();
const db = getFirestore(),
  sign = createSignBridge(db);
const portalServiceAccount = defineString("GOAT_PORTAL_SERVICE_ACCOUNT", {
  default: "goat-provider-portal@gb-goat.iam.gserviceaccount.com",
});
const { createPortalFileReader } = require("./providerPortalFiles");
const deps = {
  db,
  sign,
  findAccount: (email) =>
    require("firebase-admin/auth").getAuth().getUserByEmail(email),
  findAccountByUid: uid => require('firebase-admin/auth').getAuth().getUser(uid),
  verifyGoogleToken: token => require('firebase-admin/auth').getAuth().verifyIdToken(token, true),
  timestamp: () => FieldValue.serverTimestamp(),
  readFile: createPortalFileReader({ db, readLocalFile: sign.readLocalFile }),
};
exports.providerPortal = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 3,
    serviceAccount: portalServiceAccount,
  },
  createProviderPortalHandler(deps),
);
exports.manageProviderPortal = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 2,
    serviceAccount: portalServiceAccount,
  },
  createProviderPortalAdminHandler(deps),
);
