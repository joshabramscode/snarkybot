
document.addEventListener('DOMContentLoaded', async () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});

  const data = await getStorage();

  if (!data.accessCode) {
    setupCodeGate();
    return;
  }

  activateMain(data);
});

function setupCodeGate() {
  const input = document.getElementById('code-input');
  const btn   = document.getElementById('unlock-btn');
  const error = document.getElementById('code-error');

  async function tryUnlock() {
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    btn.textContent = 'Checking…';
    btn.disabled    = true;
    error.classList.add('hidden');

    try {
      const res = await fetch('https://snarkybot-proxy.snarky.workers.dev/validate', {
        method: 'POST',
        headers: { 'X-Access-Code': code }
      });

      if (res.ok) {
        await chrome.storage.local.set({ accessCode: code });
        activateMain(await getStorage());
      } else {
        error.classList.remove('hidden');
        btn.textContent = 'Unlock';
        btn.disabled    = false;
      }
    } catch {
      error.textContent = 'Connection error — try again.';
      error.classList.remove('hidden');
      btn.textContent = 'Unlock';
      btn.disabled    = false;
    }
  }

  btn.addEventListener('click', tryUnlock);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
}

function activateMain(data) {
  document.getElementById('code-gate').classList.add('hidden');
  document.getElementById('main-ui').classList.remove('hidden');

  renderRoast(data);
  renderStats(data);
  renderHistory(data);
  renderPause(data);
  renderSettings(data);

  document.getElementById('pause-btn').addEventListener('click', async () => {
    const d = await getStorage();
    const paused = !d.paused;
    await chrome.storage.local.set({ paused });
    renderPause({ paused });
  });

  document.getElementById('toggle-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.toggle('hidden');
  });

  setupSegControl('popup-control', 'showPopup',      v => v === 'true');
  setupSegControl('freq-control',  'roastFrequency', v => Number(v));
  setupSegControl('tone-control',  'roastTone',      v => v);

  document.getElementById('refresh-btn').addEventListener('click', requestRoast);

  document.getElementById('top-toggle').addEventListener('click', () => {
    document.getElementById('top-queries').classList.toggle('collapsed');
    document.getElementById('top-toggle').classList.toggle('collapsed');
  });

  document.getElementById('history-toggle').addEventListener('click', () => {
    document.getElementById('history-list').classList.toggle('collapsed');
    document.getElementById('history-toggle').classList.toggle('collapsed');
  });
}


function renderRoast(data) {
  const roastText = document.getElementById('roast-text');
  const roastMeta = document.getElementById('roast-meta');

  if (data.latestRoast && !data.latestRoast.isError) {
    roastText.textContent = data.latestRoast.text;
    roastText.classList.remove('placeholder');
    const ago     = timeAgo(data.latestRoast.timestamp);
    const trigger = triggerLabel(data.latestRoast.trigger);
    roastMeta.textContent = `${ago} · ${trigger}`;
  } else if (data.latestRoast?.isError) {
    roastText.textContent = data.latestRoast.text;
    roastText.classList.add('placeholder');
    roastMeta.textContent = '';
  } else {
    roastText.classList.add('placeholder');
    roastText.textContent = 'Search something on Google and I\'ll have opinions. 👀';
    roastMeta.textContent = '';
  }
}

function renderStats(data) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week    = (data.searches || []).filter(s => s.timestamp > weekAgo);

  // Top 3 by frequency
  const freq = {};
  week.forEach(s => {
    const k = s.query.toLowerCase().trim();
    freq[k] = (freq[k] || 0) + 1;
  });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const list = document.getElementById('top-queries');
  list.innerHTML = '';

  if (top.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet this week';
    list.appendChild(li);
    return;
  }

  const maxCount = top[0][1];
  top.forEach(([query, count]) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="bar-bg">
        <div class="bar-fill" style="width:${Math.round((count / maxCount) * 100)}%"></div>
      </div>
      <span class="query-text">${esc(query)}</span>
      <span class="query-count">${count}×</span>
    `;
    list.appendChild(li);
  });
}

function renderHistory(data) {
  const list    = document.getElementById('history-list');
  const history = data.roastHistory || [];

  list.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.style.cssText = 'color:#555578;font-style:italic;font-size:11px;text-align:center;padding:4px 0';
    empty.textContent = 'No roasts yet';
    list.appendChild(empty);
    return;
  }

  history.forEach(roast => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <p class="history-text">${esc(roast.text)}</p>
      <p class="history-meta">${timeAgo(roast.timestamp)}</p>
    `;
    list.appendChild(item);
  });
}


async function requestRoast() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = 'Roasting…';
  btn.disabled    = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'REQUEST_ROAST' });
    if (result?.error) {
      document.getElementById('roast-text').textContent = `⚠ ${result.error}`;
      document.getElementById('roast-text').classList.add('placeholder');
      document.getElementById('roast-meta').textContent = '';
    } else {
      const data = await getStorage();
      renderRoast(data);
    }
  } catch (err) {
    document.getElementById('roast-text').textContent = '⚠ Could not reach background worker.';
  }

  btn.textContent = 'New Roast';
  btn.disabled    = false;
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function triggerLabel(trigger) {
  if (!trigger) return 'unknown trigger';
  if (trigger.type === 'pattern' && trigger.description) {
    return `🔍 ${trigger.description}`;
  }
  if (trigger.type === 'word_repeat') return `🔁 "${trigger.word}" × ${trigger.count} searches`;
  return {
    emotional: '💔 emotional search',
    repeat:    '🔁 searched again',
    periodic:  '📊 every 5 searches',
    manual:    '👆 manually requested'
  }[trigger.type] || trigger.type;
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPause(data) {
  const btn = document.getElementById('pause-btn');
  const paused = !!data.paused;
  btn.textContent = paused ? '▶' : '⏸';
  btn.title = paused ? 'Resume roasting' : 'Pause roasting';
  btn.classList.toggle('paused', paused);
}

function renderSettings(data) {
  setSegActive('popup-control', String(data.showPopup !== false));
  setSegActive('freq-control',  String(data.roastFrequency || 5));
  setSegActive('tone-control',  data.roastTone || 'savage');
}

function setSegActive(controlId, value) {
  document.getElementById(controlId)?.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function setupSegControl(controlId, storageKey, cast) {
  document.getElementById(controlId)?.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const value = cast(btn.dataset.value);
      await chrome.storage.local.set({ [storageKey]: value });
      setSegActive(controlId, btn.dataset.value);
    });
  });
}

function getStorage() {
  return new Promise(resolve => chrome.storage.local.get(null, resolve));
}
