(() => {
  'use strict';

  let viewportRaf = 0;
  let blurTimer = 0;

  function setStatus(message) {
    const status = document.getElementById('galleryCommentStatus');
    if (status) status.textContent = message || '';
  }

  function syncVisualViewport() {
    cancelAnimationFrame(viewportRaf);
    viewportRaf = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const height = Math.max(280, Math.round(viewport?.height || window.innerHeight || 0));
      if (height) document.documentElement.style.setProperty('--gallery-visual-height', `${height}px`);
    });
  }

  function prepareCommentForm() {
    const form = document.getElementById('galleryCommentForm');
    if (!form || form.dataset.commentSafetyBound === '1') return;

    form.dataset.commentSafetyBound = '1';
    form.noValidate = true;

    const nameInput = document.getElementById('galleryCommentName');
    const commentInput = document.getElementById('galleryCommentText');

    // The gallery script already validates these values in JavaScript. Disabling
    // browser constraint validation avoids Android WebView trying to focus a
    // required field while the virtual keyboard changes the responsive layout.
    nameInput?.removeAttribute('required');
    commentInput?.removeAttribute('required');

    nameInput?.addEventListener('invalid', event => event.preventDefault());
    commentInput?.addEventListener('invalid', event => event.preventDefault());

    form.addEventListener('focusin', () => {
      clearTimeout(blurTimer);
      document.body.classList.add('gallery-keyboard-open');
      syncVisualViewport();
    });

    form.addEventListener('focusout', () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!form.contains(document.activeElement)) {
          document.body.classList.remove('gallery-keyboard-open');
          syncVisualViewport();
        }
      }, 160);
    });
  }

  // Validate before the gallery's own submit handler. If a field is empty we
  // stop the submit cleanly instead of invoking native hidden-field validation.
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'galleryCommentForm') return;

    const nameInput = document.getElementById('galleryCommentName');
    const commentInput = document.getElementById('galleryCommentText');
    const name = nameInput?.value.trim() || '';
    const comment = commentInput?.value.trim() || '';

    if (!name || !comment) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(!name ? 'Please enter your name.' : 'Please write a comment first.');
      const target = !name ? nameInput : commentInput;
      try { target?.focus(); } catch {}
      return;
    }

    setStatus('Posting…');
  }, true);

  // Use the simplest possible focus call for older Facebook/Android WebViews.
  // This bypasses the original focus(options) call which can be unreliable in
  // older embedded Chromium builds when the viewport is resizing.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('#galleryCommentFocus');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    prepareCommentForm();
    syncVisualViewport();
    const textarea = document.getElementById('galleryCommentText');
    try { textarea?.focus(); } catch {}
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('.gallery-modal-close')) {
      document.body.classList.remove('gallery-keyboard-open');
    }
  }, true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncVisualViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncVisualViewport, { passive: true });
  } else {
    window.addEventListener('resize', syncVisualViewport, { passive: true });
  }

  const observer = new MutationObserver(() => prepareCommentForm());
  observer.observe(document.body, { childList: true });

  syncVisualViewport();
  prepareCommentForm();
})();
