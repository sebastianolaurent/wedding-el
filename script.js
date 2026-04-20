const ibanText = document.getElementById('iban-text');
const feedback = document.getElementById('copy-feedback');
const heroPhoto = document.querySelector('.hero-photo');
const guestUploadTrigger = document.getElementById('guest-upload-trigger');
const guestUploadInput = document.getElementById('guest-photos');
const guestUploadStatus = document.getElementById('upload-status');
const guestGallery = document.getElementById('guest-gallery');
const photoLightbox = document.getElementById('photo-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxCloseButton = document.getElementById('lightbox-close');
const lightboxPrevButton = document.getElementById('lightbox-prev');
const lightboxNextButton = document.getElementById('lightbox-next');
const authorModal = document.getElementById('author-modal');
const authorModalForm = document.getElementById('author-modal-form');
const authorModalInput = document.getElementById('author-name-input');
const authorModalError = document.getElementById('author-modal-error');
const authorModalCancel = document.getElementById('author-modal-cancel');
const authorModalClose = document.getElementById('author-modal-close');
const programCalendarCta = document.getElementById('program-calendar-cta');
const MAX_GUEST_PHOTO_BYTES = 1.5 * 1024 * 1024;
const MAX_GUEST_PHOTO_DIMENSION = 2200;
const MIN_GUEST_PHOTO_DIMENSION = 960;
const HOME_GUEST_GALLERY_MAX_ITEMS = 6;
const GUEST_AUTHOR_STORAGE_KEY = 'weddingGuestAuthorName';
const DEFAULT_GUEST_AUTHOR = '';
const SUPABASE_CDN_URL = 'assets/vendor/supabase-js.js';
const DETAILS_AUTO_REFRESH_MS = 15 * 60 * 1000;
const REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASTER_SECRET_WORD = 'amore';
const EASTER_TAP_TARGET = 5;
const EASTER_TAP_RESET_MS = 1300;
const EASTER_TOAST_DURATION_MS = 6200;
const EASTER_MESSAGES = [
  'Hai trovato il brindisi segreto: applauso agli sposi e poi tutti in pista.',
  'Missione compiuta: sorrisi +10, passi di danza +20.',
  'Codice amore accettato. Prossima mossa: selfie di gruppo davanti alla torta.',
  'Livello festa sbloccato: chi intercetta il bouquet offre il primo caffe.'
];
const DEFAULT_WEDDING_EVENT_CONFIG = {
  timezone: 'Europe/Rome',
  weddingDate: '2026-09-26',
  galleryWindow: {
    startDate: '2026-09-24',
    endDate: '2026-09-29'
  }
};
let supabaseClient = null;
let guestUploadsEnabled = false;
let guestGalleryItems = [];
let currentLightboxIndex = 0;
let pendingGuestAuthorName = '';
let cachedGuestAuthorName = '';
let revealObserver = null;
let parallaxListenerAttached = false;
let parallaxRafId = 0;
let galleryInitialized = false;
let easterTapCount = 0;
let easterTapTimer = 0;
let easterDismissTimer = 0;
let easterKeyBuffer = '';
const externalScriptPromises = new Map();
const weddingEventConfig = getWeddingEventConfig();
const previewDateOverride = getPreviewDateFromUrl();
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
let lastLightboxTrigger = null;
let lastAuthorModalTrigger = null;

function getWeddingEventConfig() {
  const rawConfig = window.WEDDING_EVENT_CONFIG || {};
  const rawGalleryWindow = rawConfig.galleryWindow || {};

  return {
    timezone: String(rawConfig.timezone || DEFAULT_WEDDING_EVENT_CONFIG.timezone),
    weddingDate: String(rawConfig.weddingDate || DEFAULT_WEDDING_EVENT_CONFIG.weddingDate),
    galleryWindow: {
      startDate: String(rawGalleryWindow.startDate || DEFAULT_WEDDING_EVENT_CONFIG.galleryWindow.startDate),
      endDate: String(rawGalleryWindow.endDate || DEFAULT_WEDDING_EVENT_CONFIG.galleryWindow.endDate)
    }
  };
}

function getDateStampInTimeZone(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (_) {
    // Fall through to local date fallback.
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPreviewDateFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const candidate =
      params.get('pd') || params.get('previewDate') || params.get('preview-date') || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  } catch (_) {
    // Ignore URL parsing errors in legacy environments.
  }
  return '';
}

function getWeddingPhase(date = new Date()) {
  const todayInRome = previewDateOverride || getDateStampInTimeZone(weddingEventConfig.timezone, date);
  const { startDate, endDate } = weddingEventConfig.galleryWindow;
  if (todayInRome < startDate) return 'pre';
  if (todayInRome > endDate) return 'post';
  return 'event';
}

function isGalleryWindowOpen(date = new Date()) {
  return getWeddingPhase(date) === 'event';
}

function getFocusableElements(container) {
  if (!(container instanceof HTMLElement)) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => element instanceof HTMLElement && !element.hasAttribute('hidden')
  );
}

