const admin = require('firebase-admin');

let db = null;
let bucket = null;
let enabled = false;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }
  return null;
}

function initFirebase() {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return false;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
    });
  }

  db = admin.firestore();
  bucket = admin.storage().bucket();
  enabled = true;
  return true;
}

initFirebase();

function isEnabled() {
  return enabled;
}

function getDb() {
  return db;
}

function getBucket() {
  return bucket;
}

module.exports = {
  isEnabled,
  getDb,
  getBucket,
  admin
};
