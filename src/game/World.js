import { P } from '../render/Theme.js';

export class World {
  constructor(virtualWidth = 1280, virtualHeight = 720) {
    this.width = virtualWidth;
    this.height = virtualHeight;
    this.groundY = virtualHeight - 130;
    this.scrollX = 0;
    this.speed = 450;
    this.obstacles = [];
    this.coins = [];
    this.clouds = [];
    this.hills = [];
    this.trees = [];
    this.bgGraves = [];
    this.score = 0;
    this._lastScoreT = null;
    this.biomeStage = 0;
    this.shakeEnabled = true;
    this.glowEnabled = true;

    // better18: lyrics on the sky (LyricsTrack, set externally by main)
    this.lyrics = null;
    this.lyricsEnabled = true;
    // better18: vertical reward portals placed between obstacles
    this.portals = [];
    // better18: detailed background layers
    this.stars = [];
    this.skyline = [];
    this.motes = [];
    this.bats = [];
    this.batTimer = 5 + Math.random() * 5;
    // better18: melody-driven floor state
    this.melodyLevel = 0;
    this.melodyPitch = 0.5;
    this._skyGrad = null;
    this._skyKey = '';
    this.comets = [];
    this.cometTimer = 2.0;
    this.lightningBolt = null;
    this.lightningAlpha = 0;

    // better19: quality-scaled detail caps + baked static layers + fever
    this.quality = 'high';
    this.maxStars = 110;
    this.maxMotes = 26;
    this.maxBats = 9;
    this.maxComets = 3;
    this.pillarCount = 32;
    this.liveStars = 16;
    this.fever = false;
    this.onLand = null;
    this._layersDirty = true;
    this._skyCanvas = null;
    this._starCanvas = null;
    this._lastFxT = 0;

    // Jump Lead Time: when player jumps exactly on a kick, they reach peak clearance ~0.16s after jump takeoff.
    // Setting obstacle center arrival to kickTime + 0.16s means jumping ON the kick makes you soar cleanly over the obstacle!
    this.jumpLeadTime = 0.16;

    this.initScenery();
  }

  initScenery() {
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      this.clouds.push({
        x: i * 240 + Math.random() * 80,
        y: 65 + Math.random() * 140,
        w: 110 + Math.random() * 70,
        speed: 24 + Math.random() * 16
      });
    }
    this.hills = [];
    for (let i = 0; i < 5; i++) {
      this.hills.push({
        x: i * 360,
        w: 440,
        h: 140 + (i % 2) * 55
      });
    }
    this.trees = [];
    for (let i = 0; i < 7; i++) {
      this.trees.push({
        x: i * 220 + Math.random() * 70,
        h: 120 + Math.random() * 90,
        twist: (Math.random() - 0.5) * 26
      });
    }
    this.bgGraves = [];
    for (let i = 0; i < 9; i++) {
      this.bgGraves.push({
        x: i * 165 + Math.random() * 50,
        w: 28,
        h: 36 + Math.random() * 18,
        tilt: (Math.random() - 0.5) * 0.18
      });
    }