function trapFocusWithin(container, event) {
  if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') return;
  const focusableElements = getFocusableElements(container);
  if (!focusableElements.length) return;
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function restoreFocus(node) {
  if (node instanceof HTMLElement) {
    node.focus();
  }
}

function applyGalleryAvailabilityRules() {
  const gallerySection = document.getElementById('foto-invitati');
  const galleryTeaser = document.getElementById('guest-gallery-teaser');
  const galleryLive = document.getElementById('guest-gallery-live');
  const phase = getWeddingPhase();
  document.body.dataset.eventPhase = phase;
  if (previewDateOverride) {
    document.body.dataset.previewDate = previewDateOverride;
  } else {
    delete document.body.dataset.previewDate;
  }
  if (gallerySection) gallerySection.hidden = false;

  const galleryOpen = phase === 'event';
  const galleryVisible = phase !== 'pre';
  if (galleryTeaser) galleryTeaser.hidden = phase !== 'pre';
  if (galleryLive) galleryLive.hidden = !galleryVisible;
  if (guestUploadTrigger) guestUploadTrigger.hidden = !galleryOpen;

  setGuestUploaderState(galleryOpen);
  if (guestUploadInput) guestUploadInput.disabled = !galleryOpen;
  setUploadStatus('');
}

function isReducedMotionPreferred() {
  return REDUCED_MOTION_QUERY.matches;
}

function loadExternalScript(src, attributes = {}) {
  if (!src) return Promise.reject(new Error('URL script non valida'));
  if (externalScriptPromises.has(src)) {
    return externalScriptPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-external-src="${src}"]`);
    if (existing && existing.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.externalSrc = src;
    if (attributes.crossorigin) {
      script.setAttribute('crossorigin', attributes.crossorigin);
    }

    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Caricamento script fallito: ${src}`));

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  externalScriptPromises.set(src, promise);
  return promise;
}

function initProgramCalendarCta() {
  if (!programCalendarCta) return;

  programCalendarCta.textContent = 'Aggiungi al calendario';
  programCalendarCta.setAttribute('aria-label', 'Aggiungi al calendario');
  programCalendarCta.setAttribute('href', 'assets/calendar/matrimonioeleonoraeluca.ics');
  programCalendarCta.setAttribute('download', 'matrimonioeleonoraeluca.ics');
}

function setUploadStatus(message) {
  if (!guestUploadStatus) return;
  guestUploadStatus.textContent = message;
}

function applyHeroParallax() {
  if (!heroPhoto || isReducedMotionPreferred()) return;
  const scrollTop = window.scrollY || 0;
  const offset = Math.min(scrollTop * 0.08, 30);
  heroPhoto.style.transform = `scale(1.04) translate3d(0, ${offset}px, 0)`;
}

function scheduleHeroParallax() {
  if (parallaxRafId) return;
  parallaxRafId = requestAnimationFrame(() => {
    parallaxRafId = 0;
    applyHeroParallax();
  });
}

function attachParallaxListener() {
  if (parallaxListenerAttached || isReducedMotionPreferred()) return;
  window.addEventListener('scroll', scheduleHeroParallax, { passive: true });
  parallaxListenerAttached = true;
}

function detachParallaxListener() {
  if (!parallaxListenerAttached) return;
  window.removeEventListener('scroll', scheduleHeroParallax);
  parallaxListenerAttached = false;
  if (parallaxRafId) {
    cancelAnimationFrame(parallaxRafId);
    parallaxRafId = 0;
  }
}

function revealWithObserver(nodeList) {
  const nodes = Array.from(nodeList || []);
  if (!nodes.length) return;

  if (isReducedMotionPreferred() || typeof IntersectionObserver === 'undefined') {
    nodes.forEach((node) => {
      node.classList.add('is-visible');
    });
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.16
      }
    );
  }

  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.classList.add('reveal-item');
    revealObserver.observe(node);
  });
}

function initScrollReveals() {
  const sectionHeads = document.querySelectorAll('.section-head, .gift-box');
  const infoCards = document.querySelectorAll('.info-card');
  const galleryBlocks = document.querySelectorAll(
    '.guest-gallery-copy, .guest-gallery-teaser, .guest-gallery-grid'
  );
  const footerContainer = document.querySelector('.footer .container');

  revealWithObserver(sectionHeads);
  revealWithObserver(galleryBlocks);
  infoCards.forEach((card, index) => {
    card.dataset.reveal = index % 2 === 0 ? 'left' : 'right';
  });
  revealWithObserver(infoCards);

  // Keep footer always visible and never gated by scroll reveal.
  if (footerContainer) {
    footerContainer.classList.remove('reveal-item');
    footerContainer.classList.add('is-visible');
  }
}

