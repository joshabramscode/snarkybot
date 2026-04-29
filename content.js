let lastQuery = null;

function check() {
  const q = new URLSearchParams(window.location.search).get('q');
  if (q && q !== lastQuery) {
    lastQuery = q;
    chrome.runtime.sendMessage({ type: 'NEW_SEARCH', query: q }).catch(() => {});
  }
}

check();
window.addEventListener('popstate', check);

const origPush = history.pushState.bind(history);
history.pushState = function (...args) {
  origPush(...args);
  check();
};

setInterval(check, 1000);

// Listen for roasts from the background and show them inline on the page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SHOW_ROAST') showRoast(msg.text);
});

function showRoast(text) {
  document.getElementById('snarkybot-roast')?.remove();

  ensureStyles();

  const el = document.createElement('div');
  el.id = 'snarkybot-roast';
  el.innerHTML = `
    <div class="sb-header">
      <span class="sb-title">🦈 Snark Attack</span>
      <button class="sb-close" aria-label="Dismiss">✕</button>
    </div>
    <p class="sb-text">${esc(text)}</p>
  `;

  document.body.appendChild(el);

  el.querySelector('.sb-close').addEventListener('click', () => dismissRoast(el));

  // Auto-dismiss after 10 seconds
  setTimeout(() => dismissRoast(el), 10_000);
}

function dismissRoast(el) {
  if (!el.isConnected) return;
  el.style.animation = 'sb-out 0.3s ease forwards';
  setTimeout(() => el.remove(), 300);
}

function ensureStyles() {
  if (document.getElementById('snarkybot-styles')) return;
  const s = document.createElement('style');
  s.id = 'snarkybot-styles';
  s.textContent = `
    #snarkybot-roast {
      position: fixed;
      top: 28px;
      right: 28px;
      width: 310px;
      background: linear-gradient(145deg, #15152a, #1f1040);
      border: 1px solid #5b21b6;
      border-radius: 14px;
      padding: 13px 15px 14px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
      animation: sb-in 0.35s cubic-bezier(.22,1,.36,1);
    }
    @keyframes sb-in {
      from { transform: translateY(-18px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    @keyframes sb-out {
      from { transform: translateY(0);     opacity: 1; }
      to   { transform: translateY(-18px); opacity: 0; }
    }
    #snarkybot-roast .sb-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    #snarkybot-roast .sb-title {
      font-size: 11px;
      font-weight: 700;
      color: #a78bfa;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    #snarkybot-roast .sb-close {
      background: none;
      border: none;
      color: #6b5fa0;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      transition: color 0.15s;
    }
    #snarkybot-roast .sb-close:hover { color: #a78bfa; }
    #snarkybot-roast .sb-text {
      margin: 0;
      font-size: 13px;
      line-height: 1.6;
      color: #ede9fe;
    }
  `;
  document.head.appendChild(s);
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
