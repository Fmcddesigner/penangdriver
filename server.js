const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const firebase = require('./firebase');
const { createStore } = require('./store');
const { getAuth, requireAuth, registerAuthRoutes } = require('./auth');

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const upload = multer({
  storage: firebase.isEnabled()
    ? multer.memoryStorage()
    : multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ALLOWED_IMAGE_EXT.has(ext) ? ext : '.jpg';
        cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`);
      }
    }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya fail gambar dibenarkan'));
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const config = loadConfig();

function getSiteSettings() {
  const mode = process.env.SITE_MODE || config.mode || 'branded';
  const isPublicSite = mode === 'public';

  return {
    mode,
    isPublicSite,
    brand: process.env.BRAND || config.brand || (isPublicSite ? 'Malaysia' : 'Custom URL'),
    subtitle: process.env.SITE_SUBTITLE || config.subtitle || (
      isPublicSite
        ? 'Buat link custom untuk apa-apa bisnes — makanan, servis, kedai & more'
        : 'Link pendek untuk group & servis anda'
    ),
    seedDefaults: !isPublicSite && process.env.SEED_DEFAULTS !== 'false'
  };
}

const site = getSiteSettings();
const AUTH_ENABLED = site.isPublicSite || process.env.AUTH_ENABLED === 'true';
const store = createStore({ isPublicSite: site.isPublicSite });

function resolveBaseUrl() {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (config.domain) return `https://${config.domain.replace(/^https?:\/\//, '')}`;
  return `http://localhost:${PORT}`;
}

function getTargetDomain() {
  return config.freeDomain || config.domain || null;
}

let BASE_URL = resolveBaseUrl();
const IS_LOCAL = !process.env.RENDER_EXTERNAL_URL && BASE_URL.includes('localhost');

app.use(express.json());
app.use(express.static('public'));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: site.brand,
    mode: site.mode,
    storage: store.useFirebase ? 'firebase' : 'file',
    siteKey: store.siteKey
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const DEFAULT_LINKS = {
  Ridenow: {
    url: 'https://chat.whatsapp.com/JZejWvD8Unc666Bih8hsLf',
    createdAt: new Date().toISOString(),
    clicks: 0
  }
};

async function initData() {
  if (site.seedDefaults) {
    await store.seedLinks(DEFAULT_LINKS);
  }
}

function generateSlug(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidSlug(slug) {
  return /^[a-zA-Z0-9_-]+$/.test(slug) && slug.length >= 2 && slug.length <= 30;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resolveOgImage(imageUrl) {
  if (!imageUrl) return `${BASE_URL}/og-image.svg`;
  const url = String(imageUrl).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function makeShortUrl(slug) {
  return `${BASE_URL}/${slug}`;
}

function maybeAuth(req, res, next) {
  if (AUTH_ENABLED) return requireAuth(req, res, next);
  next();
}

function canManageLink(link, auth) {
  if (!AUTH_ENABLED) return true;
  if (!auth) return false;
  if (auth.role === 'admin') return true;
  return link.owner === auth.username;
}

registerAuthRoutes(app, { authEnabled: AUTH_ENABLED, store });

app.post('/api/upload-image', maybeAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Gagal muat naik gambar' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Tiada gambar dipilih' });
    }
    try {
      const imageUrl = await store.uploadImage(req.file);
      res.json({ imageUrl });
    } catch (uploadErr) {
      res.status(500).json({ error: uploadErr.message || 'Gagal muat naik gambar' });
    }
  });
});

app.get('/api/config', (req, res) => {
  const domain = BASE_URL.replace(/^https?:\/\//, '');
  const targetDomain = getTargetDomain();
  res.json({
    baseUrl: BASE_URL,
    displayDomain: domain,
    targetDomain,
    brand: site.brand,
    subtitle: site.subtitle,
    mode: site.mode,
    isPublicSite: site.isPublicSite,
    isPublic: !BASE_URL.includes('localhost'),
    isCustomDomain: !!process.env.RENDER_EXTERNAL_URL,
    isLocal: IS_LOCAL && !BASE_URL.includes('trycloudflare'),
    isDeployed: !!process.env.RENDER_EXTERNAL_URL,
    authEnabled: AUTH_ENABLED,
    storageBackend: store.useFirebase ? 'firebase' : 'file'
  });
});

app.post('/api/shorten', maybeAuth, async (req, res) => {
  const { url, slug: customSlug, imageUrl } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'URL tidak sah. Pastikan bermula dengan http:// atau https://' });
  }

  if (imageUrl && !isValidUrl(imageUrl)) {
    return res.status(400).json({ error: 'Image URL tidak sah. Guna pautan http:// atau https://' });
  }

  let slug = customSlug?.trim();

  if (slug) {
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Custom slug hanya boleh huruf, nombor, - dan _ (2-30 aksara)' });
    }
    if (await store.getLink(slug)) {
      return res.status(409).json({ error: 'Slug ini sudah digunakan. Pilih nama lain.' });
    }
  } else {
    do {
      slug = generateSlug();
    } while (await store.getLink(slug));
  }

  await store.saveLink(slug, {
    url,
    imageUrl: imageUrl || undefined,
    owner: req.auth?.username || 'public',
    createdAt: new Date().toISOString(),
    clicks: 0
  });

  res.json({ slug, shortUrl: makeShortUrl(slug), originalUrl: url });
});