function applyTiltEffect(elements) {
  if (!elements?.length || isReducedMotionPreferred()) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  elements.forEach((el) => {
    if (!(el instanceof HTMLElement) || el.dataset.tiltReady === 'true') return;
    el.dataset.tiltReady = 'true';
    let rafId = 0;
    let lastPointerEvent = null;

    const drawTilt = () => {
      rafId = 0;
      if (!lastPointerEvent) return;
      const rect = el.getBoundingClientRect();
      const px = (lastPointerEvent.clientX - rect.left) / rect.width;
      const py = (lastPointerEvent.clientY - rect.top) / rect.height;
      const rotateY = (px - 0.5) * 6;
      const rotateX = (0.5 - py) * 5;
      el.style.transform = `translateY(-4px) perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };

    const onMove = (event) => {
      lastPointerEvent = event;
      if (!rafId) {
        rafId = requestAnimationFrame(drawTilt);
      }
    };

    const onLeave = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      lastPointerEvent = null;
      el.style.transform = '';
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
  });
}

function initInteractiveMotion() {
  initScrollReveals();
  applyTiltEffect(document.querySelectorAll('.info-card, .gift-box'));
  applyHeroParallax();
  attachParallaxListener();
}

function getRandomItem(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function isTypingIntoField(element) {
  if (!(element instanceof HTMLElement)) return false;
  const tagName = element.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable
  );
}

function clearHomepageEasterEgg() {
  const toast = document.getElementById('home-easter-toast');
  const confettiLayer = document.getElementById('home-easter-confetti');
  if (toast) toast.remove();
  if (confettiLayer) confettiLayer.remove();
  document.body.classList.remove('easter-egg-active');
}

function dismissHomepageEasterEgg() {
  window.clearTimeout(easterDismissTimer);
  easterDismissTimer = 0;
  clearHomepageEasterEgg();
}

function createHomepageEasterConfetti(layer) {
  const confettiColors = ['#f9d66d', '#9a79c6', '#f88fab', '#76c7ff', '#fff6a2', '#fca974'];
  for (let index = 0; index < 28; index += 1) {
    const piece = document.createElement('span');
    piece.className = 'easter-confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty('--piece-size', `${Math.round(Math.random() * 8 + 6)}px`);
    piece.style.setProperty('--piece-color', getRandomItem(confettiColors));
    piece.style.setProperty('--drift', `${Math.round((Math.random() * 2 - 1) * 18)}vw`);
    piece.style.setProperty('--fall-duration', `${(Math.random() * 1.5 + 2.6).toFixed(2)}s`);
    piece.style.setProperty('--fall-delay', `${(Math.random() * 0.45).toFixed(2)}s`);
    piece.style.setProperty('--piece-rotate', `${Math.round(Math.random() * 320 + 40)}deg`);
    layer.appendChild(piece);
  }
}

function launchHomepageEasterEgg() {
  dismissHomepageEasterEgg();
  document.body.classList.add('easter-egg-active');

  const toast = document.createElement('aside');
  toast.id = 'home-easter-toast';
  toast.className = 'easter-egg-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const title = document.createElement('strong');
  title.textContent = 'Brindisi segreto sbloccato';

  const copy = document.createElement('p');
  copy.textContent = getRandomItem(EASTER_MESSAGES);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'easter-egg-dismiss';
  closeButton.textContent = 'chiudi';
  closeButton.setAttribute('aria-label', 'Chiudi easter egg');
  closeButton.addEventListener('click', dismissHomepageEasterEgg);

  toast.append(title, copy, closeButton);
  document.body.appendChild(toast);

  if (!isReducedMotionPreferred()) {
    const confettiLayer = document.createElement('div');
    confettiLayer.id = 'home-easter-confetti';
    confettiLayer.className = 'easter-confetti-layer';
    confettiLayer.setAttribute('aria-hidden', 'true');
    createHomepageEasterConfetti(confettiLayer);
    document.body.appendChild(confettiLayer);
  }

  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  easterDismissTimer = window.setTimeout(() => {
    dismissHomepageEasterEgg();
  }, EASTER_TOAST_DURATION_MS);
}

function registerHomepageEasterTap() {
  easterTapCount += 1;
  window.clearTimeout(easterTapTimer);
  easterTapTimer = window.setTimeout(() => {
    easterTapCount = 0;
  }, EASTER_TAP_RESET_MS);

  if (easterTapCount >= EASTER_TAP_TARGET) {
    easterTapCount = 0;
    launchHomepageEasterEgg();
  }
}

function initHomepageEasterEgg() {
  const secretTargets = [
    document.querySelector('.hero-content h1 span'),
    document.querySelector('.footer p:first-child')
  ].filter((node) => node instanceof HTMLElement);
  if (!secretTargets.length) return;

  secretTargets.forEach((target) => {
    if (!(target instanceof HTMLElement)) return;
    target.classList.add('easter-egg-target');
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '0');
    }
    target.addEventListener('click', registerHomepageEasterTap);
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      registerHomepageEasterTap();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingIntoField(document.activeElement)) return;
    const key = String(event.key || '').toLowerCase();
    if (!/^[a-z]$/.test(key)) return;
    easterKeyBuffer = `${easterKeyBuffer}${key}`.slice(-EASTER_SECRET_WORD.length);
    if (easterKeyBuffer === EASTER_SECRET_WORD) {
      easterKeyBuffer = '';
      launchHomepageEasterEgg();
    }
  });
}

function getPreferredMapsUrl(lat, lon, label) {
  const encodedLabel = encodeURIComponent(label);
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);

  if (isAndroid) {
    if (lat && lon) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodedLabel}`;
  }

  if (lat && lon) {
    return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodedLabel}`;
  }

  return `https://maps.apple.com/?q=${encodedLabel}`;
}

function hydrateMapLinks() {
  const mapLinks = document.querySelectorAll('.js-map-link');
  mapLinks.forEach((link) => {
    const { lat, lon, label } = link.dataset;
    const targetUrl = getPreferredMapsUrl(lat, lon, label || 'Destinazione');
    link.setAttribute('href', targetUrl);
  });
}

function initMapLinkClicks() {
  // Keep native anchor behavior to avoid extra main-thread work and popup blockers.
}

function initLazyMapEmbeds() {
  const mapEmbeds = Array.from(document.querySelectorAll('.program-map-embed[data-src]'));
  if (!mapEmbeds.length) return;

  const showMapFallback = (frame) => {
    const fallback = frame?.closest('.program-map-preview')?.querySelector('[data-map-fallback]');
    if (fallback instanceof HTMLElement) fallback.hidden = false;
  };

  const hideMapFallback = (frame) => {
    const fallback = frame?.closest('.program-map-preview')?.querySelector('[data-map-fallback]');
    if (fallback instanceof HTMLElement) fallback.hidden = true;
  };

  const activateEmbed = (frame) => {
    if (!(frame instanceof HTMLIFrameElement) || frame.dataset.loaded === 'true') return;
    const src = frame.dataset.src;
    if (!src) {
      showMapFallback(frame);
      return;
    }
    frame.addEventListener('load', () => hideMapFallback(frame), { once: true });
    frame.addEventListener('error', () => showMapFallback(frame), { once: true });
    window.setTimeout(() => {
      if (frame.dataset.loaded === 'true') return;
      showMapFallback(frame);
    }, 6500);
    frame.src = src;
    frame.dataset.loaded = 'true';
    delete frame.dataset.src;
  };

  if (typeof IntersectionObserver === 'undefined') {
    mapEmbeds.forEach((frame) => activateEmbed(frame));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        activateEmbed(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: '500px 0px 260px 0px',
      threshold: 0.01
    }
  );

  mapEmbeds.forEach((frame) => observer.observe(frame));
}

function normalizeIban(text) {
  return (text || '').replace(/\s+/g, '').trim();
}

function getIbanParts(iban) {
  if (!iban) return [];
  if (/^IT/i.test(iban) && iban.length >= 27) {
    const countryCode = iban.slice(0, 2);
    const checkDigits = iban.slice(2, 4);
    const cin = iban.slice(4, 5);
    const abi = iban.slice(5, 10);
    const cab = iban.slice(10, 15);
    const account = iban.slice(15, 27);
    return [countryCode, checkDigits, cin, abi, cab, account];
  }

  const countryCode = iban.slice(0, 2);
  const chunks = (iban.slice(2).match(/.{1,4}/g) || []);
  return [countryCode, ...chunks];
}

function formatIbanForDisplay(iban) {
  const parts = getIbanParts(iban);
  return parts
    .map((part, index) =>
      index === 0 ? part : `<span class="iban-sep" aria-hidden="true">·</span>${part}`
    )
    .join('');
}

function initIbanDisplay() {
  if (!ibanText) return;
  const rawIban = normalizeIban(ibanText.textContent);
  ibanText.dataset.ibanRaw = rawIban;
  ibanText.innerHTML = formatIbanForDisplay(rawIban);
}

function getIbanValue() {
  if (!ibanText) return '';
  return ibanText.dataset.ibanRaw || normalizeIban(ibanText.textContent);
}

function setCopyFeedback(message) {
  if (!feedback) return;
  feedback.textContent = message;
}

async function copyToClipboard(text) {
  if (!text) return false;
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return false;
  }

  await navigator.clipboard.writeText(text);
  return true;
}

function initIbanCopy() {
  if (!ibanText || !feedback) return;

  const copyIban = async () => {
    try {
      const ibanValue = getIbanValue();
      const copied = await copyToClipboard(ibanValue);
      if (!copied) {
        throw new Error('Clipboard API non disponibile');
      }
      setCopyFeedback('IBAN copiato negli appunti.');
    } catch (error) {
      setCopyFeedback("Copia non riuscita. Seleziona e copia manualmente l'IBAN.");
    }
  };

  ibanText.addEventListener('click', copyIban);
  ibanText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      copyIban();
    }
  });
}

