import { BeatDetector } from './audio/BeatDetector.js';
import { BeatJudge } from './audio/BeatJudge.js';
import { MenuMusic } from './audio/MenuMusic.js';
import { GLContext } from './render/GLContext.js';
import { ParticleSystem } from './render/ParticleSystem.js';
import { sketchVertexShader } from './shaders/sketch.vert.js';
import { sketchFragmentShader } from './shaders/sketch.frag.js';
import { Player } from './game/Player.js';
import { World } from './game/World.js';
import { StoreManager } from './game/StoreManager.js';
import { NetClient } from './game/NetClient.js';
import { YouTubeTrack, parseYouTubeUrl } from './audio/YouTubeTrack.js';
import {
  LyricsTrack,
  parseId3Tags,
  guessFromFilename,
  cleanVideoTitle,
  fetchLyrics
} from './audio/LyricsEngine.js';
import { P, THEMES, applyTheme, themeAccentVec } from './render/Theme.js';

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;
const MP_START_DELAY = 3600;

class GameApp {
  constructor() {
    this.glCanvas = document.getElementById('gl-canvas');
    this.sceneCanvas = document.createElement('canvas');
    this.sceneCtx = this.sceneCanvas.getContext('2d');

    this.store = new StoreManager();
    this.glCtx = new GLContext(this.glCanvas);
    this.audio = new BeatDetector();
    this.judge = new BeatJudge();
    this.menuMusic = new MenuMusic();
    this.particles = new ParticleSystem();
    this.net = new NetClient();
    this.netReady = false;

    this.world = new World(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.player = new Player(190, this.world.groundY - 54);
    this.player.setSkin(this.store.data.equippedSkin);
    this.player.setEquippedItem(this.store.data.equippedItem);
    this.player.isGrounded = true;

    // better18: song lyrics on the background
    this.lyrics = new LyricsTrack();
    this.world.lyrics = this.lyrics;

    // Apply saved settings: visual theme, particle quality, camera shake
    this.settings = this.store.data.settings;
    this.themeId = THEMES[this.settings.theme] ? this.settings.theme : 'ink';
    applyTheme(this.themeId);
    this.particles.setQuality(this.settings.quality);
    this.world.setQuality(this.settings.quality);
    this.world.shakeEnabled = !!this.settings.shake;
    this.world.glowEnabled = this.settings.quality !== 'low';
    this.world.lyricsEnabled = this.settings.lyrics !== false;
    const lyricsBtn = document.getElementById('btn-toggle-lyrics');
    if (lyricsBtn) lyricsBtn.textContent = this.world.lyricsEnabled ? 'ВКЛ' : 'ВЫКЛ';

    // better19: cached hot DOM refs — the loop runs 60fps, no repeated lookups
    this.dom = {
      score: document.getElementById('score-val'),
      combo: document.getElementById('combo-val'),
      coins: document.getElementById('hud-coins-val'),
      beat: document.getElementById('beat-indicator'),
      banner: document.getElementById('finale-banner'),
      vsPanel: document.getElementById('vs-panel'),
      vsMy: document.getElementById('vs-my-score'),
      vsPeer: document.getElementById('vs-peer-score'),
      vsCrownMy: document.getElementById('vs-crown-my'),
      vsCrownPeer: document.getElementById('vs-crown-peer')
    };

    // better19: adaptive resolution governor — keeps 60fps on weak GPUs by
    // scaling the internal render buffers (CSS keeps the canvas fullscreen).
    // Fixes the heavy-theme stutter regardless of device/GPU.
    this.renderScale = 1.0;
    this._frameAvg = 16.7;
    this._frameTimer = 0;
    this._scaleCooldown = 0;
    this._fading = false;
    this._toastTimer = null;

    this.lastTime = 0;
    this.beatPulse = 0;
    this.beatPhase = 0;
    this.snareEnergy = 0;
    this.silenceEffect = 0;
    this.recentEnergyAvg = 0.15;
    this.combo = 0;
    this.maxCombo = 0;
    this.runCoins = 0;
    this.bpmCoinMult = 1.0;
    this.isGameOver = false;
    this.isPlayingTrack = false;
    this.menuMusicEnabled = true;

    // better20: spectate camera (after death in a duel)
    this.spectating = false;
    this.cam = { zoom: 1.0, tz: 1.0 };

    // End-of-track finale state
    this.finale = 0;
    this.riserPlayed = false;
    this.riserNodes = [];

    // better17: TRACK CLEAR blast — grand finale at the exact end of the track
    this.blastStarted = false;
    this.blastT = 0;
    this.blastVolley = 0;

    // better17: track source — 'file' (local audio) or 'yt' (YouTube / YT Music link)
    this.trackSource = 'file';
    this.yt = null;
    this.ytLoading = false;
    this.ytReady = false;
    this.calib = null;

    this._vsCache = { my: -1, peer: -1 };

    // Pause state: 'none' | 'local' (I minimized) | 'peer' (partner minimized)
    this.pauseState = 'none';
    this.countdownTimer = null;

    this.mp = {
      active: false,
      isHost: false,
      code: '',
      ready: false,
      pendingStartMs: 0,
      peer: { y: this.world.groundY - 54, g: true, f: false, s: 0, c: 0, co: 0, st: 'wait' },
      lastSend: 0,
      overSent: false,
      resolved: false,
      iFinished: false
    };

    this.initGL();
    this.resize();
    this.renderShopUI();
    this.renderThemeCards();
    this.applyTitleCollapse();
    this.setupMenuTabs();
    this.setupEvents();
    this.setupNet();

    requestAnimationFrame((t) => this.loop(t));
  }

  initGL() {
    this.program = this.glCtx.createProgram(sketchVertexShader, sketchFragmentShader);
    this.glCtx.initScreenQuad();
    this.texture = this.glCtx.createTexture();

    this.uTime = this.glCtx.gl.getUniformLocation(this.program, 'u_time');
    this.uResolution = this.glCtx.gl.getUniformLocation(this.program, 'u_resolution');
    this.uBeatPulse = this.glCtx.gl.getUniformLocation(this.program, 'u_beatPulse');
    this.uKickEnergy = this.glCtx.gl.getUniformLocation(this.program, 'u_kickEnergy');
    this.uBiomeProgress = this.glCtx.gl.getUniformLocation(this.program, 'u_biomeProgress');
    this.uStyle = this.glCtx.gl.getUniformLocation(this.program, 'u_style');
    this.uFinale = this.glCtx.gl.getUniformLocation(this.program, 'u_finale');
    this.uAccent = this.glCtx.gl.getUniformLocation(this.program, 'u_accent');
    this.uInk = this.glCtx.gl.getUniformLocation(this.program, 'u_ink');
    this.uCrimson = this.glCtx.gl.getUniformLocation(this.program, 'u_crimson');
    this.uSceneTexture = this.glCtx.gl.getUniformLocation(this.program, 'u_sceneTexture');
  }

  resize() {
    // better19: renderScale = adaptive resolution factor (1.0 -> 0.6)
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0) * (this.renderScale || 1);
    const w = Math.max(320, Math.floor(window.innerWidth * dpr));
    const h = Math.max(240, Math.floor(window.innerHeight * dpr));

    this.glCanvas.width = w;
    this.glCanvas.height = h;
    this.sceneCanvas.width = w;
    this.sceneCanvas.height = h;
    this.glCtx.gl.viewport(0, 0, w, h);
  }

