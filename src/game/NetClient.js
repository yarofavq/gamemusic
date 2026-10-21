// NOCTURNE RHYTHM — PeerJS multiplayer client (better16)
// Works on static hosting (GitHub Pages): WebRTC DataChannels via the free
// PeerJS cloud broker. Host owns the room ID = room code, transfers the audio
// track + verified kick map to the guest, then both run a synced countdown.

const ROOM_PREFIX = 'noctrhy-b16-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ2456789';
// Public ICE set: Google/Twilio STUN + free OpenRelay TURN. The room code is
// resolved through the PeerJS cloud broker, so a friend can join from ANY
// network/IP; TURN covers strict NATs (mobile data, corporate firewalls).
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  }
};
// Track transfer goes as base64-in-JSON chunks: string payloads proved 100%
// reliable over PeerJS's BinaryPack, raw ArrayBuffer bursts did not.
const RAW_CHUNK = 6144;              // raw bytes per chunk -> ~8200 base64 chars (< 16KB pack MTU)
const CHUNK_PUMP_MS = 12;
const CHUNKS_PER_TICK = 6;

function genCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

export class NetClient {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.handlers = {};
    this.isHost = false;
    this.roomCode = '';
    this.destroyed = false;

    // Track transfer job (host side)
    this.trackJob = null;
    this.pumpTimer = null;
    // Track receive job (guest side)
    this.rxJob = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, msg) {
    const fn = this.handlers[type];
    if (fn) fn(msg || {});
  }

  destroy() {
    this.destroyed = true;
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    this.trackJob = null;
    this.rxJob = null;
    try { if (this.conn) this.conn.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
    this.conn = null;
    this.peer = null;
  }

  /** Load PeerJS lib (CDN with fallback) and open an anonymous peer. */
  async ensurePeer() {
    if (this.peer && !this.peer.destroyed && this.peer.open) return this.peer;
    this.destroyed = false;
    if (!window.Peer) {
      const cdns = [
        'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
        'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'
      ];
      let loaded = false;
      for (const src of cdns) {
        try {
          await loadScript(src);
          if (window.Peer) { loaded = true; break; }
        } catch (_) {}
      }
      if (!loaded) throw new Error('Не удалось загрузить модуль связи. Проверь интернет.');
    }
    return new Promise((resolve, reject) => {
      this.peer = new Peer(PEER_OPTS);
      const to = setTimeout(() => reject(new Error('Сервис комнат не отвечает.')), 15000);
      this.peer.on('open', () => {
        clearTimeout(to);
        resolve(this.peer);
      });
      this.peer.on('error', (err) => {
        clearTimeout(to);
        reject(new Error(this.humanError(err)));
      });
    });
  }

  humanError(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'Комната не найдена. Проверь код.';
    if (t === 'unavailable-id') return 'Код занят, пробую другой...';
    if (t === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
    if (t === 'network' || t === 'socket-error' || t === 'server-error') return 'Нет связи с сервисом комнат.';
    return 'Ошибка сети: ' + (t || 'unknown');
  }

  wireConn(conn) {
    conn.on('data', (data) => this.onData(data));
    conn.on('close', () => {
      if (!this.destroyed) this.emit('peer_left');
    });
    conn.on('error', () => {
      if (!this.destroyed) this.emit('peer_left');
    });
  }

  /** HOST: create a room. Retries with a new code if the ID is taken. */
  async hostCreate() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = genCode();
      try {
        const peer = await new Promise((resolve, reject) => {
          const p = new Peer(ROOM_PREFIX + code, PEER_OPTS);
          const to = setTimeout(() => reject(new Error('Сервис комнат не отвечает.')), 15000);
          p.on('open', () => { clearTimeout(to); resolve(p); });
          p.on('error', (err) => { clearTimeout(to); reject(err); });
        });
        this.isHost = true;
        this.roomCode = code;
        this.peer = peer;
        peer.on('connection', (conn) => {
          if (this.conn && this.conn.open) {
            // Room for two: reject extra connections politely
            try { conn.close(); } catch (_) {}
            return;
          }
          this.conn = conn;
          this.wireConn(conn);
          conn.on('open', () => this.emit('peer'));
        });
        this.emit('created', { code });
        return;
      } catch (err) {
        if (err && err.type === 'unavailable-id') continue;
        this.emit('error', { msg: this.humanError(err) });
        return;
      }
    }
    this.emit('error', { msg: 'Не удалось получить код комнаты, попробуй ещё раз.' });
  }

  /** GUEST: join by code. */
  async join(code) {
    try {
      await this.ensurePeer();
    } catch (err) {
      this.emit('error', { msg: err.message });
      return;
    }
    const clean = String(code || '').trim().toUpperCase();
    this.isHost = false;
    this.roomCode = clean;
    const conn = this.peer.connect(ROOM_PREFIX + clean, { reliable: true });
    const to = setTimeout(() => this.emit('error', { msg: 'Комната не отвечает.' }), 15000);
    conn.on('open', () => {
      clearTimeout(to);
      this.conn = conn;
      this.wireConn(conn);
      this.emit('joined', { code: clean });
    });
    this.peer.on('error', (err) => {
      clearTimeout(to);
      this.emit('error', { msg: this.humanError(err) });
    });
  }

  onData(data) {
    let msg;
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (_) {
      return;
    }
    if (!msg || !msg.t) return;
    if (msg.t === 'track_meta') {
      this.rxJob = { name: msg.name || 'Трек хоста', size: msg.size || 0, map: msg.map || {}, b64: [], got: 0, lastRx: Date.now() };
      this.emit('track_meta', { name: this.rxJob.name, size: this.rxJob.size });
      // Guest-side watchdog: silent channel for 20s after meta -> give up
      if (this.rxWatchdog) clearInterval(this.rxWatchdog);
      this.rxWatchdog = setInterval(() => {
        if (!this.rxJob) {
          clearInterval(this.rxWatchdog);
          this.rxWatchdog = null;
          return;
        }
        if (Date.now() - this.rxJob.lastRx > 20000) {
          clearInterval(this.rxWatchdog);
          this.rxWatchdog = null;
          this.rxJob = null;
          this.emit('error', { msg: 'Трек перестал передаваться. Попросите хоста отправить заново.' });
        }
      }, 4000);
      return;
    }
    if (msg.t === 'tk') {
      if (!this.rxJob) return;
      this.rxJob.lastRx = Date.now();
      const bin = atob(msg.d);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.rxJob.b64.push(bytes);
      this.rxJob.got += bytes.length;
      this.emit('track_progress', { got: this.rxJob.got, size: this.rxJob.size });
      if (this.rxJob.got >= this.rxJob.size) {
        const parts = this.rxJob.b64;
        const total = this.rxJob.size;
        const name = this.rxJob.name;
        const map = this.rxJob.map;
        this.rxJob = null;
        const out = new Uint8Array(total);
        let off = 0;
        for (const part of parts) {
          out.set(part, off);
          off += part.length;
        }
        this.emit('track_done', { buffer: out.buffer, name, map });
      }
      return;
    }
    if (msg.t === 'track_end') {
      // Host signalled completion; if some bytes are missing the transfer failed
      if (this.rxJob && this.rxJob.got < this.rxJob.size) {
        this.emit('error', { msg: 'Трек передался не полностью. Попроси хоста отправить снова.' });
        this.rxJob = null;
      }
      return;
    }
    // Peer->peer renames: state/over arrive FROM the other side
    if (msg.t === 'state') msg.t = 'peer_state';
    if (msg.t === 'over') msg.t = 'peer_over';
    // Everything else is forwarded: start / pause / resume / peer_state / peer_over
    this.emit(msg.t, msg);
  }

  send(obj) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(JSON.stringify(obj));
      } catch (e) {
        this.emit('error', { msg: 'Ошибка отправки данных: ' + (e && e.message ? e.message : 'unknown') });
      }
    }
  }

  /** HOST: push the audio file + verified beat map to the guest. */
  sendTrack(name, arrayBuffer, map) {
    if (!this.conn || !this.conn.open) {
      this.emit('error', { msg: 'Нет соединения с напарником.' });
      return;
    }
    this.trackJob = { buf: new Uint8Array(arrayBuffer), offset: 0, name, map, lastProgress: Date.now() };
    this.send({ t: 'track_meta', name, size: arrayBuffer.byteLength, map });
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = setInterval(() => this.pumpChunks(), CHUNK_PUMP_MS);
    // Watchdog: if nothing moves for 12s the channel is wedged -> tell the user
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = setInterval(() => {
      if (!this.trackJob) {
        clearInterval(this.stallTimer);
        this.stallTimer = null;
        return;
      }
      if (Date.now() - this.trackJob.lastProgress > 12000) {
        clearInterval(this.pumpTimer);
        this.pumpTimer = null;
        clearInterval(this.stallTimer);
        this.stallTimer = null;
        this.trackJob = null;
        this.emit('error', { msg: 'Передача трека застряла. Пересоздайте комнату и попробуйте снова.' });
      }
    }, 3000);
  }

  pumpChunks() {
    if (!this.conn || !this.conn.open || !this.trackJob) {
      if (this.pumpTimer) clearInterval(this.pumpTimer);
      this.pumpTimer = null;
      return;
    }
    const job = this.trackJob;
    for (let k = 0; k < CHUNKS_PER_TICK && job.offset < job.buf.byteLength; k++) {
      const end = Math.min(job.offset + RAW_CHUNK, job.buf.byteLength);
      try {
        const b64 = this.bytesToB64(job.buf.subarray(job.offset, end));
        this.conn.send(JSON.stringify({ t: 'tk', d: b64 }));
      } catch (e) {
        clearInterval(this.pumpTimer);
        this.pumpTimer = null;
        this.trackJob = null;
        this.emit('error', { msg: 'Канал передачи оборвался: ' + (e && e.message ? e.message : 'unknown') });
        return;
      }
      job.offset = end;
    }
    job.lastProgress = Date.now();
    this.emit('track_sending', { got: job.offset, size: job.buf.byteLength });
    if (job.offset >= job.buf.byteLength) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
      this.trackJob = null;
      this.send({ t: 'track_end' });
      this.emit('track_sent', {});
    }
  }

  bytesToB64(bytes) {
    let s = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(s);
  }

  sendStart(delay) {
    this.send({ t: 'start', delay });
  }

  sendPause() {
    this.send({ t: 'pause' });
  }

  sendResume(delay) {
    this.send({ t: 'resume', delay });
  }

  sendState(y, g, f, s, c, co, st) {
    this.send({ t: 'state', y, g, f, s, c, co, st });
  }

  sendOver(score, maxCombo, coins, finished) {
    this.send({ t: 'over', score, maxCombo, coins, finished });
  }
}
