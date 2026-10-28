// Fixture driver: plays a scenario (classes, ad UI, badge text, media src) on a timeline.
// Plain JS so it runs unchanged in real browsers (e2e, manual) and under happy-dom (unit tests).
// The page under test picks its scenario with <body data-scenario="…">. Add ?autoplay=1 to
// the URL to start it on load; otherwise call `AdFixture.run()`. <body data-player-api> also
// gives the player root a minimal getVideoData() that reports the URL's ?v= as the video id,
// so the extension's MAIN-world bridge has something to read.
//
// It also records what the extension does to the <video> (rate, mute, crash marker), with
// timestamps, in `AdFixture.log`.
(function (global) {
  'use strict';
  const doc = global.document;
  const MEDIA = '/__fixtures/media/clip.mp4';
  const log = [];
  const note = (what, value) => log.push({ t: global.performance.now(), what, value });
  const $ = (selector) => doc.querySelector(selector);
  const root = () => $('#movie_player') || $('.html5-video-player');
  const video = () => $('video');
  const adModule = () => $('.video-ads');
  const sleep = (ms) => new Promise((resolve) => global.setTimeout(resolve, ms));

  function adMarkup(index, total, countdown) {
    return (
      '<div class="ytp-ad-player-overlay-layout">' +
      '<span class="ytp-ad-badge__text">Ad ' +
      index +
      ' of ' +
      total +
      '</span>' +
      '<span class="ytp-ad-duration-remaining">' +
      countdown +
      '</span>' +
      '<div class="ytp-skip-ad"><button type="button">Skip</button></div>' +
      '</div>'
    );
  }

  /** Every action a scenario can take. Writes here play the role of YouTube or the user. */
  const actions = {
    src(name) {
      video().src = MEDIA + '?' + name;
      note('src', name);
    },
    play() {
      const p = video().play && video().play();
      if (p && p.catch) p.catch(() => undefined);
    },
    userRate(rate) {
      video().playbackRate = rate;
      note('user-rate', rate);
    },
    adStart(arg) {
      root().classList.add('ad-showing');
      adModule().innerHTML = adMarkup(arg.index, arg.total, arg.countdown || '0:05');
      note('ad-showing', arg);
    },
    countdown(text) {
      const el = $('.ytp-ad-duration-remaining');
      if (el) el.textContent = text;
      note('countdown', text);
    },
    /** The class flicker between pod ads: ad-showing and the ad UI drop for a moment. */
    flicker() {
      root().classList.remove('ad-showing');
      adModule().replaceChildren();
      note('flicker');
    },
    adEnd() {
      root().classList.remove('ad-showing');
      adModule().replaceChildren();
      note('ad-end');
    },
    /** Resolves once content has played past `seconds` (or after 5 s). */
    waitForPlayback(seconds) {
      const v = video();
      const started = global.performance.now();
      return new Promise((resolve) => {
        const check = () => {
          if (v.currentTime >= seconds || global.performance.now() - started > 5000) {
            note('content-playing', v.currentTime);
            resolve();
          } else {
            global.setTimeout(check, 50);
          }
        };
        check();
      });
    },
    done() {
      note('done');
    },
  };

  /** [delay before the step in ms, action, argument]. */
  const scenarios = {
    // Pre-roll pod of 2 with class flicker between the ads; user watches at 1.5x.
    'ad-pod': [
      [0, 'src', 'ad1'],
      [0, 'userRate', 1.5],
      [0, 'play'],
      [300, 'adStart', { index: 1, total: 2 }],
      [1000, 'flicker'],
      [0, 'src', 'ad2'],
      [150, 'adStart', { index: 2, total: 2 }],
      [1000, 'adEnd'],
      [0, 'src', 'content'],
      [1200, 'done'],
    ],
    // Server-side stitched ad: no src change; the countdown reaches 0 before ad-showing clears.
    ssai: [
      [0, 'src', 'content'],
      [0, 'userRate', 1.25],
      [0, 'play'],
      [0, 'waitForPlayback', 1.3],
      [100, 'adStart', { index: 1, total: 1, countdown: '0:02' }],
      [500, 'countdown', '0:01'],
      [500, 'countdown', '0:00'],
      [600, 'adEnd'],
      [800, 'done'],
    ],
    // Stitched pre-roll: no src swap and the content src is never learned (the ad starts
    // before 1 s of content). Only the bridge's video id can tell it is in the content stream.
    'ssai-preroll': [
      [0, 'src', 'content'],
      [0, 'userRate', 1.25],
      [0, 'play'],
      [300, 'adStart', { index: 1, total: 1, countdown: '0:02' }],
      [500, 'countdown', '0:01'],
      [500, 'countdown', '0:00'],
      [600, 'adEnd'],
      [800, 'done'],
    ],
    // Mid-roll on a live stream: mute only, never a rate boost.
    live: [
      [0, 'src', 'content'],
      [0, 'play'],
      [300, 'adStart', { index: 1, total: 1 }],
      [1000, 'adEnd'],
      [800, 'done'],
    ],
  };

  function record() {
    const v = video();
    v.addEventListener('ratechange', () => note('rate', v.playbackRate));
    v.addEventListener('volumechange', () => note('muted', v.muted));
    new global.MutationObserver(() =>
      note('marker', v.hasAttribute('data-adspeeder-boosted')),
    ).observe(v, { attributes: true, attributeFilter: ['data-adspeeder-boosted'] });
  }

  function installPlayerApi() {
    const id = new global.URLSearchParams(global.location.search).get('v');
    root().getVideoData = () => ({ video_id: id, isLive: false });
  }

  const scenarioName = doc.body.dataset.scenario;
  const steps = scenarios[scenarioName] || [];

  global.AdFixture = {
    log,
    scenario: scenarioName,
    steps,
    actions,
    /** Runs one step without its delay (unit tests drive time themselves). */
    step(i) {
      const [, action, arg] = steps[i];
      return actions[action](arg);
    },
    /** Plays the whole timeline in real time; resolves when it is done. */
    async run() {
      for (const [delay, action, arg] of steps) {
        if (delay > 0) await sleep(delay);
        await actions[action](arg);
      }
      return log;
    },
  };

  record();
  if (doc.body.hasAttribute('data-player-api')) installPlayerApi();
  if (/[?&]autoplay=1\b/.test(global.location.search)) void global.AdFixture.run();
})(window);
