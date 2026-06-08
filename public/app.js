const urlForm = document.getElementById('urlForm');
const waForm = document.getElementById('waForm');
const result = document.getElementById('result');
const errorEl = document.getElementById('error');
const shortUrlInput = document.getElementById('shortUrl');
const copyBtn = document.getElementById('copyBtn');
const testLink = document.getElementById('testLink');
const linksList = document.getElementById('linksList');
const loginScreen = document.getElementById('loginScreen');
const mainApp = document.getElementById('mainApp');
const userBar = document.getElementById('userBar');
const adminTab = document.getElementById('adminTab');

let baseUrl = window.location.origin;
let authToken = localStorage.getItem('authToken') || '';
let currentUser = null;
let siteConfig = {};

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

async function apiFetch(url, options = {}) {
  const res = await fetchWithRetry(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers }
  });
  return res;
}

async function fetchWithRetry(url, options = {}, retries = 8) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 404 && i < retries - 1) {
        document.getElementById('wakeOverlay')?.classList.remove('hidden');
        await new Promise(r => setTimeout(r, 8000));
        continue;
      }
      document.getElementById('wakeOverlay')?.classList.add('hidden');
      return res;
    } catch {
      document.getElementById('wakeOverlay')?.classList.remove('hidden');
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  throw new Error('Server tidak respons');
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  mainApp.classList.add('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');
  userBar.classList.remove('hidden');
  document.getElementById('loggedInAs').textContent = currentUser.role === 'admin'
    ? 'Admin'
    : currentUser.username;
  adminTab.classList.toggle('hidden', currentUser.role !== 'admin');
}

function logout() {
  authToken = '';
  currentUser = null;
  localStorage.removeItem('authToken');
  if (siteConfig.authEnabled) showLogin();
}

async function checkAuth() {
  const res = await apiFetch('/api/auth/status');
  const status = await res.json();
  if (!status.authEnabled) {
    showApp();
    userBar.classList.add('hidden');
    return;
  }
  if (status.user && authToken) {
    currentUser = status.user;
    showApp();
    return;
  }
  showLogin();
}

async function loadConfig() {
  try {
    const res = await fetchWithRetry('/api/config');
    siteConfig = await res.json();
    baseUrl = siteConfig.baseUrl.replace(/\/$/, '');

    const showDomain = siteConfig.displayDomain;
    document.getElementById('urlPrefix').textContent = showDomain + '/';
    document.getElementById('waPrefix').textContent = showDomain + '/';

    if (siteConfig.brand) {
      document.getElementById('siteTitle').textContent = siteConfig.brand;
    }
    if (siteConfig.subtitle) {
      document.getElementById('siteSubtitle').textContent = siteConfig.subtitle;
    }
    document.title = siteConfig.brand + (siteConfig.isPublicSite ? '' : ' — Link Pendek');

    const slugPlaceholder = siteConfig.isPublicSite ? 'nasi-lemak-ali' : 'Ridenow';
    document.getElementById('customSlug').placeholder = slugPlaceholder;
    document.getElementById('waSlug').placeholder = siteConfig.isPublicSite ? 'order-kuih' : 'Ridenow';

    if (siteConfig.isDeployed) {
      document.getElementById('publicBanner').textContent = siteConfig.authEnabled
        ? '🔒 Login diperlukan untuk jana link'
        : (siteConfig.isPublicSite ? '✓ Percuma — sesuai untuk semua jenis bisnes' : '✓ Live — penangdriver.onrender.com');
      document.getElementById('publicBanner').classList.remove('hidden');
      document.getElementById('localWarning').classList.add('hidden');
      document.getElementById('deployInfo').classList.add('hidden');
    } else if (siteConfig.isPublic) {
      document.getElementById('publicBanner').classList.remove('hidden');
    } else {
      document.getElementById('localWarning').classList.remove('hidden');
    }

    await checkAuth();
  } catch {
    document.getElementById('localWarning').classList.remove('hidden');
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error);
    authToken = data.token;
    currentUser = { username: data.username, role: data.role };
    localStorage.setItem('authToken', authToken);
    hideMessages();
    showApp();
    loadLinks();
  } catch {
    showError('Gagal login. Cuba lagi.');
  }
});

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('adminPass').value;
  try {
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error);
    authToken = data.token;
    currentUser = { username: 'admin', role: 'admin' };
    localStorage.setItem('authToken', authToken);
    hideMessages();
    showApp();
    loadUsers();
    loadLinks();
  } catch {
    showError('Gagal login admin.');
  }
});

document.getElementById('showAdminLogin').addEventListener('click', () => {
  document.getElementById('loginForm').parentElement.classList.add('hidden');
  document.getElementById('adminLoginScreen').classList.remove('hidden');
});

document.getElementById('backToUserLogin').addEventListener('click', () => {
  document.getElementById('adminLoginScreen').classList.add('hidden');
  document.getElementById('loginForm').parentElement.classList.remove('hidden');
});

document.getElementById('logoutBtn').addEventListener('click', logout);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    hideMessages();
    if (tab.dataset.tab === 'admin') loadUsers();
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
  const imageUrl = document.getElementById('imageUrl').value.trim();
  try {
    const res = await apiFetch('/api/shorten', {
      method: 'POST',
      body: JSON.stringify({ url, slug: slug || undefined, imageUrl: imageUrl || undefined })
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
  const waImageUrl = document.getElementById('waImageUrl').value.trim();
  try {
    const res = await apiFetch('/api/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ phone, message, slug: slug || undefined, imageUrl: waImageUrl || undefined })
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
    const res = await apiFetch('/api/links');
    if (res.status === 401) return showLogin();
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
          ${link.owner ? `<span class="link-owner">${link.owner}</span>` : ''}
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
  await apiFetch(`/api/links/${slug}`, { method: 'DELETE' });
  loadLinks();
}

document.getElementById('addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  try {
    const res = await apiFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error);
    document.getElementById('addUserForm').reset();
    loadUsers();
    showError(`User "${username}" berjaya ditambah!`);
    errorEl.style.borderColor = 'rgba(34, 197, 94, 0.3)';
    errorEl.style.color = '#22c55e';
    setTimeout(() => {
      errorEl.style.borderColor = '';
      errorEl.style.color = '';
      hideMessages();
    }, 3000);
  } catch {
    showError('Gagal tambah user.');
  }
});

async function loadUsers() {
  const list = document.getElementById('usersList');
  try {
    const res = await apiFetch('/api/admin/users');
    const users = await res.json();
    if (users.length === 0) {
      list.innerHTML = '<p class="empty">Tiada user lagi.</p>';
      return;
    }
    list.innerHTML = users.map(u => `
      <div class="user-item">
        <span class="user-name">${u.username}</span>
        <div class="user-actions">
          <button class="btn-small" onclick="resetUserPass('${u.username}')">Tukar Password</button>
          <button class="btn-small btn-danger" onclick="removeUser('${u.username}')">Padam</button>
        </div>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<p class="empty">Gagal memuatkan users.</p>';
  }
}

async function resetUserPass(username) {
  const password = prompt(`Password baru untuk "${username}":`);
  if (!password) return;
  const res = await apiFetch(`/api/admin/users/${username}`, {
    method: 'PATCH',
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  alert(`Password ${username} dikemaskini!`);
}

async function removeUser(username) {
  if (!confirm(`Padam user "${username}"?`)) return;
  const res = await apiFetch(`/api/admin/users/${username}`, { method: 'DELETE' });
  if (!res.ok) return alert('Gagal padam user');
  loadUsers();
}

loadConfig().then(() => {
  if (!siteConfig.authEnabled || currentUser) loadLinks();
});
