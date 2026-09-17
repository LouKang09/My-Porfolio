(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const NAME_KEY = 'resume-gallery-reactor-name';
  const COMMENT_NAME_KEY = 'resume-gallery-comment-name';

  function getSavedName() {
    try {
      return (localStorage.getItem(NAME_KEY) || localStorage.getItem(COMMENT_NAME_KEY) || '').trim().slice(0, 80);
    } catch {
      return '';
    }
  }

  function saveName(name) {
    if (!name) return;
    try {
      localStorage.setItem(NAME_KEY, name);
      if (!localStorage.getItem(COMMENT_NAME_KEY)) localStorage.setItem(COMMENT_NAME_KEY, name);
    } catch {}
  }

  function askForName() {
    const saved = getSavedName();
    if (saved) return saved;

    const inFacebook = /FBAN|FBAV|FB_IAB/i.test(navigator.userAgent || '');
    const message = inFacebook
      ? 'Facebook does not share your account name with this portfolio. If you want the portfolio owner to know who reacted, enter your display name. This is visible only to the site admin. You can cancel to stay anonymous.'
      : 'If you want the portfolio owner to know who reacted, enter your display name. This is visible only to the site admin. You can cancel to stay anonymous.';

    let value = '';
    try { value = (window.prompt(message, '') || '').trim().slice(0, 80); } catch {}
    if (value) saveName(value);
    return value;
  }

  window.fetch = async function reactorIdentityFetch(input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String(init.method || (input && input.method) || 'GET').toUpperCase();

      if (method === 'POST' && /\/api\/gallery-social\/reaction(?:\?|$)/.test(url) && typeof init.body === 'string') {
        const payload = JSON.parse(init.body || '{}');
        if (!Object.prototype.hasOwnProperty.call(payload, 'viewerName')) {
          payload.viewerName = getSavedName() || askForName();
          init = { ...init, body: JSON.stringify(payload) };
        }
      }
    } catch (error) {
      console.warn('Reactor identity helper could not attach a display name:', error);
    }

    return originalFetch(input, init);
  };
})();
