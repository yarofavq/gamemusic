import { P } from '../render/Theme.js';
export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.maxParticles = 420;
  }

  push(p) {
    this.particles.push(p);
    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }
  }

  emitJumpDust(x, y, count = 24, isPerfect = false) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = Math.random() * 290 + 75;
      const rand = Math.random();
      let type = 'pencil_stroke';
      if (rand > 0.62) type = 'bat';
      else if (rand > 0.35 && isPerfect) type = 'spark_orange';

      this.push({
        x,
        y: y - 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'bat' ? 95 : 0),
        life: 1.0,
        decay: Math.random() * 1.4 + 1.0,
        size: Math.random() * 7 + 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        wingPhase: Math.random() * 6,
        type
      });
    }
  }

  emitFlipVortex(x, y, skin = 'pumpkin') {
    // Spectacular spiral ink & bat burst during mid-air beat flip
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      const speed = 150 + (i % 3) * 65;
      let type = 'spark_orange';
      if (skin === 'skeleton') type = i % 2 === 0 ? 'bone_shard' : 'spark_orange';
      else if (skin === 'ghost') type = i % 2 === 0 ? 'spirit_orb' : 'pencil_stroke';
      else if (skin === 'witch') type = i % 2 === 0 ? 'bat' : 'spark_orange';
      else if (skin === 'raven') type = i % 2 === 0 ? 'feather' : 'ink_droplet';
      else if (skin === 'doll') type = i % 2 === 0 ? 'petal' : 'pencil_stroke';
      else if (skin === 'candle_monk') type = i % 3 === 0 ? 'spirit_orb' : 'spark_orange';
      else if (skin === 'hellhound') type = i % 2 === 0 ? 'bat' : 'spark_orange';
      else if (skin === 'plague') type = i % 2 === 0 ? 'spirit_orb' : 'ink_droplet';
      else if (skin === 'star_weaver') type = i % 2 === 0 ? 'star' : 'spirit_orb';

      this.push({
        x: x + Math.cos(angle) * 18,
        y: y + Math.sin(angle) * 18,
        vx: Math.cos(angle + 0.8) * speed,
        vy: Math.sin(angle + 0.8) * speed,
        life: 0.95,
        decay: 1.5,
        size: 6 + (i % 4),
        rotation: angle,
        rotSpeed: 9,
        wingPhase: i,
        type
      });
    }
  }

  emitBeatRing(x, y) {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const speed = 180 + Math.random() * 40;
      this.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.75,
        decay: 1.8,
        size: 4.5,
        rotation: angle,
        rotSpeed: 4,
        type: i % 2 === 0 ? 'spark_orange' : 'ink_droplet'
      });
    }
  }

  /**
   * Full kick-hit celebration: expanding shockwave ring, radial spikes,
   * musical glyphs floating up, ink droplets and a rolling ground wave.
   * intensity 0..1 (from offline kick strength / realtime kick energy).
   */
  emitKickShock(x, y, groundY, intensity = 1) {
    const boost = 0.7 + intensity * 0.6;

    // 1. Expanding shockwave ring
    this.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.5,
      decay: 1.9,
      size: 14,
      rotation: 0,
      rotSpeed: 0,
      growth: 460 * boost,
      type: 'ring'
    });

    // 2. Radial ink spikes
    const spikes = 6 + Math.round(intensity * 6);
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (200 + Math.random() * 160) * boost;
      this.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7,
        life: 0.6,
        decay: 2.0,
        size: 5 + Math.random() * 4,
        rotation: angle,
        rotSpeed: 6,
        type: 'spark_orange'
      });
    }

    // 3. Musical note glyphs floating up
    const notes = 1 + Math.round(intensity * 2);
    for (let i = 0; i < notes; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 70,
        y: y - 10 - Math.random() * 20,
        vx: (Math.random() - 0.5) * 30,
        vy: -60 - Math.random() * 50,
        life: 0.9,
        decay: 1.15,
        size: 14 + Math.random() * 8,
        rotation: (Math.random() - 0.5) * 0.5,
        rotSpeed: (Math.random() - 0.5) * 1.5,
        glyph: i % 2 === 0 ? '\u266A' : '\u266B',
        type: 'note'
      });
    }

    // 4. Ink droplets with gravity
    for (let i = 0; i < 5; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 260 * boost,
        vy: -Math.random() * 220 * boost,
        life: 0.8,
        decay: 1.6,
        size: 3 + Math.random() * 4,
        rotation: 0,
        rotSpeed: 0,
        type: 'ink_droplet'
      });
    }

    // 5. Ground dust wave rolling both directions
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        this.push({
          x,
          y: groundY - 2 - i * 3,
          vx: dir * (320 + i * 90) * boost,
          vy: -20 - i * 14,
          life: 0.55,
          decay: 2.2,
          size: 6 + i * 2,
          rotation: 0,
          rotSpeed: 0,
          type: 'ground_wave'
        });
      }
    }
  }

  setQuality(level) {
    this.maxParticles = level === 'low' ? 170 : level === 'mid' ? 300 : 420;
  }

  /**
   * Finale storm: rising accent embers + spinning runes when the track
   * approaches its end (intensity = finale progress 0..1).
   */
  emitFinaleEmbers(x, y, groundY, intensity = 0.5) {
    const count = Math.round(2 + intensity * 4);
    for (let i = 0; i < count; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 420,
        y: groundY - Math.random() * 20,
        vx: (Math.random() - 0.5) * 60,
        vy: -110 - Math.random() * 130 * (0.5 + intensity),
        life: 1.0,
        decay: 0.75,
        size: 3 + Math.random() * 5,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8,
        type: i % 3 === 0 ? 'spirit_orb' : 'spark_orange'
      });
    }
    if (Math.random() < intensity * 0.8) {
      this.push({
        x: x + (Math.random() - 0.5) * 300,
        y: groundY - 60 - Math.random() * 160,
        vx: (Math.random() - 0.5) * 40,
        vy: -40 - Math.random() * 30,
        life: 1.1,
        decay: 0.85,
        size: 16 + Math.random() * 8,
        rotation: (Math.random() - 0.5) * 0.6,
        rotSpeed: (Math.random() - 0.5) * 1.2,
        glyph: Math.random() < 0.5 ? '\u266B' : '\u266A',
        type: 'note'
      });
    }
  }

  emitJudgment(text, x, y, quality) {
    this.push({
      text,
      x,
      y,
      vx: 0,
      vy: -70,
      life: 0.9,
      decay: 1.15,
      size: quality === 'PERFECT' ? 23 : 17,
      quality,
      rotation: (Math.random() - 0.5) * 0.14,
      rotSpeed: 0,
      type: 'text_label'
    });
  }

  /**
   * better17 TRACK CLEAR blast: everything at once — triple shockwave,
   * star & note fireworks, spirit orbs, ink rain from the sky and a
   * rising ember column. Called at the exact end of the track.
   */
  emitFinaleStorm(x, y, groundY, intensity = 1) {
    const boost = 1 + intensity * 0.5;

    // Triple expanding shockwave rings (staggered radii)
    for (let r = 0; r < 3; r++) {
      this.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.9 - r * 0.14,
        decay: 1.35,
        size: 10 + r * 26,
        rotation: 0,
        rotSpeed: 0,
        growth: (520 - r * 120) * boost,
        type: 'ring'
      });
    }

    // Star & note firework volley
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
      const speed = (240 + Math.random() * 260) * boost;
      const type = i % 3 === 0 ? 'star' : i % 3 === 1 ? 'note' : 'spirit_orb';
      this.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 130,
        life: 1.25,
        decay: 0.95,
        size: type === 'note' ? 16 + Math.random() * 9 : 5 + Math.random() * 5,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 9,
        glyph: Math.random() < 0.5 ? '\u266A' : '\u266B',
        type
      });
    }

    // Ink rain falling from the sky across the whole road
    for (let i = 0; i < 26; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 900,
        y: -30 - Math.random() * 220,
        vx: (Math.random() - 0.5) * 40,
        vy: 240 + Math.random() * 260,
        life: 1.5,
        decay: 0.8,
        size: 3 + Math.random() * 4,
        rotation: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 6,
        type: i % 4 === 0 ? 'feather' : 'ink_droplet'
      });
    }

    // Rising ember column from the ground
    for (let i = 0; i < 18; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 320,
        y: groundY - Math.random() * 26,
        vx: (Math.random() - 0.5) * 70,
        vy: -180 - Math.random() * 240,
        life: 1.3,
        decay: 0.75,
        size: 3 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        type: i % 3 === 0 ? 'petal' : 'spark_orange'
      });
    }
  }

  // better18: vertical portal pass-through burst
  emitPortalBurst(x, y) {
    this.push({
      x, y,
      vx: 0, vy: 0,
      life: 0.8, decay: 1.3,
      size: 12, rotation: 0, rotSpeed: 0,
      growth: 430,
      type: 'ring'
    });

    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 240;
      const type = i % 4 === 0 ? 'star' : i % 4 === 1 ? 'note' : i % 4 === 2 ? 'spirit_orb' : 'spark_orange';
      this.push({
        x,
        y: y - 40,
        vx: Math.cos(angle) * speed * 0.6,
        vy: Math.sin(angle) * speed - 70,
        life: 1.1, decay: 1.0,
        size: type === 'note' ? 13 + Math.random() * 7 : 3.5 + Math.random() * 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8,
        glyph: Math.random() < 0.5 ? '\u25c8' : '\u2726',
        type
      });
    }

    // vertical light columns shooting up from the portal
    for (let i = 0; i < 5; i++) {
      this.push({
        x: x + (Math.random() - 0.5) * 52,
        y: y + 8,
        vx: 0,
        vy: -330 - Math.random() * 170,
        life: 0.9, decay: 1.25,
        size: 2.5 + Math.random() * 2,
        rotation: 0, rotSpeed: 0,
        type: 'spark_orange'
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'ring') {
        p.size += p.growth * dt;
      } else if (p.type !== 'bat' && p.type !== 'text_label' && p.type !== 'spirit_orb' && p.type !== 'note' && p.type !== 'ground_wave') {
        p.vy += 400 * dt;
      } else if (p.type === 'bat') {
        p.wingPhase += dt * 26;
        p.vy -= 45 * dt;
      } else if (p.type === 'ground_wave') {
        p.vy += 140 * dt;
      }
      p.rotation += p.rotSpeed * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx) {
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.type === 'pencil_stroke') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 2);
        ctx.stroke();
      } else if (p.type === 'spark_orange') {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 0);
        ctx.moveTo(0, -p.size);
        ctx.lineTo(0, p.size);
        ctx.stroke();
      } else if (p.type === 'ring') {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 3.2 * Math.max(0.2, p.life);
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (p.type === 'note') {
        ctx.font = `700 ${p.size}px 'Georgia', serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = P.ink;
        ctx.fillText(p.glyph, 0, 0);
      } else if (p.type === 'ground_wave') {
        ctx.strokeStyle = `rgba(${P.inkRGB}, 0.85)`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-p.size * 1.6, 0);
        ctx.quadraticCurveTo(0, -5, p.size * 1.6, 0);
        ctx.stroke();
      } else if (p.type === 'bone_shard') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 0);
        ctx.arc(-p.size, -2, 2, 0, Math.PI * 2);
        ctx.arc(p.size, 2, 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'spirit_orb') {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * p.life, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'bat') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 2.2;
        const wingY = Math.sin(p.wingPhase) * 6;
        ctx.beginPath();
        ctx.moveTo(-p.size * 1.4, wingY);
        ctx.quadraticCurveTo(-p.size * 0.6, -5, 0, 0);
        ctx.quadraticCurveTo(p.size * 0.6, -5, p.size * 1.4, wingY);
        ctx.stroke();
      } else if (p.type === 'ink_droplet') {
        ctx.fillStyle = P.ink;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'feather') {
        // Barbed quill: central shaft + angled barbs
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-p.size, p.size * 0.6);
        ctx.quadraticCurveTo(0, -p.size, p.size, -p.size * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.4, p.size * 0.15);
        ctx.lineTo(-p.size * 0.7, -p.size * 0.75);
        ctx.moveTo(p.size * 0.2, -p.size * 0.1);
        ctx.lineTo(p.size * 0.65, -p.size * 0.9);
        ctx.stroke();
      } else if (p.type === 'petal') {
        // Sakura petal: soft notched ellipse
        ctx.fillStyle = P.accent;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.9, p.size * 0.55, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.5, 0);
        ctx.lineTo(p.size * 0.5, 0);
        ctx.stroke();
      } else if (p.type === 'star') {
        // Four-point sparkle star
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2.2;
        const s = p.size * (0.6 + p.life * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(0, 0, s, 0);
        ctx.quadraticCurveTo(0, 0, 0, s);
        ctx.quadraticCurveTo(0, 0, -s, 0);
        ctx.quadraticCurveTo(0, 0, 0, -s);
        ctx.stroke();
      } else if (p.type === 'text_label') {
        ctx.font = `900 ${p.size}px 'Georgia', serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.quality === 'PERFECT' ? P.accent : (p.quality === 'GOOD' ? P.ink : P.crimson);
        ctx.fillText(p.text, 0, 0);
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