function safeFileName(name) {
  return (name || 'foto')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 70) || 'foto';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeGuestAuthorName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function getGuestAuthorSlug(name) {
  const normalized = normalizeGuestAuthorName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return slug || 'invitato';
}

function formatAuthorFromSlug(slug) {
  if (!slug) return DEFAULT_GUEST_AUTHOR;
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getAuthorFromPhotoName(fileName) {
  const match = String(fileName || '').match(/--([a-z0-9-]{2,32})--/i);
  if (!match) return DEFAULT_GUEST_AUTHOR;
  return formatAuthorFromSlug(match[1]);
}

function getGuestAuthorLabel(authorName) {
  return normalizeGuestAuthorName(authorName);
}

function getFileBaseName(name) {
  return safeFileName(name).replace(/\.[a-z0-9]+$/i, '') || 'foto';
}

function getGuestPhotoPath(file, authorName) {
  const uniqueId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const authorSlug = getGuestAuthorSlug(authorName);
  return `${Date.now()}-${uniqueId}--${authorSlug}--${getFileBaseName(file.name)}.jpg`;
}

function getStoredGuestAuthorName() {
  if (cachedGuestAuthorName) return cachedGuestAuthorName;
  try {
    cachedGuestAuthorName = normalizeGuestAuthorName(
      localStorage.getItem(GUEST_AUTHOR_STORAGE_KEY) || ''
    );
    return cachedGuestAuthorName;
  } catch (_) {
    return cachedGuestAuthorName;
  }
}

function storeGuestAuthorName(authorName) {
  const normalized = normalizeGuestAuthorName(authorName);
  cachedGuestAuthorName = normalized;
  try {
    localStorage.setItem(GUEST_AUTHOR_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage errors and continue with in-memory upload flow.
  }
}

function askGuestAuthorName(initialValue = '') {
  if (!authorModal || !authorModalForm || !authorModalInput || !authorModalError) {
    const answer = window.prompt(
      'Come ti chiami? Inseriamo il tuo nome come autore delle foto.',
      initialValue
    );
    if (answer === null) return null;
    return Promise.resolve(normalizeGuestAuthorName(answer));
  }

  return new Promise((resolve) => {
    let settled = false;
    lastAuthorModalTrigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const closeModal = (value) => {
      if (settled) return;
      settled = true;
      authorModal.classList.remove('is-open');
      authorModal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('author-modal-open');
      authorModalForm.removeEventListener('submit', onSubmit);
      authorModalCancel?.removeEventListener('click', onCancel);
      authorModalClose?.removeEventListener('click', onCancel);
      authorModal.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onTrapFocus);
      document.removeEventListener('keydown', onEscape);
      restoreFocus(lastAuthorModalTrigger);
      lastAuthorModalTrigger = null;
      resolve(value);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      const authorName = normalizeGuestAuthorName(authorModalInput.value);
      if (!authorName) {
        authorModalError.textContent = 'Inserisci il tuo nome per continuare.';
        authorModalInput.focus();
        return;
      }
      closeModal(authorName);
    };

    const onCancel = () => closeModal(null);

    const onBackdropClick = (event) => {
      if (event.target === authorModal) onCancel();
    };

    const onEscape = (event) => {
      if (event.key === 'Escape') onCancel();
    };

    const onTrapFocus = (event) => {
      trapFocusWithin(authorModal, event);
    };

    authorModalInput.value = initialValue;
    authorModalError.textContent = '';
    authorModal.classList.add('is-open');
    authorModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('author-modal-open');
    authorModalForm.addEventListener('submit', onSubmit);
    authorModalCancel?.addEventListener('click', onCancel);
    authorModalClose?.addEventListener('click', onCancel);
    authorModal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onTrapFocus);
    document.addEventListener('keydown', onEscape);
    requestAnimationFrame(() => {
      authorModalInput.focus();
      authorModalInput.select();
    });
  });
}

