(function () {
  'use strict';

  function extractSnippet() {
    const el = document.querySelector('main, article, [role="main"]');
    const text = (el || document.body).innerText ?? '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  // Returns true if any video on the page is actively playing.
  function isVideoPlaying() {
    const videos = [...document.querySelectorAll('video')].filter(v => v.duration > 0);
    if (videos.length === 0) return null; // no video present
    return videos.some(v => !v.paused && !v.ended);
  }

  function buildInfo() {
    return {
      type: 'TAB_INFO',
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

  // Push TAB_INFO proactively on load.
  chrome.runtime.sendMessage(buildInfo()).catch(() => {});

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
      chrome.runtime.sendMessage(buildInfo()).catch(() => {});
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
