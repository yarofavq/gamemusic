// ============================================================
// LyricsEngine (better18): song lyrics rendered on the background.
// - ID3v2 tag reading (TIT2/TPE1) for local audio files
// - YouTube title cleaning (strips "(Official Video)" junk)
// - lrclib.net free public lyrics API (CORS-enabled, no key, no backend)
// - LRC parsing + plain-lyrics time distribution
// - script/stopword language detection
// - elegant synced canvas rendering (fade, drift, glow, language badge)
// ============================================================

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/search';

/**
 * Minimal ID3v2.3/2.4 reader for the first KBs of a file.
 * Returns { title, artist } (either may be '').
 */
export function parseId3Tags(buf) {
  const res = { title: '', artist: '' };
  try {
    const u8 = new Uint8Array(buf);
    if (u8.length < 20 || u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return res; // "ID3"
    const ver = u8[3];
    const tagSize = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
    const end = Math.min(10 + tagSize, u8.length);
    let pos = 10;
    while (pos + 10 <= end) {
      const id = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      let fsize;
      if (ver === 4) {
        fsize = ((u8[pos + 4] & 0x7f) << 21) | ((u8[pos + 5] & 0x7f) << 14) | ((u8[pos + 6] & 0x7f) << 7) | (u8[pos + 7] & 0x7f);
      } else {
        fsize = ((u8[pos + 4] << 24) | (u8[pos + 5] << 16) | (u8[pos + 6] << 8) | u8[pos + 7]) >>> 0;
      }
      const frameStart = pos + 10;
      if (fsize <= 0 || frameStart + fsize > end) break;

      if (id === 'TIT2' || id === 'TPE1') {
        const enc = u8[frameStart];
        let raw = u8.subarray(frameStart + 1, frameStart + fsize);
        let text = '';
        if (enc === 1 || enc === 2) {
          let be = enc === 2;
          if (raw[0] === 0xff && raw[1] === 0xfe) { be = false; raw = raw.subarray(2); }
          else if (raw[0] === 0xfe && raw[1] === 0xff) { be = true; raw = raw.subarray(2); }
          for (let i = 0; i + 1 < raw.length; i += 2) {
            const code = be ? ((raw[i] << 8) | raw[i + 1]) : ((raw[i + 1] << 8) | raw[i]);
            if (code) text += String.fromCharCode(code);
          }
        } else if (enc === 3) {
          text = new TextDecoder('utf-8').decode(raw);
        } else {
          // Latin1 nominally, but RU rippers store windows-1251 here
          try { text = new TextDecoder('windows-1251').decode(raw); }
          catch (_) { text = new TextDecoder('iso-8859-1').decode(raw); }
        }
        text = text.replace(/\0/g, '').trim();
        if (id === 'TIT2' && !res.title) res.title = text;
        if (id === 'TPE1' && !res.artist) res.artist = text;
      }
      pos = frameStart + fsize;
    }
  } catch (_) {}
  return res;
}

/**
 * "01 - Artist - Song.mp3" -> { artist, title }
 */
export function guessFromFilename(name) {
  let base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  base = base.replace(/^\d{1,3}[\s.\-]+/, '');
  const m = base.match(/^(.{2,60}?)\s+[-\u2013\u2014]\s+(.{2,90})$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base };
}

/**
 * YouTube video title -> { artist, title } with junk stripped.
 */
export function cleanVideoTitle(raw) {
  let t = String(raw || '');
  const junk = [
    /\((?:official\s+)?(?:music\s+)?video\)/gi,
    /\[(?:official\s+)?(?:music\s+)?video\]/gi,
    /\((?:official\s+)?audio\)/gi,
    /\[(?:official\s+)?audio\]/gi,
    /\(official\)/gi,
    /\[official\]/gi,
    /\(lyrics?\s*(?:video)?\)/gi,
    /\[lyrics?\s*(?:video)?\]/gi,
    /\((?:hd|hq|4k|remaster(?:ed)?)\)/gi,
    /\[(?:hd|hq|4k|remaster(?:ed)?)\]/gi,
    /\((?:visualizer)\)/gi,
    /\[visualizer\]/gi,
    /\|\s*official.*$/i
  ];
  for (const re of junk) t = t.replace(re, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  const feat = t.match(/^(.{2,60}?)\s*(?:feat\.?|ft\.?|featuring)\s+(.{2,60})\s*[-\u2013\u2014]\s*(.{2,80})$/i);
  if (feat) return { artist: feat[1].trim(), title: feat[3].trim() };
  const m = t.match(/^(.{2,60}?)\s+[-\u2013\u2014]\s+(.{2,90})$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: t };
}

// ---------------- language detection ----------------

const SCRIPT_TESTS = [
  { re: /[\u0400-\u04FF]/, name: 'cyrillic' },
  { re: /[\uAC00-\uD7AF]/, name: 'hangul' },
  { re: /[\u3040-\u30FF]/, name: 'kana' },
  { re: /[\u4E00-\u9FFF]/, name: 'han' },
  { re: /[\u0600-\u06FF]/, name: 'arabic' },
  { re: /[\u0900-\u097F]/, name: 'devanagari' },
  { re: /[\u0E00-\u0E7F]/, name: 'thai' },
  { re: /[\u0370-\u03FF]/, name: 'greek' },
  { re: /[\u0590-\u05FF]/, name: 'hebrew' }
];

const LATIN_MARKERS = [
  { re: /\b(the|and|you|is|are|was|that|this|with|for|my|have|not|yeah|oh)\b/gi, label: 'АНГЛИЙСКИЙ' },
  { re: /\b(der|die|das|und|ich|nicht|ist|du|mit|ein|eine|auch)\b/gi, label: 'НЕМЕЦКИЙ' },
  { re: /\b(je|les|et|pas|pour|avec|mon|mais|vous)\b/gi, label: 'ФРАНЦУЗСКИЙ' },
  { re: /\b(los|las|que|por|para|con|pero|como)\b/gi, label: 'ИСПАНСКИЙ' },
  { re: /\b(che|di|sono|non|per|con|anche|questo)\b/gi, label: 'ИТАЛЬЯНСКИЙ' },
  { re: /\b(n\u00e3o|nao|voc\u00ea|voce|com|para|meu|minha|mais)\b/gi, label: 'ПОРТУГАЛЬСКИЙ' },
  { re: /\b(nie|jest|si\u0119|sie|tylko|tak|ale)\b/gi, label: 'ПОЛЬСКИЙ' },
  { re: /\b(bir|ben|i\u00e7in|icin|de\u011fil|degil|benim|seni)\b/gi, label: 'ТУРЕЦКИЙ' }
];

/**
 * Returns a Russian human-readable language label like 'АНГЛИЙСКИЙ'.
 */
export function detectLanguage(text) {
  const sample = String(text || '').slice(0, 6000);
  if (!sample.trim()) return '';
  const counts = {};
  for (const ch of sample) {
    for (const s of SCRIPT_TESTS) {
      if (s.re.test(ch)) { counts[s.name] = (counts[s.name] || 0) + 1; break; }
    }
  }
  if ((counts.hangul || 0) > 2) return 'КОРЕЙСКИЙ';
  if ((counts.kana || 0) > 2) return 'ЯПОНСКИЙ';
  if ((counts.han || 0) > 4) return 'КИТАЙСКИЙ';
  if ((counts.arabic || 0) > 4) return 'АРАБСКИЙ';
  if ((counts.devanagari || 0) > 4) return 'ХИНДИ';
  if ((counts.thai || 0) > 4) return 'ТАЙСКИЙ';
  if ((counts.greek || 0) > 4) return 'ГРЕЧЕСКИЙ';
  if ((counts.hebrew || 0) > 4) return 'ИВРИТ';
  if ((counts.cyrillic || 0) > 6) {
    const uk = (sample.match(/[\u0456\u0457\u0454\u0491]|\b(та|що|це|його)\b/gi) || []).length;
    return uk >= 2 ? 'УКРАИНСКИЙ' : 'РУССКИЙ';
  }
  // Latin: score marker words across the text
  let best = 'АНГЛИЙСКИЙ';
  let bestScore = 0;
  for (const m of LATIN_MARKERS) {
    const n = (sample.match(m.re) || []).length;
    if (n > bestScore) { bestScore = n; best = m.label; }
  }
  return best;
}

// ---------------- LRC parsing ----------------

/**
 * "[mm:ss.xx] text" lines -> [{ t, line }] sorted by time.
 */
export function parseLrc(lrcText) {
  const out = [];
  for (const raw of String(lrcText || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/);
    if (!m) continue;
    const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
    const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
    const line = m[4].replace(/\s+/g, ' ').trim();
    if (line && !/^\u25c6|^ti:|^ar:|^al:|^by:|^offset:/i.test(line)) out.push({ t, line });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Distribute plain (unsynced) lyrics across the track duration
 * weighted by line length.
 */
function distributePlain(plainText, duration) {
  const raw = String(plainText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length || !duration) return [];
  const weights = raw.map((s) => Math.max(8, s.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = Math.min(3, duration * 0.02);
  const usable = Math.max(10, duration - t - 4);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    out.push({ t: Math.round(t * 100) / 100, line: raw[i] });
    t += (weights[i] / total) * usable;
  }
  return out;
}

/**
 * Query lrclib.net (free, public, CORS: yes) for synced lyrics.
 * Returns null when nothing found / network error — the game silently
 * continues without lyrics.
 */
export async function fetchLyrics({ title, artist, duration }) {
  if (!title) return null;
  const qs = new URLSearchParams();
  if (artist) {
    qs.set('artist_name', artist);
    qs.set('track_name', title);
  } else {
    qs.set('q', title);
  }
  if (duration) qs.set('duration', String(Math.round(duration)));
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(`${LRCLIB_ENDPOINT}?${qs.toString()}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) return null;
    let best = null;
    let bestScore = -1e9;
    for (const item of list) {
      let s = 0;
      if (item.syncedLyrics) s += 100;
      if (duration && item.duration) s -= Math.min(80, Math.abs(item.duration - duration)) * 2;
      if (artist && item.artistName && item.artistName.toLowerCase() === artist.toLowerCase()) s += 12;
      if (s > bestScore) { bestScore = s; best = item; }
    }
    if (!best || (!best.syncedLyrics && !best.plainLyrics)) return null;
    return {
      synced: !!best.syncedLyrics,
      lrc: best.syncedLyrics || '',
      plain: best.plainLyrics || ''
    };
  } catch (_) {
    return null;
  }
}

// ---------------- renderer ----------------

export class LyricsTrack {
  constructor() {
    this.lines = [];
    this.lang = '';
    this.synced = false;
    this._idx = -1;
  }

  get ready() { return this.lines.length > 0; }

  clear() {
    this.lines = [];
    this.lang = '';
    this.synced = false;
    this._idx = -1;
  }

  reset() { this._idx = -1; }

  setFromResult(result, duration = 0) {
    this.clear();
    if (!result) return;
    let lines = [];
    if (result.synced && result.lrc) lines = parseLrc(result.lrc);
    if (!lines.length && result.plain) lines = distributePlain(result.plain, duration);
    if (!lines.length) return;
    this.lines = lines;
    this.synced = !!result.synced;
    const all = lines.map((l) => l.line).join(' ');
    this.lang = detectLanguage(all);
  }

  /** Network transfer path (host -> guest) */
  setFromData(lines, lang, synced) {
    this.clear();
    if (!Array.isArray(lines) || !lines.length) return;
    this.lines = lines
      .filter((l) => l && typeof l.t === 'number' && typeof l.line === 'string')
      .sort((a, b) => a.t - b.t);
    this.synced = !!synced;
    this.lang = lang || detectLanguage(this.lines.map((l) => l.line).join(' '));
  }

  lineAt(t) {
    if (!this.lines.length) return -1;
    if (this._idx >= this.lines.length) this._idx = this.lines.length - 1;
    while (this._idx + 1 < this.lines.length && this.lines[this._idx + 1].t <= t) this._idx++;
    while (this._idx >= 0 && this.lines[this._idx].t > t) this._idx--;
    return this._idx;
  }

  /**
   * Draw the current vocal line in the sky area. cx/topY is the anchor,
   * maxW the wrapping width. P is the shared theme palette.
   */
  draw(ctx, t, cx, topY, maxW, P, qualityHigh = true) {
    if (!this.lines.length) return;
    const idx = this.lineAt(t);
    if (idx < 0) return;
    const cur = this.lines[idx];
    const next = this.lines[idx + 1];
    const endT = next ? next.t : cur.t + Math.max(3.2, Math.min(7, (cur.line.length / 12) + 2.5));
    const aIn = Math.max(0, Math.min(1, (t - cur.t) / 0.38));
    const aOut = Math.max(0, Math.min(1, (endT - t) / 0.45));
    const alpha = Math.min(aIn, aOut);
    if (alpha <= 0.02) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- language badge during the first seconds ---
    if (this.lang && t < 6.5) {
      const ba = Math.max(0, Math.min(1, (6.5 - t) / 1.2)) * Math.min(1, t / 0.5);
      ctx.globalAlpha = ba * 0.85;
      ctx.font = '600 13px Georgia, "Times New Roman", serif';
      ctx.fillStyle = P.pale;
      if (qualityHigh) {
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
      }
      ctx.fillText(`\u25c8  ${this.lang}  \u25c8`, cx, topY - 34);
      ctx.shadowBlur = 0;
    }

    // --- main line (wrap to max 2 rows) ---
    let fontSize = 33;
    ctx.font = `italic 600 ${fontSize}px Georgia, "Times New Roman", serif`;
    let words = cur.line.split(' ');
    let rows = [cur.line];
    if (ctx.measureText(cur.line).width > maxW) {
      const mid = Math.ceil(words.length / 2);
      let r1 = words.slice(0, mid).join(' ');
      let r2 = words.slice(mid).join(' ');
      while (r2 && ctx.measureText(r1).width > maxW && r1.includes(' ')) {
        const sp = r1.lastIndexOf(' ');
        r2 = r1.slice(sp + 1) + ' ' + r2;
        r1 = r1.slice(0, sp);
      }
      while (r1 && ctx.measureText(r2).width > maxW && r2.includes(' ')) {
        const sp = r2.indexOf(' ');
        r1 = r1 + ' ' + r2.slice(0, sp);
        r2 = r2.slice(sp + 1);
      }
      rows = r2 ? [r1, r2] : [r1];
    }
    if (rows.some((r) => ctx.measureText(r).width > maxW)) {
      fontSize = Math.max(19, Math.floor(fontSize * (maxW / Math.max(...rows.map((r) => ctx.measureText(r).width)))));
      ctx.font = `italic 600 ${fontSize}px Georgia, "Times New Roman", serif`;
    }

    const drift = -7 * (t - cur.t);
    const rowH = fontSize * 1.28;
    const baseY = topY + drift - (rows.length - 1) * rowH * 0.5;

    ctx.globalAlpha = alpha * 0.92;
    if (qualityHigh) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = P.accent;
    for (let i = 0; i < rows.length; i++) {
      ctx.fillText(rows[i], cx, baseY + i * rowH);
    }

    // thin ink outline for the engraving look
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = 1;
    ctx.strokeStyle = P.ink;
    for (let i = 0; i < rows.length; i++) {
      ctx.strokeText(rows[i], cx, baseY + i * rowH);
    }

    // --- next line preview (whisper) ---
    if (next && next.t - t < 7) {
      ctx.globalAlpha = alpha * 0.16;
      ctx.font = `italic 500 ${Math.round(fontSize * 0.62)}px Georgia, "Times New Roman", serif`;
      ctx.fillStyle = P.pale;
      let preview = next.line;
      if (ctx.measureText(preview).width > maxW) preview = preview.slice(0, 60) + '\u2026';
      ctx.fillText(preview, cx, baseY + rows.length * rowH + 8);
    }

    ctx.restore();
  }
}