async function ensureGuestAuthorName() {
  const storedAuthorName = getStoredGuestAuthorName();
  if (storedAuthorName) return storedAuthorName;
  const initialValue = pendingGuestAuthorName || '';
  const authorName = await askGuestAuthorName(initialValue);
  if (!authorName) return authorName;
  storeGuestAuthorName(authorName);
  return authorName;
}

async function resolveGuestAuthorName() {
  if (pendingGuestAuthorName) return pendingGuestAuthorName;
  return ensureGuestAuthorName();
}

function isGuestAuthorNameMissing(authorName) {
  return !normalizeGuestAuthorName(authorName);
}

function blobToFile(blob, fileName) {
  return new File([blob], fileName, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now()
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Immagine non leggibile'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Compressione non riuscita'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

async function compressGuestPhoto(file) {
  if ((file.type || '').toLowerCase() === 'image/gif') {
    return file;
  }

  if (file.size <= MAX_GUEST_PHOTO_BYTES) {
    return file;
  }

  const { image, objectUrl } = await loadImageFromFile(file);
  try {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const initialScale = Math.min(1, MAX_GUEST_PHOTO_DIMENSION / Math.max(sourceWidth, sourceHeight));

    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    let quality = 0.86;
    let bestBlob = null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }

    for (let attempt = 0; attempt < 16; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, quality);
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= MAX_GUEST_PHOTO_BYTES) {
        bestBlob = blob;
        break;
      }

      if (quality > 0.5) {
        quality = Math.max(0.48, quality - 0.08);
        continue;
      }

      const nextWidth = Math.round(width * 0.85);
      const nextHeight = Math.round(height * 0.85);

      if (
        nextWidth === width ||
        nextHeight === height ||
        Math.max(nextWidth, nextHeight) <= MIN_GUEST_PHOTO_DIMENSION
      ) {
        break;
      }

      width = nextWidth;
      height = nextHeight;
      quality = 0.8;
    }

    if (!bestBlob) {
      return file;
    }

    const outputName = `${getFileBaseName(file.name)}.jpg`;
    return blobToFile(bestBlob, outputName);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getImageSortKey(image) {
  const createdAtMs = new Date(image.createdAt || '').getTime();
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    return createdAtMs;
  }

  const prefix = Number.parseInt(String(image.name || '').split('-')[0], 10);
  return Number.isFinite(prefix) ? prefix : 0;
}

