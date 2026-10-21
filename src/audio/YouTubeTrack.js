// NOCTURNE RHYTHM — YouTube / YouTube Music track source (better17)
// Static-hosting friendly: uses the official YouTube IFrame Player API.
// The audio cannot be routed through Web Audio (CORS), so beat sync comes
// from a tap-calibration phase in main.js (see startCalibration there):
// the player taps the kick during a short listening window, we derive
// BPM + phase and synthesize the kick grid from it.

const YT_API_SRC = 'https://www.youtube.com/iframe_api';

// Extract an 11-char video id from any common YouTube / YT Music URL form:
// youtube.com/watch?v=ID, youtu.be/ID, music.youtube.com/watch?v=ID,
// /shorts/ID, /embed/ID, /live/ID. Returns '' when nothing found.
export function parseYouTubeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Bare 11-char id pasted directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  let u = null;
  try {
    u = new URL(s.startsWith('http') ? s : 'https://' + s);
  } catch (_) {
    return '';
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (
    host !== 'youtube.com' && host !== 'm.youtube.com' &&
    host !== 'music.youtube.com' && host !== 'youtu.be' &&
    host !== 'youtube-nocookie.com'
  ) return '';
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && parts[0]) return parts[0].slice(0, 11);
  const v = u.searchParams.get('v');
  if (v && /^[a-zA-Z0-9_-]{6,16}$/.test(v)) return v.slice(0, 11);
  const idx = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].slice(0, 11);
  return '';
}

let apiPromise = null;

function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve();
    };
    const s = document.createElement('script');
    s.src = YT_API_SRC;
    s.async = true;
    s.onerror = () => reject(new Error('Не удалось загрузить YouTube-плеер. Проверь интернет / блокировщики.'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube-плеер не отвечает.')), 15000);
  });
  return apiPromise;
}

export class YouTubeTrack {
  constructor() {
    this.player = null;
    this.ready = false;
    this.videoId = '';
    this.title = '';
    this.duration = 0;
    this.onState = null; // (state) => void, YT state codes
    this._lastTime = 0;
    this._lastPerf = 0;
  }

  /**
   * Create the hidden iframe player and wait until metadata is playable.
   * Resolves with { title, duration }.
   */
  async load(videoId) {
    await loadYouTubeApi();
    this.videoId = videoId;
    if (this.player) {
      try { this.player.destroy(); } catch (_) {}
      this.player = null;
    }
    const holder = document.getElementById('yt-holder');
    if (!holder) throw new Error('Нет контейнера для YouTube-плеера.');
    holder.innerHTML = '<div id="yt-embed"></div>';

    const created = await new Promise((resolve, reject) => {
      let settled = false;
      const to = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('YouTube не открыл видео (недоступно/платное?).')); }
      }, 20000);
      this.player = new window.YT.Player('yt-embed', {
        videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0 },
        events: {
          onReady: () => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            resolve(this.player);
          },
          onError: () => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            reject(new Error('YouTube не может воспроизвести это видео (скрыто/возрастное ограничение).'));
          },
          onStateChange: (e) => {
            if (this.onState) this.onState(e.data);
          }
        }
      });
    });

    this.ready = true;
    // Poll until metadata (duration) arrives
    for (let i = 0; i < 60; i++) {
      const d = this.getDuration();
      if (d > 0) {
        this.duration = d;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      const vd = this.player.getVideoData ? this.player.getVideoData() : null;
      this.title = (vd && vd.title) || '';
    } catch (_) {}
    return { title: this.title, duration: this.duration };
  }

  getTime() {
    if (!this.player || !this.ready) return this._estimate();
    const t = this.player.getCurrentTime ? this.player.getCurrentTime() : 0;
    const now = performance.now();
    if (Math.abs(t - this._lastTime) > 0.001) {
      this._lastTime = t;
      this._lastPerf = now;
    }
    return t;
  }

  // Smooth interpolation between YT's quantized time polls
  _estimate() {
    return this._lastTime + (performance.now() - this._lastPerf) / 1000;
  }

  getDuration() {
    try {
      return this.player && this.player.getDuration ? this.player.getDuration() : 0;
    } catch (_) {
      return 0;
    }
  }

  getState() {
    try {
      return this.player && this.player.getPlayerState ? this.player.getPlayerState() : -1;
    } catch (_) {
      return -1;
    }
  }

  isEnded() {
    return this.getState() === 0;
  }

  setVolume(percent) {
    try {
      if (this.player && this.player.setVolume) this.player.setVolume(Math.max(0, Math.min(100, percent)));
    } catch (_) {}
  }

  seekPlay(offsetSec) {
    if (!this.player || !this.ready) return;
    try {
      this.player.seekTo(Math.max(0, offsetSec), true);
      this.player.playVideo();
    } catch (_) {}
  }

  play() {
    try { if (this.player) this.player.playVideo(); } catch (_) {}
  }

  pause() {
    try { if (this.player) this.player.pauseVideo(); } catch (_) {}
  }

  stop() {
    try {
      if (this.player) {
        this.player.pauseVideo();
        this.player.seekTo(0, true);
      }
    } catch (_) {}
  }

  destroy() {
    try { if (this.player) this.player.destroy(); } catch (_) {}
    this.player = null;
    this.ready = false;
  }
}
