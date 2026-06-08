const admin = require('firebase-admin');

let db = null;
let bucket = null;
let enabled = false;
let storageEnabled = false;

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
    const config = { credential: admin.credential.cert(serviceAccount) };
    if (process.env.USE_FIREBASE_STORAGE === 'true' && process.env.FIREBASE_STORAGE_BUCKET) {
      config.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      storageEnabled = true;
    }
    admin.initializeApp(config);
  }

  db = admin.firestore();
  if (storageEnabled) {
    bucket = admin.storage().bucket();
  }
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

function hasStorage() {
  return storageEnabled && !!bucket;
}

module.exports = {
  isEnabled,
  hasStorage,
  getDb,
  getBucket,
  admin
};