function setGuestUploaderState(enabled) {
  guestUploadsEnabled = enabled;
  if (guestUploadTrigger) {
    guestUploadTrigger.disabled = !enabled;
  }
}

function isImageStorageObject(entry) {
  if (!entry || !entry.name || entry.name.endsWith('/')) return false;
  const mimeType = String(entry.metadata?.mimetype || '').toLowerCase();
  if (mimeType.startsWith('image/')) return true;
  return /\.(avif|webp|jpe?g|png|gif|heic|heif)$/i.test(entry.name);
}

function handleGuestImageLoadError(event) {
  const image = event.currentTarget;
  if (!image || !guestGallery) return;

  const card = image.closest('.guest-photo-card');
  const photoName = card?.dataset?.photoName || '';
  if (photoName) {
    guestGalleryItems = guestGalleryItems.filter((item) => item.name !== photoName);
  }
  if (card) card.remove();

  if (!guestGalleryItems.length) {
    renderGuestGalleryEmpty('Per ora non vediamo foto valide: caricane una nuova.');
    return;
  }

  renderGuestGallery(guestGalleryItems);
}

function getMosaicVariantClass(index) {
  const pattern = ['is-square', 'is-wide', 'is-tall', 'is-square', 'is-square', 'is-wide'];
  return pattern[index % pattern.length];
}

function openLightbox(index) {
  if (!photoLightbox || !lightboxImage || !guestGalleryItems.length) return;
  lastLightboxTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const safeIndex = ((index % guestGalleryItems.length) + guestGalleryItems.length) % guestGalleryItems.length;
  const image = guestGalleryItems[safeIndex];
  if (!image) return;
  const authorLabel = getGuestAuthorLabel(image.author);

  currentLightboxIndex = safeIndex;
  lightboxImage.src = image.url;
  lightboxImage.alt = authorLabel ? `Foto di ${authorLabel}` : 'Foto invitati';
  photoLightbox.classList.add('is-open');
  photoLightbox.setAttribute('aria-hidden', 'false');
  photoLightbox.setAttribute('tabindex', '-1');
  document.body.classList.add('lightbox-open');
  requestAnimationFrame(() => {
    (lightboxCloseButton || photoLightbox).focus();
  });
}

function closeLightbox() {
  if (!photoLightbox || !lightboxImage) return;
  photoLightbox.classList.remove('is-open');
  photoLightbox.setAttribute('aria-hidden', 'true');
  lightboxImage.src = '';
  document.body.classList.remove('lightbox-open');
  restoreFocus(lastLightboxTrigger);
  lastLightboxTrigger = null;
}

function showNextLightboxImage(direction) {
  if (!guestGalleryItems.length) return;
  openLightbox(currentLightboxIndex + direction);
}

function bindCardImageLoadingState(image) {
  if (!image) return;
  const card = image.closest('.guest-photo-card');
  if (!card) return;

  const markLoaded = () => {
    card.classList.remove('is-loading');
    image.classList.add('is-loaded');
  };

  if (image.complete && image.naturalWidth > 0) {
    markLoaded();
    return;
  }

  image.addEventListener('load', markLoaded, { once: true });
}

