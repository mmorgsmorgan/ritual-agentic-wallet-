// ═══════════════════════════════════════════════════════════
//  Ritual Agent Wallet — Dashboard Client
//  Fetches data from REST API and renders the UI.
// ═══════════════════════════════════════════════════════════

const API_BASE = window.location.origin;

// ── State ───────────────────────────────────────────────────
let selectedWalletId = null;
let wallets = [];
let pollInterval = null;

// ── DOM refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  loadStats();
  loadWallets();

  // Poll every 15s
  pollInterval = setInterval(() => {
    loadStats();
    loadWallets();
    if (selectedWalletId) loadWalletDetail(selectedWalletId);
  }, 15000);

  // Event listeners
  $('btn-create-wallet').addEventListener('click', openCreateModal);
  $('btn-close-modal').addEventListener('click', closeModal);
  $('btn-confirm-create').addEventListener('click', createWallet);
  $('btn-done').addEventListener('click', closeModal);
  $('btn-copy-shard').addEventListener('click', () => copyText($('result-shard').textContent));
  $('btn-copy-address').addEventListener('click', () => copyText($('detail-address').textContent));
  $('btn-close-detail').addEventListener('click', closeDetail);
  $('btn-freeze').addEventListener('click', freezeWallet);
  $('btn-refresh').addEventListener('click', () => { loadStats(); loadWallets(); });
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });
});

// ── API Calls ───────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

async function checkHealth() {
  try {
    const data = await api('/health');
    if (data.status === 'ok') {
      $('status-dot').className = 'status-dot online';
      $('status-text').textContent = 'Online';
    }
  } catch {
    $('status-dot').className = 'status-dot offline';
    $('status-text').textContent = 'Offline';
  }
}

async function loadStats() {
  try {
    const stats = await api('/stats');
    $('stat-total-wallets').textContent = stats.totalWallets;
    $('stat-active-wallets').textContent = stats.activeWallets;
    $('stat-total-tx').textContent = stats.totalTransactions;
    $('stat-recent-tx').textContent = stats.recentTransactions;
  } catch {
    // Stats unavailable
  }
}

async function loadWallets() {
  try {
    const data = await api('/wallets');
    wallets = data.wallets || [];
    renderWalletList();
  } catch {
    // Wallets unavailable
  }
}

// ── Render Wallet List ──────────────────────────────────────
function renderWalletList() {
  const list = $('wallet-list');

  if (wallets.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⬡</span>
        <p>No wallets yet</p>
        <p class="empty-sub">Create your first agent wallet to get started</p>
      </div>`;
    return;
  }

  list.innerHTML = wallets.map((w) => `
    <div class="wallet-item ${selectedWalletId === w.id ? 'selected' : ''}"
         data-id="${w.id}" onclick="selectWallet('${w.id}')">
      <div class="wallet-icon">⬡</div>
      <div class="wallet-info">
        <div class="wallet-label">${w.label || 'Agent Wallet'}</div>
        <div class="wallet-addr">${truncAddr(w.address)}</div>
      </div>
      <div class="wallet-status ${w.status}"></div>
    </div>
  `).join('');
}

// ── Select Wallet ───────────────────────────────────────────
window.selectWallet = function(id) {
  selectedWalletId = id;
  renderWalletList();
  loadWalletDetail(id);
  $('wallet-detail-panel').classList.remove('hidden');
};

async function loadWalletDetail(id) {
  try {
    const [wallet, balanceData, txData, policyData] = await Promise.all([
      api(`/wallets/${id}`),
      api(`/wallets/${id}/balance`).catch(() => null),
      api(`/wallets/${id}/transactions?limit=10`).catch(() => ({ transactions: [] })),
      api(`/wallets/${id}/audit?limit=1`).catch(() => null),
    ]);

    // Title
    $('detail-title').textContent = wallet.label || 'Agent Wallet';

    // Address
    $('detail-address').textContent = wallet.address;
    $('detail-explorer-link').href = `https://explorer.ritualfoundation.org/address/${wallet.address}`;

    // Balances
    if (balanceData && balanceData.native) {
      $('detail-native-balance').textContent = parseFloat(balanceData.native.formatted).toFixed(4);
      $('detail-escrow-balance').textContent = parseFloat(balanceData.ritualWallet.formatted).toFixed(4);
      $('detail-lock-status').textContent = balanceData.ritualWallet.isLocked
        ? `🔒 Locked until block ${balanceData.ritualWallet.lockUntil}`
        : '🔓 Unlocked';
    } else {
      $('detail-native-balance').textContent = '—';
      $('detail-escrow-balance').textContent = '—';
      $('detail-lock-status').textContent = '';
    }

    // Policy
    try {
      // Fetch policy from audit or use defaults
      $('detail-policy-per-tx').textContent = '1.0 RITUAL';
      $('detail-policy-daily').textContent = '5.0 RITUAL';
      $('detail-policy-rate').textContent = '10/min';
      $('detail-policy-status').textContent = wallet.status === 'active' ? '✅ Active' : '🔒 Frozen';
    } catch {}

    // Freeze button
    const freezeBtn = $('btn-freeze');
    if (wallet.status === 'frozen') {
      freezeBtn.textContent = '🔓 Unfreeze';
      freezeBtn.className = 'btn btn-ghost btn-sm';
    } else {
      freezeBtn.textContent = '🔒 Freeze';
      freezeBtn.className = 'btn btn-danger btn-sm';
    }

    // Transactions
    renderTransactions(txData.transactions || []);
  } catch (err) {
    console.error('Failed to load wallet detail:', err);
  }
}

