import { P } from '../render/Theme.js';
export function drawStar(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 40;
    this.height = 54;
    this.vx = 0;
    this.vy = 0;
    this.gravity = 1820;
    this.jumpForce = -695;
    this.isGrounded = false;
    this.stretch = 1.0;
    this.squash = 1.0;
    this.runFrame = 0;
    this.scarfWave = 0;

    this.isFlipping = false;
    this.flipProgress = 0;
    this.canAirFlip = false;
    this.flipTrail = [];

    this.skin = 'pumpkin';
    this.equippedItem = 'none';
  }

  setSkin(skinName) {
    this.skin = skinName;
  }

  setEquippedItem(itemId) {
    this.equippedItem = itemId;
  }

  jump(particles, timingRating) {
    if (this.isGrounded) {
      let force = this.jumpForce;
      if (timingRating === 'PERFECT') {
        force *= 1.05;
        particles.emitJumpDust(this.x + this.width / 2, this.y + this.height, 34, true);
      } else if (timingRating === 'OFF-BEAT') {
        force *= 0.88;
        particles.emitJumpDust(this.x + this.width / 2, this.y + this.height, 10, false);
      } else {
        particles.emitJumpDust(this.x + this.width / 2, this.y + this.height, 22, false);
      }
      this.vy = force;
      this.isGrounded = false;
      this.canAirFlip = true;
      this.isFlipping = false;
      this.flipProgress = 0;
      this.stretch = 1.4;
      this.squash = 0.66;
      return 'GROUND_JUMP';
    } else if (this.canAirFlip && !this.isFlipping) {
      this.isFlipping = true;
      this.canAirFlip = false;
      this.flipProgress = 0;
      this.stretch = 1.25;
      this.squash = 1.25;
      particles.emitFlipVortex(this.x + this.width / 2, this.y + this.height / 2, this.skin);
      return 'AIR_FLIP';
    }
    return false;
  }

  update(dt) {
    this.vy += this.gravity * dt;
    this.y += this.vy * dt;

    this.stretch += (1.0 - this.stretch) * 9.5 * dt;
    this.squash += (1.0 - this.squash) * 9.5 * dt;
    this.scarfWave += dt * 18;

    if (this.isFlipping) {
      this.flipProgress += dt * 3.5;
      this.flipTrail.push({
        x: this.x + this.width / 2,
        y: this.y + this.height / 2,
        angle: this.flipProgress * Math.PI * 2,
        alpha: 0.65
      });
      if (this.flipTrail.length > 5) this.flipTrail.shift();

      if (this.flipProgress >= 1.0) {
        this.isFlipping = false;
        this.flipProgress = 0;
      }
    }

    for (let i = this.flipTrail.length - 1; i >= 0; i--) {
      this.flipTrail[i].alpha -= dt * 3.2;
      if (this.flipTrail[i].alpha <= 0) this.flipTrail.splice(i, 1);
    }

    if (this.isGrounded) {
      this.runFrame += dt * 16;
      this.isFlipping = false;
      this.canAirFlip = false;
    }
  }

  render(ctx, beatRingProgress = 0, isPlaying = false, groundY = 590, kickPulse = 0) {
    ctx.save();
    if (P.glow) {
      ctx.shadowColor = P.glowColor;
      ctx.shadowBlur = P.glowBlur;
    }
    const centerX = this.x + this.width / 2;
    const centerY = this.y + this.height / 2;
    const bottomY = this.y + this.height;

    // 3D Ground Shadow
    const heightRatio = Math.max(0.25, 1.0 - (groundY - bottomY) / 280);
    ctx.fillStyle = `rgba(${P.inkRGB}, ${0.38 * heightRatio})`;
    ctx.beginPath();
    ctx.ellipse(centerX, groundY + 5, 20 * heightRatio, 5 * heightRatio, 0, 0, Math.PI * 2);
    ctx.fill();

    // Contracting Rhythm Ring synced to Kick
    if (isPlaying) {
      ctx.save();
      const distToBeat = 1.0 - beatRingProgress;
      const isSweetSpot = distToBeat < 0.22 || distToBeat > 0.82;
      ctx.strokeStyle = isSweetSpot ? P.accent : '#5e5246';
      ctx.lineWidth = isSweetSpot ? 3.4 : 1.8;
      ctx.setLineDash([7, 4]);
      const radius = 22 + distToBeat * 44;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Render Equipped Visual Cosmetics INSIDE the flip/squash transform:
    // they rotate together with the character during a mid-air beat flip.
    ctx.save();
    ctx.translate(centerX, centerY);
    if (this.isFlipping) {
      ctx.rotate(this.flipProgress * Math.PI * 2);
    }
    ctx.scale(this.squash, this.stretch);
    this.renderCosmeticItem(ctx, 0, 0, kickPulse);
    ctx.restore();

    // Motion afterimages during mid-air flip
    if (this.flipTrail.length > 0) {
      for (const tr of this.flipTrail) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, tr.alpha * 0.45);
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2.0;
        ctx.translate(tr.x, tr.y);
        ctx.rotate(tr.angle);
        ctx.strokeRect(-14, -18, 28, 36);
        ctx.restore();
      }
    }

    ctx.translate(centerX, centerY);
    if (this.isFlipping) {
      const rotAngle = this.flipProgress * Math.PI * 2;
      ctx.rotate(rotAngle);

      ctx.save();
      ctx.strokeStyle = this.skin === 'witch' || this.skin === 'reaper' ? P.crimson : P.accent;
      ctx.lineWidth = 2.8;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 33, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.scale(this.squash, this.stretch);
    ctx.translate(-centerX, -centerY);

    // Flowing cape / scarf
    ctx.strokeStyle = (this.skin === 'witch' || this.skin === 'reaper' || this.skin === 'vampire') ? P.crimson : P.accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(centerX - 4, this.y + 20);
    ctx.quadraticCurveTo(
      centerX - 24,
      this.y + 16 + Math.sin(this.scarfWave) * 8,
      centerX - 40,
      this.y + 24 + Math.cos(this.scarfWave) * 10
    );
    ctx.stroke();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.skin === 'pumpkin') {
      this.drawPumpkinKnight(ctx, centerX, bottomY);
    } else if (this.skin === 'ghost') {
      this.drawSheetGhost(ctx, centerX, bottomY);
    } else if (this.skin === 'skeleton') {
      this.drawSkeleton(ctx, centerX, bottomY);
    } else if (this.skin === 'witch') {
      this.drawWitch(ctx, centerX, bottomY);
    } else if (this.skin === 'reaper') {
      this.drawReaper(ctx, centerX, bottomY);
    } else if (this.skin === 'vampire') {
      this.drawVampire(ctx, centerX, bottomY);
    } else if (this.skin === 'mummy') {
      this.drawMummy(ctx, centerX, bottomY);
    } else if (this.skin === 'franken') {
      this.drawFranken(ctx, centerX, bottomY);
    } else if (this.skin === 'frost_maiden') {
      this.drawFrostMaiden(ctx, centerX, bottomY);
    } else if (this.skin === 'neon_ronin') {
      this.drawNeonRonin(ctx, centerX, bottomY);
    }

    ctx.restore();
  }

  renderCosmeticItem(ctx, ox, oy, kickPulse) {
    // Drawn in player-center-relative space, INSIDE the flip/squash transform,
    // so every item rotates together with the character during a mid-air flip.
    if (!this.equippedItem || this.equippedItem === 'none') return;
    ctx.save();

    if (this.equippedItem === 'bat_familiar') {
      // Orbiting Bat Familiar
      const bx = -38 + Math.cos(this.scarfWave * 0.5) * 10;
      const by = -32 + Math.sin(this.scarfWave * 0.8) * 8 - kickPulse * 8;
      const wing = Math.sin(this.scarfWave * 1.8) * 9;
      ctx.strokeStyle = P.ink;
      ctx.fillStyle = P.accent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(bx - 14, by + wing);
      ctx.quadraticCurveTo(bx - 6, by - 7, bx, by);
      ctx.quadraticCurveTo(bx + 6, by - 7, bx + 14, by + wing);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, 3.5 + kickPulse * 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.equippedItem === 'flame_halo') {
      // Rotating Runic Flame Halo behind character
      const r = 28 + kickPulse * 7;
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 2.2;
      ctx.translate(ox, oy - 4);
      ctx.rotate(this.scarfWave * 0.15);
      ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    } else if (this.equippedItem === 'floating_lantern') {
      // Floating Gothic Lantern ahead/above character
      const lx = 34;
      const ly = -26 + Math.sin(this.scarfWave * 0.6) * 6;
      ctx.strokeStyle = P.ink;
      ctx.fillStyle = P.accent;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(lx, ly, 12 + kickPulse * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(lx - 5, ly - 6, 10, 12);
      ctx.strokeRect(lx - 5, ly - 6, 10, 12);
    } else if (this.equippedItem === 'skull_orbit') {
      // Three skulls orbiting the runner (Waltz of Skulls)
      for (let k = 0; k < 3; k++) {
        const a = this.scarfWave * 0.9 + k * ((Math.PI * 2) / 3);
        const sx = Math.cos(a) * 34;
        const sy = Math.sin(a) * 22 - 6 - kickPulse * 3;
        ctx.strokeStyle = P.ink;
        ctx.fillStyle = P.bone;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 + kickPulse * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = P.ink;
        ctx.fillRect(sx - 3, sy - 1.5, 2, 2.5);
        ctx.fillRect(sx + 1, sy - 1.5, 2, 2.5);
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy + 4);
        ctx.lineTo(sx + 2, sy + 4);
        ctx.stroke();
      }
    } else if (this.equippedItem === 'ghost_candles') {
      // Two floating ghost candles with flickering flames
      const spots = [
        [-30, 8],
        [26, -2]
      ];
      for (let i = 0; i < spots.length; i++) {
        const cx0 = spots[i][0];
        const cy0 = spots[i][1];
        const bob = Math.sin(this.scarfWave * 1.1 + i * 2.1) * 4;
        const flick = 1 + Math.sin(this.scarfWave * 7 + i * 3) * 0.25 + kickPulse * 0.6;
        ctx.strokeStyle = P.ink;
        ctx.fillStyle = P.bone;
        ctx.lineWidth = 1.8;
        ctx.fillRect(cx0 - 4, cy0 + bob - 7, 8, 14);
        ctx.strokeRect(cx0 - 4, cy0 + bob - 7, 8, 14);
        ctx.fillStyle = P.accent;
        ctx.beginPath();
        ctx.ellipse(cx0, cy0 + bob - 12, 2.5 * flick, 5 * flick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = P.crimson;
        ctx.beginPath();
        ctx.moveTo(cx0 + 4, cy0 + bob - 4);
        ctx.lineTo(cx0 + 6, cy0 + bob + 2);
        ctx.stroke();
      }
    } else if (this.equippedItem === 'spider_charm') {
      // Spider on a thread, watching the road
      const sx = 4 + Math.sin(this.scarfWave * 0.7) * 5;
      const sy = -14 + Math.sin(this.scarfWave * 1.3) * 6;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -40);
      ctx.lineTo(sx, sy - 5);
      ctx.stroke();
      ctx.lineWidth = 1.8;
      const legSplay = 4 + kickPulse * 3;
      for (let l = 0; l < 4; l++) {
        const la = -0.6 + l * 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - Math.cos(la) * legSplay, sy + Math.sin(la) * 6 + 4);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(la) * legSplay, sy + Math.sin(la) * 6 + 4);
        ctx.stroke();
      }
      ctx.fillStyle = P.ink;
      ctx.beginPath();
      ctx.arc(sx, sy - 2, 3.5 + kickPulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy + 2.5, 2.6 + kickPulse * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.equippedItem === 'blood_wings') {
      // Dark Raven / Vampire Wings
      const spread = this.isGrounded ? 18 : 32 + kickPulse * 8;
      const flap = this.isGrounded ? Math.sin(this.runFrame) * 4 : -10;
      ctx.strokeStyle = P.crimson;
      ctx.fillStyle = '#2b1818';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-6, -4);
      ctx.lineTo(-6 - spread, -18 + flap);
      ctx.lineTo(-2 - spread * 0.7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (this.equippedItem === 'scythe_aura') {
      // Two death scythes slowly circling behind the runner
      const rot = this.scarfWave * 0.12;
      for (let s = 0; s < 2; s++) {
        ctx.save();
        ctx.rotate(rot + s * Math.PI);
        ctx.strokeStyle = P.crimson;
        ctx.lineWidth = 3.0 + kickPulse * 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 34 + kickPulse * 4, Math.PI * 0.15, Math.PI * 0.7);
        ctx.stroke();
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(
          Math.cos(Math.PI * 0.15) * (34 + kickPulse * 4),
          Math.sin(Math.PI * 0.15) * (34 + kickPulse * 4)
        );
        ctx.lineTo(Math.cos(Math.PI * 0.45) * 22, Math.sin(Math.PI * 0.45) * 22);
        ctx.stroke();
        ctx.restore();
      }
    } else if (this.equippedItem === 'frost_orb') {
      // Ice storm eye orbiting the runner with cold crystal spikes
      const fa = this.scarfWave * 0.7;
      const fx = Math.cos(fa) * 36;
      const fy = Math.sin(fa) * 18 - 8 - kickPulse * 4;
      ctx.strokeStyle = '#7fd4ff';
      ctx.fillStyle = '#eaf9ff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(fx, fy, 7 + kickPulse * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#bdeaff';
      ctx.lineWidth = 1.4;
      for (let s = 0; s < 3; s++) {
        const sa = fa * 1.6 + s * 2.1;
        ctx.beginPath();
        ctx.moveTo(fx + Math.cos(sa) * 10, fy + Math.sin(sa) * 10);
        ctx.lineTo(fx + Math.cos(sa) * 15, fy + Math.sin(sa) * 15);
        ctx.stroke();
      }
    } else if (this.equippedItem === 'star_chain') {
      // Constellation chain of five stars circling the runner
      for (let k = 0; k < 5; k++) {
        const a = this.scarfWave * 0.55 + k * ((Math.PI * 2) / 5);
        const sx = Math.cos(a) * 40;
        const sy = Math.sin(a) * 26 - 4;
        drawStar(ctx, sx, sy, 4 + kickPulse * 2, '#ffd76a');
      }
    }

    ctx.restore();
  }

  drawPumpkinKnight(ctx, centerX, bottomY) {
    const headY = this.y + 13;
    ctx.fillStyle = '#b84214';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(centerX + 3, headY, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.accent;
    ctx.beginPath();
    ctx.ellipse(centerX, headY, 14, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX, headY - 12);
    ctx.lineTo(centerX + 4, headY - 18);
    ctx.stroke();

    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.moveTo(centerX - 6, headY - 4);
    ctx.lineTo(centerX - 2, headY - 1);
    ctx.lineTo(centerX - 7, headY + 1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(centerX + 6, headY - 4);
    ctx.lineTo(centerX + 9, headY + 1);
    ctx.lineTo(centerX + 3, headY - 1);
    ctx.fill();

    const bodyY = this.y + 25;
    const bodyH = 16;
    ctx.fillStyle = '#cfc2ad';
    ctx.fillRect(centerX - 9, bodyY, 18, bodyH);
    ctx.strokeRect(centerX - 9, bodyY, 18, bodyH);

    const legOffset = Math.sin(this.runFrame) * 9;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, bodyY + bodyH);
    ctx.lineTo(centerX - 5 - legOffset, bottomY);
    ctx.moveTo(centerX + 5, bodyY + bodyH);
    ctx.lineTo(centerX + 5 + legOffset, bottomY);
    ctx.stroke();
  }

  drawSheetGhost(ctx, centerX, bottomY) {
    ctx.fillStyle = P.bone;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.8;
    const topY = this.y + 4;
    ctx.beginPath();
    ctx.arc(centerX, topY + 14, 15, Math.PI, 0, false);
    ctx.lineTo(centerX + 16, bottomY - 4);

    for (let i = 3; i >= -3; i--) {
      const wx = centerX + i * 5;
      const wy = bottomY - 4 + Math.sin(this.scarfWave + i) * 4;
      ctx.lineTo(wx, wy);
    }
    ctx.lineTo(centerX - 15, topY + 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.ellipse(centerX - 4, topY + 13, 2.5, 4.5, 0, 0, Math.PI * 2);
    ctx.ellipse(centerX + 6, topY + 13, 2.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawSkeleton(ctx, centerX, bottomY) {
    ctx.fillStyle = P.bone;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.5;

    const headY = this.y + 11;
    ctx.beginPath();
    ctx.arc(centerX, headY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.ink;
    ctx.fillRect(centerX - 4, headY - 2, 3, 3);
    ctx.fillRect(centerX + 4, headY - 2, 3, 3);

    const spineTop = this.y + 22;
    const spineBot = this.y + 40;
    ctx.beginPath();
    ctx.moveTo(centerX, spineTop);
    ctx.lineTo(centerX, spineBot);
    for (let ry = spineTop + 4; ry < spineBot; ry += 5) {
      ctx.moveTo(centerX - 8, ry);
      ctx.lineTo(centerX + 8, ry);
    }
    ctx.stroke();

    const legOffset = Math.sin(this.runFrame) * 10;
    ctx.beginPath();
    ctx.moveTo(centerX - 4, spineBot);
    ctx.lineTo(centerX - 4 - legOffset, bottomY);
    ctx.moveTo(centerX + 4, spineBot);
    ctx.lineTo(centerX + 4 + legOffset, bottomY);
    ctx.stroke();
  }

  drawWitch(ctx, centerX, bottomY) {
    ctx.fillStyle = '#3b312b';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;

    const hatBrimY = this.y + 10;
    ctx.beginPath();
    ctx.moveTo(centerX - 18, hatBrimY);
    ctx.lineTo(centerX + 18, hatBrimY);
    ctx.lineTo(centerX + 10, hatBrimY);
    ctx.lineTo(centerX - 4, this.y - 12);
    ctx.lineTo(centerX - 10, hatBrimY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.accent;
    ctx.fillRect(centerX - 5, hatBrimY - 5, 10, 4);

    ctx.fillStyle = P.bone;
    ctx.beginPath();
    ctx.arc(centerX, hatBrimY + 7, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4a3d35';
    ctx.beginPath();
    ctx.moveTo(centerX, hatBrimY + 15);
    ctx.lineTo(centerX - 13, bottomY - 8);
    ctx.lineTo(centerX + 13, bottomY - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const legOffset = Math.sin(this.runFrame) * 8;
    ctx.beginPath();
    ctx.moveTo(centerX - 4, bottomY - 8);
    ctx.lineTo(centerX - 4 - legOffset, bottomY);
    ctx.moveTo(centerX + 4, bottomY - 8);
    ctx.lineTo(centerX + 4 + legOffset, bottomY);
    ctx.stroke();
  }

  drawReaper(ctx, centerX, bottomY) {
    // Hooded Grim Reaper with Scythe
    ctx.fillStyle = '#231d1a';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;

    // Pointed Hood & Cloak
    ctx.beginPath();
    ctx.moveTo(centerX - 14, this.y + 8);
    ctx.lineTo(centerX + 6, this.y - 4);
    ctx.lineTo(centerX + 14, this.y + 16);
    ctx.lineTo(centerX + 16, bottomY - 2);
    ctx.lineTo(centerX - 16, bottomY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Glowing orange eye under hood
    ctx.fillStyle = P.accent;
    ctx.fillRect(centerX + 4, this.y + 9, 4, 4);

    // Scythe Pole & Crimson Blade
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(centerX - 12, bottomY - 6);
    ctx.lineTo(centerX + 18, this.y - 10);
    ctx.stroke();

    ctx.fillStyle = P.crimson;
    ctx.beginPath();
    ctx.moveTo(centerX + 18, this.y - 10);
    ctx.quadraticCurveTo(centerX + 38, this.y - 6, centerX + 26, this.y + 12);
    ctx.quadraticCurveTo(centerX + 24, this.y - 2, centerX + 16, this.y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawVampire(ctx, centerX, bottomY) {
    // Pale count: slick widow's-peak hair, red eyes, high-collared cape
    const headY = this.y + 13;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;

    ctx.fillStyle = '#2b1818';
    ctx.beginPath();
    ctx.moveTo(centerX - 13, this.y + 24);
    ctx.lineTo(centerX + 13, this.y + 24);
    ctx.lineTo(centerX + 16, bottomY - 2);
    ctx.lineTo(centerX - 16, bottomY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.crimson;
    ctx.beginPath();
    ctx.moveTo(centerX - 9, this.y + 26);
    ctx.lineTo(centerX + 9, this.y + 26);
    ctx.lineTo(centerX + 5, bottomY - 4);
    ctx.lineTo(centerX - 5, bottomY - 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.moveTo(centerX - 12, headY + 8);
    ctx.lineTo(centerX - 4, headY + 2);
    ctx.lineTo(centerX - 12, headY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(centerX + 12, headY + 8);
    ctx.lineTo(centerX + 4, headY + 2);
    ctx.lineTo(centerX + 12, headY - 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e8d9c8';
    ctx.beginPath();
    ctx.ellipse(centerX, headY + 2, 11, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(centerX, headY, 11.5, Math.PI, 0);
    ctx.lineTo(centerX, headY - 1);
    ctx.lineTo(centerX - 4, headY - 7);
    ctx.lineTo(centerX - 8, headY - 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = P.crimson;
    ctx.fillRect(centerX - 6, headY + 1, 3, 2.5);
    ctx.fillRect(centerX + 3, headY + 1, 3, 2.5);
    ctx.fillStyle = '#f7f0e2';
    ctx.beginPath();
    ctx.moveTo(centerX - 4, headY + 9);
    ctx.lineTo(centerX - 2.5, headY + 12);
    ctx.lineTo(centerX - 1.5, headY + 9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(centerX + 1.5, headY + 9);
    ctx.lineTo(centerX + 2.5, headY + 12);
    ctx.lineTo(centerX + 4, headY + 9);
    ctx.closePath();
    ctx.fill();

    const legOffset = Math.sin(this.runFrame) * 9;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, bottomY - 8);
    ctx.lineTo(centerX - 5 - legOffset, bottomY);
    ctx.moveTo(centerX + 5, bottomY - 8);
    ctx.lineTo(centerX + 5 + legOffset, bottomY);
    ctx.stroke();
  }

  drawMummy(ctx, centerX, bottomY) {
    // Bandaged awakened one: wraps, one glowing eye, dangling strip
    const headY = this.y + 12;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.4;

    ctx.fillStyle = P.bone;
    ctx.fillRect(centerX - 10, this.y + 24, 20, 18);
    ctx.strokeRect(centerX - 10, this.y + 24, 20, 18);

    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const wy = this.y + 26 + k * 4.5;
      ctx.moveTo(centerX - 10, wy + Math.sin(k) * 2);
      ctx.lineTo(centerX + 10, wy - Math.sin(k) * 2);
    }
    ctx.stroke();

    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(centerX, headY, 11, 0, Math.PI * 2);
    ctx.fillStyle = P.bone;
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(centerX - 10, headY - 4);
    ctx.lineTo(centerX + 9, headY - 8);
    ctx.moveTo(centerX - 9, headY + 3);
    ctx.lineTo(centerX + 10, headY - 1);
    ctx.stroke();

    ctx.fillStyle = P.accent;
    ctx.fillRect(centerX + 1, headY - 2, 4, 3);
    ctx.fillStyle = P.ink;
    ctx.fillRect(centerX - 6, headY - 2, 3, 3);

    const sway = Math.sin(this.scarfWave * 1.4) * 4;
    ctx.strokeStyle = P.bone;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(centerX + 8, headY + 8);
    ctx.quadraticCurveTo(centerX + 10 + sway, this.y + 34, centerX + 6 + sway, bottomY - 4);
    ctx.stroke();

    const legOffset = Math.sin(this.runFrame) * 7;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 4, this.y + 42);
    ctx.lineTo(centerX - 4 - legOffset, bottomY);
    ctx.moveTo(centerX + 4, this.y + 42);
    ctx.lineTo(centerX + 4 + legOffset, bottomY);
    ctx.stroke();
  }

  drawFranken(ctx, centerX, bottomY) {
    // Lab creature: flat green head, bolts, forehead stitches
    const headY = this.y + 12;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.6;

    ctx.fillStyle = '#3b312b';
    ctx.fillRect(centerX - 9, this.y + 24, 18, 17);
    ctx.strokeRect(centerX - 9, this.y + 24, 18, 17);

    ctx.fillStyle = '#7a8f4a';
    ctx.beginPath();
    ctx.rect(centerX - 11, headY - 6, 22, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.ink;
    ctx.fillRect(centerX - 11, headY - 10, 22, 4);
    ctx.strokeRect(centerX - 11, headY - 10, 22, 4);

    ctx.fillStyle = P.ink;
    ctx.fillRect(centerX - 7, headY, 5, 2.5);
    ctx.fillRect(centerX + 2, headY, 5, 2.5);
    ctx.fillStyle = '#e8be8c';
    ctx.fillRect(centerX - 6, headY + 3, 3.5, 3);
    ctx.fillRect(centerX + 2.5, headY + 3, 3.5, 3);
    ctx.fillStyle = P.ink;
    ctx.fillRect(centerX - 5, headY + 4, 1.5, 1.5);
    ctx.fillRect(centerX + 3.5, headY + 4, 1.5, 1.5);

    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 8, headY - 3);
    ctx.lineTo(centerX + 8, headY - 3);
    for (let sx = -6; sx <= 6; sx += 4) {
      ctx.moveTo(centerX + sx, headY - 5);
      ctx.lineTo(centerX + sx, headY - 1);
    }
    ctx.stroke();

    ctx.fillStyle = '#8c7f70';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(centerX - 10, headY + 13, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX + 10, headY + 13, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const legOffset = Math.sin(this.runFrame) * 9;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, this.y + 41);
    ctx.lineTo(centerX - 5 - legOffset, bottomY);
    ctx.moveTo(centerX + 5, this.y + 41);
    ctx.lineTo(centerX + 5 + legOffset, bottomY);
    ctx.stroke();
  }

  drawFrostMaiden(ctx, centerX, bottomY) {
    // Icy queen: pale gown with icicle hem and a crystal crown
    const headY = this.y + 12;
    ctx.strokeStyle = '#274b6d';
    ctx.lineWidth = 2.6;

    ctx.fillStyle = '#bfe3f7';
    ctx.beginPath();
    ctx.moveTo(centerX - 10, this.y + 22);
    ctx.lineTo(centerX + 10, this.y + 22);
    ctx.lineTo(centerX + 15, bottomY - 2);
    ctx.lineTo(centerX - 15, bottomY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#eaf9ff';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(centerX + i * 6 - 3, bottomY - 3);
      ctx.lineTo(centerX + i * 6, bottomY + 4);
      ctx.lineTo(centerX + i * 6 + 3, bottomY - 3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.arc(centerX, headY, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#7fd4ff';
    ctx.beginPath();
    ctx.moveTo(centerX - 8, headY - 8);
    ctx.lineTo(centerX - 4, headY - 16);
    ctx.lineTo(centerX, headY - 9);
    ctx.lineTo(centerX + 4, headY - 17);
    ctx.lineTo(centerX + 8, headY - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1d5c8a';
    ctx.fillRect(centerX - 5, headY - 1, 3, 3);
    ctx.fillRect(centerX + 2, headY - 1, 3, 3);

    const legOffset = Math.sin(this.runFrame) * 8;
    ctx.strokeStyle = '#274b6d';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, bottomY - 6);
    ctx.lineTo(centerX - 5 - legOffset, bottomY);
    ctx.moveTo(centerX + 5, bottomY - 6);
    ctx.lineTo(centerX + 5 + legOffset, bottomY);
    ctx.stroke();
  }

  drawNeonRonin(ctx, centerX, bottomY) {
    // Cyber ronin: dark coat, neon cross-belt, glowing visor, katana
    const headY = this.y + 12;
    ctx.strokeStyle = '#101826';
    ctx.lineWidth = 2.6;

    ctx.fillStyle = '#182338';
    ctx.beginPath();
    ctx.moveTo(centerX - 11, this.y + 22);
    ctx.lineTo(centerX + 11, this.y + 22);
    ctx.lineTo(centerX + 14, bottomY - 2);
    ctx.lineTo(centerX - 14, bottomY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(centerX - 10, this.y + 24);
    ctx.lineTo(centerX + 10, this.y + 36);
    ctx.moveTo(centerX + 10, this.y + 24);
    ctx.lineTo(centerX - 10, this.y + 36);
    ctx.stroke();

    ctx.strokeStyle = '#101826';
    ctx.lineWidth = 2.4;
    ctx.fillStyle = '#22304a';
    ctx.beginPath();
    ctx.arc(centerX, headY, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff2e88';
    ctx.fillRect(centerX - 8, headY - 3, 16, 4);

    ctx.strokeStyle = '#101826';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - 14, this.y + 34);
    ctx.lineTo(centerX + 16, this.y + 2);
    ctx.stroke();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 13, this.y + 36);
    ctx.lineTo(centerX + 17, this.y + 4);
    ctx.stroke();

    const legOffset = Math.sin(this.runFrame) * 9;
    ctx.strokeStyle = '#101826';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, bottomY - 6);
    ctx.lineTo(centerX - 5 - legOffset, bottomY);
    ctx.moveTo(centerX + 5, bottomY - 6);
    ctx.lineTo(centerX + 5 + legOffset, bottomY);
    ctx.stroke();
  }

  renderGhost(ctx, remoteY, remoteFlipping) {
    // Translucent silhouette of the peer's runner (multiplayer)
    ctx.save();
    ctx.globalAlpha = 0.32;
    const cx = this.x + this.width / 2;
    ctx.fillStyle = P.ink;
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 2.0;
    if (remoteFlipping) {
      ctx.translate(cx, remoteY + this.height / 2);
      ctx.rotate(this.scarfWave * 0.8);
      ctx.translate(-cx, -(remoteY + this.height / 2));
    }
    ctx.beginPath();
    ctx.rect(cx - 14, remoteY + 16, 28, 34);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, remoteY + 9, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 4, remoteY + 14);
    ctx.quadraticCurveTo(cx - 18, remoteY + 22, cx - 30, remoteY + 18);
    ctx.stroke();
    ctx.restore();
  }
}