function renderGuestGallery(images) {
  if (!guestGallery) return;

  if (!images.length) {
    guestGallery.classList.add('is-empty');
    guestGallery.innerHTML = `
      <div class="guest-gallery-empty">
        <strong>Album ancora vuoto</strong>
        Carica la prima foto e inaugura il carosello dei ricordi.
      </div>
    `;
    return;
  }

  guestGallery.classList.remove('is-empty');
  guestGallery.innerHTML = images
    .map((image, index) => {
      const variantClass = getMosaicVariantClass(index);
      const authorLabel = getGuestAuthorLabel(image.author);
      const authorCaption = authorLabel
        ? `<figcaption class="guest-photo-author">${escapeHtml(authorLabel)}</figcaption>`
        : '';
      return `
      <figure class="guest-photo-card ${variantClass} is-loading" data-photo-name="${image.name}" data-photo-index="${index}">
        <img src="${image.url}" alt="${authorLabel ? `Foto di ${escapeHtml(authorLabel)}` : 'Foto invitati'}" loading="lazy" />
        ${authorCaption}
      </figure>
    `;
    })
    .join('');

  guestGallery.querySelectorAll('.guest-photo-card img').forEach((img) => {
    bindCardImageLoadingState(img);
    img.addEventListener('error', handleGuestImageLoadError, { once: true });
  });

  revealWithObserver(guestGallery.querySelectorAll('.guest-photo-card'));
}

function renderGuestGalleryEmpty(message) {
  if (!guestGallery) return;
  guestGallery.classList.add('is-empty');
  guestGallery.innerHTML = `
    <div class="guest-gallery-empty">
      <strong>Album ancora vuoto</strong>
      ${message}
    </div>
  `;
}

async function loadGuestPhotos() {
  if (!supabaseClient || !guestGallery) return;
  const { bucket } = window.SUPABASE_CONFIG || {};
  if (!bucket) return;

  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .list('', {
      limit: HOME_GUEST_GALLERY_MAX_ITEMS + 1,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' }
    });

  if (error) {
    console.error('Errore caricamento galleria invitati:', error);
    setUploadStatus('Non riesco a leggere la galleria. Controlla il bucket Supabase.');
    renderGuestGalleryEmpty('Per ora non vediamo foto: riprova tra poco.');
    return;
  }

  const pageItems = (data || [])
    .filter((entry) => isImageStorageObject(entry))
    .map((entry) => {
      const publicData = supabaseClient.storage.from(bucket).getPublicUrl(entry.name);
      return {
        name: entry.name,
        createdAt: entry.created_at || entry.updated_at || '',
        author: getAuthorFromPhotoName(entry.name),
        url: publicData.data.publicUrl
      };
    });

  guestGalleryItems = pageItems
    .sort((a, b) => getImageSortKey(b) - getImageSortKey(a))
    .slice(0, HOME_GUEST_GALLERY_MAX_ITEMS);

  renderGuestGallery(guestGalleryItems);
}

async function uploadGuestPhotos(files, authorName) {
  if (!supabaseClient || !files.length) return;
  const { bucket } = window.SUPABASE_CONFIG || {};
  if (!bucket) return;
  const normalizedAuthorName = normalizeGuestAuthorName(authorName);
  if (!normalizedAuthorName) {
    setUploadStatus('Inserisci un nome prima di caricare le foto.');
    return;
  }

  setGuestUploaderState(false);
  setUploadStatus(`Caricamento di ${files.length} foto in corso...`);

  let completed = 0;
  let skipped = 0;
  for (const file of files) {
    setUploadStatus(`Ottimizzo foto ${completed + 1}/${files.length}...`);
    const optimizedFile = await compressGuestPhoto(file);
    if (optimizedFile.size > MAX_GUEST_PHOTO_BYTES) {
      skipped += 1;
      setUploadStatus(
        'Una o piu foto superano 1.5MB anche dopo ottimizzazione. Salta quelle immagini.'
      );
      continue;
    }

    const path = getGuestPhotoPath(optimizedFile, normalizedAuthorName);
    const { error } = await supabaseClient.storage.from(bucket).upload(path, optimizedFile, {
      upsert: false,
      cacheControl: '3600',
      contentType: optimizedFile.type || 'image/jpeg'
    });

    if (error) {
      console.error('Errore upload foto invitato:', error);
      setUploadStatus("Upload non riuscito per una o più foto. Riprova tra poco.");
      setGuestUploaderState(true);
      return;
    }

    completed += 1;
    setUploadStatus(`Caricata ${completed}/${files.length} (max 1.5MB/foto)...`);
  }

  await loadGuestPhotos();
  if (completed === 0 && skipped > 0) {
    setUploadStatus('Nessuna foto caricata: tutte oltre 1.5MB dopo ottimizzazione.');
  } else {
    setUploadStatus('');
  }
  setGuestUploaderState(true);
}

