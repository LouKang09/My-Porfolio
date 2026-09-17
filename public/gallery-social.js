(() => {
  'use strict';

  const REACTIONS = [
    ['like', '👍', 'Like'],
    ['love', '❤️', 'Love'],
    ['care', '🥰', 'Care'],
    ['haha', '😂', 'Haha'],
    ['wow', '😮', 'Wow'],
    ['sad', '😢', 'Sad'],
    ['angry', '😡', 'Angry']
  ];

  const LONG_PRESS_MS = 520;
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  }[c]));

  let gallery = [];
  let social = { items: [], photos: {} };
  let keyByIndex = new Map();
  let photoIndexes = [];
  let currentIndex = -1;
  let lastFocused = null;
  let gridObserver = null;
  let reactionBusy = false;
  let pressTimer = null;
  let longPressTriggered = false;
  let pickerOpen = false;

  function makeViewerId() {
    try {
      let value = localStorage.getItem('resume-gallery-viewer');
      if (!value) {
        const hasUuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function';
        value = hasUuid
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('resume-gallery-viewer', value);
      }
      return value;
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  const viewerId = makeViewerId();

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  async function getJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function emptyPhoto() {
    return {
      counts: Object.fromEntries(REACTIONS.map(([type]) => [type, 0])),
      total: 0,
      viewerReaction: '',
      comments: [],
      commentCount: 0
    };
  }

  function ensureModal() {
    if (document.getElementById('galleryLightbox')) return;

    const modal = document.createElement('div');
    modal.id = 'galleryLightbox';
    modal.className = 'gallery-lightbox';
    modal.hidden = true;
    modal.innerHTML = `
      <button class="gallery-modal-close" type="button" aria-label="Close photo viewer">×</button>
      <button class="gallery-nav gallery-nav-prev" type="button" aria-label="Previous photo">‹</button>

      <div class="gallery-viewer-shell" role="dialog" aria-modal="true" aria-labelledby="galleryLightboxTitle">
        <section class="gallery-photo-stage">
          <img id="galleryLightboxImage" alt="" />
          <div id="galleryImageLoading" class="gallery-image-loading" hidden>Loading photo…</div>
          <div class="gallery-mobile-counter" id="galleryMobileCounter"></div>
        </section>

        <aside class="gallery-social-panel">
          <header class="gallery-social-header">
            <span class="gallery-social-eyebrow">PROJECT GALLERY</span>
            <h2 id="galleryLightboxTitle">Project photo</h2>
            <p id="galleryPhotoCounter"></p>
          </header>

          <div class="gallery-engagement-summary">
            <div id="galleryReactionSummary" class="gallery-reaction-summary"></div>
            <span id="galleryCommentCount">0 comments</span>
          </div>

          <div class="gallery-reaction-action">
            <div class="gallery-reaction-control">
              <button id="galleryMainReaction" class="gallery-main-reaction" type="button" aria-haspopup="true" aria-expanded="false">
                <span id="galleryMainReactionEmoji" class="gallery-main-reaction-emoji">👍</span>
                <span id="galleryMainReactionLabel">Like</span>
              </button>
              <div id="galleryReactionPicker" class="gallery-reaction-picker" role="menu" aria-label="Choose a reaction" hidden></div>
            </div>
            <button id="galleryCommentFocus" class="gallery-comment-action" type="button">💬 Comment</button>
          </div>
          <p class="gallery-longpress-hint">Press and hold <strong>Like</strong> to choose a reaction.</p>

          <div class="gallery-comments-title"><strong>Comments</strong><span>Public</span></div>
          <div id="galleryComments" class="gallery-comments"></div>

          <form id="galleryCommentForm" class="gallery-comment-form">
            <input id="galleryCommentName" name="name" maxlength="80" autocomplete="name" placeholder="Your name" required />
            <div class="gallery-comment-row">
              <textarea id="galleryCommentText" name="comment" maxlength="800" rows="2" placeholder="Write a comment…" required></textarea>
              <button type="submit" aria-label="Post comment">➤</button>
            </div>
            <small id="galleryCommentStatus" aria-live="polite"></small>
          </form>
        </aside>
      </div>

      <button class="gallery-nav gallery-nav-next" type="button" aria-label="Next photo">›</button>
    `;

    document.body.appendChild(modal);

    try {
      document.getElementById('galleryCommentName').value =
        localStorage.getItem('resume-gallery-comment-name') || '';
    } catch {}

    modal.querySelector('.gallery-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.gallery-nav-prev').addEventListener('click', () => navigate(-1));
    modal.querySelector('.gallery-nav-next').addEventListener('click', () => navigate(1));
    document.getElementById('galleryCommentForm').addEventListener('submit', submitComment);
    document.getElementById('galleryCommentFocus').addEventListener('click', () => {
      document.getElementById('galleryCommentText')?.focus({ preventScroll: false });
    });

    const mainReaction = document.getElementById('galleryMainReaction');
    mainReaction.addEventListener('pointerdown', startReactionPress);
    mainReaction.addEventListener('pointerup', endReactionPress);
    mainReaction.addEventListener('pointercancel', cancelReactionPress);
    mainReaction.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse' && pressTimer) cancelReactionPress();
    });
    mainReaction.addEventListener('contextmenu', event => {
      event.preventDefault();
      showReactionPicker();
    });
    mainReaction.addEventListener('click', handleMainReactionClick);
    mainReaction.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        showReactionPicker(true);
      }
    });

    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal();
      if (pickerOpen &&
          !event.target.closest('#galleryReactionPicker') &&
          !event.target.closest('#galleryMainReaction')) {
        hideReactionPicker();
      }
    });

    document.addEventListener('keydown', event => {
      if (modal.hidden) return;

      if (event.key === 'Escape') {
        if (pickerOpen) hideReactionPicker();
        else closeModal();
        return;
      }

      const tag = String(event.target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || event.target?.isContentEditable;
      if (isTyping) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(1);
      }
    });
  }

  function currentGalleryKey() {
    return keyByIndex.get(currentIndex) || '';
  }

  function currentPhotoSocial() {
    const key = currentGalleryKey();
    return social.photos?.[key] || emptyPhoto();
  }

  function reactionMeta(type) {
    return REACTIONS.find(([id]) => id === type) || REACTIONS[0];
  }

  function renderMainReaction(photo) {
    const selected = photo.viewerReaction || '';
    const [, emoji, label] = selected ? reactionMeta(selected) : REACTIONS[0];

    const button = document.getElementById('galleryMainReaction');
    const emojiEl = document.getElementById('galleryMainReactionEmoji');
    const labelEl = document.getElementById('galleryMainReactionLabel');

    if (!button || !emojiEl || !labelEl) return;

    emojiEl.textContent = selected ? emoji : '👍';
    labelEl.textContent = selected ? label : 'Like';
    button.dataset.reaction = selected;
    button.classList.toggle('selected', !!selected);
    button.className = `gallery-main-reaction${selected ? ` selected reaction-${selected}` : ''}`;
  }

  function renderReactionPicker(photo) {
    const picker = document.getElementById('galleryReactionPicker');
    if (!picker) return;

    picker.innerHTML = REACTIONS.map(([type, emoji, label]) => `
      <button type="button"
              class="gallery-reaction ${photo.viewerReaction === type ? 'selected' : ''}"
              data-reaction="${type}"
              role="menuitemradio"
              aria-checked="${photo.viewerReaction === type ? 'true' : 'false'}"
              title="${label}">
        <span>${emoji}</span><small>${label}</small>
      </button>
    `).join('');

    picker.querySelectorAll('[data-reaction]').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        await react(button.dataset.reaction);
        hideReactionPicker();
      });
    });
  }

  function renderSummary(photo) {
    const summary = document.getElementById('galleryReactionSummary');
    if (!summary) return;

    const top = REACTIONS
      .map(([type, emoji, label]) => ({
        type, emoji, label, count: Number(photo.counts?.[type] || 0)
      }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);

    summary.innerHTML = Number(photo.total || 0)
      ? `<span class="gallery-summary-emojis">${top.slice(0, 3).map(item =>
          `<b title="${esc(item.label)}">${item.emoji}</b>`).join('')}</span>
         <span>${Number(photo.total)} ${Number(photo.total) === 1 ? 'reaction' : 'reactions'}</span>`
      : '<span>Be the first to react</span>';

    const count = Number(photo.commentCount || photo.comments?.length || 0);
    document.getElementById('galleryCommentCount').textContent =
      `${count} ${count === 1 ? 'comment' : 'comments'}`;
  }

  function renderComments(photo) {
    const container = document.getElementById('galleryComments');
    if (!container) return;

    const comments = Array.isArray(photo.comments) ? photo.comments : [];
    container.innerHTML = comments.length
      ? comments.map(comment => `
          <article class="gallery-comment">
            <div class="gallery-comment-avatar">${esc((comment.name || 'V').trim().charAt(0).toUpperCase() || 'V')}</div>
            <div class="gallery-comment-bubble">
              <strong>${esc(comment.name || 'Visitor')}</strong>
              <p>${esc(comment.text || '')}</p>
              <time>${esc(formatDate(comment.createdAt))}</time>
            </div>
          </article>
        `).join('')
      : '<div class="gallery-no-comments"><strong>No comments yet</strong><span>Start the conversation about this project.</span></div>';
  }

  function renderCurrent() {
    const item = gallery[currentIndex];
    if (!item) return;

    hideReactionPicker();

    const modal = document.getElementById('galleryLightbox');
    const image = document.getElementById('galleryLightboxImage');
    const loading = document.getElementById('galleryImageLoading');
    const position = photoIndexes.indexOf(currentIndex);
    const humanPosition = Math.max(0, position) + 1;

    document.getElementById('galleryLightboxTitle').textContent = item.title || 'Project photo';
    document.getElementById('galleryPhotoCounter').textContent =
      `${humanPosition} of ${photoIndexes.length}`;
    document.getElementById('galleryMobileCounter').textContent =
      `${humanPosition} / ${photoIndexes.length}`;

    image.alt = item.title || 'Project gallery image';
    loading.hidden = false;

    const requestedSrc = item.image;
    image.onload = () => {
      if (image.src.includes(encodeURI(requestedSrc).replace(/%2F/g, '/')) || image.getAttribute('src') === requestedSrc) {
        loading.hidden = true;
      }
    };
    image.onerror = () => {
      loading.hidden = true;
    };
    image.src = requestedSrc;

    modal.querySelector('.gallery-nav-prev').disabled = position <= 0;
    modal.querySelector('.gallery-nav-next').disabled = position >= photoIndexes.length - 1;

    const photo = currentPhotoSocial();
    renderSummary(photo);
    renderMainReaction(photo);
    renderReactionPicker(photo);
    renderComments(photo);

    const status = document.getElementById('galleryCommentStatus');
    if (status) status.textContent = '';

    updateGridBadges();
  }

  function openModal(index, trigger = null) {
    if (!gallery[index]?.image) return;

    ensureModal();
    lastFocused = trigger || document.activeElement;
    currentIndex = index;

    const modal = document.getElementById('galleryLightbox');
    modal.hidden = false;
    document.body.classList.add('gallery-modal-open');
    renderCurrent();

    requestAnimationFrame(() => {
      modal.querySelector('.gallery-modal-close')?.focus({ preventScroll: true });
    });
  }

  function closeModal() {
    const modal = document.getElementById('galleryLightbox');
    if (!modal || modal.hidden) return;

    cancelReactionPress();
    hideReactionPicker();
    modal.hidden = true;
    document.body.classList.remove('gallery-modal-open');

    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus({ preventScroll: true }); } catch {}
    }
  }

  function navigate(direction) {
    const position = photoIndexes.indexOf(currentIndex);
    const next = position + direction;
    if (next < 0 || next >= photoIndexes.length) return;
    currentIndex = photoIndexes[next];
    renderCurrent();
  }

  function startReactionPress(event) {
    if (reactionBusy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    longPressTriggered = false;
    clearTimeout(pressTimer);

    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}

    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressTriggered = true;
      if (navigator.vibrate) {
        try { navigator.vibrate(18); } catch {}
      }
      showReactionPicker();
    }, LONG_PRESS_MS);
  }

  function endReactionPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function cancelReactionPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    longPressTriggered = false;
  }

  async function handleMainReactionClick(event) {
    event.preventDefault();

    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }

    if (pickerOpen || reactionBusy) return;

    const current = currentPhotoSocial().viewerReaction || '';
    await react(current ? current : 'like');
  }

  function showReactionPicker(focusFirst = false) {
    const picker = document.getElementById('galleryReactionPicker');
    const button = document.getElementById('galleryMainReaction');
    if (!picker || !button) return;

    picker.hidden = false;
    pickerOpen = true;
    button.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => picker.classList.add('open'));

    if (focusFirst) {
      requestAnimationFrame(() => picker.querySelector('button')?.focus());
    }
  }

  function hideReactionPicker() {
    const picker = document.getElementById('galleryReactionPicker');
    const button = document.getElementById('galleryMainReaction');
    if (!picker || !button) return;

    picker.classList.remove('open');
    pickerOpen = false;
    button.setAttribute('aria-expanded', 'false');

    setTimeout(() => {
      if (!pickerOpen) picker.hidden = true;
    }, 120);
  }

  async function react(type) {
    const key = currentGalleryKey();
    if (!key || reactionBusy) return;

    const current = currentPhotoSocial().viewerReaction || '';
    const reaction = current === type ? '' : type;
    const status = document.getElementById('galleryCommentStatus');

    reactionBusy = true;
    document.getElementById('galleryMainReaction')?.classList.add('busy');
    document.getElementById('galleryReactionPicker')?.classList.add('busy');

    try {
      const result = await getJson('/api/gallery-social/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryKey: key, reaction, viewerId })
      });

      if (!result?.photo) throw new Error('The reaction could not be saved.');

      social.photos[key] = result.photo;
      renderSummary(result.photo);
      renderMainReaction(result.photo);
      renderReactionPicker(result.photo);
      updateGridBadges();
    } catch (error) {
      if (status) status.textContent = error.message || 'Reaction failed. Please try again.';
      console.warn('Gallery reaction failed:', error);
    } finally {
      reactionBusy = false;
      document.getElementById('galleryMainReaction')?.classList.remove('busy');
      document.getElementById('galleryReactionPicker')?.classList.remove('busy');
    }
  }

  async function submitComment(event) {
    event.preventDefault();

    const key = currentGalleryKey();
    if (!key) return;

    const nameInput = document.getElementById('galleryCommentName');
    const textInput = document.getElementById('galleryCommentText');
    const status = document.getElementById('galleryCommentStatus');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const name = nameInput.value.trim();
    const comment = textInput.value.trim();

    if (!name || !comment) return;

    try { localStorage.setItem('resume-gallery-comment-name', name); } catch {}

    submit.disabled = true;
    status.textContent = 'Posting…';

    try {
      const result = await getJson('/api/gallery-social/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryKey: key, name, comment, viewerId })
      });

      if (!result?.photo) throw new Error('The comment could not be saved.');

      social.photos[key] = result.photo;
      textInput.value = '';
      status.textContent = 'Comment posted.';
      renderSummary(result.photo);
      renderComments(result.photo);
      updateGridBadges();
    } catch (error) {
      status.textContent = error.message || 'Comment failed. Please try again.';
    } finally {
      submit.disabled = false;
    }
  }

  function badgeText(photo) {
    const total = Number(photo?.total || 0);
    const comments = Number(photo?.commentCount || photo?.comments?.length || 0);

    const top = REACTIONS
      .map(([type, emoji]) => ({ emoji, count: Number(photo?.counts?.[type] || 0) }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map(x => x.emoji)
      .join('');

    const pieces = [];
    if (total) pieces.push(`${top} ${total}`);
    if (comments) pieces.push(`💬 ${comments}`);
    return pieces.join('  ');
  }

  function decorateGrid() {
    const grid = document.getElementById('galleryGrid');
    if (!grid || !gallery.length) return;

    const items = [...grid.querySelectorAll('.gallery-item')];

    items.forEach((element, index) => {
      const item = gallery[index];
      if (!item?.image) return;

      element.classList.add('gallery-clickable');
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Open ${item.title || `gallery photo ${index + 1}`}`);
      element.dataset.galleryIndex = String(index);

      if (!element.querySelector('.gallery-view-hint')) {
        const hint = document.createElement('span');
        hint.className = 'gallery-view-hint';
        hint.textContent = '⛶ View photo';
        element.appendChild(hint);
      }

      if (!element.querySelector('.gallery-grid-engagement')) {
        const badge = document.createElement('span');
        badge.className = 'gallery-grid-engagement';
        badge.hidden = true;
        element.appendChild(badge);
      }
    });

    updateGridBadges();
  }

  function updateGridBadges() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    grid.querySelectorAll('[data-gallery-index]').forEach(element => {
      const index = Number(element.dataset.galleryIndex);
      const key = keyByIndex.get(index);
      const badge = element.querySelector('.gallery-grid-engagement');
      if (!badge) return;

      const text = badgeText(social.photos?.[key]);

      // Important: only mutate the DOM if the value actually changed.
      // This prevents the MutationObserver from entering a feedback loop.
      if (badge.textContent !== text) badge.textContent = text;

      const shouldHide = !text;
      if (badge.hidden !== shouldHide) badge.hidden = shouldHide;
    });
  }

  function watchGrid() {
    const grid = document.getElementById('galleryGrid');
    if (!grid || grid.dataset.gallerySocialBound === '1') return;

    grid.dataset.gallerySocialBound = '1';

    grid.addEventListener('click', event => {
      const item = event.target.closest('[data-gallery-index]');
      if (item) openModal(Number(item.dataset.galleryIndex), item);
    });

    grid.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('[data-gallery-index]');
      if (!item) return;

      event.preventDefault();
      openModal(Number(item.dataset.galleryIndex), item);
    });

    // Only observe direct gallery children. The previous subtree observer
    // also watched engagement badge changes and could recursively retrigger itself.
    gridObserver?.disconnect();
    gridObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) {
        requestAnimationFrame(decorateGrid);
      }
    });
    gridObserver.observe(grid, { childList: true });

    decorateGrid();
  }

  async function load() {
    ensureModal();

    try {
      const [content, socialResponse] = await Promise.all([
        getJson('/api/content'),
        getJson(`/api/gallery-social?viewer=${encodeURIComponent(viewerId)}`)
      ]);

      gallery = Array.isArray(content.gallery) ? content.gallery : [];
      social = socialResponse || { items: [], photos: {} };
      keyByIndex = new Map((social.items || []).map(item => [Number(item.index), item.key]));
      photoIndexes = gallery
        .map((item, index) => item?.image ? index : -1)
        .filter(index => index >= 0);

      watchGrid();

      // Main app renders independently. A couple of bounded checks cover slow browsers
      // without leaving timers or mutation loops running forever.
      [80, 300, 900].forEach(delay => setTimeout(decorateGrid, delay));
    } catch (error) {
      console.warn('Gallery social features could not start:', error);
      const grid = document.getElementById('galleryGrid');
      if (grid) grid.title = 'Gallery social features are temporarily unavailable.';
    }
  }

  load();
})();