function renderTransactions(txs) {
  const list = $('tx-list');

  if (txs.length === 0) {
    list.innerHTML = '<p class="empty-sub">No transactions yet</p>';
    return;
  }

  list.innerHTML = txs.map((tx) => {
    const icon = tx.status === 'confirmed' ? '✓' : tx.status === 'pending' ? '⏳' : '✗';
    const val = tx.value ? (parseFloat(tx.value) / 1e18).toFixed(4) : '0';
    return `
      <div class="tx-item">
        <div class="tx-status-icon ${tx.status}">${icon}</div>
        <div class="tx-info">
          <div class="tx-hash">${tx.hash ? truncAddr(tx.hash) : '—'}</div>
          <div class="tx-to">→ ${truncAddr(tx.toAddress)}</div>
        </div>
        <div>
          <div class="tx-value">${val} RITUAL</div>
          <div class="tx-time">${timeAgo(tx.createdAt)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Create Wallet Modal ─────────────────────────────────────
function openCreateModal() {
  $('modal-overlay').classList.remove('hidden');
  $('modal-step-create').classList.remove('hidden');
  $('modal-step-shard').classList.add('hidden');
  $('wallet-label').value = '';
  $('wallet-label').focus();
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
}

async function createWallet() {
  const label = $('wallet-label').value.trim();
  const btn = $('btn-confirm-create');
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');

  btn.disabled = true;
  btnText.textContent = 'Generating...';
  btnSpinner.classList.remove('hidden');

  try {
    const data = await api('/wallets', {
      method: 'POST',
      body: JSON.stringify({ label }),
    });

    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    // Show shard step
    $('result-address').textContent = data.address;
    $('result-wallet-id').textContent = data.walletId;
    $('result-shard').textContent = data.agentShard;

    $('modal-step-create').classList.add('hidden');
    $('modal-step-shard').classList.remove('hidden');

    // Refresh wallet list
    await loadWallets();
    await loadStats();
  } catch (err) {
    alert('Failed to create wallet: ' + err.message);
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Generate Wallet';
    btnSpinner.classList.add('hidden');
  }
}

// ── Freeze / Unfreeze ───────────────────────────────────────
async function freezeWallet() {
  if (!selectedWalletId) return;
  const wallet = wallets.find((w) => w.id === selectedWalletId);
  const action = wallet?.status === 'frozen' ? 'unfreeze' : 'freeze';

  try {
    await api(`/wallets/${selectedWalletId}/${action}`, { method: 'POST' });
    await loadWallets();
    loadWalletDetail(selectedWalletId);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

function closeDetail() {
  selectedWalletId = null;
  $('wallet-detail-panel').classList.add('hidden');
  renderWalletList();
}

// ── Utilities ───────────────────────────────────────────────
function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr || '—';
  return addr.slice(0, 8) + '…' + addr.slice(-6);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Brief visual feedback could be added here
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
