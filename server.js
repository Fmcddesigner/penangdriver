const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'links.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const config = loadConfig();

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

function readLinks() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeLinks(links) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2));
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

function makeShortUrl(slug) {
  return `${BASE_URL}/${slug}`;
}

app.get('/api/config', (req, res) => {
  const domain = BASE_URL.replace(/^https?:\/\//, '');
  const targetDomain = getTargetDomain();
  res.json({
    baseUrl: BASE_URL,
    displayDomain: domain,
    targetDomain,
    brand: config.brand || 'Custom URL',
    isPublic: !BASE_URL.includes('localhost'),
    isCustomDomain: !!process.env.RENDER_EXTERNAL_URL,
    isLocal: IS_LOCAL && !BASE_URL.includes('trycloudflare'),
    isDeployed: !!process.env.RENDER_EXTERNAL_URL
  });
});

app.post('/api/shorten', (req, res) => {
  const { url, slug: customSlug } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'URL tidak sah. Pastikan bermula dengan http:// atau https://' });
  }

  const links = readLinks();
  let slug = customSlug?.trim();

  if (slug) {
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Custom slug hanya boleh huruf, nombor, - dan _ (2-30 aksara)' });
    }
    if (links[slug]) {
      return res.status(409).json({ error: 'Slug ini sudah digunakan. Pilih nama lain.' });
    }
  } else {
    do {
      slug = generateSlug();
    } while (links[slug]);
  }

  links[slug] = {
    url,
    createdAt: new Date().toISOString(),
    clicks: 0
  };
  writeLinks(links);

  res.json({ slug, shortUrl: makeShortUrl(slug), originalUrl: url });
});

app.post('/api/whatsapp', (req, res) => {
  const { phone, message, slug: customSlug } = req.body;

  if (!phone || !/^\d{8,15}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Nombor telefon tidak sah (8-15 digit)' });
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const waUrl = message
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${cleanPhone}`;

  const links = readLinks();
  let slug = customSlug?.trim();

  if (slug) {
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Custom slug hanya boleh huruf, nombor, - dan _ (2-30 aksara)' });
    }
    if (links[slug]) {
      return res.status(409).json({ error: 'Slug ini sudah digunakan. Pilih nama lain.' });
    }
  } else {
    do {
      slug = generateSlug();
    } while (links[slug]);
  }

  links[slug] = {
    url: waUrl,
    type: 'whatsapp',
    phone: cleanPhone,
    message: message || '',
    createdAt: new Date().toISOString(),
    clicks: 0
  };
  writeLinks(links);

  res.json({ slug, shortUrl: makeShortUrl(slug), originalUrl: waUrl });
});

app.get('/api/links', (req, res) => {
  const links = readLinks();
  const list = Object.entries(links)
    .map(([slug, data]) => ({
      slug,
      shortUrl: makeShortUrl(slug),
      ...data
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.delete('/api/links/:slug', (req, res) => {
  const links = readLinks();
  if (!links[req.params.slug]) {
    return res.status(404).json({ error: 'Link tidak dijumpai' });
  }
  delete links[req.params.slug];
  writeLinks(links);
  res.json({ success: true });
});

app.get('/:slug', (req, res) => {
  const links = readLinks();
  const link = links[req.params.slug];

  if (!link) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  link.clicks++;
  writeLinks(links);
  res.redirect(302, link.url);
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
  app.listen(PORT, async () => {
    console.log(`\n  Custom URL Shortener berjalan!`);
    console.log(`  Local:  http://localhost:${PORT}`);

    if (process.env.RENDER_EXTERNAL_URL) {
      console.log(`  Live:   ${BASE_URL}`);
      console.log(`\n  Link percuma anda: ${BASE_URL}/nama-link\n`);
    } else if (IS_LOCAL) {
      console.log(`  Brand:  ${config.brand || 'penangdrivergroup'}`);
      console.log(`  Target: https://${config.freeDomain || 'penangdrivergroup.onrender.com'}`);
      console.log(`\n  Sedang buat link public sementara...`);
      try {
        const tunnel = await startPublicTunnel();
        BASE_URL = tunnel.url;
        console.log(`  Sementara: ${BASE_URL}`);
        console.log(`\n  Nak link pendek PERCUMA macam:`);
        console.log(`  penangdrivergroup.onrender.com/grab`);
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