app.post('/api/whatsapp', maybeAuth, async (req, res) => {
  const { phone, message, slug: customSlug, imageUrl } = req.body;

  if (!phone || !/^\d{8,15}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Nombor telefon tidak sah (8-15 digit)' });
  }

  if (imageUrl && !isValidUrl(imageUrl)) {
    return res.status(400).json({ error: 'Image URL tidak sah. Guna pautan http:// atau https://' });
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const waUrl = message
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${cleanPhone}`;

  let slug = customSlug?.trim();

  if (slug) {
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Custom slug hanya boleh huruf, nombor, - dan _ (2-30 aksara)' });
    }
    if (await store.getLink(slug)) {
      return res.status(409).json({ error: 'Slug ini sudah digunakan. Pilih nama lain.' });
    }
  } else {
    do {
      slug = generateSlug();
    } while (await store.getLink(slug));
  }

  await store.saveLink(slug, {
    url: waUrl,
    type: 'whatsapp',
    phone: cleanPhone,
    message: message || '',
    imageUrl: imageUrl || undefined,
    owner: req.auth?.username || 'public',
    createdAt: new Date().toISOString(),
    clicks: 0
  });

  res.json({ slug, shortUrl: makeShortUrl(slug), originalUrl: waUrl });
});

app.get('/api/links', maybeAuth, async (req, res) => {
  const links = await store.getAllLinks();
  const auth = req.auth;
  const list = Object.entries(links)
    .filter(([, data]) => !AUTH_ENABLED || auth?.role === 'admin' || data.owner === auth?.username)
    .map(([slug, data]) => ({
      slug,
      shortUrl: makeShortUrl(slug),
      ...data
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.patch('/api/links/:slug', maybeAuth, async (req, res) => {
  const { newSlug } = req.body;
  const oldSlug = req.params.slug;
  const link = await store.getLink(oldSlug);

  if (!link) {
    return res.status(404).json({ error: 'Link tidak dijumpai' });
  }
  if (!canManageLink(link, req.auth)) {
    return res.status(403).json({ error: 'Anda tak boleh edit link ini' });
  }
  if (!newSlug || !isValidSlug(newSlug)) {
    return res.status(400).json({ error: 'Nama link tidak sah (huruf, nombor, - dan _ sahaja)' });
  }
  if (newSlug !== oldSlug && await store.getLink(newSlug)) {
    return res.status(409).json({ error: 'Nama link ini sudah digunakan' });
  }

  await store.saveLink(newSlug, link);
  if (newSlug !== oldSlug) await store.deleteLink(oldSlug);

  res.json({ slug: newSlug, shortUrl: makeShortUrl(newSlug) });
});

app.delete('/api/links/:slug', maybeAuth, async (req, res) => {
  const link = await store.getLink(req.params.slug);
  if (!link) {
    return res.status(404).json({ error: 'Link tidak dijumpai' });
  }
  if (!canManageLink(link, req.auth)) {
    return res.status(403).json({ error: 'Anda tak boleh padam link ini' });
  }
  await store.deleteLink(req.params.slug);
  res.json({ success: true });
});

app.get('/:slug', async (req, res) => {
  const link = await store.getLink(req.params.slug);

  if (!link) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  await store.incrementClicks(req.params.slug);

  const destination = link.url;
  const title = site.brand || 'Custom URL Shortener';
  const description = site.subtitle || 'Preview link';
  const ogImage = resolveOgImage(link.imageUrl);

  // Important: WhatsApp preview bots read OG tags from HTML.
  // We serve a small preview page here (instead of redirecting straight).
  res.type('html').send(`<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="twitter:card" content="summary_large_image">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <p style="font-family: Arial, sans-serif; margin: 24px;">
    <strong>${escapeHtml(title)}</strong><br/>
    Link akan dibuka sebentar lagi...
  </p>

  <noscript>
    <p style="font-family: Arial, sans-serif; margin: 24px;">
      Jika link tak dibuka otomatis, sila klik:
      <a href="${escapeHtml(destination)}">${escapeHtml(destination)}</a>
    </p>
  </noscript>

  <script>
    setTimeout(() => {
      window.location.href = ${JSON.stringify(destination)};
    }, 800);
  </script>
</body>
</html>`);
});

function startPublicTunnel() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Tunnel timeout'));
    }, 45000);

    function onData(data) {
      const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve({ url: match[0], proc });
      }
    }

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
  });
}

async function start() {
  await initData();

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n  Custom URL Shortener berjalan!`);
    console.log(`  Storage: ${store.useFirebase ? 'Firebase' : 'File'}`);
    console.log(`  Local:  http://localhost:${PORT}`);

    if (process.env.RENDER_EXTERNAL_URL) {
      console.log(`  Live:   ${BASE_URL}`);
      console.log(`\n  Link percuma anda: ${BASE_URL}/nama-link\n`);
    } else if (IS_LOCAL) {
      console.log(`  Brand:  ${config.brand || 'penangdriver'}`);
      console.log(`  Target: https://${config.freeDomain || 'penangdriver.onrender.com'}`);
      console.log(`\n  Sedang buat link public sementara...`);
      try {
        const tunnel = await startPublicTunnel();
        BASE_URL = tunnel.url;
        console.log(`  Sementara: ${BASE_URL}`);
        console.log(`\n  Nak link pendek PERCUMA macam:`);
        console.log(`  penangdriver.onrender.com/Ridenow`);
        console.log(`  → Deploy ke Render.com (percuma, 5 minit)\n`);

        tunnel.proc.on('close', () => {
          BASE_URL = resolveBaseUrl();
          console.log('  Tunnel tertutup. Restart server untuk link public baru.');
        });
      } catch (err) {
        console.log(`\n  Amaran: Tunnel gagal (${err.message})`);
        console.log(`  Link masih guna localhost - tak boleh klik dalam WhatsApp.\n`);
      }
    } else {
      console.log(`  Live:   ${BASE_URL}\n`);
    }
  });
}

start();
