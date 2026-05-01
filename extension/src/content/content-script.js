(function () {
  'use strict';

  function extractSnippet() {
    const parts = [];
    const selectors = [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ];

    for (const selector of selectors) {
      const content = document.querySelector(selector)?.getAttribute('content');
      if (content) parts.push(content);
    }

    for (const selector of ['h1', 'article h2', 'main h2', '[role="main"] h2']) {
      const text = document.querySelector(selector)?.textContent;
      if (text) parts.push(text);
    }

    const el = document.querySelector('main, article, [role="main"]');
    const bodyText = (el || document.body).innerText ?? '';
    if (bodyText) parts.push(bodyText);

    return [...new Set(parts.map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean))]
      .join(' • ')
      .slice(0, 700);
  }

  function isVisibleVideo(video) {
    const rect = video.getBoundingClientRect();
    return rect.width >= 80 && rect.height >= 45;
  }

  function videoArea(video) {
    const rect = video.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function isPlaying(video) {
    return !video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }

  // Returns true if a video is actively playing, false if video exists but is
  // paused, and null if the page has no meaningful video element.
  function isVideoPlaying() {
    const videos = [...document.querySelectorAll('video')];
    if (videos.length === 0) return null;

    const visibleVideos = videos.filter(isVisibleVideo);
    if (visibleVideos.length > 0) {
      const primaryVideo = visibleVideos.sort((a, b) => videoArea(b) - videoArea(a))[0];
      return isPlaying(primaryVideo);
    }

    return videos.some(isPlaying);
  }

  function buildInfo() {
    return {
      url: location.href,
      title: document.title,
      snippet: extractSnippet(),
      videoPlaying: isVideoPlaying(), // true | false | null (no video)
    };
  }

  // Respond to GET_INFO requests from the service worker.
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'GET_INFO') {
      respond(buildInfo());
    }
  });

  // --- Video play/pause detection ---

  const attachedVideos = new WeakSet();

  function attachVideoListeners(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);

    video.addEventListener('play', () => {
      chrome.runtime.sendMessage({ type: 'VIDEO_PLAYING' }).catch(() => {});
    });
    video.addEventListener('pause', () => {
      chrome.runtime.sendMessage({ type: 'VIDEO_PAUSED' }).catch(() => {});
    });
  }

  function scanVideos() {
    document.querySelectorAll('video').forEach(attachVideoListeners);
  }

  scanVideos();

  // Watch for dynamically inserted video elements (YouTube injects the player lazily).
  const videoObserver = new MutationObserver(scanVideos);
  videoObserver.observe(document.body, { childList: true, subtree: true });

  // --- Title / SPA navigation ---

  let currentTitle = document.title;

  function onTitleChange() {
    if (document.title !== currentTitle) {
      currentTitle = document.title;
    }
  }

  function observeTitle(titleEl) {
    const obs = new MutationObserver(onTitleChange);
    obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return obs;
  }

  let titleEl = document.querySelector('title');
  let titleObserver = titleEl ? observeTitle(titleEl) : null;

  const headObserver = new MutationObserver(() => {
    const newTitle = document.querySelector('title');
    if (newTitle && newTitle !== titleEl) {
      if (titleObserver) titleObserver.disconnect();
      titleEl = newTitle;
      titleObserver = observeTitle(titleEl);
      onTitleChange();
    }
  });

  if (document.head) {
    headObserver.observe(document.head, { childList: true });
  }
})();
