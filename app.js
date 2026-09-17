(() => {
  'use strict';

  const cards = [
    { id: 'virgo-cake', title: 'VIRGO BIRTHDAY CAKE', mode: 'holo', src: './cards/virgo/index.html?rev=20260917-collection&embed=archive' },
    {
      id: 'bird-meerkat',
      title: 'BIRD / MEERKAT',
      mode: 'lenticular',
      src: './cards/bird/index.html?rev=20260917-collection&embed=archive',
    },
    { id: 'tiger-holo', title: 'TIGER HOLO', mode: 'holo', src: './cards/tiger/index.html?rev=20260917-collection&embed=archive' },
    { id: 'feathered-portrait', title: 'FEATHERED PORTRAIT', mode: 'holo', src: './cards/feathered/index.html?rev=20260917-collection&embed=archive' },
    { id: 'chick-zan', title: 'CHICK · ZAN!', mode: 'holo', src: './cards/chick/index.html?rev=20260917-collection&embed=archive' },
    { id: 'niulai-mama', title: 'NIULAI · MAMA~', mode: 'holo', src: './cards/mama/index.html?rev=20260917-collection&embed=archive' },
    { id: 'bubbly', title: 'BUBBLY', mode: 'holo', src: './cards/bubbly/index.html?rev=20260917-collection&embed=archive' },
    { id: 'milk-dragon', title: 'MILK DRAGON · BOBO', mode: 'holo', src: './cards/milk-dragon/index.html?rev=20260917-collection&embed=archive' },
    { id: 'mech-web', title: 'MECH WEB', mode: 'holo', src: './cards/mech-web/index.html?rev=20260917-collection&embed=archive' },
    { id: 'inverted-strike', title: 'INVERTED STRIKE', mode: 'holo', src: './cards/inverted-strike/index.html?rev=20260917-collection&embed=archive' },
  ];

  const frameStack = document.querySelector('#frame-stack');
  const loading = document.querySelector('#frame-loading');
  const progress = document.querySelector('#loading-progress');
  const progressFill = document.querySelector('#loading-progress-fill');
  const progressValue = document.querySelector('#loading-value');
  const progressStage = document.querySelector('#loading-stage');
  const title = document.querySelector('#card-name');
  const position = document.querySelector('#card-position');
  const previous = document.querySelector('#previous');
  const next = document.querySelector('#next');
  const preloadJobs = new Map();
  const frameCache = new Map();
  const MAX_FRAME_CACHE = 2;
  let activeIndex = 0;
  let activeFrameState = null;
  let navigationSerial = 0;
  let displayedProgress = 0;

  const wrapIndex = (index) => (index % cards.length + cards.length) % cards.length;

  const indexFromUrl = () => {
    const id = new URLSearchParams(window.location.search).get('card');
    const index = cards.findIndex((card) => card.id === id);
    return index >= 0 ? index : 0;
  };

  const updateUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('card', cards[activeIndex].id);
    window.history.replaceState(null, '', url);
  };

  const setLoadingProgress = (value, stage) => {
    displayedProgress = Math.max(displayedProgress, Math.min(100, Math.max(0, value)));
    const rounded = Math.round(displayedProgress);
    progressFill.style.width = `${rounded}%`;
    progressValue.value = `${rounded}%`;
    progress.setAttribute('aria-valuenow', String(rounded));
    if (stage) progressStage.textContent = stage;
  };

  const resetLoadingProgress = () => {
    displayedProgress = 0;
    progressFill.style.width = '0%';
    progressValue.value = '0%';
    progress.setAttribute('aria-valuenow', '0');
    progressStage.textContent = 'DISCOVERING CARD';
  };

  const fetchResource = async (url, onProgress = () => {}) => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body || !total) {
      await response.arrayBuffer();
      onProgress(1);
      return;
    }
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      onProgress(Math.min(1, received / total));
    }
    onProgress(1);
  };

  const runPool = async (resources, workerCount, worker) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(workerCount, resources.length) }, async () => {
      while (cursor < resources.length) {
        const index = cursor;
        cursor += 1;
        await worker(resources[index], index);
      }
    });
    await Promise.all(runners);
  };

  const preloadCard = (card, listener) => {
    let job = preloadJobs.get(card.id);
    if (job) {
      if (listener) {
        job.listeners.add(listener);
        listener(job.progress, job.stage);
      }
      return job.promise;
    }

    job = { progress: 0, stage: 'DISCOVERING CARD', listeners: new Set(listener ? [listener] : []) };
    const notify = (value, stage) => {
      job.progress = Math.max(job.progress, value);
      job.stage = stage || job.stage;
      for (const callback of job.listeners) callback(job.progress, job.stage);
    };

    job.promise = (async () => {
      try {
        const cardUrl = new URL(card.src, window.location.href);
        const configUrl = new URL('./card-config.json', cardUrl);
        const [pageResponse, configResponse] = await Promise.all([
          fetch(cardUrl, { cache: 'force-cache' }),
          fetch(configUrl, { cache: 'force-cache' }),
        ]);
        if (!pageResponse.ok || !configResponse.ok) throw new Error(`Unable to preload ${card.id}`);
        const [pageMarkup, config] = await Promise.all([pageResponse.text(), configResponse.json()]);
        notify(18, 'READING MANIFEST');

        const pageDocument = new DOMParser().parseFromString(pageMarkup, 'text/html');
        const resourceUrls = new Set();
        pageDocument.querySelectorAll('script[src], link[href]').forEach((element) => {
          const value = element.getAttribute('src') || element.getAttribute('href');
          if (value && !value.startsWith('data:')) resourceUrls.add(new URL(value, cardUrl).href);
        });
        Object.values(config.assets || {}).forEach((value) => {
          if (typeof value === 'string') resourceUrls.add(new URL(value, configUrl).href);
        });
        if (typeof config.backImage === 'string') resourceUrls.add(new URL(config.backImage, configUrl).href);
        (card.preload || []).forEach((value) => resourceUrls.add(new URL(value, window.location.href).href));

        const resources = [...resourceUrls];
        if (!resources.length) {
          notify(86, 'ASSETS CACHED');
          return;
        }
        const resourceProgress = new Array(resources.length).fill(0);
        const updateAssetProgress = () => {
          const total = resourceProgress.reduce((sum, value) => sum + value, 0) / resources.length;
          notify(18 + total * 68, `LOADING ASSETS ${Math.floor(total * resources.length)} / ${resources.length}`);
        };
        await runPool(resources, 3, async (url, index) => {
          try {
            await fetchResource(url, (value) => {
              resourceProgress[index] = value;
              updateAssetProgress();
            });
          } catch (error) {
            console.warn('Preload skipped:', error);
            resourceProgress[index] = 1;
            updateAssetProgress();
          }
        });
        notify(86, 'ASSETS CACHED');
      } catch (error) {
        console.warn('Card preload fallback:', error);
        notify(86, 'OPENING CARD');
      }
    })();

    preloadJobs.set(card.id, job);
    return job.promise;
  };

  const attachFrameKeyboard = (cardFrame) => {
    const frameDocument = cardFrame.contentDocument;
    if (!frameDocument) return;
    frameDocument.addEventListener('keydown', (event) => {
      if (!event.altKey || previous.disabled) return;
      if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
      if (event.key === 'ArrowRight') goTo(activeIndex + 1);
    }, true);
  };

  const applyFrameShowcase = (cardFrame, card) => {
    const frameDocument = cardFrame.contentDocument;
    if (!frameDocument || !card) return Promise.resolve();
    frameDocument.documentElement.classList.add('showcase-card');
    if (frameDocument.querySelector('[data-gallery-showcase]')) return Promise.resolve();
    const stylesheet = frameDocument.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL(`./showcase-${card.mode}.css?rev=20260917-collection`, window.location.href).href;
    stylesheet.dataset.galleryShowcase = '';
    return new Promise((resolve) => {
      let finished = false;
      const revealWhenReady = () => {
        if (finished) return;
        finished = true;
        requestAnimationFrame(resolve);
      };
      stylesheet.addEventListener('load', revealWhenReady, { once: true });
      stylesheet.addEventListener('error', revealWhenReady, { once: true });
      window.setTimeout(revealWhenReady, 600);
      frameDocument.head.append(stylesheet);
    });
  };

  const waitForCardRender = (cardFrame) => new Promise((resolve) => {
    const deadline = performance.now() + 6000;
    const check = () => {
      const frameDocument = cardFrame.contentDocument;
      const runtime = cardFrame.contentWindow?.__holo || cardFrame.contentWindow?.__lenticular;
      const hasCanvas = Boolean(frameDocument?.querySelector('canvas'));
      const stillLoading = Boolean(frameDocument?.querySelector('#loading'));
      if (runtime?.ready || (hasCanvas && !stillLoading)) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        resolve();
        return;
      }
      window.setTimeout(check, 80);
    };
    check();
  });

  const touchFrameCache = (cardId, state) => {
    frameCache.delete(cardId);
    frameCache.set(cardId, state);
  };

  const trimFrameCache = () => {
    while (frameCache.size > MAX_FRAME_CACHE) {
      const candidate = [...frameCache.entries()].find(([, state]) => state !== activeFrameState);
      if (!candidate) return;
      const [cardId, state] = candidate;
      state.frame.remove();
      frameCache.delete(cardId);
    }
  };

  const createCardFrame = (card, showInitialLoader) => {
    const cardFrame = document.createElement('iframe');
    cardFrame.className = 'card-frame';
    cardFrame.title = `${card.title} 卡片`;
    cardFrame.setAttribute('allow', 'fullscreen');
    cardFrame.setAttribute('allowtransparency', 'true');
    cardFrame.loading = 'eager';
    const state = { card, frame: cardFrame, ready: false, promise: null };
    state.promise = new Promise((resolve) => {
      cardFrame.addEventListener('load', async () => {
        if (showInitialLoader) setLoadingProgress(92, 'CALIBRATING MATERIAL');
        await applyFrameShowcase(cardFrame, card);
        await waitForCardRender(cardFrame);
        state.ready = true;
        cardFrame.classList.add('is-ready');
        attachFrameKeyboard(cardFrame);
        resolve(state);
      }, { once: true });
    });
    cardFrame.src = card.src;
    frameStack.append(cardFrame);
    touchFrameCache(card.id, state);
    return state;
  };

  const activateFrame = (state) => {
    if (activeFrameState && activeFrameState !== state) activeFrameState.frame.classList.remove('is-active');
    state.frame.classList.add('is-ready', 'is-active');
    activeFrameState = state;
    touchFrameCache(state.card.id, state);
    trimFrameCache();
  };

  const preloadNeighbors = () => {
    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 500));
    schedule(() => preloadCard(cards[wrapIndex(activeIndex + 1)]), { timeout: 1200 });
    window.setTimeout(() => schedule(() => preloadCard(cards[wrapIndex(activeIndex - 1)]), { timeout: 1600 }), 1400);
  };

  const goTo = async (requestedIndex) => {
    const serial = ++navigationSerial;
    activeIndex = wrapIndex(requestedIndex);
    const card = cards[activeIndex];
    const firstDisplay = !activeFrameState;
    title.textContent = card.title;
    position.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    document.documentElement.dataset.cardMode = card.mode;
    previous.disabled = true;
    next.disabled = true;
    updateUrl();

    const cachedFrame = frameCache.get(card.id);
    if (cachedFrame?.ready) {
      activateFrame(cachedFrame);
      loading.classList.add('is-hidden');
      previous.disabled = false;
      next.disabled = false;
      preloadNeighbors();
      return;
    }

    if (firstDisplay) {
      resetLoadingProgress();
      loading.classList.remove('is-hidden');
    } else {
      loading.classList.add('is-hidden');
    }

    await preloadCard(card, firstDisplay ? (value, stage) => {
      if (serial === navigationSerial) setLoadingProgress(value, stage);
    } : undefined);
    if (serial !== navigationSerial) return;
    if (firstDisplay) setLoadingProgress(89, 'INITIALIZING VIEWER');

    const state = frameCache.get(card.id) || createCardFrame(card, firstDisplay);
    await state.promise;
    if (serial !== navigationSerial) return;
    activateFrame(state);
    if (firstDisplay) {
      setLoadingProgress(100, 'READY');
      window.setTimeout(() => loading.classList.add('is-hidden'), 180);
    }
    previous.disabled = false;
    next.disabled = false;
    preloadNeighbors();
  };

  previous.addEventListener('click', () => goTo(activeIndex - 1));
  next.addEventListener('click', () => goTo(activeIndex + 1));
  window.addEventListener('keydown', (event) => {
    if (!event.altKey || previous.disabled) return;
    if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
    if (event.key === 'ArrowRight') goTo(activeIndex + 1);
  });

  window.__archive = {
    cards,
    goTo,
    getState: () => ({
      activeIndex,
      card: cards[activeIndex],
      progress: Math.round(displayedProgress),
      ready: Boolean(activeFrameState?.ready),
      visibleCard: activeFrameState?.card.id || null,
      frameCache: [...frameCache.keys()],
      cachedAssets: [...preloadJobs.entries()].filter(([, job]) => job.progress >= 86).map(([id]) => id),
    }),
  };

  goTo(indexFromUrl());
})();
