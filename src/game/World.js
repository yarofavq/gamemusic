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
    this.biomeStage = 0;
    this.shakeEnabled = true;
    this.glowEnabled = true;

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
  }

  reset(obstacleKicks = [], coinKicks = []) {
    this.score = 0;
    this.biomeStage = 0;
    this.buildTimeline(obstacleKicks, coinKicks);
  }

  update(dt, player, trackElapsedTime, onCoinCollected) {
    this.scrollX += this.speed * dt;
    this.score += dt * 16;
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

    if (player.y + player.height >= this.groundY) {
      player.y = this.groundY - player.height;
      player.vy = 0;
      if (!player.isGrounded) {
        player.isGrounded = true;
        player.squash = 1.28;
        player.stretch = 0.78;
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

      if (Math.abs(coin.x - playerAnchorX) < 38 && Math.abs(coin.y - playerCenterY) < 42) {
        coin.collected = true;
        if (onCoinCollected) onCoinCollected(coin);
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

  render(ctx, beatPulse = 0, kickEnergy = 0, finale = 0) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (P.glow && this.glowEnabled) {
      ctx.shadowColor = P.glowColor;
      ctx.shadowBlur = P.glowBlur;
    }

    const totalKick = Math.min(1.25, beatPulse + kickEnergy * 0.55);
    const stageIdx = Math.floor(this.biomeStage) % 6;

    // Micro camera shake driven by kick energy (can be disabled in settings)
    const shake = this.shakeEnabled ? totalKick * 3.4 + finale * 2.4 : 0;
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // 1. Volumetric Celestial Body
    const moonX = this.width - 240;
    const moonY = 145;
    const moonR = 64 + totalKick * 16 + finale * 12;

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

    // 6. 3D Road
    const roadDepth = 36;
    ctx.fillStyle = P.road;
    ctx.fillRect(0, this.groundY, this.width, roadDepth);

    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.width, this.groundY);
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

    ctx.restore();
  }
}