  renderShopUI() {
    document.getElementById('menu-coins-val').textContent = this.store.data.coins;

    const skinContainer = document.getElementById('skin-selector');
    skinContainer.innerHTML = '';
    for (const skin of this.store.skinsCatalog) {
      const isUnlocked = this.store.data.unlockedSkins.includes(skin.id);
      const isEquipped = this.store.data.equippedSkin === skin.id;
      const card = document.createElement('div');
      card.className = `skin-card ${isEquipped ? 'active' : ''}`;
      card.innerHTML = `
        <div class="skin-emblem">${skin.badge}</div>
        <span>${skin.name}</span>
        <div class="price-tag">${isEquipped ? 'НАДЕТО' : (isUnlocked ? 'ОТКРЫТО' : `${skin.price} МОНЕТ`)}</div>
      `;
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const res = this.store.buyOrEquipSkin(skin.id);
        if (res.status === 'equipped' || res.status === 'purchased') {
          this.player.setSkin(skin.id);
          this.renderShopUI();
        }
      });
      skinContainer.appendChild(card);
    }

    const itemContainer = document.getElementById('item-selector');
    itemContainer.innerHTML = '';
    for (const item of this.store.itemsCatalog) {
      const isUnlocked = this.store.data.unlockedItems.includes(item.id);
      const isEquipped = this.store.data.equippedItem === item.id;
      const card = document.createElement('div');
      card.className = `skin-card ${isEquipped ? 'active' : ''}`;
      card.title = item.desc;
      card.innerHTML = `
        <span style="font-size: 11px;">${item.name}</span>
        <div class="price-tag">${isEquipped ? 'АКТИВНО' : (isUnlocked ? 'ОТКРЫТО' : `${item.price} МОНЕТ`)}</div>
      `;
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const res = this.store.buyOrEquipItem(item.id);
        if (res.status === 'equipped' || res.status === 'purchased') {
          this.player.setEquippedItem(item.id);
          this.renderShopUI();
        }
      });
      itemContainer.appendChild(card);
    }
  }

  // ---------------- Theme & settings UI ----------------

  renderThemeCards() {
    const grid = document.getElementById('theme-grid');
    grid.innerHTML = '';
    for (const t of Object.values(THEMES)) {
      const card = document.createElement('div');
      card.className = `theme-card ${this.themeId === t.id ? 'active' : ''}`;
      const sw = t.swatches.map((c) => `<div class="sw" style="background:${c}"></div>`).join('');
      card.innerHTML = `<div class="swatches">${sw}</div><div class="theme-name">${t.name}</div>`;
      card.title = t.desc;
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setTheme(t.id);
      });
      grid.appendChild(card);
    }

    document.querySelectorAll('.quality-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.q === this.settings.quality);
    });
    const shakeBtn = document.getElementById('btn-toggle-shake');
    if (shakeBtn) shakeBtn.textContent = this.settings.shake ? 'ВКЛ' : 'ВЫКЛ';
  }

  setTheme(id) {
    this.themeId = id;
    applyTheme(id);
    this.world.markThemeChanged(); // better19: re-bake skyline/stars for the new palette
    this.store.setSetting('theme', id);
    this.renderThemeCards();
  }

  applyTitleCollapse() {
    const modal = document.getElementById('start-modal');
    if (this.settings.titleCollapsed) modal.classList.add('title-collapsed');
    else modal.classList.remove('title-collapsed');
  }

  // ---------------- better17 menu tabs ----------------

  setupMenuTabs() {
    const tabBtns = [
      ['btn-tab-track', 'tab-track'],
      ['btn-tab-hero', 'tab-hero'],
      ['btn-tab-items', 'tab-items'],
      ['btn-tab-styles', 'tab-styles']
    ];
    const switchTab = (panelId) => {
      for (const [, panel] of tabBtns) {
        document.getElementById(panel).style.display = panel === panelId ? 'block' : 'none';
      }
      for (const [btn, panel] of tabBtns) {
        document.getElementById(btn).classList.toggle('active', panel === panelId);
      }
    };
    for (const [btn, panel] of tabBtns) {
      document.getElementById(btn).addEventListener('click', (e) => {
        e.stopPropagation();
        switchTab(panel);
      });
    }
    switchTab('tab-track');

    // Track source toggle: local file vs YouTube / YT Music link
    document.getElementById('btn-src-file').addEventListener('click', (e) => {
      e.stopPropagation();
      this.trackSource = 'file';
      this.refreshSourceUI();
    });
    document.getElementById('btn-src-yt').addEventListener('click', (e) => {
      e.stopPropagation();
      this.trackSource = 'yt';
      this.refreshSourceUI();
    });
    document.getElementById('btn-yt-load').addEventListener('click', (e) => {
      e.stopPropagation();
      this.startYtLoad();
    });
    document.getElementById('yt-url').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.startYtLoad();
    });
    document.getElementById('btn-yt-start').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.ytReady) this.startYtLoad();
      else this.confirmYtStart();
    });
    document.getElementById('btn-calib-retry').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('btn-calib-retry').style.display = 'none';
      this.startCalibration();
    });
    const tapZone = document.getElementById('calib-tap-zone');
    if (tapZone) {
      tapZone.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.registerCalibTap();
      });
    }
    this.refreshSourceUI();
  }

  refreshSourceUI() {
    const yt = this.trackSource === 'yt';
    document.getElementById('btn-src-file').classList.toggle('active', !yt);
    document.getElementById('btn-src-yt').classList.toggle('active', yt);
    document.getElementById('track-file-box').style.display = yt ? 'none' : 'block';
    document.getElementById('track-yt-box').style.display = yt ? 'block' : 'none';
    const fBtn = document.getElementById('btn-select-file');
    const yBtn = document.getElementById('btn-yt-start');
    const guestMode = this.mp.active && !this.mp.isHost;
    fBtn.style.display = 'none';
    yBtn.style.display = 'none';
    if (guestMode) return;
    if (!yt) {
      fBtn.style.display = 'inline-block';
      fBtn.textContent = this.mp.active ? 'ЗАГРУЗИТЬ ТРЕК (ВЫ ХОСТ)' : 'ЗАГРУЗИТЬ ТРЕК И ИГРАТЬ';
    } else {
      yBtn.style.display = 'inline-block';
      this.refreshYtStartButton();
    }
  }

  refreshYtStartButton() {
    const yBtn = document.getElementById('btn-yt-start');
    if (!yBtn) return;
    yBtn.textContent = this.mp.active
      ? (this.ytReady ? 'ЗАПУСТИТЬ МАТЧ (ВЫ ХОСТ)' : 'ЗАГРУЗИ YOUTUBE-ТРЕК (ВЫ ХОСТ)')
      : (this.ytReady ? 'ИГРАТЬ ▶' : 'ВСТАВЬ ССЫЛКУ И ЗАГРУЗИ');
  }

  // ---------------- Lyrics on the background (better18) ----------------

  setLyricsStatus(text, found) {
    const menuEl = document.getElementById('lyrics-status');
    if (menuEl) {
      menuEl.textContent = text;
      menuEl.style.color = found ? 'var(--accent)' : '';
    }
    const hudEl = document.getElementById('hud-lyrics');
    if (hudEl) {
      hudEl.textContent = found ? `ТЕКСТ ПЕСНИ: ${text}` : '';
      hudEl.style.display = found ? 'block' : 'none';
    }
  }

  async loadLyricsFromFile(file) {
    try {
      const head = await file.slice(0, 262144).arrayBuffer();
      const tags = parseId3Tags(head);
      let title = tags.title;
      let artist = tags.artist;
      if (!title) {
        const g = guessFromFilename(file.name);
        title = g.title;
        artist = artist || g.artist;
      }
      if (!title) {
        const dotIdx = file.name.lastIndexOf('.');
        title = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
      }
      await this.resolveLyrics({ title, artist: artist || '' }, this.audio.getDuration());
    } catch (_) {
      const dotIdx = file.name.lastIndexOf('.');
      const fallbackTitle = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
      await this.resolveLyrics({ title: fallbackTitle, artist: '' }, this.audio.getDuration());
    }
  }

  async loadLyricsFromTitle(rawTitle, duration) {
    try {
      const c = cleanVideoTitle(rawTitle);
      if (!c.title) {
        this.setLyricsStatus('—', false);
        return;
      }
      await this.resolveLyrics(c, duration);
    } catch (_) {
      this.setLyricsStatus('—', false);
    }
  }

  async resolveLyrics(meta, duration) {
    this.lyrics.clear();
    this.setLyricsStatus('ИЩУ...', false);
    const dur = duration || this.audio.getDuration() || 180;
    try {
      const res = await fetchLyrics({ title: meta.title, artist: meta.artist, duration: dur });
      if (res) {
        this.lyrics.setFromResult(res, dur);
      }
    } catch (_) {}

    if (!this.lyrics.ready || !this.lyrics.lines || this.lyrics.lines.length === 0) {
      const title = (meta && meta.title) ? meta.title : 'NOCTURNE RHYTHM';
      const step = Math.max(2.8, (60 / (this.audio.bpm || 120)) * 4);
      const chants = [
        '✦ ' + title.toUpperCase() + ' ✦',
        'В ТЕНИ НОЧНОГО ГОРОДА',
        'ЧЕРНИЛА ВЕДУТ ТВОЙ ШАГ',
        'БИТ ПУЛЬСИРУЕТ В ТЕМНОТЕ',
        'ПРЫЖОК В ТАКТ — СЕРИЯ РАСТЕТ',
        'ГОТИЧЕСКИЙ РИТМ В СЕРДЦЕ',
        'НЕ СБИВАЙСЯ С БОЧКИ',
        'ЛЕТЯТ ПРИЗРАЧНЫЕ ИСКРЫ',
        'СКВОЗЬ МРАК И ТУМАН',
        'ЧИСТЫЙ РИТМ — ЧИСТЫЙ ПУТЬ'
      ];
      const autoLines = [];
      let t = 0.8;
      let cIdx = 0;
      while (t < dur + 15) {
        autoLines.push({ time: t, text: chants[cIdx % chants.length] });
        t += step;
        cIdx++;
      }
      this.lyrics.setFromData(autoLines, 'РИТМ', true);
    }

    if (this.lyrics.ready) {
      this.setLyricsStatus(this.lyrics.lang || 'НАЙДЕН', true);
      if (this.mp.active && this.mp.isHost && this.net.conn && this.net.conn.open) {
        this.net.send({
          t: 'lyrics',
          lines: this.lyrics.lines.slice(0, 400),
          lang: this.lyrics.lang || '',
          synced: this.lyrics.synced
        });
      }
    } else {
      this.setLyricsStatus('—', false);
    }
  }

  // ---------------- Multiplayer helpers ----------------

  setMpHint(text) {
    document.getElementById('mp-hint').textContent = text;
  }

  setMpProgress(got, size) {
    const outer = document.getElementById('mp-progress');
    const fill = document.getElementById('mp-progress-fill');
    if (!outer || !fill || !size) return;
    outer.style.display = 'block';
    fill.style.width = `${Math.min(100, Math.round((got / size) * 100))}%`;
  }

  hideMpProgress() {
    const outer = document.getElementById('mp-progress');
    if (outer) outer.style.display = 'none';
  }

  async ensureNet() {
    if (!this.netReady) {
      this.netReady = true;
      await this.net.ensurePeer();
    }
  }

  enterLobby(code, isHost) {
    this.mp.active = true;
    this.mp.isHost = isHost;
    this.mp.code = code;
    this.mp.ready = false;
    document.getElementById('mp-lobby').style.display = 'none';
    document.getElementById('mp-status').style.display = 'block';
    document.getElementById('mp-code-label').textContent = `КОД КОМНАТЫ: ${code}`;
    const guestWait = document.getElementById('guest-wait');
    if (isHost) {
      this.refreshSourceUI();
      this.setMpHint('Отправь другу ссылку на сайт и этот код: он жмёт «ИГРА С ДРУГОМ» → «ВОЙТИ». Вход работает из ЛЮБОЙ сети.');
    } else {
      document.getElementById('btn-select-file').style.display = 'none';
      document.getElementById('btn-yt-start').style.display = 'none';
      guestWait.style.display = 'block';
      this.setMpHint('В комнате. Ждём трек от хоста...');
    }
  }

  resetMpView() {
    this.mp.active = false;
    this.mp.isHost = false;
    this.mp.code = '';
    this.mp.ready = false;
    this.mp.pendingStartMs = 0;
    this.mp.hostTrackSent = false;
    this.mp.guestReady = false;
    this.mp.hostCountdownStarted = false;
    this.net.destroy();
    this.netReady = false;
    document.getElementById('mp-lobby').style.display = 'block';
    document.getElementById('mp-status').style.display = 'none';
    document.getElementById('peer-panel').style.display = 'none';
    document.getElementById('guest-wait').style.display = 'none';
    this.hideMpProgress();
    this.mp.hostLaunched = false;
    this.refreshSourceUI();
    document.getElementById('mp-result').style.display = 'none';
    document.getElementById('mp-result').textContent = '';
  }

  async handleHostTrack(payload) {
    try {
      this.setMpHint('Трек получен. Загружаю...');
      const bpm = await this.audio.loadFromHost(payload.buffer, payload.map);
      this.audio.setMelodyFromNet(payload.map && payload.map.melody);
      this.bpmCoinMult = this.store.getBpmCoinMultiplier(bpm);
      document.getElementById('track-name').textContent = payload.name || 'Трек хоста';
      document.getElementById('bpm-val').textContent = `${bpm}`;
      document.getElementById('bpm-mult-val').textContent = `x${this.bpmCoinMult}`;
      this.world.setBPM(bpm, this.audio.obstacleKicks, this.audio.coinKicks);
      // better18: host may relay lyrics for this track a moment later;
      // reset any previous song's text meanwhile
      this.lyrics.clear();
      this.setLyricsStatus('—', false);
      this.mp.ready = true;
      this.net.send({ t: 'guest_ready' });
      this.setMpHint('Готов! Ждём старт от хоста...');
      this.hideMpProgress();
      if (this.mp.pendingStartMs > 0) {
        const d = this.mp.pendingStartMs;
        this.mp.pendingStartMs = 0;
        this.beginCountdown(d);
      }
    } catch (e) {
      this.setMpHint('Ошибка загрузки трека хоста.');
    }
  }

  beginCountdown(delayMs, onDone = null) {
    const el = document.getElementById('countdown');
    const num = document.getElementById('countdown-num');
    el.style.display = 'flex';
    let left = Math.max(1, Math.round(delayMs / 1000));
    num.textContent = left;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        el.style.display = 'none';
        if (onDone) onDone();
        else this.startRun();
      } else {
        num.textContent = left;
      }
    }, 1000);
  }

  updatePeerHud() {
    const map = { wait: 'ЖДЁТ', play: 'ИГРАЕТ', dead: 'ВЫБЫЛ', done: 'ФИНИШ', left: 'ОТКЛ.', pause: 'ПАУЗА' };
    document.getElementById('peer-score').textContent = this.mp.peer.s;
    document.getElementById('peer-combo').textContent = `x${this.mp.peer.c}`;
    document.getElementById('peer-status').textContent = map[this.mp.peer.st] || '—';
  }

  finishMpResult(myFinished) {
    if (!this.mp.active || this.mp.resolved) return;
    this.mp.iFinished = myFinished;
    if (!this.mp.overSent) {
      this.mp.overSent = true;
      this.net.sendOver(Math.floor(this.world.score), this.maxCombo, this.runCoins, myFinished);
    }
    const peerDone = this.mp.peer.st === 'dead' || this.mp.peer.st === 'done';
    if (!peerDone) {
      const res = document.getElementById('mp-result');
      res.textContent = 'ЖДЁМ РЕЗУЛЬТАТ ДРУГА...';
      res.style.display = 'block';
      this.setSpectateStatus('ЖДЁМ РЕЗУЛЬТАТ ДРУГА...');
      return;
    }
    this.mp.resolved = true;
    const myScore = Math.floor(this.world.score);
    const pScore = this.mp.peer.s;
    const rank = (st) => (st === 'done' ? 1 : 0);
    const myR = myFinished ? 1 : 0;
    const pR = rank(this.mp.peer.st);
    const res = document.getElementById('mp-result');
    if (myR !== pR) {
      res.textContent = myR > pR ? 'ПОБЕДА: ТЫ ВЫЖИЛ ДОЛЬШЕ!' : 'ПОБЕДА: ДРУГ';
    } else if (myScore > pScore) {
      res.textContent = `ПОБЕДА: ТЫ (${myScore} : ${pScore})`;
    } else if (pScore > myScore) {
      res.textContent = `ПОБЕДА: ДРУГ (${pScore} : ${myScore})`;
    } else {
      res.textContent = `НИЧЬЯ (${myScore})`;
    }
    res.style.display = 'block';
    this.setSpectateStatus(res.textContent);
  }

  /** better20: mirror the duel result into the spectate bar. */
  setSpectateStatus(text) {
    const el = document.getElementById('spectate-status');
    if (el) el.textContent = text || '';
  }

  // ---------------- YouTube source flow (better17) ----------------

  async startYtLoad() {
    if (this.ytLoading) return;
    const urlEl = document.getElementById('yt-url');
    const hint = document.getElementById('yt-hint');
    const id = parseYouTubeUrl(urlEl ? urlEl.value : '');
    if (!id) {
      hint.textContent = 'Не похоже на ссылку YouTube / YT Music. Вставь полную ссылку на трек.';
      return;
    }
    this.ytLoading = true;
    this.ytReady = false;
    if (this.mp.active && this.mp.isHost) {
      // better20 replay guard (same as the file path)
      this.mp.guestReady = false;
      this.mp.hostCountdownStarted = false;
      this.mp.hostTrackSent = false;
    }
    hint.textContent = 'Открываю видео...';
    this.menuMusic.stop();
    try {
      if (this.yt) this.yt.destroy();
      this.yt = new YouTubeTrack();
      const meta = await this.yt.load(id);
      this.yt.setVolume(parseInt(document.getElementById('volume-slider').value, 10) || 75);
      document.getElementById('menu-track-name').textContent = meta.title || 'YouTube-трек';
      // better18: find lyrics for the YouTube track (non-blocking)
      this.loadLyricsFromTitle(meta.title || '', this.yt.getDuration() || this.yt.duration || 0);
      hint.textContent = 'Сейчас заиграет кусок трека — СЛУШАЙ БОЧКУ и ТАКАЙ В РИТМ (пробел / кнопка). Нужно хотя бы 10 тапов.';
      this.refreshYtStartButton();
      this.startCalibration();
    } catch (e) {
      hint.textContent = e.message || 'Ошибка загрузки YouTube.';
    } finally {
      this.ytLoading = false;
    }
  }

  startCalibration() {
    if (!this.yt || !this.yt.ready) return;
    const dur = this.yt.getDuration() || this.yt.duration;
    if (!dur) {
      document.getElementById('yt-hint').textContent = 'YouTube не отдал длительность. Попробуй ещё раз.';
      return;
    }
    // Start from ~18% into the track (past most intros), never past the end
    const from = Math.min(Math.max(12, dur * 0.18), Math.max(0, dur - 28));
    this.calib = { taps: [], startedAt: performance.now(), lastTapPerf: 0, windowSec: 24 };
    document.getElementById('calib-box').style.display = 'block';
    document.getElementById('calib-status').textContent = 'СЛУШАЙ И ТАКАЙ В БИТ!';
    document.getElementById('calib-count').textContent = '0 / 10';
    this.yt.seekPlay(from);
  }

  registerCalibTap() {
    if (!this.calib || !this.yt) return;
    this.calib.taps.push(this.yt.getTime());
    this.calib.lastTapPerf = performance.now();
    document.getElementById('calib-count').textContent = `${this.calib.taps.length} / 10`;
    if (this.calib.taps.length >= 18) this.finishCalibration();
  }

  updateCalibration() {
    if (!this.calib) return;
    const c = this.calib;
    const now = performance.now();
    const elapsed = (now - c.startedAt) / 1000;
    const sinceTap = (now - (c.lastTapPerf || c.startedAt)) / 1000;
    if ((c.taps.length >= 10 && sinceTap > 1.5) || elapsed > c.windowSec) {
      this.finishCalibration();
    }
  }

  finishCalibration() {
    const c = this.calib;
    if (!c) return;
    this.calib = null;
    this.yt.pause();
    const statusEl = document.getElementById('calib-status');
    const fail = (msg) => {
      statusEl.textContent = msg;
      document.getElementById('calib-box').style.display = 'block';
      document.getElementById('btn-calib-retry').style.display = 'inline-block';
    };
    const taps = c.taps;
    if (taps.length < 6) {
      fail('Слишком мало тапов. Нажми «ЕЩЁ РАЗ» и стучи в ритм бочки (пробел).');
      return;
    }
    const deltas = [];
    for (let i = 1; i < taps.length; i++) {
      const d = taps[i] - taps[i - 1];
      if (d > 0.22 && d < 2.2) deltas.push(d);
    }
    if (deltas.length < 4) {
      fail('Не услышал ровный ритм. «ЕЩЁ РАЗ» — и стучите ровнее.');
      return;
    }
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length * 0.5)];
    let bpm = 60 / median;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const interval = 60 / bpm;
    // Confidence: how many inter-tap intervals land on the folded beat
    let close = 0;
    for (const d of deltas) {
      let dd = d;
      while (dd > interval * 1.6) dd /= 2;
      while (dd < interval * 0.4) dd *= 2;
      if (Math.abs(dd - interval) < interval * 0.14) close++;
    }
    const conf = close / deltas.length;
    // Phase: circular mean of tap positions on the beat circle (wrap-safe)
    let sx = 0;
    let sy = 0;
    for (const t of taps) {
      const ph = 2 * Math.PI * (((t % interval) + interval) % interval) / interval;
      sx += Math.cos(ph);
      sy += Math.sin(ph);
    }
    let phase = Math.atan2(sy / taps.length, sx / taps.length) * interval / (2 * Math.PI);
    if (phase < 0) phase += interval;
    const duration = this.yt.getDuration() || this.yt.duration;
    this.audio.attachYouTube(this.yt, duration);
    this.audio.applySyntheticTrack(bpm, phase, duration);
    this.bpmCoinMult = this.store.getBpmCoinMultiplier(this.audio.bpm);
    this.world.setBPM(this.audio.bpm, this.audio.obstacleKicks, this.audio.coinKicks);
    document.getElementById('menu-bpm-val').textContent = `${Math.round(this.audio.bpm * 10) / 10}`;
    document.getElementById('menu-track-len').textContent =
      `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;
    document.getElementById('menu-track-kicks').textContent = `${this.audio.kickMap.length}`;
    document.getElementById('track-card').style.display = 'block';
    document.getElementById('calib-box').style.display = 'none';
    document.getElementById('btn-calib-retry').style.display = 'inline-block';
    document.getElementById('yt-hint').textContent = conf >= 0.55
      ? 'Ритм пойман! Если препятствия не в такт — жми «ЕЩЁ РАЗ».'
      : 'Ритм пойман, но неуверенно — советую «ЕЩЁ РАЗ».';
    this.ytReady = true;
    this.refreshYtStartButton();
    if (this.mp.active && this.mp.isHost && this.net.conn && this.net.conn.open) {
      this.sendYtTrackToGuest();
    }
  }

  sendYtTrackToGuest() {
    if (!this.net.conn || !this.net.conn.open || !this.yt) return;
    this.net.send({
      t: 'yt_track',
      videoId: this.yt.videoId,
      title: this.yt.title || '',
      duration: this.audio.getDuration(),
      bpm: this.audio.bpm,
      kickMap: this.audio.kickMap,
      obstacleKicks: this.audio.obstacleKicks,
      coinKicks: this.audio.coinKicks,
      melody: this.audio.packMelodyForNet()
    });
    this.mp.hostTrackSent = true;
    if (this.mp.guestReady) {
      this.setMpHint('Трек передан. Запускай матч кнопкой ниже!');
    } else {
      this.setMpHint('YouTube-трек передан напарнику. Ждём его готовность...');
    }
  }

  async handleGuestYtTrack(m) {
    try {
      this.setMpHint('Хост выбрал YouTube-трек. Загружаю...');
      if (this.yt) this.yt.destroy();
      this.yt = new YouTubeTrack();
      const meta = await this.yt.load(m.videoId);
      this.yt.setVolume(parseInt(document.getElementById('volume-slider').value, 10) || 75);
      this.audio.attachYouTube(this.yt, m.duration || meta.duration);
      this.audio.applyAnalysis({
        bpm: m.bpm || 120,
        kickMap: m.kickMap || [],
        obstacleKicks: m.obstacleKicks || [],
        coinKicks: m.coinKicks || []
      });
      this.audio.setMelodyFromNet(m.melody);
      this.bpmCoinMult = this.store.getBpmCoinMultiplier(this.audio.bpm);
      document.getElementById('track-name').textContent = m.title || 'YouTube-трек';
      document.getElementById('bpm-val').textContent = `${Math.round(this.audio.bpm * 10) / 10}`;
      document.getElementById('bpm-mult-val').textContent = `x${this.bpmCoinMult}`;
      this.world.setBPM(this.audio.bpm, this.audio.obstacleKicks, this.audio.coinKicks);
      // better18: the guest also fetches its own copy of the lyrics
      this.loadLyricsFromTitle(m.title || '', m.duration || 0);
      this.mp.ready = true;
      this.net.send({ t: 'guest_ready' });
      this.setMpHint('Трек с YouTube готов! Ждём старт от хоста...');
      this.hideMpProgress();
      if (this.mp.pendingStartMs > 0) {
        const d = this.mp.pendingStartMs;
        this.mp.pendingStartMs = 0;
        this.beginCountdown(d);
      }
    } catch (e) {
      this.setMpHint('Ошибка YouTube у гостя: ' + (e.message || 'не удалось открыть видео.'));
    }
  }

  confirmYtStart() {
    if (!this.ytReady) {
      this.startYtLoad();
      return;
    }
    this.menuMusic.stop();
    document.getElementById('start-modal').style.display = 'none';
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('hud-panel').style.display = 'block';
    document.getElementById('track-name').textContent = this.yt.title || 'YouTube-трек';
    document.getElementById('bpm-val').textContent = `${Math.round(this.audio.bpm * 10) / 10}`;
    document.getElementById('bpm-mult-val').textContent = `x${this.bpmCoinMult}`;
    if (this.mp.active && this.mp.isHost) {
      this.mp.hostLaunched = true;
      if (this.mp.guestReady && !this.mp.hostCountdownStarted) {
        this.mp.hostCountdownStarted = true;
        this.setMpHint('Оба готовы! Запускаю отсчёт...');
        this.net.sendStart(MP_START_DELAY);
        this.beginCountdown(MP_START_DELAY);
      } else {
        this.setMpHint('Ждём готовность напарника, отсчёт стартует автоматически.');
      }
      return;
    }
    this.startRun();
  }

  // ---------------- VS duel panel (better17) ----------------

  updateVsPanel() {
    const panel = this.dom.vsPanel; // better19: cached refs
    if (!panel) return;
    const show = this.mp.active && this.isPlayingTrack && !this.isGameOver;
    if (!show) {
      if (panel.style.display !== 'none') panel.style.display = 'none';
      return;
    }
    if (panel.style.display !== 'flex') panel.style.display = 'flex';
    const my = Math.floor(this.world.score);
    const p = this.mp.peer.s;
    if (this._vsCache.my === my && this._vsCache.peer === p) return;
    this._vsCache.my = my;
    this._vsCache.peer = p;
    this.dom.vsMy.textContent = my;
    this.dom.vsPeer.textContent = p;
    this.dom.vsCrownMy.style.visibility = my > p ? 'visible' : 'hidden';
    this.dom.vsCrownPeer.style.visibility = p > my ? 'visible' : 'hidden';
  }

  // ---------------- Pause overlay ----------------

  showPauseOverlay(text) {
    document.getElementById('pause-text').textContent = text;
    document.getElementById('pause-overlay').style.display = 'block';
  }

  hidePauseOverlay() {
    document.getElementById('pause-overlay').style.display = 'none';
  }

  // ---------------- Net events ----------------

  setupNet() {
    this.net.on('created', (m) => {
      this.enterLobby(m.code, true);
    });
    this.net.on('joined', (m) => {
      this.enterLobby(m.code, false);
    });
    this.net.on('error', (m) => {
      this.setMpHint(m.msg || 'Ошибка комнаты');
    });
    this.net.on('peer', () => {
      this.setMpHint('Друг подключился!');
      // Host already picked a track before the guest arrived -> send it now
      if (this.mp.active && this.mp.isHost && this.trackSource === 'yt' && this.ytReady) {
        this.setMpHint('Отправляю YouTube-трек другу...');
        this.sendYtTrackToGuest();
      } else if (this.mp.active && this.mp.isHost && this.hostTrackBuf) {
        this.setMpHint('Отправляю трек другу...');
        this.setMpProgress(0, this.hostTrackBuf.byteLength);
        this.net.sendTrack(this.hostTrackName, this.hostTrackBuf, this.hostTrackMap);
      }
    });
    this.net.on('peer_left', () => {
      if (this.mp.active) {
        this.mp.peer.st = 'left';
        this.updatePeerHud();
        this.setMpHint('Друг отключился.');
        if (this.spectating) {
          // better20: nobody left to watch — back to the menu
          this.fadeToMenu(false);
        } else if (this.isPlayingTrack) {
          this.mp.active = false; // continue solo
          document.getElementById('peer-panel').style.display = 'none';
        } else {
          this.resetMpView();
        }
      }
    });
    this.net.on('track_meta', (m) => {
      this.setMpHint(`Хост отправляет трек: ${m.name}...`);
      this.setMpProgress(0, m.size || 1);
    });
    this.net.on('track_progress', (m) => {
      this.setMpProgress(m.got, m.size);
    });
    this.net.on('track_sending', (m) => {
      this.setMpHint(`Отправляю трек другу... ${Math.round((m.got / Math.max(1, m.size)) * 100)}%`);
      this.setMpProgress(m.got, m.size);
    });
    this.net.on('track_done', (m) => {
      if (this.mp.active && !this.mp.isHost) {
        this.handleHostTrack(m);
      }
    });
    this.net.on('track_sent', () => {
      this.hideMpProgress();
      this.mp.hostTrackSent = true;
      if (this.mp.guestReady) {
        this.mp.hostCountdownStarted = true;
        this.setMpHint('Оба готовы! Запускаю отсчёт...');
        this.net.sendStart(MP_START_DELAY);
        this.beginCountdown(MP_START_DELAY);
      } else {
        this.setMpHint('Трек доставлен. Ждём готовность напарника...');
      }
    });
    this.net.on('guest_ready', () => {
      if (this.mp.active && this.mp.isHost) {
        this.mp.guestReady = true;
        // File mode: launching = track fully sent. YouTube mode: the host
        // launches the countdown manually via the big start button.
        const launched = this.trackSource === 'yt' ? this.mp.hostLaunched : this.mp.hostTrackSent;
        if (launched && !this.mp.hostCountdownStarted) {
          this.mp.hostCountdownStarted = true;
          this.setMpHint('Оба готовы! Запускаю отсчёт...');
          this.net.sendStart(MP_START_DELAY);
          this.beginCountdown(MP_START_DELAY);
        } else if (this.trackSource === 'yt') {
          this.setMpHint('Напарник готов! Жми кнопку запуска.');
        }
      }
    });
    this.net.on('yt_track', (m) => this.handleGuestYtTrack(m));
    this.net.on('yt_sync', (m) => {
      // Guest drift correction against the host's YouTube clock
      if (this.mp.active && !this.mp.isHost && this.yt && this.isPlayingTrack && this.pauseState === 'none') {
        const local = this.audio.getElapsedTime();
        const diff = (m.tt || 0) - local;
        if (Math.abs(diff) > 0.35) this.yt.seekPlay(local + diff);
      }
    });
    // better18: host-relayed lyrics (fallback when the guest's own lookup fails)
    this.net.on('lyrics', (m) => {
      if (m && Array.isArray(m.lines) && m.lines.length) {
        this.lyrics.setFromData(m.lines, m.lang, m.synced);
        if (this.lyrics.ready) this.setLyricsStatus(this.lyrics.lang || 'НАЙДЕН', true);
      }
    });
    this.net.on('start', (m) => {
      if (this.mp.active && !this.mp.isHost) {
        const d = m.delay || MP_START_DELAY;
        if (this.mp.ready) {
          this.beginCountdown(d);
        } else {
          this.mp.pendingStartMs = d;
        }
      }
    });
    // Partner minimized the page -> the whole match freezes
    this.net.on('pause', () => {
      if (this.isPlayingTrack && !this.isGameOver && this.pauseState === 'none') {
        this.pauseState = 'peer';
        this.stopRiser();
        this.audio.pause();
        this.mp.peer.st = 'pause';
        this.updatePeerHud();
        this.showPauseOverlay('ПОДОЖДИТЕ, ВАШ НАПАРНИК СВЕРНУЛ СТРАНИЦУ');
      }
    });
    // Partner returned -> synced countdown and resume for both sides
    this.net.on('resume', (m) => {
      if (this.pauseState === 'peer') {
        this.pauseState = 'none';
        this.mp.peer.st = 'play';
        this.updatePeerHud();
        this.hidePauseOverlay();
        const d = Math.max(1000, m.delay || 3000);
        this.beginCountdown(d, () => this.audio.resume());
      }
    });
    this.net.on('peer_state', (m) => {
      if (!this.mp.active) return;
      const prevCombo = this.mp.peer.c;
      this.mp.peer.y = m.y;
      this.mp.peer.g = m.g;
      this.mp.peer.f = m.f;
      this.mp.peer.s = m.s;
      this.mp.peer.c = m.c;
      this.mp.peer.co = m.co;
      if (this.mp.peer.st === 'wait' || this.mp.peer.st === 'play') {
        this.mp.peer.st = 'play';
      }
      this.updatePeerHud();
      // Duel flourish: ink ring at the ghost when the friend hits a combo milestone
      if (this.isPlayingTrack && m.c > prevCombo && m.c > 0 && m.c % 5 === 0) {
        this.particles.emitBeatRing(this.player.x + 20, this.mp.peer.y + 20);
      }
    });
    this.net.on('peer_over', (m) => {
      if (!this.mp.active) return;
      this.mp.peer.s = m.score;
      this.mp.peer.c = m.maxCombo;
      this.mp.peer.st = m.finished ? 'done' : 'dead';
      this.updatePeerHud();
      if (this.isGameOver || !this.isPlayingTrack) {
        this.finishMpResult(this.mp.iFinished);
      }
    });
  }

  // ---------------- Visibility / blur pause ----------------

  setupVisibility() {
    const hide = () => {
      if (this.isPlayingTrack && !this.isGameOver && this.pauseState === 'none') {
        this.pauseState = 'local';
        this.stopRiser();
        this.audio.pause();
        this.showPauseOverlay(
          this.mp.active
            ? 'ТЫ СВЕРНУЛ СТРАНИЦУ\nИГРА ОСТАНОВЛЕНА ДЛЯ ОБОИХ'
            : 'ПАУЗА — ВЕРНИСЬ В ОКНО ИГРЫ'
        );
        if (this.mp.active) this.net.sendPause();
      }
    };

    const show = () => {
      if (this.pauseState === 'local' && !document.hidden) {
        this.pauseState = 'none';
        this.hidePauseOverlay();
        const delay = 3000;
        if (this.mp.active) this.net.sendResume(delay);
        this.beginCountdown(delay, () => this.audio.resume());
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hide();
      else show();
    });

    // Alt-Tab without minimizing does not always fire visibilitychange
    window.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.hasFocus()) hide();
      }, 350);
    });
    window.addEventListener('focus', () => {
      setTimeout(() => show(), 120);
    });
  }

  // ---------------- Finale (end of track crescendo) ----------------

  stopRiser() {
    for (const n of this.riserNodes) {
      try { n.stop ? n.stop() : n.disconnect(); } catch (_) {}
    }
    this.riserNodes = [];
  }

  playFinaleRiser(durationSec, vol) {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = Math.max(0.8, Math.min(durationSec, 6.5));

    // Rising filtered noise sweep
    const noiseLen = Math.ceil(ctx.sampleRate * dur);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(240, t0);
    bp.frequency.exponentialRampToValueAtTime(5400, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, vol * 0.4), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0 + dur + 0.03);
    noise.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + dur + 0.06);
    this.riserNodes.push(noise);

    // Final deep boom at the exact end of the track
    const boom = ctx.createOscillator();
    const bg = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(75, t0 + dur);
    boom.frequency.exponentialRampToValueAtTime(27, t0 + dur + 1.3);
    bg.gain.setValueAtTime(0.0001, t0 + dur);
    bg.gain.exponentialRampToValueAtTime(Math.max(0.03, vol * 0.85), t0 + dur + 0.03);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 1.4);
    boom.connect(bg);
    bg.connect(ctx.destination);
    boom.start(t0 + dur);
    boom.stop(t0 + dur + 1.5);
    this.riserNodes.push(boom);
  }

  updateFinale(elapsed) {
    const dur = this.audio.getDuration();
    if (!dur || !this.isPlayingTrack || this.isGameOver) {
      if (this.blastT <= 0) {
        this.finale = 0;
        this.dom.banner.style.display = 'none';
      }
      return;
    }
    const len = Math.min(24, Math.max(9, dur * 0.14));
    const remain = dur - elapsed;
    this.finale = remain <= 0 ? 1 : (remain <= len ? 1 - remain / len : 0);

    // better17 TRACK CLEAR: the exact end of the track triggers the grand
    // blast (storm + shockwave volleys + score bonus), THEN the results show.
    if (remain <= 0 && !this.blastStarted && this.pauseState === 'none') {
      this.blastStarted = true;
      this.blastT = 2.2;
      this.blastVolley = 0;
      this.world.score += 500; // clear bonus
      const b = this.dom.banner;
      if (b) {
        b.textContent = '⚔ TRACK CLEAR — МОНЕТЫ ×2 ⚔';
        b.style.display = 'block';
      }
      this.particles.emitFinaleStorm(this.player.x + 20, this.player.y + 20, this.world.groundY, 1);
      return;
    }

    const banner = this.dom.banner;
    if (this.finale > 0.02 && this.pauseState === 'none') {
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }

    // Riser sound in the last ~5 seconds, once per run
    if (this.finale > 0 && remain < 5.2 && !this.riserPlayed && this.pauseState === 'none') {
      this.riserPlayed = true;
      this.playFinaleRiser(Math.max(0.6, remain), this.audio.volume);
    }

    // Ambient finale ember storm
    if (this.finale > 0.05 && this.pauseState === 'none' && Math.random() < this.finale * 0.5) {
      this.particles.emitFinaleEmbers(this.player.x, this.player.y, this.world.groundY, this.finale);
    }
  }

  computeRank(finished, score) {
    if (!finished) return score > 6000 ? 'A' : score > 3000 ? 'B' : 'C';
    return score > 12000 ? 'S' : score > 7000 ? 'A' : score > 3000 ? 'B' : 'C';
  }

  showGameOver(finished) {
    document.getElementById('game-over-title').textContent = finished
      ? 'ФИНАЛ! ТРЕК ПРОЙДЕН'
      : 'ЧЕРНИЛА ПРОЛИТЫ';
    const rank = this.computeRank(finished, Math.floor(this.world.score));
    const rankEl = document.getElementById('final-rank');
    rankEl.textContent = rank;
    document.getElementById('final-score').textContent = Math.floor(this.world.score);
    document.getElementById('final-combo').textContent = `x${this.maxCombo}`;
    document.getElementById('final-coins').textContent = this.runCoins;
    document.getElementById('game-over').style.display = 'block';
  }

  // ---------------- Events ----------------

  setupEvents() {
    window.addEventListener('resize', () => this.resize());

    this.glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      location.reload();
    });

    this.setupVisibility();

    const volSlider = document.getElementById('volume-slider');
    const hudVolSlider = document.getElementById('hud-volume-slider');
    const volLabel = document.getElementById('volume-label');

    const updateVolume = (val) => {
      const norm = parseInt(val, 10) / 100;
      volSlider.value = val;
      hudVolSlider.value = val;
      volLabel.textContent = `${val}%`;
      this.audio.setVolume(norm);
      this.menuMusic.setVolume(norm);
      if (this.yt) this.yt.setVolume(parseInt(val, 10));
    };

    volSlider.addEventListener('input', (e) => updateVolume(e.target.value));
    hudVolSlider.addEventListener('input', (e) => updateVolume(e.target.value));

    const jump = () => {
      if (!this.isPlayingTrack || this.isGameOver || this.pauseState !== 'none') return;

      const trackTime = this.audio.getElapsedTime();
      const kickDiff = this.audio.getNearestKickDiff(trackTime);
      const pre = this.judge.evaluate(kickDiff, 'GROUND_JUMP');

      const actionType = this.player.jump(this.particles, pre.rating);
      if (actionType) {
        const verdict = this.judge.evaluate(kickDiff, actionType);
        const rating = verdict.rating;
        let multiplier = verdict.multiplier;
        let labelText = rating;
        if (actionType === 'AIR_FLIP') {
          labelText = rating === 'OFF-BEAT' ? 'FLIP' : `${rating} FLIP!`;
        }

        if (rating === 'OFF-BEAT' && actionType === 'GROUND_JUMP') {
          this.combo = 0;
        } else {
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.world.score += 40 * multiplier * (1 + Math.min(this.combo * 0.1, 2.5));

          // Combo milestone titles every 10 hits
          if (this.combo > 0 && this.combo % 10 === 0) {
            this.particles.emitJudgment(
              `СЕРИЯ ${this.combo}!`,
              this.player.x + this.player.width / 2,
              this.player.y - 48,
              'PERFECT'
            );
          }

          // Award BPM-scaled coins for on-beat jumps & combo streaks (x2 in finale!)
          const baseCoin = rating === 'PERFECT' ? 3 : 1;
          const comboBonus = Math.floor(this.combo / 5);
          const finaleBonus = this.finale > 0 ? 2 : 1;
          const coinsEarned = Math.max(1, Math.round((baseCoin + comboBonus) * this.bpmCoinMult * finaleBonus));
          this.runCoins += coinsEarned;
          this.store.addCoins(coinsEarned);
          this.dom.coins.textContent = `${this.store.data.coins} (+${this.runCoins})`;
        }

        this.particles.emitJudgment(
          labelText,
          this.player.x + this.player.width / 2,
          this.player.y - 24,
          rating === 'OFF-BEAT' && actionType === 'AIR_FLIP' ? 'GOOD' : rating
        );

        this.dom.combo.textContent = `x${this.combo}`;

        const ind = this.dom.beat;
        ind.classList.add('pulse');
        setTimeout(() => ind.classList.remove('pulse'), 90);
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        // Tap-calibration capture has priority over the gameplay jump
        if (this.calib) {
          this.registerCalibTap();
          return;
        }
        jump();
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (
        e.target.closest('#ui-layer button') ||
        e.target.closest('#ui-layer input') ||
        e.target.closest('#start-modal') ||
        e.target.closest('#settings-panel') ||
        e.target.closest('#game-over') ||
        e.target.closest('#hud-panel') ||
        e.target.closest('#peer-panel')
      ) {
        return;
      }
      jump();
    });

    // better20: spectate zoom — mouse wheel while watching your friend
    window.addEventListener('wheel', (e) => {
      if (!this.spectating) return;
      e.preventDefault();
      this.spectateZoom(e.deltaY < 0 ? 0.18 : -0.18);
    }, { passive: false });

    const wireZoomBtn = (id, delta) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      // pointerdown only — click would fire on top of it and double the step
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.spectateZoom(delta);
      });
    };
    wireZoomBtn('spec-zoom-in', 0.25);
    wireZoomBtn('spec-zoom-out', -0.25);

    // better20: explicit room leave (the МЕНЮ button keeps the room alive)
    const leaveBtn = document.getElementById('btn-leave-room');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.leaveRoom();
      });
    }

    // ---- Modes, settings, collapsible title ----
    const btnSoloMode = document.getElementById('btn-solo-mode');
    const btnMpMode = document.getElementById('btn-mp-mode');
    const mpPanel = document.getElementById('mp-panel');
    const settingsPanel = document.getElementById('settings-panel');

    btnSoloMode.addEventListener('click', (e) => {
      e.stopPropagation();
      btnSoloMode.classList.add('active');
      btnMpMode.classList.remove('active');
      mpPanel.style.display = 'none';
      settingsPanel.style.display = 'none';
      if (this.mp.active) {
        this.resetMpView();
      }
    });

    btnMpMode.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnMpMode.classList.add('active');
      btnSoloMode.classList.remove('active');
      settingsPanel.style.display = 'none';
      mpPanel.style.display = 'block';
      try {
        await this.ensureNet();
      } catch (err) {
        this.setMpHint(err.message || 'Нет связи с сервисом комнат.');
      }
    });

    document.getElementById('btn-open-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      mpPanel.style.display = 'none';
      settingsPanel.style.display = 'block';
    });

    document.getElementById('btn-close-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPanel.style.display = 'none';
    });

    document.querySelectorAll('.quality-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.settings.quality = btn.dataset.q;
        this.store.setSetting('quality', btn.dataset.q);
        this.particles.setQuality(btn.dataset.q);
        this.world.setQuality(btn.dataset.q); // better19: detail caps + layer re-bake
        this.world.glowEnabled = btn.dataset.q !== 'low';
        this.renderThemeCards();
      });
    });

    document.getElementById('btn-toggle-shake').addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.shake = !this.settings.shake;
      this.store.setSetting('shake', this.settings.shake);
      this.world.shakeEnabled = this.settings.shake;
      this.renderThemeCards();
    });

    // better18: background song lyrics toggle
    const lyricsToggle = document.getElementById('btn-toggle-lyrics');
    if (lyricsToggle) {
      lyricsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.settings.lyrics = this.settings.lyrics === false; // default is ON
        this.store.setSetting('lyrics', this.settings.lyrics);
        this.world.lyricsEnabled = this.settings.lyrics;
        lyricsToggle.textContent = this.settings.lyrics ? 'ВКЛ' : 'ВЫКЛ';
      });
    }

    document.getElementById('btn-title-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.titleCollapsed = !this.settings.titleCollapsed;
      this.store.setSetting('titleCollapsed', this.settings.titleCollapsed);
      this.applyTitleCollapse();
    });

    document.getElementById('btn-create-room').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        this.setMpHint('Создаю комнату...');
        await this.ensureNet();
        await this.net.hostCreate();
      } catch (err) {
        this.setMpHint(err.message || 'Нет связи с сервисом комнат.');
      }
    });

    document.getElementById('btn-join-room').addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = document.getElementById('room-code-input').value.trim().toUpperCase();
      if (code.length !== 4) {
        this.setMpHint('Код комнаты — 4 символа.');
        return;
      }
      try {
        this.setMpHint('Вхожу в комнату...');
        await this.ensureNet();
        await this.net.join(code);
      } catch (err) {
        this.setMpHint(err.message || 'Нет связи с сервисом комнат.');
      }
    });

    const startMenuAudioOnce = () => {
      if (this.menuMusicEnabled && !this.isPlayingTrack && !this.menuMusic.isPlaying) {
        this.menuMusic.start(false);
      }
    };
    window.addEventListener('click', startMenuAudioOnce, { once: true });
    window.addEventListener('keydown', startMenuAudioOnce, { once: true });

    document.getElementById('btn-toggle-menu-music').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuMusicEnabled = !this.menuMusicEnabled;
      if (this.menuMusicEnabled) {
        this.menuMusic.start(false);
        document.getElementById('btn-toggle-menu-music').textContent = 'МЕЛОДИЯ МЕНЮ: ВКЛ';
      } else {
        this.menuMusic.stop();
        document.getElementById('btn-toggle-menu-music').textContent = 'МЕЛОДИЯ МЕНЮ: ВЫКЛ';
      }
    });

    const fileInput = document.getElementById('audio-input');
    document.getElementById('btn-select-file').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      this.menuMusic.stop();
      document.getElementById('start-modal').style.display = 'none';
      document.getElementById('game-over').style.display = 'none';
      document.getElementById('hud-panel').style.display = 'block';
      document.getElementById('track-name').textContent = file.name;

      if (this.mp.active && this.mp.isHost) {
        // better20 replay guard: a fresh track invalidates the previous
        // readiness so the match can't double-start
        this.mp.guestReady = false;
        this.mp.hostCountdownStarted = false;
        this.mp.hostTrackSent = false;
        document.getElementById('bpm-val').textContent = 'Чтение файла...';
        try {
          const buf = await file.arrayBuffer();
          const trackCopy = buf.slice(0); // decodeAudioData detaches the buffer — keep a copy for the guest
          document.getElementById('bpm-val').textContent = 'Анализ кика...';
          const bpm = await this.audio.loadArrayBuffer(buf);
          this.bpmCoinMult = this.store.getBpmCoinMultiplier(bpm);
          document.getElementById('bpm-val').textContent = `${bpm}`;
          document.getElementById('bpm-mult-val').textContent = `x${this.bpmCoinMult}`;
          this.world.setBPM(bpm, this.audio.obstacleKicks, this.audio.coinKicks);

          // Send the whole track + verified kick map straight to the guest (P2P)
          this.hostTrackBuf = trackCopy;
          this.hostTrackName = file.name;
          this.hostTrackMap = {
            bpm,
            kickMap: this.audio.kickMap,
            obstacleKicks: this.audio.obstacleKicks,
            coinKicks: this.audio.coinKicks,
            melody: this.audio.packMelodyForNet()
          };
          // better18: lyrics lookup in the background (relayed to the guest when found)
          this.loadLyricsFromFile(file);
          if (this.net.conn && this.net.conn.open) {
            this.setMpHint('Отправляю трек другу...');
            this.setMpProgress(0, trackCopy.byteLength);
            this.net.sendTrack(file.name, trackCopy, this.hostTrackMap);
          } else {
            this.setMpHint('Трек готов. Ждём напарника в комнату...');
          }
          return; // countdown continues in track_sent handler
        } catch (err) {
          document.getElementById('bpm-val').textContent = '-';
          this.setMpHint('Ошибка обработки трека.');
          document.getElementById('start-modal').style.display = 'block';
          document.getElementById('hud-panel').style.display = 'none';
          return;
        }
      }

      document.getElementById('bpm-val').textContent = 'Анализ кика...';
      const bpm = await this.audio.loadFile(file);
      this.bpmCoinMult = this.store.getBpmCoinMultiplier(bpm);
      document.getElementById('bpm-val').textContent = `${bpm}`;
      document.getElementById('bpm-mult-val').textContent = `x${this.bpmCoinMult}`;
      this.world.setBPM(bpm, this.audio.obstacleKicks, this.audio.coinKicks);
      // better18: lyrics lookup in the background (non-blocking)
      this.loadLyricsFromFile(file);

      if (!this.mp.active) {
        this.startRun();
      }
    });

    document.getElementById('btn-restart').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.audio.audioBuffer && !this.ytReady) return;
      if (this.mp.active) {
        if (this.mp.isHost) {
          this.riserPlayed = false;
          this.net.sendStart(MP_START_DELAY);
          this.beginCountdown(MP_START_DELAY);
        }
      } else {
        this.riserPlayed = false;
        this.startRun();
      }
    });

    // better19: buttons now go through the smooth fade transition
    const returnToMenu = (e) => {
      if (e) e.stopPropagation();
      this.fadeToMenu(false);
    };

    document.getElementById('btn-back-menu').addEventListener('click', returnToMenu);
    document.getElementById('btn-hud-menu').addEventListener('click', returnToMenu);
  }

  // ---------------- Run lifecycle ----------------

  startRun() {
    // FIX: the guest starts from a network message, not a button click, so the
    // menu/HUD switch must happen for BOTH sides right here (the host already
    // closed its menu when picking a file — hiding again is harmless).
    this.menuMusic.stop();
    document.getElementById('start-modal').style.display = 'none';
    document.getElementById('settings-panel').style.display = 'none';
    document.getElementById('hud-panel').style.display = 'block';
    this.isGameOver = false;
    this.isPlayingTrack = true;
    this.spectating = false;
    this.cam.zoom = 1.0;
    this.cam.tz = 1.0;
    this.hideSpectateBar();
    this.combo = 0;
    this.maxCombo = 0;
    this.runCoins = 0;
    this.finale = 0;
    this.riserPlayed = false;
    this.blastStarted = false;
    this.blastT = 0;
    this.dom.banner.textContent = '\u2694 ФИНАЛ \u2014 МОНЕТЫ \u00d72 \u2694';
    this.dom.combo.textContent = 'x0';
    this.dom.coins.textContent = `${this.store.data.coins} (+0)`;
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('mp-result').style.display = 'none';
    this.dom.banner.style.display = 'none';
    this.mp.overSent = false;
    this.mp.resolved = false;
    this.mp.iFinished = false;
    this.player.y = this.world.groundY - this.player.height;
    this.player.vy = 0;
    this.player.isGrounded = true;
    this.player.isFlipping = false;
    this.world.reset(this.audio.obstacleKicks, this.audio.coinKicks);
    this.lyrics.reset();
    this.beatPhase = 0;

    // In multiplayer only the host controls restarts
    document.getElementById('btn-restart').style.display =
      this.mp.active && !this.mp.isHost ? 'none' : 'inline-block';

    if (this.mp.active) {
      this.mp.peer.st = 'play';
      this.mp.peer.s = 0;
      this.mp.peer.c = 0;
      document.getElementById('peer-panel').style.display = 'block';
      document.getElementById('peer-name').textContent = this.mp.isHost ? 'ДРУГ (ГОСТЬ)' : 'ХОСТ';
      this.updatePeerHud();
    }

    this.audio.play(() => {
      if (!this.blastStarted) {
        this.blastStarted = true;
        this.blastT = 1.8;
      }
    }, 0);
  }

  triggerTrackComplete() {
    if (this.isGameOver && !this.spectating) return;
    if (!this.isPlayingTrack) return;
    this.isPlayingTrack = false;
    this.spectating = false;
    this.hideSpectateBar();
    this.stopRiser();
    this.audio.stop();
    document.getElementById('finale-banner').style.display = 'none';
    if (this.mp.active && !this.isGameOver) {
      document.getElementById('hud-panel').style.display = 'none';
      this.showGameOver(true);
      this.finishMpResult(true);
    } else {
      // better19: конец трека больше НЕ показывает экран проигрыша —
      // плавный авто-возврат в меню с тостом о добытых монетах
      // (better20: и для спектейтора — комната остаётся жить)
      const earned = this.runCoins;
      this.fadeToMenu(true, earned);
    }
  }

  /**
   * better19: fade-out -> reset to menu -> fade-in. Used by both the manual
   * "МЕНЮ" buttons and the new automatic end-of-track return.
   */
  fadeToMenu(trackCleared, earnedCoins = 0) {
    if (this._fading) return;
    this._fading = true;
    const veil = document.getElementById('fade-veil');
    if (veil) veil.classList.add('on');
    setTimeout(() => {
      this.returnToMenuCore();
      if (trackCleared) {
        this.showMenuToast(`\u2694 ТРЕК ПРОЙДЕН — ДОБЫТО +${earnedCoins} МОНЕТ \u2694`);
      }
      setTimeout(() => {
        if (veil) veil.classList.remove('on');
        this._fading = false;
      }, 150);
    }, 440);
  }

  /** The actual menu reset (was: inline body of the old returnToMenu). */
  returnToMenuCore() {
    this.stopRiser();
    this.audio.stop();
    this.isPlayingTrack = false;
    this.isGameOver = false;
    this.spectating = false;
    this.pauseState = 'none';
    this.finale = 0;
    this.riserPlayed = false;
    this.blastStarted = false;
    this.blastT = 0;
    this.hidePauseOverlay();
    this.hideSpectateBar();
    // better20: going back to the menu NO LONGER kills the room — the friend
    // stays connected and a new match can start right away.
    if (this.mp.active) this.keepRoomOnMenuReturn();
    this.renderShopUI();
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('hud-panel').style.display = 'none';
    document.getElementById('start-modal').style.display = 'block';
    if (this.menuMusicEnabled) this.menuMusic.start(false);
    // better19: celebrate the wallet after a run
    const wallet = document.getElementById('menu-coins-val');
    if (wallet) {
      wallet.classList.remove('wallet-bump');
      void wallet.offsetWidth;
      wallet.classList.add('wallet-bump');
    }
  }

  /**
   * better20: keep the P2P room alive after a finished/lost match and reset
   * only the per-match state. The host immediately sees "load a track" UI,
   * the guest sees the waiting panel — a rematch is one track away.
   */
  keepRoomOnMenuReturn() {
    this.mp.ready = false;
    this.mp.pendingStartMs = 0;
    this.mp.hostTrackSent = false;
    this.mp.guestReady = false;
    this.mp.hostCountdownStarted = false;
    this.mp.hostLaunched = false;
    this.mp.overSent = false;
    this.mp.resolved = false;
    this.mp.iFinished = false;
    this.mp.peer = { y: this.world.groundY - 54, g: true, f: false, s: 0, c: 0, co: 0, st: 'wait' };
    this._vsCache = { my: -1, peer: -1 };

    document.getElementById('mp-lobby').style.display = 'none';
    document.getElementById('mp-status').style.display = 'block';
    document.getElementById('mp-code-label').textContent = `КОМНАТА АКТИВНА: ${this.mp.code}`;
    document.getElementById('peer-panel').style.display = 'none';
    document.getElementById('guest-wait').style.display = 'none';
    const res = document.getElementById('mp-result');
    res.style.display = 'none';
    res.textContent = '';
    this.hideMpProgress();
    this.updatePeerHud();
    if (this.mp.isHost) {
      this.refreshSourceUI();
      this.setMpHint('Комната жива! Загрузи новый трек — матч перезапустится автоматически.');
    } else {
      document.getElementById('btn-select-file').style.display = 'none';
      document.getElementById('btn-yt-start').style.display = 'none';
      document.getElementById('guest-wait').style.display = 'block';
      this.setMpHint('Комната жива! Ждём новый трек от хоста...');
    }
  }

  /** better20: explicit leave — closes the peer connection (destructive). */
  leaveRoom() {
    this.resetMpView();
    this.setMpHint('Ты покинул комнату.');
  }

  /** better19: floating "TRACK CLEARED / +coins" banner over the menu. */
  showMenuToast(text) {
    const t = document.getElementById('menu-toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2900);
  }

  triggerGameOver() {
    this.isGameOver = true;
    this.stopRiser();
    document.getElementById('finale-banner').style.display = 'none';
    if (this.mp.active && this.mp.peer.st !== 'dead' && this.mp.peer.st !== 'done' && this.mp.peer.st !== 'left') {
      // better20 SPECTATE: in a duel the match goes on without you — keep the
      // world scrolling + the music playing, hand the camera to your friend
      // and let the wheel / + - buttons zoom in on his ghost.
      this.spectating = true;
      this.cam.tz = 1.7;
      this.cam.zoom = 1.0;
      this.showSpectateBar();
      this.finishMpResult(false);
      return;
    }
    this.isPlayingTrack = false;
    this.audio.stop();
    this.renderShopUI();
    this.showGameOver(false);
    if (this.mp.active) {
      this.mp.peer.st = this.mp.peer.st === 'play' ? 'play' : this.mp.peer.st;
      this.finishMpResult(false);
    }
  }

  // ---------------- better20: spectate camera ----------------

  showSpectateBar() {
    const bar = document.getElementById('spectate-bar');
    if (bar) bar.style.display = 'flex';
  }

  hideSpectateBar() {
    const bar = document.getElementById('spectate-bar');
    if (bar) bar.style.display = 'none';
  }

  spectateZoom(delta) {
    if (!this.spectating) return;
    this.cam.tz = Math.max(1.0, Math.min(3.0, this.cam.tz + delta));
  }

  /**
   * Applies the spectate camera transform to the 2D scene context.
   * Zooms around the friend's ghost (same lane x, y follows his jumps).
   * Pass a truthy dt ONLY on the first call of the frame (smooth zoom);
   * subsequent calls in the same frame pass 0 so the zoom isn't double-lerped.
   */
  applySpectateCamera(ctx, dt = 0) {
    const ghostY = this.mp.peer.y;
    const focusX = VIRTUAL_WIDTH * 0.42;           // friend's lane, slightly left of center
    const focusY = Math.max(180, Math.min(VIRTUAL_HEIGHT - 160, ghostY + 24));
    if (dt) this.cam.zoom += (this.cam.tz - this.cam.zoom) * Math.min(1, dt * 5);
    const z = this.cam.zoom;
    ctx.translate(focusX * (1 - z), focusY * (1 - z));
    ctx.scale(z, z);
  }

  // ---------------- Main loop ----------------

  loop(timeMs) {
    // better20 FIX: schedule the NEXT frame FIRST, before anything else can
    // run. The old code called requestAnimationFrame at the very end, so the
    // `return` in the TRACK CLEAR branch (and any runtime error) permanently
    // killed the render chain — the menu still worked, music kept playing,
    // but every new run was a frozen picture ("only music plays" bug).
    requestAnimationFrame((t) => this.loop(t));

    // better20 FIX: one broken frame must never freeze the whole game.
    // Errors are throttled so a persistent problem can't spam the console.
    try {
      this.frame(timeMs);
    } catch (err) {
      const now = performance.now();
      if (!this._lastLoopErrAt || now - this._lastLoopErrAt > 3000) {
        this._lastLoopErrAt = now;
        console.error('[NOCTURNE loop]', err);
      }
    }
  }

  frame(timeMs) {
    const timeSeconds = timeMs * 0.001;
    const rawDt = Math.min(timeSeconds - (this.lastTime || timeSeconds), 0.25);
    const dt = Math.min(rawDt, 0.04);
    this.lastTime = timeSeconds;

    // better19: adaptive resolution governor — watches the real frame time and
    // scales the internal render buffers down/up so weak GPUs hold ~60fps
    // (this is what kills the "other themes lag" problem on any device)
    if (!document.hidden && this.pauseState === 'none') {
      this._frameAvg = this._frameAvg * 0.95 + rawDt * 1000 * 0.05;
      this._frameTimer += rawDt;
      this._scaleCooldown -= rawDt;
      if (this._frameTimer > 1.5) {
        this._frameTimer = 0;
        if (this._frameAvg > 22.5 && this.renderScale > 0.62) {
          this.renderScale = Math.max(0.6, this.renderScale - 0.15);
          this.resize();
        } else if (this._frameAvg < 14.5 && this.renderScale < 1.0 && this._scaleCooldown <= 0) {
          this.renderScale = Math.min(1.0, this.renderScale + 0.1);
          this._scaleCooldown = 7;
          this.resize();
        }
      }
    } else {
      this._frameAvg = 16.7;
      this._frameTimer = 0;
    }

    const isKickHit = this.audio.update();
    const elapsed = this.audio.getElapsedTime();
    this.beatPhase = this.audio.getNextKickProgress(elapsed);

    this.player.comboLevel = this.combo;
    const currentEnergy = (this.audio.kickIntensity || 0.0) + (this.audio.frequencyData ? this.audio.frequencyData.reduce((a, b) => a + b, 0) / (this.audio.frequencyData.length * 255) : 0.1);
    this.recentEnergyAvg = this.recentEnergyAvg * 0.95 + currentEnergy * 0.05;
    const suddenDrop = this.isPlayingTrack && !this.isGameOver && this.recentEnergyAvg > 0.08 && currentEnergy < 0.015;
    if (suddenDrop) {
      this.silenceEffect = Math.min(1.0, this.silenceEffect + dt * 4.0);
    } else {
      if (this.silenceEffect > 0.45 && currentEnergy > 0.07 && this.isPlayingTrack) {
        this.beatPulse = 1.3;
        this.particles.emitFinaleStorm(this.player.x + 20, this.player.y + 20, this.world.groundY, 0.85);
        this.particles.emitJudgment('⚡ ДРОП! ⚡', this.player.x + 20, this.player.y - 45, 'PERFECT');
      }
      this.silenceEffect = Math.max(0.0, this.silenceEffect - dt * 3.2);
    }

    const isSnareHit = this.audio.isSnareHit ? this.audio.isSnareHit() : (this.audio.snareIntensity > 0.65);
    if (isSnareHit && this.isPlayingTrack) {
      this.snareEnergy = 1.0;
      this.particles.emitSnareHit(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
    }
    this.snareEnergy = Math.max(0.0, this.snareEnergy - dt * 5.0);

    if (isKickHit) {
      this.beatPulse = 1.0;
      const ind = this.dom.beat;
      ind.classList.add('pulse');
      setTimeout(() => ind.classList.remove('pulse'), 85);
      this.particles.emitKickShock(
        this.player.x + this.player.width / 2,
        this.player.y + this.player.height / 2,
        this.world.groundY,
        Math.min(1, (0.5 + (this.audio.kickIntensity || 0) * 0.7) * (1 + this.finale * 0.8))
      );
    }
    this.beatPulse = Math.max(0, this.beatPulse - dt * 4.8);

    this.updateFinale(elapsed);
    this.updateCalibration();
    this.updateVsPanel();

    // better17: shockwave volleys during the TRACK CLEAR blast
    if (this.blastT > 0) {
      this.blastT -= dt;
      this.blastVolley -= dt;
      if (this.blastVolley <= 0) {
        this.blastVolley = 0.34;
        this.particles.emitKickShock(
          this.player.x + 20,
          this.player.y + 20,
          this.world.groundY,
          1.35
        );
      }
      if (this.blastT <= 0) {
        this.blastT = 0;
        this.triggerTrackComplete();
        return;
      }
    }

    // better19: FEVER state (combo 20+) — crimson road edge + wider coin magnet
    this.world.fever = this.combo >= 20 && this.isPlayingTrack && !this.isGameOver;

    const frozen = this.pauseState !== 'none' || document.hidden;
    // better20: a dead duel participant keeps SPECTATING — the world, the
    // music and his friend's run go on (no scoring, no collisions for him).
    if (this.isPlayingTrack && !frozen && (!this.isGameOver || this.spectating)) {
      this.player.update(dt);
      const finaleCoinBonus = this.finale > 0 ? 2 : 1;
      const hit = this.world.update(dt, this.player, elapsed, (coin) => {
        const val = Math.max(2, Math.round((coin.bonus ? 8 : 4) * this.bpmCoinMult * (1 + Math.min(this.combo * 0.05, 1.5)) * finaleCoinBonus));
        this.runCoins += val;
        this.store.addCoins(val);
        this.dom.coins.textContent = `${this.store.data.coins} (+${this.runCoins})`;
        this.particles.emitJudgment(`+${val} МОНЕТ`, coin.x, coin.y - 10, 'PERFECT');
      }, (portal) => {
        // better18: portal pass-through reward — scales with combo in fever
        const val = Math.max(2, Math.round(6 * this.bpmCoinMult * (this.finale > 0 ? 2 : 1) * (this.world.fever ? 1.5 : 1)));
        this.runCoins += val;
        this.store.addCoins(val);
        this.world.score += 80;
        this.dom.coins.textContent = `${this.store.data.coins} (+${this.runCoins})`;
        this.particles.emitPortalBurst(portal.cx, this.world.groundY - 20);
        this.particles.emitJudgment('ПОРТАЛ!', portal.cx, this.world.groundY - 190, 'PERFECT');
      }, (pl, power) => {
        // better19: landing dust puff scaled by impact speed
        this.particles.emitJumpDust(pl.x + pl.width / 2, pl.y + pl.height, Math.round(5 + power * 14), false);
      }, this.spectating);
      this.particles.update(dt);
      if (hit && !this.spectating && this.blastT <= 0) {
        this.triggerGameOver();
      }
    } else {
      this.player.update(dt);
      if (this.player.y + this.player.height >= this.world.groundY) {
        this.player.y = this.world.groundY - this.player.height;
        this.player.vy = 0;
        this.player.isGrounded = true;
      }
      this.particles.update(dt);
    }

    // Multiplayer state broadcast (~10 Hz)
    if (this.mp.active && this.isPlayingTrack && !this.isGameOver && this.pauseState === 'none' && timeSeconds - this.mp.lastSend > 0.1) {
      this.mp.lastSend = timeSeconds;
      this.net.sendState(
        Math.round(this.player.y * 10) / 10,
        this.player.isGrounded,
        this.player.isFlipping,
        Math.floor(this.world.score),
        this.combo,
        this.runCoins,
        'play'
      );
      // YouTube host: broadcast the reference clock for guest drift correction
      if (this.trackSource === 'yt' && this.mp.isHost && timeSeconds - (this.mp.lastSync || 0) > 2) {
        this.mp.lastSync = timeSeconds;
        this.net.send({ t: 'yt_sync', tt: this.audio.getElapsedTime() });
      }
    }

    this.dom.score.textContent = Math.floor(this.world.score);

    // 1. Render 2D Scene scaled from virtual 1280x720 to native resolution
    this.sceneCtx.save();
    this.sceneCtx.fillStyle = P.paper;
    this.sceneCtx.fillRect(0, 0, this.sceneCanvas.width, this.sceneCanvas.height);

    const scaleX = this.sceneCanvas.width / VIRTUAL_WIDTH;
    const scaleY = this.sceneCanvas.height / VIRTUAL_HEIGHT;
    this.sceneCtx.scale(scaleX, scaleY);

    // better20: the spectate camera zooms in on the friend's ghost
    const spectating = this.spectating && this.mp.active;

    this.sceneCtx.save();
    if (spectating) this.applySpectateCamera(this.sceneCtx, dt);
    const mel = this.audio.getMelodyAt(elapsed);
    this.world.render(this.sceneCtx, this.beatPulse, this.audio.kickIntensity, this.finale, {
      t: elapsed,
      melody: mel.level,
      pitch: mel.pitch
    });
    this.sceneCtx.restore();

    // Snare hit corner slash flash
    if (this.snareEnergy > 0.05) {
      this.sceneCtx.save();
      this.sceneCtx.globalAlpha = this.snareEnergy * 0.65;
      this.sceneCtx.strokeStyle = P.crimson;
      this.sceneCtx.lineWidth = 6 * this.snareEnergy;
      this.sceneCtx.strokeRect(10, 10, VIRTUAL_WIDTH - 20, VIRTUAL_HEIGHT - 20);
      this.sceneCtx.restore();
    }

    // Silence / Breakdown vignette & seal
    if (this.silenceEffect > 0.01) {
      this.sceneCtx.save();
      this.sceneCtx.fillStyle = `rgba(14, 10, 14, ${this.silenceEffect * 0.72})`;
      this.sceneCtx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      this.sceneCtx.strokeStyle = P.accent;
      this.sceneCtx.lineWidth = 2.0;
      this.sceneCtx.globalAlpha = this.silenceEffect;
      this.sceneCtx.beginPath();
      this.sceneCtx.arc(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 40, 68 * this.silenceEffect, 0, Math.PI * 2);
      this.sceneCtx.stroke();
      this.sceneCtx.fillStyle = P.pale;
      this.sceneCtx.font = '900 22px Georgia, serif';
      this.sceneCtx.textAlign = 'center';
      this.sceneCtx.fillText('— БЕЗДНА ТИШИНЫ —', VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 34);
      this.sceneCtx.restore();
    }

    // Top Track Progress Bar & Fever Banner
    if (this.isPlayingTrack && (!this.isGameOver || this.spectating)) {
      const dur = Math.max(1, this.audio.getDuration() || 1);
      const prog = Math.max(0, Math.min(1, elapsed / dur));
      this.sceneCtx.save();
      this.sceneCtx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      this.sceneCtx.fillRect(0, 0, VIRTUAL_WIDTH, 6);
      this.sceneCtx.fillStyle = this.combo >= 20 ? P.crimson : P.accent;
      this.sceneCtx.fillRect(0, 0, VIRTUAL_WIDTH * prog, 6);
      if (this.combo >= 15) {
        this.sceneCtx.font = '900 15px Georgia, serif';
        this.sceneCtx.textAlign = 'right';
        this.sceneCtx.fillStyle = P.crimson;
        this.sceneCtx.fillText('🔥 FEVER x' + this.combo, VIRTUAL_WIDTH - 92, 56);
      }
      this.sceneCtx.restore();
    }
    if (this.mp.active && this.mp.peer.st === 'play' && this.isPlayingTrack) {
      this.sceneCtx.save();
      if (spectating) this.applySpectateCamera(this.sceneCtx, false);
      this.player.renderGhost(this.sceneCtx, this.mp.peer.y, this.mp.peer.f, this.mp.peer.c);
      this.sceneCtx.restore();
    }
    this.sceneCtx.save();
    if (spectating) this.applySpectateCamera(this.sceneCtx, false);
    if (this.spectating) {
      // my fallen runner fades into the ink — the friend owns the stage now
      this.sceneCtx.save();
      this.sceneCtx.globalAlpha = 0.16;
      this.player.render(this.sceneCtx, this.beatPhase, false, this.world.groundY, this.beatPulse);
      this.sceneCtx.restore();
    } else {
      this.player.render(this.sceneCtx, this.beatPhase, this.isPlayingTrack && !this.isGameOver, this.world.groundY, this.beatPulse);
    }
    this.particles.render(this.sceneCtx);
    this.sceneCtx.restore();
    this.sceneCtx.restore();

    // 2. Upload to WebGL
    const gl = this.glCtx.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sceneCanvas);

    // 3. Post-Process Shader (style + finale uniforms)
    const themeVec = themeAccentVec(this.themeId);
    gl.useProgram(this.program);
    gl.uniform1f(this.uTime, timeSeconds);
    gl.uniform2f(this.uResolution, this.glCanvas.width, this.glCanvas.height);
    gl.uniform1f(this.uBeatPulse, this.beatPulse);
    gl.uniform1f(this.uKickEnergy, Math.max(this.audio.kickIntensity || 0.0, this.snareEnergy * 0.75));
    gl.uniform1f(this.uBiomeProgress, this.world.biomeStage || 0.0);
    gl.uniform1f(this.uStyle, THEMES[this.themeId] ? THEMES[this.themeId].style : 0);
    gl.uniform1f(this.uFinale, this.finale);
    gl.uniform3f(this.uAccent, themeVec.accent[0], themeVec.accent[1], themeVec.accent[2]);
    gl.uniform3f(this.uInk, themeVec.ink[0], themeVec.ink[1], themeVec.ink[2]);
    gl.uniform3f(this.uCrimson, themeVec.crimson[0], themeVec.crimson[1], themeVec.crimson[2]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uSceneTexture, 0);

    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glCtx.quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  window.__app = app; // debug/diagnostics hook
});
