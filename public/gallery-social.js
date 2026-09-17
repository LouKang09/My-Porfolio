(() => {
  const REACTIONS = [
    ['like', '👍', 'Like'],
    ['love', '❤️', 'Love'],
    ['care', '🥰', 'Care'],
    ['haha', '😂', 'Haha'],
    ['wow', '😮', 'Wow'],
    ['sad', '😢', 'Sad'],
    ['angry', '😡', 'Angry']
  ];

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  }[c]));

  let gallery = [];
  let social = { items: [], photos: {} };
  let keyByIndex = new Map();
  let photoIndexes = [];
  let currentIndex = -1;
  let lastFocused = null;

  const viewerId = (() => {
    let value = localStorage.getItem('resume-gallery-viewer');
    if (!value) {
      value = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('resume-gallery-viewer', value);
    }
    return value;
  })();

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(date);
  }

  async function getJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
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
          <div id="galleryReactionPicker" class="gallery-reaction-picker" aria-label="React to this photo"></div>
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

    const savedName = localStorage.getItem('resume-gallery-comment-name') || '';
    document.getElementById('galleryCommentName').value = savedName;

    modal.querySelector('.gallery-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.gallery-nav-prev').addEventListener('click', () => navigate(-1));
    modal.querySelector('.gallery-nav-next').addEventListener('click', () => navigate(1));
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal();
    });
    document.getElementById('galleryCommentForm').addEventListener('submit', submitComment);

    document.addEventListener('keydown', event => {
      if (modal.hidden) return;
      if (event.key === 'Escape') closeModal();
      else if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
    });
  }

  function currentGalleryKey() {
    return keyByIndex.get(currentIndex) || '';
  }

  function currentPhotoSocial() {
    const key = currentGalleryKey();
    return social.photos?.[key] || {
      counts: Object.fromEntries(REACTIONS.map(([type]) => [type, 0])),
      total: 0,
      viewerReaction: '',
      comments: [],
      commentCount: 0
    };
  }

  function renderReactionPicker(photo) {
    const picker = document.getElementById('galleryReactionPicker');
    picker.innerHTML = REACTIONS.map(([type, emoji, label]) => `
      <button type="button" class="gallery-reaction ${photo.viewerReaction === type ? 'selected' : ''}" data-reaction="${type}" aria-pressed="${photo.viewerReaction === type ? 'true' : 'false'}" title="${label}">
        <span>${emoji}</span><small>${label}</small>
      </button>
    `).join('');
    picker.querySelectorAll('[data-reaction]').forEach(button => {
      button.addEventListener('click', () => react(button.dataset.reaction));
    });
  }

  function renderSummary(photo) {
    const summary = document.getElementById('galleryReactionSummary');
    const top = REACTIONS
      .map(([type, emoji, label]) => ({ type, emoji, label, count: Number(photo.counts?.[type] || 0) }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);

    summary.innerHTML = photo.total
      ? `<span class="gallery-summary-emojis">${top.slice(0, 3).map(item => `<b title="${item.label}">${item.emoji}</b>`).join('')}</span><span>${photo.total} ${photo.total === 1 ? 'reaction' : 'reactions'}</span>`
      : '<span>Be the first to react</span>';

    const count = Number(photo.commentCount || photo.comments?.length || 0);
    document.getElementById('galleryCommentCount').textContent = `${count} ${count === 1 ? 'comment' : 'comments'}`;
  }

  function renderComments(photo) {
    const container = document.getElementById('galleryComments');
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
    const modal = document.getElementById('galleryLightbox');
    const image = document.getElementById('galleryLightboxImage');
    const loading = document.getElementById('galleryImageLoading');
    const position = photoIndexes.indexOf(currentIndex);

    document.getElementById('galleryLightboxTitle').textContent = item.title || 'Project photo';
    document.getElementById('galleryPhotoCounter').textContent = `${position + 1} of ${photoIndexes.length}`;
    image.alt = item.title || 'Project gallery image';
    loading.hidden = false;
    image.onload = () => { loading.hidden = true; };
    image.onerror = () => { loading.hidden = true; };
    image.src = item.image;

    modal.querySelector('.gallery-nav-prev').disabled = position <= 0;
    modal.querySelector('.gallery-nav-next').disabled = position >= photoIndexes.length - 1;

    const photo = currentPhotoSocial();
    renderSummary(photo);
    renderReactionPicker(photo);
    renderComments(photo);
    document.getElementById('galleryCommentStatus').textContent = '';
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
    modal.querySelector('.gallery-modal-close').focus({ preventScroll: true });
  }

  function closeModal() {
    const modal = document.getElementById('galleryLightbox');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('gallery-modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
  }

  function navigate(direction) {
    const position = photoIndexes.indexOf(currentIndex);
    const next = position + direction;
    if (next < 0 || next >= photoIndexes.length) return;
    currentIndex = photoIndexes[next];
    renderCurrent();
  }

  async function react(type) {
    const key = currentGalleryKey();
    if (!key) return;
    const current = currentPhotoSocial().viewerReaction || '';
    const reaction = current === type ? '' : type;
    const picker = document.getElementById('galleryReactionPicker');
    picker.classList.add('busy');
    try {
      const result = await getJson('/api/gallery-social/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryKey: key, reaction, viewerId })
      });
      social.photos[key] = result.photo;
      renderSummary(result.photo);
      renderReactionPicker(result.photo);
      updateGridBadges();
    } catch (error) {
      document.getElementById('galleryCommentStatus').textContent = error.message;
    } finally {
      picker.classList.remove('busy');
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

    localStorage.setItem('resume-gallery-comment-name', name);
    submit.disabled = true;
    status.textContent = 'Posting…';
    try {
      const result = await getJson('/api/gallery-social/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryKey: key, name, comment, viewerId })
      });
      social.photos[key] = result.photo;
      textInput.value = '';
      status.textContent = 'Comment posted.';
      renderSummary(result.photo);
      renderComments(result.photo);
      updateGridBadges();
    } catch (error) {
      status.textContent = error.message;
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
      badge.textContent = text;
      badge.hidden = !text;
    });
  }

  function watchGrid() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
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
    new MutationObserver(decorateGrid).observe(grid, { childList: true, subtree: true });
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
      photoIndexes = gallery.map((item, index) => item?.image ? index : -1).filter(index => index >= 0);
      watchGrid();
      setTimeout(decorateGrid, 100);
      setTimeout(decorateGrid, 500);
    } catch (error) {
      console.warn('Gallery social features could not start:', error);
      const grid = document.getElementById('galleryGrid');
      if (grid) grid.title = 'Gallery social features are temporarily unavailable.';
    }
  }

  load();
})();