    // better18: twinkling star field (upper half of the sky)
    this.stars = [];
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height * 0.5,
        r: 0.5 + Math.random() * 1.6,
        tw: Math.random() * Math.PI * 2,
        sp: 0.8 + Math.random() * 2.4
      });
    }

    // better18: gothic skyline silhouettes with lit windows (2x width, wraps)
    this.skyline = [];
    let sx = -40;
    while (sx < this.width * 2 + 200) {
      const bw = 60 + Math.random() * 95;
      const bh = 70 + Math.random() * 150;
      const windows = [];
      for (let wy = 14; wy < bh - 12; wy += 16) {
        for (let wx = 9; wx < bw - 9; wx += 13) {
          if (Math.random() < 0.14) windows.push({ x: wx, y: wy, ph: Math.random() * Math.PI * 2 });
        }
      }
      this.skyline.push({ x: sx, w: bw, h: bh, spire: Math.random() < 0.35, windows });
      sx += bw + 6 + Math.random() * 34;
    }

    // better18: floating dust motes / fireflies drifting above the road
    this.motes = [];
    for (let i = 0; i < 26; i++) {
      this.motes.push({
        x: Math.random() * this.width,
        y: this.groundY - Math.random() * 280,
        r: 1 + Math.random() * 1.8,
        ph: Math.random() * Math.PI * 2,
        sp: 6 + Math.random() * 14
      });
    }
  }

  /**
   * better19: scale scenery detail by the quality setting (low/mid/high).
   * Called by main.js whenever the user changes particle quality — keeps
   * weaker devices smooth while baking the heavy static layers.
   */
  setQuality(level) {
    // better21: new 'ultra' tier = КРАСИВЕЙШИЙ ВИЗУАЛ scenery density
    const q = (this.quality = level === 'low' ? 'low' : level === 'mid' ? 'mid' : level === 'ultra' ? 'ultra' : 'high');
    this.maxStars = q === 'low' ? 45 : q === 'mid' ? 80 : q === 'ultra' ? 150 : 110;
    this.maxMotes = q === 'low' ? 10 : q === 'mid' ? 18 : q === 'ultra' ? 40 : 26;
    this.maxBats = q === 'low' ? 4 : q === 'mid' ? 6 : q === 'ultra' ? 12 : 9;
    this.maxComets = q === 'low' ? 1 : q === 'mid' ? 2 : q === 'ultra' ? 5 : 3;
    this.pillarCount = q === 'low' ? 14 : q === 'mid' ? 22 : q === 'ultra' ? 42 : 32;
    this.liveStars = q === 'ultra' ? 24 : Math.min(16, this.maxStars);
    if (q === 'ultra') {
      // top up the scenery pools so the ultra tier is genuinely denser
      while (this.stars.length < this.maxStars) {
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height * 0.5,
          r: 0.5 + Math.random() * 1.6,
          tw: Math.random() * Math.PI * 2,
          sp: 0.8 + Math.random() * 2.4
        });
      }
      while (this.motes.length < this.maxMotes) {
        this.motes.push({
          x: Math.random() * this.width,
          y: this.groundY - Math.random() * 280,
          r: 1 + Math.random() * 1.8,
          ph: Math.random() * Math.PI * 2,
          sp: 6 + Math.random() * 14
        });
      }
    }
    this._layersDirty = true;
  }

  markThemeChanged() {
    this._layersDirty = true;
  }

  /**
   * better19: bake the expensive static background (gothic skyline + lit
   * windows, star field) into offscreen canvases once per theme/quality.
   * Replaces ~600+ per-frame path/fillRect ops with 2-3 drawImage calls.
   */
  buildStaticLayers() {
    this._layersDirty = false;
    const SKY_H = 250;

    // --- skyline silhouettes + baked window glow (2x width, wraps) ---
    if (!this._skyCanvas || this._skyCanvas.width !== this.width * 2 || this._skyCanvas.height !== SKY_H) {
      this._skyCanvas = document.createElement('canvas');
      this._skyCanvas.width = this.width * 2;
      this._skyCanvas.height = SKY_H;
    }
    const sc = this._skyCanvas.getContext('2d');
    sc.clearRect(0, 0, this._skyCanvas.width, SKY_H);
    const baseY = SKY_H;
    sc.fillStyle = P.hillDark;
    for (const s of this.skyline) {
      sc.beginPath();
      sc.moveTo(s.x, baseY);
      sc.lineTo(s.x, baseY - s.h);
      if (s.spire) {
        sc.lineTo(s.x + s.w * 0.5, baseY - s.h - 34);
        sc.lineTo(s.x + s.w, baseY - s.h);
      } else {
        sc.lineTo(s.x + s.w * 0.5, baseY - s.h - 12);
        sc.lineTo(s.x + s.w, baseY - s.h);
      }
      sc.lineTo(s.x + s.w, baseY);
      sc.closePath();
      sc.fill();
    }
    sc.fillStyle = P.accent;
    for (const s of this.skyline) {
      for (const w of s.windows) {
        // flicker phase is baked into a stable per-window brightness variety
        const flick = 0.5 + 0.5 * Math.sin(w.ph * 3.17);
        sc.globalAlpha = 0.2 + flick * 0.42;
        sc.fillRect(s.x + w.x, baseY - s.h + w.y, 3, 4.5);
      }
    }
    sc.globalAlpha = 1;

    // --- static star field (all stars beyond the live twinkle subset) ---
    if (!this._starCanvas || this._starCanvas.height !== 372) {
      this._starCanvas = document.createElement('canvas');
      this._starCanvas.width = this.width;
      this._starCanvas.height = 372;
    }
    const stc = this._starCanvas.getContext('2d');
    stc.clearRect(0, 0, this._starCanvas.width, this._starCanvas.height);
    stc.fillStyle = P.cloudDark;
    for (let i = this.liveStars; i < this.stars.length && i < this.maxStars; i++) {
      const s = this.stars[i];
      stc.globalAlpha = 0.16 + 0.3 * (s.r / 2.1);
      stc.beginPath();
      stc.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      stc.fill();
    }
    stc.globalAlpha = 1;
  }

  setBPM(bpm, obstacleKicks = [], coinKicks = []) {
    this.speed = 380 + bpm * 1.15;
    this.buildTimeline(obstacleKicks, coinKicks);
  }

  static get OBSTACLE_DEFS() {
    return {
      crypt_monolith: { w: 42, h: 50, yOff: 50 },
      pumpkin_lantern: { w: 42, h: 50, yOff: 50 },
      iron_gate: { w: 42, h: 50, yOff: 50 },
      wraith_pendulum: { w: 42, h: 50, yOff: 62 },
      ghoul_candle: { w: 26, h: 58, yOff: 58 },
      coffin_cart: { w: 58, h: 38, yOff: 38 }
    };
  }

  buildTimeline(obstacleKicks = [], coinKicks = []) {
    const types = ['crypt_monolith', 'pumpkin_lantern', 'iron_gate', 'wraith_pendulum', 'ghoul_candle', 'coffin_cart'];
    const defs = World.OBSTACLE_DEFS;
    this.obstacles = obstacleKicks.map((kickTime, index) => {
      const type = types[index % types.length];
      const def = defs[type];
      return {
        kickTime,
        x: 99999,
        y: this.groundY - def.yOff,
        w: def.w,
        h: def.h,
        type
      };
    });

    // Rhythm coins: triple arc over every 3rd-ish obstacle (collected at the jump
    // apex), single coin over the rest, plus off-beat bonus kicks high in the air.
    this.coins = [];
    for (let idx = 0; idx < this.obstacles.length; idx++) {
      const obs = this.obstacles[idx];
      if (idx % 3 === 1) {
        const offs = [-0.06, 0, 0.06];
        const lift = [0, 30, 0];
        for (let k = 0; k < 3; k++) {
          this.coins.push({
            targetTime: obs.kickTime + this.jumpLeadTime + offs[k],
            x: 99999,
            y: this.groundY - 120 - lift[k],
            r: 9,
            collected: false,
            bonus: false
          });
        }
      } else {
        this.coins.push({
          targetTime: obs.kickTime + this.jumpLeadTime,
          x: 99999,
          y: this.groundY - 125,
          r: 13,
          collected: false,
          bonus: false
        });
      }
    }
    for (let i = 0; i < coinKicks.length; i += 2) {
      this.coins.push({
        targetTime: coinKicks[i] + this.jumpLeadTime,
        x: 99999,
        y: this.groundY - 165, // High coin for mid-air flip!
        r: 15,
        collected: false,
        bonus: true
      });
    }

    // better18: vertical portals in the middle of long gaps between obstacles
    // (>= 1.9s apart -> the portal never overlaps a jump line)
    this.portals = [];
    for (let i = 0; i < this.obstacles.length - 1; i++) {
      const gap = this.obstacles[i + 1].kickTime - this.obstacles[i].kickTime;
      if (gap >= 1.9) {
        this.portals.push({
          targetTime: this.obstacles[i].kickTime + gap * 0.5,
          cx: 99999,
          passed: false
        });
      }
    }
  }

  reset(obstacleKicks = [], coinKicks = []) {
    this.score = 0;
    this._lastScoreT = null;
    this.biomeStage = 0;
    this.buildTimeline(obstacleKicks, coinKicks);
  }

  update(dt, player, trackElapsedTime, onCoinCollected, onPortal, onLand, spectate = false) {
    this.scrollX += this.speed * dt;
    // better20: passive score follows the TRACK CLOCK, not the frame clock —
    // a 30fps phone now earns exactly as much as a 144fps PC (MP fairness),
    // and a dead spectator earns nothing.
    if (this._lastScoreT === null || trackElapsedTime < this._lastScoreT - 0.05) this._lastScoreT = trackElapsedTime;
    const scoreEd = Math.max(0, Math.min(0.25, trackElapsedTime - this._lastScoreT));
    this._lastScoreT = trackElapsedTime;
    if (!spectate) this.score += scoreEd * 16;
    this.biomeStage = trackElapsedTime / 18.0;

    for (const c of this.clouds) {
      c.x -= c.speed * dt;
      if (c.x + c.w < -100) c.x = this.width + 80;
    }
    for (const h of this.hills) {
      h.x -= this.speed * 0.18 * dt;
      if (h.x + h.w < -100) h.x += 5 * 360;
    }
    for (const t of this.trees) {
      t.x -= this.speed * 0.38 * dt;
      if (t.x < -100) t.x = this.width + 100 + Math.random() * 80;
    }
    for (const g of this.bgGraves) {
      g.x -= this.speed * 0.62 * dt;
      if (g.x < -60) g.x = this.width + 60 + Math.random() * 90;
    }

    // better18: drifting dust motes (better19: capped by quality)
    const mCap = Math.min(this.motes.length, this.maxMotes);
    for (let mi = 0; mi < mCap; mi++) {
      const m = this.motes[mi];
      m.x -= (10 + this.speed * 0.02) * dt;
      m.y -= m.sp * dt * 0.35;
      if (m.y < 70) m.y = this.groundY - 10;
      if (m.x < -20) m.x = this.width + 20;
    }

    // better18: occasional bat flights across the sky
    this.batTimer -= dt;
    if (this.batTimer <= 0 && this.bats.length < this.maxBats) {
      this.batTimer = 7 + Math.random() * 7;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const by = 70 + Math.random() * 170;
      for (let i = 0; i < 3; i++) {
        this.bats.push({
          x: dir > 0 ? -50 - i * 36 : this.width + 50 + i * 36,
          y: by + (i % 2) * 16 - 8,
          vx: dir * (95 + Math.random() * 55),
          ph: Math.random() * Math.PI * 2
        });
      }
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      b.x += b.vx * dt;
      b.y += Math.sin(performance.now() * 0.0026 + b.ph) * 14 * dt;
      if (b.x < -130 || b.x > this.width + 130) this.bats.splice(i, 1);
    }

    if (player.y + player.height >= this.groundY) {
      player.y = this.groundY - player.height;
      const impact = player.vy;
      player.vy = 0;
      if (!player.isGrounded) {
        player.isGrounded = true;
        player.squash = 1.28;
        player.stretch = 0.78;
        // better19: landing dust puff scaled by impact speed
        if (onLand && impact > 240 && !spectate) onLand(player, Math.min(1, impact / 900));
      }
    }

    const playerAnchorX = player.x + player.width * 0.5;
    const playerCenterY = player.y + player.height * 0.5;

    // Update & collect beat-synced Coins
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (coin.collected) continue;
      const timeDiff = coin.targetTime - trackElapsedTime;
      coin.x = playerAnchorX + timeDiff * this.speed;

      if (spectate) continue; // better20: the fallen collect nothing
      // better19: fever widens the coin magnet
      const magX = this.fever ? 50 : 38;
      const magY = this.fever ? 54 : 42;
      if (Math.abs(coin.x - playerAnchorX) < magX && Math.abs(coin.y - playerCenterY) < magY) {
        coin.collected = true;
        if (onCoinCollected) onCoinCollected(coin);
      }
    }

    // better18: vertical portals — a guaranteed reward gate the runner passes
    // straight through (the ring is drawn behind the player)
    if (onPortal && !spectate) {
      for (const p of this.portals) {
        if (p.passed) continue;
        const diff = p.targetTime - trackElapsedTime;
        p.cx = playerAnchorX + diff * this.speed;
        if (Math.abs(p.cx - playerAnchorX) < 30) {
          p.passed = true;
          onPortal(p);
        }
      }
    }

    // Update Obstacles locked to exact kickTime + jumpLeadTime
    let collided = false;
    const pad = 11;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      const arrivalTime = obs.kickTime + this.jumpLeadTime;
      const timeDiff = arrivalTime - trackElapsedTime;
      obs.x = playerAnchorX + timeDiff * this.speed - obs.w * 0.5;

      if (spectate) continue; // better20: the fallen pass through everything
      if (obs.x > -120 && obs.x < this.width + 120) {
        if (
          player.x + pad < obs.x + obs.w - pad &&
          player.x + player.width - pad > obs.x + pad &&
          player.y + pad < obs.y + obs.h - pad &&
          player.y + player.height - pad > obs.y + pad
        ) {
          collided = true;
        }
      }
    }

    return collided;
  }

  drawExtrudedBox(ctx, x, y, w, h, depthX = 14, depthY = -10, strokeColor = P.ink, fillFront = P.stoneFront, fillSide = P.stoneSide) {
    ctx.fillStyle = P.stone;
    ctx.strokeStyle = strokeColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + depthX, y + depthY);
    ctx.lineTo(x + w + depthX, y + depthY);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fillSide;
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w + depthX, y + depthY);
    ctx.lineTo(x + w + depthX, y + h + depthY);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fillFront;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  render(ctx, beatPulse = 0, kickEnergy = 0, finale = 0, fx = null) {
    // better19: real per-frame dt for comet/lightning timers (was hardcoded 0.016)
    const fxT = fx ? (fx.t || 0) : 0;
    let fxDT = fxT - (this._lastFxT || 0);
    this._lastFxT = fxT;
    if (!(fxDT > 0) || fxDT > 0.06) fxDT = 0.016;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (P.glow && this.glowEnabled) {
      ctx.shadowColor = P.glowColor;
      ctx.shadowBlur = P.glowBlur;
    }

    const totalKick = Math.min(1.25, beatPulse + kickEnergy * 0.55);
    const stageIdx = Math.floor(this.biomeStage) % 6;

    // better18: melody-driven floor state (smoothed per frame)
    const melTarget = fx ? Math.min(1, Math.max(0, fx.melody || 0)) : 0;
    const pitchN = fx ? Math.max(0, Math.min(1, fx.pitch || 0.5)) : 0.5;
    this.melodyLevel += (melTarget - this.melodyLevel) * 0.22;
    const melody = this.melodyLevel;

    // Micro camera shake driven by kick energy (can be disabled in settings)
    const shake = this.shakeEnabled ? totalKick * 3.4 + finale * 2.4 : 0;
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // 0. Layered sky gradient (better18: paper -> cloud -> hill, cached per theme)
    const skyKey = `${P.paper}|${P.cloud}|${P.hill}`;
    if (!this._skyGrad || this._skyKey !== skyKey) {
      this._skyKey = skyKey;
      const g = ctx.createLinearGradient(0, 0, 0, this.groundY);
      g.addColorStop(0, P.paper);
      g.addColorStop(0.55, P.cloud);
      g.addColorStop(1, P.hill);
      this._skyGrad = g;
    }
    ctx.fillStyle = this._skyGrad;
    ctx.fillRect(-20, -20, this.width + 40, this.groundY + 22);

    // 0a. Star field — static base baked once per theme (better19), live twinkles on top
    if (this._layersDirty) this.buildStaticLayers();
    if (this._starCanvas) ctx.drawImage(this._starCanvas, 0, 0);
    const nowSec = performance.now() * 0.001;
    const liveCap = Math.min(this.liveStars, this.stars.length);
    for (let si = 0; si < liveCap; si++) {
      const s = this.stars[si];
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(nowSec * s.sp + s.tw));
      ctx.globalAlpha = tw * 0.5;
      ctx.fillStyle = P.cloudDark;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.r > 1.7 && tw > 0.86) {
        // rare bright-star cross sparkle
        ctx.globalAlpha = (tw - 0.86) * 2.2;
        ctx.strokeStyle = P.pale;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 3.4, s.y);
        ctx.lineTo(s.x + s.r * 3.4, s.y);
        ctx.moveTo(s.x, s.y - s.r * 3.4);
        ctx.lineTo(s.x, s.y + s.r * 3.4);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 0b. Shooting comets & kick-triggered gothic lightning
    this.cometTimer -= fxDT;
    if (this.cometTimer <= 0 && this.comets.length < this.maxComets) {
      this.cometTimer = 2.2 + Math.random() * 3.5;
      this.comets.push({
        x: 200 + Math.random() * (this.width - 250),
        y: 25 + Math.random() * 110,
        vx: -360 - Math.random() * 220,
        vy: 90 + Math.random() * 70,
        len: 55 + Math.random() * 45,
        life: 1.0
      });
    }
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const cm = this.comets[i];
      cm.x += cm.vx * fxDT;
      cm.y += cm.vy * fxDT;
      cm.life -= fxDT * 1.35;
      if (cm.life <= 0) {
        this.comets.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = cm.life * 0.75;
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cm.x, cm.y);
      ctx.lineTo(cm.x - cm.vx * 0.12, cm.y - cm.vy * 0.12);
      ctx.stroke();
      ctx.fillStyle = P.pale;
      ctx.beginPath();
      ctx.arc(cm.x, cm.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (totalKick > 0.82 && this.lightningAlpha <= 0.05 && Math.random() < 0.45) {
      const lx = 140 + Math.random() * (this.width - 380);
      const pts = [{ x: lx, y: 0 }];
      let curX = lx;
      let curY = 0;
      while (curY < this.groundY - 40) {
        curX += (Math.random() - 0.5) * 56;
        curY += 35 + Math.random() * 45;
        pts.push({ x: curX, y: curY });
      }
      this.lightningBolt = pts;
      this.lightningAlpha = 0.9;
    }
    if (this.lightningAlpha > 0.01 && this.lightningBolt) {
      this.lightningAlpha = Math.max(0, this.lightningAlpha - fxDT * 3.6);
      ctx.save();
      ctx.globalAlpha = this.lightningAlpha;
      ctx.strokeStyle = P.pale;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let i = 0; i < this.lightningBolt.length; i++) {
        const pt = this.lightningBolt[i];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 0c. Cathedral Audio-Reactive Sky Pillars
    const barCount = this.pillarCount;
    const barSpan = this.width / barCount;
    ctx.save();
    ctx.globalAlpha = 0.16 + totalKick * 0.14 + finale * 0.12;
    ctx.fillStyle = P.accent;
    for (let b = 0; b < barCount; b++) {
      const wave = 0.5 + 0.5 * Math.sin(nowSec * 3.8 + b * 0.45 + pitchN * 4.0);
      const bh = 25 + wave * (55 + melody * 110 + totalKick * 95);
      const bx = b * barSpan + 4;
      ctx.fillRect(bx, this.groundY - bh, barSpan - 8, bh);
    }
    ctx.restore();

    // 1. Volumetric Celestial Body
    const moonX = this.width - 240;
    const moonY = 145;
    const moonR = 64 + totalKick * 16 + finale * 12;

    // Rotating astrolabe rays behind the moon
    ctx.save();
    ctx.translate(moonX, moonY);
    ctx.rotate(nowSec * 0.18);
    ctx.strokeStyle = P.accent;
    ctx.globalAlpha = 0.22 + totalKick * 0.25;
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rIn = moonR + 8;
      const rOut = moonR + (k % 2 === 0 ? 54 : 30) + totalKick * 28;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      ctx.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut);
      ctx.stroke();
    }
    ctx.restore();

    // better18: soft halo bloom around the moon
    ctx.globalAlpha = 0.13 + totalKick * 0.09 + melody * 0.06;
    ctx.fillStyle = P.accent;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1.8;
    for (let r = 1; r <= 3; r++) {
      const ringR = moonR + r * 24 + totalKick * (r * 18);
      ctx.save();
      ctx.globalAlpha = Math.max(0.08, 0.48 - r * 0.12 + totalKick * 0.25);
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(moonX, moonY, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = [P.pale, P.ink, P.pale, P.pale, P.pale, P.pale][stageIdx];
    ctx.strokeStyle = [P.accent, P.accent, '#8a4fd0', '#2b9e68', '#4a7fc0', '#c9902a'][stageIdx];
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (stageIdx === 2) {
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.ellipse(moonX, moonY, 12, moonR * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1.6;
      for (let a = -moonR + 8; a < moonR - 8; a += 7) {
        const halfChord = Math.sqrt(Math.max(0, moonR * moonR - a * a));
        ctx.beginPath();
        ctx.moveTo(moonX + halfChord * 0.15, moonY + a);
        ctx.lineTo(moonX + halfChord * 0.92, moonY + a);
        ctx.stroke();
      }
    }

    // 1a. Gothic skyline — baked layer drawn with 2 drawImage calls (better19;
    // the old version did ~600 path ops + fillRects every frame)
    if (this._layersDirty) this.buildStaticLayers();
    if (this._skyCanvas) {
      const skySpan = this.width * 2;
      const skyOff = -((this.scrollX * 0.05) % skySpan);
      const skyY = this.groundY - this._skyCanvas.height;
      ctx.globalAlpha = 0.82;
      ctx.drawImage(this._skyCanvas, skyOff, skyY);
      ctx.drawImage(this._skyCanvas, skyOff + skySpan, skyY);
      ctx.globalAlpha = 1;
    }

    // 1b. Gothic Aurora Ribbons in the upper sky
    ctx.save();
    for (let band = 0; band < 2; band++) {
      ctx.globalAlpha = (0.11 + melody * 0.1 + totalKick * 0.08) * (band === 0 ? 1 : 0.7);
      ctx.strokeStyle = band === 0 ? P.accent : P.crimson;
      ctx.lineWidth = 18 - band * 6;
      ctx.beginPath();
      for (let x = 0; x <= this.width; x += 64) {
        const ay = 78 + band * 34 + Math.sin(nowSec * 1.1 + x * 0.005 + band * 1.7) * (22 + totalKick * 14);
        if (x === 0) ctx.moveTo(x, ay);
        else ctx.lineTo(x, ay);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 2. Hills
    ctx.fillStyle = P.hill;
    ctx.strokeStyle = P.hillDark;
    ctx.lineWidth = 2.0;
    for (const h of this.hills) {
      const lift = totalKick * 14;
      ctx.beginPath();
      ctx.moveTo(h.x, this.groundY);
      ctx.quadraticCurveTo(h.x + h.w * 0.5, this.groundY - h.h - lift, h.x + h.w, this.groundY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 2b. Distant Gothic Viaduct Arches & Hanging Streetlight Lanterns
    ctx.save();
    const archSpan = 260;
    const archOff = -((this.scrollX * 0.26) % archSpan);
    ctx.strokeStyle = P.hillDark;
    ctx.lineWidth = 2.2;
    for (let ax = archOff - archSpan; ax < this.width + archSpan; ax += archSpan) {
      const pillarX = ax + archSpan * 0.5;
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      ctx.moveTo(pillarX - 8, this.groundY);
      ctx.lineTo(pillarX - 5, this.groundY - 145);
      ctx.lineTo(pillarX + 5, this.groundY - 145);
      ctx.lineTo(pillarX + 8, this.groundY);
      ctx.stroke();
      const lanternY = this.groundY - 118 + Math.sin(nowSec * 3.0 + ax * 0.02) * 3 - totalKick * 5;
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = P.accent;
      ctx.beginPath();
      ctx.arc(pillarX, lanternY, 4.5 + totalKick * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 3. Clouds
    ctx.fillStyle = P.cloud;
    ctx.strokeStyle = P.cloudDark;
    ctx.lineWidth = 1.8;
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.quadraticCurveTo(c.x + c.w * 0.25, c.y - 22, c.x + c.w * 0.55, c.y - 6);
      ctx.quadraticCurveTo(c.x + c.w * 0.8, c.y - 18, c.x + c.w, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 4. Trees
    ctx.strokeStyle = P.bark;
    for (const t of this.trees) {
      const baseY = this.groundY;
      const sway = totalKick * (t.twist > 0 ? 10 : -10);
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(t.x, baseY);
      ctx.quadraticCurveTo(t.x + t.twist, baseY - t.h * 0.5, t.x + sway, baseY - t.h);
      ctx.stroke();

      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(t.x + t.twist * 0.4, baseY - t.h * 0.62);
      ctx.lineTo(t.x - 34 + sway, baseY - t.h * 0.86);
      ctx.moveTo(t.x + t.twist * 0.3, baseY - t.h * 0.48);
      ctx.lineTo(t.x + 32 + sway, baseY - t.h * 0.74);
      ctx.stroke();
    }

    // 5. Graves
    ctx.strokeStyle = P.hillDark;
    ctx.lineWidth = 1.8;
    for (const g of this.bgGraves) {
      ctx.save();
      ctx.translate(g.x, this.groundY);
      ctx.rotate(g.tilt);
      const lift = totalKick * 5;
      ctx.fillStyle = P.grave;
      ctx.beginPath();
      ctx.arc(0, -g.h + 12 - lift, g.w / 2, Math.PI, 0);
      ctx.lineTo(g.w / 2, 0);
      ctx.lineTo(-g.w / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 5a. better18: floating dust motes / fireflies (better19: capped by quality)
    const moteRender = Math.min(this.motes.length, this.maxMotes);
    for (let mi = 0; mi < moteRender; mi++) {
      const m = this.motes[mi];
      const gl = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(nowSec * 1.6 + m.ph));
      ctx.globalAlpha = gl;
      ctx.fillStyle = P.accent;
      ctx.beginPath();
      ctx.arc(m.x + Math.sin(nowSec * 0.7 + m.ph) * 8, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 5b. better18: bat flights
    ctx.strokeStyle = P.cloudDark;
    ctx.lineWidth = 1.8;
    for (const b of this.bats) {
      const flap = Math.sin(nowSec * 13 + b.ph) * 4;
      ctx.beginPath();
      ctx.moveTo(b.x - 7, b.y - flap * 0.45);
      ctx.quadraticCurveTo(b.x - 3, b.y - 3 - flap, b.x, b.y);
      ctx.quadraticCurveTo(b.x + 3, b.y - 3 - flap, b.x + 7, b.y - flap * 0.45);
      ctx.stroke();
    }

    // 5c. Kinetic Gothic Lyrics Display (prev / active / next + progress)
    if (this.lyrics && this.lyricsEnabled && fx) {
      const curT = fx.t || 0;
      let activeIdx = -1;
      const lines = this.lyrics.lines || [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= curT) activeIdx = i;
        else break;
      }
      if (activeIdx >= 0 && lines[activeIdx]) {
        const prevLine = activeIdx > 0 ? lines[activeIdx - 1].text : '';
        const currLine = lines[activeIdx].text || '';
        const nextLine = activeIdx + 1 < lines.length ? lines[activeIdx + 1].text : '';
        const startT = lines[activeIdx].time || 0;
        const endT = activeIdx + 1 < lines.length ? lines[activeIdx + 1].time : startT + 4.0;
        const prog = Math.max(0, Math.min(1, (curT - startT) / Math.max(0.2, endT - startT)));
        const cx = this.width * 0.5;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (prevLine) {
          ctx.globalAlpha = 0.35;
          ctx.font = 'italic 600 14px Georgia, serif';
          ctx.fillStyle = P.ink;
          ctx.fillText(prevLine, cx, 64);
        }

        const scale = 1.0 + totalKick * 0.08;
        ctx.save();
        ctx.translate(cx, 96);
        ctx.scale(scale, scale);
        ctx.globalAlpha = 0.96;
        ctx.font = '900 24px Georgia, serif';
        ctx.strokeStyle = P.paper;
        ctx.lineWidth = 5.0;
        ctx.strokeText(currLine, 0, 0);
        ctx.fillStyle = P.accent;
        ctx.fillText(currLine, 0, 0);
        ctx.restore();

        const barW = 240;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = P.hillDark;
        ctx.fillRect(cx - barW * 0.5, 115, barW, 3);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = P.accent;
        ctx.fillRect(cx - barW * 0.5, 115, barW * prog, 3);

        if (nextLine) {
          ctx.globalAlpha = 0.48;
          ctx.font = '600 15px Georgia, serif';
          ctx.fillStyle = P.ink;
          ctx.fillText(nextLine, cx, 134);
        }
        ctx.restore();
      }
    }

    // 6. 3D Road — the floor BREATHES with the lead melody (better18)
    const roadDepth = 36;
    const undAmp = 1.5 + melody * 7.2;
    const undFreq = 0.011 + pitchN * 0.026;
    const undPhase = (fx ? fx.t || 0 : 0) * (2.1 + melody * 3.2);
    const SEG = 24;
    const segW = this.width / SEG;

    ctx.fillStyle = P.road;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    for (let i = 0; i <= SEG; i++) {
      const x = segW * i;
      const y = this.groundY + Math.sin(undPhase + x * undFreq) * undAmp
        + Math.sin(undPhase * 1.63 + x * undFreq * 2.17) * undAmp * 0.38;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.width, this.groundY + roadDepth);
    ctx.lineTo(0, this.groundY + roadDepth);
    ctx.closePath();
    ctx.fill();

    // road edges: top edge follows the melody wave, bottom stays straight
    // better19: FEVER (combo 20+) turns the edge into a burning crimson line
    ctx.strokeStyle = this.fever ? P.crimson : P.ink;
    ctx.lineWidth = this.fever ? 3.8 : 3.2;
    ctx.beginPath();
    for (let i = 0; i <= SEG; i++) {
      const x = segW * i;
      const y = this.groundY + Math.sin(undPhase + x * undFreq) * undAmp
        + Math.sin(undPhase * 1.63 + x * undFreq * 2.17) * undAmp * 0.38;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.moveTo(0, this.groundY + roadDepth);
    ctx.lineTo(this.width, this.groundY + roadDepth);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    for (let x = -(this.scrollX % 48); x < this.width + 48; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, this.groundY);
      ctx.lineTo(x - 28, this.groundY + roadDepth);
      ctx.stroke();
    }

    // better18: melody shimmer — accent light streaks drifting inside the floor
    if (melody > 0.08) {
      ctx.globalAlpha = Math.min(0.55, melody * 0.5);
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1.6 + melody * 2.2;
      for (let row = 0; row < 2; row++) {
        const ry = this.groundY + 11 + row * 12;
        const wob = Math.sin(undPhase * 1.9 + row * 2.1) * 2.4;
        ctx.beginPath();
        ctx.moveTo(0, ry + wob);
        ctx.lineTo(this.width, ry - wob);
        ctx.stroke();
      }
      // vertical energy veins sliding with the road speed
      ctx.globalAlpha = Math.min(0.5, melody * 0.42);
      const veinGap = 168;
      for (let x = -(this.scrollX * 0.9 % veinGap); x < this.width; x += veinGap) {
        const vh = 4 + melody * 11;
        ctx.beginPath();
        ctx.moveTo(x, this.groundY + 5);
        ctx.lineTo(x, this.groundY + 5 + vh);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Kick ground wave: accent line flashes along the road on every kick
    if (totalKick > 0.18) {
      ctx.strokeStyle = P.accent;
      ctx.globalAlpha = Math.min(0.85, (totalKick - 0.18) * 1.4);
      ctx.lineWidth = 2.2 + totalKick * 2.4 + finale * 3.0;
      ctx.beginPath();
      ctx.moveTo(0, this.groundY + 1);
      ctx.lineTo(this.width, this.groundY + 1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Finale: road fills with pulsing accent light as the track approaches its end
    if (finale > 0.02) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006 * (1 + finale));
      ctx.fillStyle = P.accent;
      ctx.globalAlpha = finale * 0.28 * pulse;
      ctx.fillRect(0, this.groundY, this.width, roadDepth);
      ctx.globalAlpha = 1;
    }

    // 6a. better18: vertical reward portals (drawn behind coins & player)
    for (const p of this.portals) {
      if (p.passed || p.cx < -90 || p.cx > this.width + 90) continue;
      const px = p.cx;
      const baseY = this.groundY + 8;
      const ry = 86 + Math.sin(nowSec * 2 + px * 0.01) * 3.5;
      const rx = 30 + Math.sin(nowSec * 2.6 + px * 0.013) * 2;
      const cy = baseY - ry - 4;

      // outer ring
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.ellipse(px, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // rotating rune dashes on the inner ring
      ctx.strokeStyle = P.pale;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 11]);
      ctx.lineDashOffset = -nowSec * 46;
      ctx.beginPath();
      ctx.ellipse(px, cy, rx * 0.76, ry * 0.82, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // inner shimmer
      ctx.globalAlpha = 0.13 + Math.sin(nowSec * 3.1 + px) * 0.05;
      ctx.fillStyle = P.accent;
      ctx.beginPath();
      ctx.ellipse(px, cy, rx * 0.68, ry * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // stone base
      ctx.fillStyle = P.stone;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2;
      ctx.fillRect(px - rx - 10, baseY - 11, (rx + 10) * 2, 13);
      ctx.strokeRect(px - rx - 10, baseY - 11, (rx + 10) * 2, 13);

      // orbiting sparks
      ctx.fillStyle = P.pale;
      for (let k = 0; k < 3; k++) {
        const a = nowSec * 2.4 + k * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * (rx + 9), cy - Math.sin(a) * (ry * 0.55), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Render Rhythm Coins
    for (const coin of this.coins) {
      if (coin.collected || coin.x < -50 || coin.x > this.width + 50) continue;
      const cy = coin.y - totalKick * 5;
      const r = coin.r + totalKick * 2;
      ctx.fillStyle = coin.bonus ? P.crimson : P.accent;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(coin.x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner gothic diamond stamp on coin
      ctx.fillStyle = P.pale;
      ctx.beginPath();
      ctx.moveTo(coin.x, cy - r * 0.5);
      ctx.lineTo(coin.x + r * 0.4, cy);
      ctx.lineTo(coin.x, cy + r * 0.5);
      ctx.lineTo(coin.x - r * 0.4, cy);
      ctx.closePath();
      ctx.fill();
    }

    // 8. Render Obstacles + Exact Jump Kick Line Marker
    for (const obs of this.obstacles) {
      if (obs.x < -150 || obs.x > this.width + 150) continue;

      const bounce = totalKick * 6;
      const ox = obs.x;
      const oy = obs.y - bounce;
      const ow = obs.w;
      const oh = obs.h + bounce;
      const cx = ox + ow / 2;

      // Visual Jump Trigger Line on the road right before the obstacle (shows exact spot where the kick hits!)
      const jumpSpotX = cx - this.jumpLeadTime * this.speed;
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(jumpSpotX, this.groundY - 6);
      ctx.lineTo(jumpSpotX - 10, this.groundY + 14);
      ctx.moveTo(jumpSpotX - 8, this.groundY);
      ctx.lineTo(jumpSpotX + 8, this.groundY);
      ctx.stroke();

      ctx.fillStyle = `rgba(${P.inkRGB}, 0.35)`;
      ctx.beginPath();
      ctx.ellipse(cx + 6, this.groundY + 8, ow * 0.62, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (obs.type === 'crypt_monolith') {
        this.drawExtrudedBox(ctx, ox, oy, ow, oh, 14, -10, P.ink, P.stoneFront, P.stoneSide);
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(cx, oy + 18, ow * 0.28, Math.PI, 0);
        ctx.lineTo(cx + ow * 0.28, oy + oh - 8);
        ctx.lineTo(cx - ow * 0.28, oy + oh - 8);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, oy + 14);
        ctx.lineTo(cx, oy + 32);
        ctx.moveTo(cx - 6, oy + 20);
        ctx.lineTo(cx + 6, oy + 20);
        ctx.stroke();
      } else if (obs.type === 'pumpkin_lantern') {
        this.drawExtrudedBox(ctx, ox + 4, oy + oh - 16, ow - 8, 16, 10, -7, P.ink, P.grave, P.stoneSide);
        const py = oy + oh * 0.42;
        const pr = ow * 0.48;
        ctx.fillStyle = '#b84214';
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx + 6, py - 2, pr, pr * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = P.accent;
        ctx.beginPath();
        ctx.ellipse(cx, py, pr, pr * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(cx, py, pr * 0.48, pr * 0.82, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = P.ink;
        ctx.beginPath();
        ctx.moveTo(cx - 9, py - 5);
        ctx.lineTo(cx - 3, py - 1);
        ctx.lineTo(cx - 10, py + 1);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 9, py - 5);
        ctx.lineTo(cx + 10, py + 1);
        ctx.lineTo(cx + 3, py - 1);
        ctx.fill();
      } else if (obs.type === 'iron_gate') {
        this.drawExtrudedBox(ctx, ox, this.groundY - 12, ow, 12, 12, -8, P.ink, P.stoneSide, P.hillDark);
        for (let s = 0; s < 3; s++) {
          const sx = ox + s * (ow / 3);
          const sw = ow / 3;
          ctx.fillStyle = P.rust;
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(sx + sw * 0.5, oy);
          ctx.lineTo(sx + sw + 6, this.groundY - 16);
          ctx.lineTo(sx + sw * 0.5, this.groundY - 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = P.crimson;
          ctx.beginPath();
          ctx.moveTo(sx, this.groundY - 12);
          ctx.lineTo(sx + sw * 0.5, oy);
          ctx.lineTo(sx + sw, this.groundY - 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (obs.type === 'wraith_pendulum') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx, oy - 35);
        ctx.lineTo(cx, oy);
        ctx.stroke();
        this.drawExtrudedBox(ctx, ox + 4, oy, ow - 8, oh - 8, 12, -8, P.ink, P.hill, P.hillDark);
        ctx.fillStyle = P.accent;
        ctx.beginPath();
        ctx.arc(cx, oy + (oh - 8) / 2, 9 + totalKick * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (obs.type === 'ghoul_candle') {
        // Tall stack of skull-candles, flames flicker on the kick
        this.drawExtrudedBox(ctx, ox, oy + oh - 14, ow, 14, 8, -6, P.ink, P.grave, P.stoneSide);
        const candleH = oh - 16;
        ctx.lineWidth = 2.2;
        for (let s = 0; s < 3; s++) {
          const ch = candleH / 3;
          const cyy = oy + candleH - ch * (s + 1);
          const cwid = ow * (0.95 - s * 0.18);
          ctx.fillStyle = P.bone;
          ctx.strokeStyle = P.ink;
          ctx.fillRect(cx - cwid / 2, cyy, cwid, ch - 3);
          ctx.strokeRect(cx - cwid / 2, cyy, cwid, ch - 3);
          ctx.fillStyle = P.accent;
          ctx.beginPath();
          ctx.ellipse(cx, cyy - 4 + totalKick * 2, 3, 5 + totalKick * 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = P.bone;
        ctx.strokeStyle = P.ink;
        ctx.beginPath();
        ctx.arc(cx, oy - 6 + totalKick * 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = P.ink;
        ctx.fillRect(cx - 3.5, oy - 8 + totalKick * 2, 2.4, 2.6);
        ctx.fillRect(cx + 1.1, oy - 8 + totalKick * 2, 2.4, 2.6);
      } else if (obs.type === 'coffin_cart') {
        // Wide low coffin riding a cart, wheels spin with the road
        this.drawExtrudedBox(ctx, ox, oy + oh - 10, ow, 10, 10, -7, P.ink, P.stoneSide, P.hillDark);
        ctx.fillStyle = P.rust;
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.4;
        const cwx = ow * 0.72;
        const chx = oh - 14;
        const c0x = cx - cwx / 2;
        const c0y = oy + 2;
        ctx.beginPath();
        ctx.moveTo(c0x + 8, c0y);
        ctx.lineTo(c0x + cwx - 8, c0y);
        ctx.lineTo(c0x + cwx, c0y + chx * 0.5);
        ctx.lineTo(c0x + cwx - 8, c0y + chx);
        ctx.lineTo(c0x + 8, c0y + chx);
        ctx.lineTo(c0x, c0y + chx * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = P.bone;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(cx, c0y + 6);
        ctx.lineTo(cx, c0y + chx - 6);
        ctx.moveTo(cx - 5, c0y + chx * 0.42);
        ctx.lineTo(cx + 5, c0y + chx * 0.42);
        ctx.stroke();
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.2;
        const wheelRot = this.scrollX * 0.05;
        for (const wx of [ox + 10, ox + ow - 10]) {
          ctx.beginPath();
          ctx.arc(wx, oy + oh - 6, 5, wheelRot, wheelRot + Math.PI * 1.4);
          ctx.stroke();
        }
      }
    }

    // 9. Foreground fast parallax Gothic Iron Fence silhouette
    const fenceGap = 96;
    const fenceOff = -((this.scrollX * 1.38) % fenceGap);
    const fenceBaseY = this.height;
    ctx.save();
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, fenceBaseY - 16, this.width, 4);
    for (let fx0 = fenceOff; fx0 < this.width + fenceGap; fx0 += fenceGap) {
      ctx.beginPath();
      ctx.moveTo(fx0 - 4, fenceBaseY);
      ctx.lineTo(fx0 - 4, fenceBaseY - 34);
      ctx.lineTo(fx0, fenceBaseY - 46 - totalKick * 5);
      ctx.lineTo(fx0 + 4, fenceBaseY - 34);
      ctx.lineTo(fx0 + 4, fenceBaseY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  }
}
