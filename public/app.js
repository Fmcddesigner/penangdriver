const urlForm = document.getElementById('urlForm');
const waForm = document.getElementById('waForm');
const result = document.getElementById('result');
const errorEl = document.getElementById('error');
const shortUrlInput = document.getElementById('shortUrl');
const copyBtn = document.getElementById('copyBtn');
const testLink = document.getElementById('testLink');
const linksList = document.getElementById('linksList');
let baseUrl = window.location.origin;

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    baseUrl = config.baseUrl.replace(/\/$/, '');

    const showDomain = config.isDeployed && config.targetDomain
      ? config.targetDomain
      : config.displayDomain;
    document.getElementById('urlPrefix').textContent = showDomain + '/';
    document.getElementById('waPrefix').textContent = showDomain + '/';

    if (config.brand) {
      document.getElementById('siteTitle').textContent = config.brand;
    }

    if (config.isDeployed) {
      document.getElementById('siteSubtitle').textContent = 'Link pendek percuma untuk bisnes anda';
      document.getElementById('publicBanner').textContent = 'Link percuma aktif — boleh kongsi dalam WhatsApp';
      document.getElementById('publicBanner').classList.remove('hidden');
    } else if (config.isPublic) {
      document.getElementById('siteSubtitle').textContent = config.targetDomain
        ? `Sementara — deploy untuk dapat ${config.targetDomain}`
        : 'Link sementara aktif';
      document.getElementById('publicBanner').textContent = config.targetDomain
        ? `Sementara aktif. Deploy ke Render → ${config.targetDomain}`
        : 'Link sementara aktif — boleh kongsi dalam WhatsApp';
      document.getElementById('publicBanner').classList.remove('hidden');
      if (config.targetDomain) {
        document.getElementById('targetDomainText').textContent = config.targetDomain;
        document.getElementById('deployInfo').classList.remove('hidden');
      }
    } else {
      document.getElementById('localWarning').classList.remove('hidden');
    }
  } catch {
    document.getElementById('localWarning').classList.remove('hidden');
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    hideMessages();
  });
});

function hideMessages() {
  result.classList.add('hidden');
  errorEl.classList.add('hidden');
}

function formatDisplayUrl(url) {
  return url.replace(/^https?:\/\//, '');
}

function showResult(data) {
  hideMessages();
  shortUrlInput.value = formatDisplayUrl(data.shortUrl);
  shortUrlInput.dataset.fullUrl = data.shortUrl;
  testLink.href = data.shortUrl;
  result.classList.remove('hidden');
  loadLinks();
}

function showError(msg) {
  hideMessages();
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('originalUrl').value.trim();
  const slug = document.getElementById('customSlug').value.trim();

  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, slug: slug || undefined })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error);
    showResult(data);
    urlForm.reset();
  } catch {
    showError('Ralat sambungan. Pastikan server berjalan.');
  }
});

waForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('waPhone').value.trim();
  const message = document.getElementById('waMessage').value.trim();
  const slug = document.getElementById('waSlug').value.trim();

  try {
    const res = await fetch('/api/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, slug: slug || undefined })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error);
    showResult(data);
    waForm.reset();
  } catch {
    showError('Ralat sambungan. Pastikan server berjalan.');
  }
});

copyBtn.addEventListener('click', () => {
  const toCopy = shortUrlInput.dataset.fullUrl || shortUrlInput.value;
  navigator.clipboard.writeText(toCopy);
  copyBtn.textContent = 'Tersalin!';
  setTimeout(() => { copyBtn.textContent = 'Salin'; }, 2000);
});

async function loadLinks() {
  try {
    const res = await fetch('/api/links');
    const links = await res.json();

    if (links.length === 0) {
      linksList.innerHTML = '<p class="empty">Tiada link lagi. Jana link pertama anda di atas!</p>';
      return;
    }

    linksList.innerHTML = links.map(link => `
      <div class="link-item">
        <div class="link-info">
          <a href="${link.shortUrl}" target="_blank" class="link-short">${formatDisplayUrl(link.shortUrl)}</a>
          <div class="link-original" title="${link.url}">${link.url}</div>
        </div>
        <div class="link-meta">
          ${link.type === 'whatsapp' ? '<span class="badge-wa">WA</span>' : ''}
          <span class="link-clicks">${link.clicks} klik</span>
          <button class="btn-delete" onclick="deleteLink('${link.slug}')" title="Padam">×</button>
        </div>
      </div>
    `).join('');
  } catch {
    linksList.innerHTML = '<p class="empty">Gagal memuatkan senarai link.</p>';
  }
}

async function deleteLink(slug) {
  if (!confirm(`Padam link /${slug}?`)) return;
  await fetch(`/api/links/${slug}`, { method: 'DELETE' });
  loadLinks();
}

loadConfig();
loadLinks();