async function initGuestGallery() {
  if (galleryInitialized) return;
  galleryInitialized = true;
  if (!guestGallery) return;
  const uploadControlsAvailable = Boolean(guestUploadInput && guestUploadTrigger);

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    try {
      await loadExternalScript(SUPABASE_CDN_URL);
    } catch (_) {
      setUploadStatus('Upload non disponibile: libreria Supabase non caricata.');
      setGuestUploaderState(false);
      renderGuestGalleryEmpty('Caricamento non disponibile al momento.');
      return;
    }
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setUploadStatus('Upload non disponibile: libreria Supabase non caricata.');
    setGuestUploaderState(false);
    renderGuestGalleryEmpty('Caricamento non disponibile al momento.');
    return;
  }

  const { url, anonKey, bucket } = window.SUPABASE_CONFIG || {};
  if (!url || !anonKey || !bucket) {
    setUploadStatus('Configura SUPABASE_CONFIG in config.js per abilitare la galleria.');
    setGuestUploaderState(false);
    renderGuestGalleryEmpty('Manca la configurazione per mostrare le foto.');
    return;
  }

  supabaseClient = window.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  if (uploadControlsAvailable) {
    guestUploadTrigger.addEventListener('click', async () => {
      if (!guestUploadsEnabled) return;
      const authorName = await ensureGuestAuthorName();
      if (authorName === null) {
        setUploadStatus('Upload annullato.');
        return;
      }
      if (isGuestAuthorNameMissing(authorName)) {
        setUploadStatus('Inserisci un nome prima di caricare le foto.');
        return;
      }
      pendingGuestAuthorName = authorName;
      guestUploadInput.click();
    });

    guestUploadInput.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []).filter((file) =>
        (file.type || '').startsWith('image/')
      );
      if (!files.length) {
        setUploadStatus('Seleziona almeno una foto valida.');
        return;
      }
      const authorName = await resolveGuestAuthorName();
      if (authorName === null) {
        setUploadStatus('Upload annullato.');
        guestUploadInput.value = '';
        pendingGuestAuthorName = '';
        return;
      }
      if (isGuestAuthorNameMissing(authorName)) {
        setUploadStatus('Inserisci un nome prima di caricare le foto.');
        guestUploadInput.value = '';
        pendingGuestAuthorName = '';
        return;
      }
      await uploadGuestPhotos(files, authorName);
      guestUploadInput.value = '';
      pendingGuestAuthorName = '';
    });
  }

  guestGallery.addEventListener('click', (event) => {
    const card = event.target.closest('.guest-photo-card');
    if (!card) return;
    const index = Number.parseInt(card.dataset.photoIndex || '-1', 10);
    if (index < 0) return;
    openLightbox(index);
  });

  if (photoLightbox && lightboxCloseButton && lightboxPrevButton && lightboxNextButton) {
    lightboxCloseButton.addEventListener('click', closeLightbox);
    lightboxPrevButton.addEventListener('click', () => showNextLightboxImage(-1));
    lightboxNextButton.addEventListener('click', () => showNextLightboxImage(1));
    photoLightbox.addEventListener('click', (event) => {
      if (event.target === photoLightbox) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!photoLightbox.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        showNextLightboxImage(-1);
      } else if (event.key === 'ArrowRight') {
        showNextLightboxImage(1);
      } else if (event.key === 'Tab') {
        trapFocusWithin(photoLightbox, event);
      }
    });
  }

  setGuestUploaderState(uploadControlsAvailable && isGalleryWindowOpen());
  loadGuestPhotos();
}

function initDeferredSections() {
  const gallerySection = document.getElementById('foto-invitati');
  const canObserve = typeof IntersectionObserver !== 'undefined';
  const galleryVisible = getWeddingPhase() !== 'pre';

  if (!canObserve) {
    if (galleryVisible) initGuestGallery();
    return;
  }

  if (gallerySection && galleryVisible) {
    const galleryObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          void initGuestGallery();
          observer.disconnect();
        });
      },
      { rootMargin: '420px 0px 260px 0px', threshold: 0.01 }
    );
    galleryObserver.observe(gallerySection);
  } else if (galleryVisible) {
    void initGuestGallery();
  }
}

function initDetailsAutoRefresh() {
  if (!document.getElementById('dettagli')) return;
  window.setInterval(() => {
    window.location.reload();
  }, DETAILS_AUTO_REFRESH_MS);
}

window.addEventListener('DOMContentLoaded', () => {
  applyGalleryAvailabilityRules();
  initInteractiveMotion();
  initHomepageEasterEgg();
  initProgramCalendarCta();
  initIbanDisplay();
  initIbanCopy();
  hydrateMapLinks();
  initMapLinkClicks();
  initLazyMapEmbeds();
  initDeferredSections();
  initDetailsAutoRefresh();
});

if (typeof REDUCED_MOTION_QUERY.addEventListener === 'function') {
  REDUCED_MOTION_QUERY.addEventListener('change', () => {
    if (isReducedMotionPreferred()) {
      detachParallaxListener();
      document.querySelectorAll('.reveal-item').forEach((node) => {
        node.classList.add('is-visible');
      });
      if (heroPhoto) heroPhoto.style.transform = '';
    } else {
      initInteractiveMotion();
    }
  });
}
