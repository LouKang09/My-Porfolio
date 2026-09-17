(() => {
  'use strict';

  const REACTION_META = {
    like: ['👍', 'Like'],
    love: ['❤️', 'Love'],
    care: ['🥰', 'Care'],
    haha: ['😂', 'Haha'],
    wow: ['😮', 'Wow'],
    sad: ['😢', 'Sad'],
    angry: ['😡', 'Angry']
  };

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function findStoredToken() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        const raw = localStorage.getItem(key) || '';
        if (/^[a-f0-9]{64}$/i.test(raw) && /token|session|auth|admin/i.test(key)) return raw;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed && typeof parsed === 'object' ? parsed.token : '';
          if (typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token)) return token;
        } catch {}
      }
    } catch {}
    return '';
  }

  function authHeaders() {
    const token = findStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function formatDate(value) {
    if (!value) return 'Time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Time unavailable';
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  function ensureUi() {
    const nav = document.getElementById('adminNav');
    const main = document.querySelector('.admin-main');
    if (!nav || !main || document.getElementById('panel-reactors')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.panel = 'reactors';
    button.innerHTML = '♥ Reactors <span id="reactorBadge" class="badge" hidden></span>';

    const messagesButton = nav.querySelector('[data-panel="messages"]');
    nav.insertBefore(button, messagesButton || nav.lastElementChild);

    const panel = document.createElement('section');
    panel.id = 'panel-reactors';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="section-heading">
        <div>
          <h2>Gallery Reactors</h2>
          <p>Private admin-only view of people who reacted to Project Gallery photos.</p>
        </div>
        <button id="refreshReactors" class="secondary" type="button">↻ Refresh</button>
      </div>
      <div class="reactor-privacy-note">
        <strong>Privacy:</strong> Facebook does not reveal a visitor's account identity to this website. Names shown here are names visitors voluntarily entered on your portfolio. Browser source is stored only as a broad category, not a raw IP address.
      </div>
      <div id="reactorStats" class="reactor-stats"></div>
      <div class="reactor-toolbar">
        <input id="reactorSearch" type="search" placeholder="Search name, project, reaction…" autocomplete="off" />
        <select id="reactorFilter" aria-label="Filter reaction">
          <option value="">All reactions</option>
          <option value="like">👍 Like</option>
          <option value="love">❤️ Love</option>
          <option value="care">🥰 Care</option>
          <option value="haha">😂 Haha</option>
          <option value="wow">😮 Wow</option>
          <option value="sad">😢 Sad</option>
          <option value="angry">😡 Angry</option>
        </select>
      </div>
      <div id="reactorsEditor" class="reactors-list"><div class="reactor-loading">Open Reactors to load activity.</div></div>
    `;

    const messagesPanel = document.getElementById('panel-messages');
    main.insertBefore(panel, messagesPanel || document.getElementById('panel-account'));

    button.addEventListener('click', () => openReactorsPanel(button, panel));
    document.getElementById('refreshReactors')?.addEventListener('click', loadReactors);
    document.getElementById('reactorSearch')?.addEventListener('input', renderCurrent);
    document.getElementById('reactorFilter')?.addEventListener('change', renderCurrent);

    nav.addEventListener('click', event => {
      const clicked = event.target.closest('button[data-panel]');
      if (!clicked || clicked === button) return;
      document.getElementById('saveBtn')?.removeAttribute('hidden');
    });
  }

  let reactors = [];

  function openReactorsPanel(button, panel) {
    document.querySelectorAll('#adminNav button[data-panel]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.admin-main .panel').forEach(item => item.classList.remove('active-panel'));
    panel.classList.add('active-panel');

    const eyebrow = document.getElementById('panelEyebrow');
    const title = document.getElementById('panelTitle');
    if (eyebrow) eyebrow.textContent = 'PRIVATE ENGAGEMENT';
    if (title) title.textContent = 'Reactors';
    document.getElementById('saveBtn')?.setAttribute('hidden', 'hidden');

    loadReactors();
  }

  async function loadReactors() {
    const container = document.getElementById('reactorsEditor');
    if (!container) return;
    container.innerHTML = '<div class="reactor-loading">Loading reactors…</div>';

    try {
      const response = await fetch('/api/admin/gallery-reactors', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: authHeaders()
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to load reactors.');
      reactors = Array.isArray(payload.reactors) ? payload.reactors : [];

      const badge = document.getElementById('reactorBadge');
      if (badge) {
        badge.textContent = reactors.length > 99 ? '99+' : String(reactors.length);
        badge.hidden = reactors.length === 0;
      }

      renderCurrent();
    } catch (error) {
      container.innerHTML = `<div class="reactor-empty"><strong>Could not load reactors</strong><p>${esc(error.message)}</p><p>If your admin session expired, log out and sign in again.</p></div>`;
    }
  }

  function renderCurrent() {
    const container = document.getElementById('reactorsEditor');
    const stats = document.getElementById('reactorStats');
    if (!container || !stats) return;

    const identified = reactors.filter(item => item.identified).length;
    const anonymous = reactors.length - identified;
    const facebook = reactors.filter(item => /facebook/i.test(item.client || '')).length;
    const uniqueProjects = new Set(reactors.map(item => item.galleryIndex)).size;

    stats.innerHTML = `
      <article><strong>${reactors.length}</strong><span>Total reactions</span></article>
      <article><strong>${identified}</strong><span>Named visitors</span></article>
      <article><strong>${anonymous}</strong><span>Anonymous</span></article>
      <article><strong>${facebook}</strong><span>Via Facebook browser</span></article>
      <article><strong>${uniqueProjects}</strong><span>Gallery photos</span></article>
    `;

    const query = (document.getElementById('reactorSearch')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('reactorFilter')?.value || '';
    const shown = reactors.filter(item => {
      if (filter && item.reaction !== filter) return false;
      if (!query) return true;
      return [item.name, item.galleryTitle, item.reaction, item.client, item.viewerRef]
        .some(value => String(value || '').toLowerCase().includes(query));
    });

    if (!shown.length) {
      container.innerHTML = '<div class="reactor-empty"><strong>No reactors found</strong><p>New reactions will appear here. Older reactions made before this feature may show as anonymous.</p></div>';
      return;
    }

    container.innerHTML = shown.map(item => {
      const [emoji, label] = REACTION_META[item.reaction] || ['•', item.reaction || 'Reaction'];
      const initial = esc((item.name || 'A').trim().charAt(0).toUpperCase() || 'A');
      const nameClass = item.identified ? '' : ' anonymous';
      return `
        <article class="reactor-row">
          <div class="reactor-photo">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" />` : '<span>▦</span>'}</div>
          <div class="reactor-person">
            <span class="reactor-avatar${nameClass}">${initial}</span>
            <div><strong>${esc(item.name || 'Anonymous visitor')}</strong><small>${esc(item.client || 'Unknown browser')} · ID ${esc(item.viewerRef || '—')}</small></div>
          </div>
          <div class="reactor-project"><strong>${esc(item.galleryTitle || 'Gallery photo')}</strong><small>${esc(formatDate(item.reactedAt))}</small></div>
          <div class="reactor-type reaction-${esc(item.reaction)}"><span>${emoji}</span><strong>${esc(label)}</strong></div>
        </article>
      `;
    }).join('');
  }

  function boot() {
    ensureUi();
    if (!document.getElementById('panel-reactors')) setTimeout(boot, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
