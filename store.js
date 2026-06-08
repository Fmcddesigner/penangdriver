const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const firebase = require('./firebase');

function getSiteKey(isPublicSite) {
  return process.env.FIREBASE_SITE_KEY || (isPublicSite ? 'public' : 'penangdriver');
}

function linksFileFor(siteKey) {
  return path.join(__dirname, 'data', siteKey === 'public' ? 'links-public.json' : 'links.json');
}

function usersFileFor() {
  return path.join(__dirname, 'data', 'users.json');
}

function linksCollection(siteKey) {
  return firebase.getDb().collection('sites').doc(siteKey).collection('links');
}

function usersCollection(siteKey) {
  return firebase.getDb().collection('sites').doc(siteKey).collection('users');
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createStore({ isPublicSite }) {
  const siteKey = getSiteKey(isPublicSite);
  const linksFile = linksFileFor(siteKey);
  const usersFile = usersFileFor();
  const useFirebase = firebase.isEnabled();

  async function getAllLinks() {
    if (useFirebase) {
      const snap = await linksCollection(siteKey).get();
      const links = {};
      snap.forEach((doc) => { links[doc.id] = doc.data(); });
      return links;
    }
    return readJsonFile(linksFile);
  }

  async function getLink(slug) {
    if (useFirebase) {
      const doc = await linksCollection(siteKey).doc(slug).get();
      return doc.exists ? doc.data() : null;
    }
    const links = readJsonFile(linksFile);
    return links[slug] || null;
  }

  async function saveLink(slug, data) {
    if (useFirebase) {
      await linksCollection(siteKey).doc(slug).set(data);
      return;
    }
    const links = readJsonFile(linksFile);
    links[slug] = data;
    writeJsonFile(linksFile, links);
  }

  async function deleteLink(slug) {
    if (useFirebase) {
      await linksCollection(siteKey).doc(slug).delete();
      return;
    }
    const links = readJsonFile(linksFile);
    delete links[slug];
    writeJsonFile(linksFile, links);
  }

  async function incrementClicks(slug) {
    if (useFirebase) {
      await linksCollection(siteKey).doc(slug).update({
        clicks: firebase.admin.firestore.FieldValue.increment(1)
      });
      return;
    }
    const links = readJsonFile(linksFile);
    if (links[slug]) {
      links[slug].clicks = (links[slug].clicks || 0) + 1;
      writeJsonFile(linksFile, links);
    }
  }

  async function seedLinks(defaults) {
    const links = await getAllLinks();
    if (Object.keys(links).length > 0) return;
    for (const [slug, data] of Object.entries(defaults)) {
      await saveLink(slug, data);
    }
  }

  async function getUser(username) {
    if (useFirebase) {
      const doc = await usersCollection(siteKey).doc(username).get();
      return doc.exists ? doc.data() : null;
    }
    const users = readJsonFile(usersFile);
    return users[username] || null;
  }

  async function saveUser(username, data) {
    if (useFirebase) {
      await usersCollection(siteKey).doc(username).set(data);
      return;
    }
    const users = readJsonFile(usersFile);
    users[username] = data;
    writeJsonFile(usersFile, users);
  }

  async function deleteUser(username) {
    if (useFirebase) {
      await usersCollection(siteKey).doc(username).delete();
      return;
    }
    const users = readJsonFile(usersFile);
    delete users[username];
    writeJsonFile(usersFile, users);
  }

  async function listUsers() {
    if (useFirebase) {
      const snap = await usersCollection(siteKey).get();
      return snap.docs.map((doc) => ({
        username: doc.id,
        createdAt: doc.data().createdAt
      }));
    }
    return Object.entries(readJsonFile(usersFile)).map(([username, data]) => ({
      username,
      createdAt: data.createdAt
    }));
  }

  function getBaseUrl() {
    return process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  }

  async function saveImageToDisk(file) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    const filename = file.filename || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
    if (file.buffer) {
      fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
    }
    return `${getBaseUrl()}/uploads/${filename}`;
  }

  async function uploadImage(file) {
    if (useFirebase && firebase.hasStorage()) {
      try {
        const bucket = firebase.getBucket();
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        const storagePath = `uploads/${siteKey}/${filename}`;
        const blob = bucket.file(storagePath);

        await blob.save(file.buffer, {
          metadata: { contentType: file.mimetype }
        });
        await blob.makePublic();

        return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
      } catch (err) {
        console.warn('Firebase Storage gagal, guna disk:', err.message);
      }
    }

    return saveImageToDisk(file);
  }

  return {
    siteKey,
    useFirebase,
    getAllLinks,
    getLink,
    saveLink,
    deleteLink,
    incrementClicks,
    seedLinks,
    getUser,
    saveUser,
    deleteUser,
    listUsers,
    uploadImage
  };
}

module.exports = { createStore };
