export class MenuMusic {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.timer = null;
    this.step = 0;
    this.tempo = 104;
    this.masterGain = null;
    this.underwaterFilter = null;
    this.lfo = null;
    this.lfoGain = null;
    this.volume = 0.75;
    this.isUnderwater = false;
  }

  init(audioCtx) {
    this.ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (!this.masterGain) {
      this.underwaterFilter = this.ctx.createBiquadFilter();
      this.underwaterFilter.type = 'lowpass';
      this.underwaterFilter.frequency.setValueAtTime(18000, this.ctx.currentTime);
      this.underwaterFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

      // Subtle LFO for underwater murkiness wobble
      this.lfo = this.ctx.createOscillator();
      this.lfo.frequency.value = 0.45;
      this.lfoGain = this.ctx.createGain();
      this.lfoGain.gain.value = 0;
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.underwaterFilter.frequency);
      this.lfo.start();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume * 0.28, this.ctx.currentTime);

      this.underwaterFilter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
  }

  setUnderwater(enabled) {
    if (!this.ctx) this.init();
    this.isUnderwater = enabled;
    const now = this.ctx.currentTime;
    this.underwaterFilter.frequency.cancelScheduledValues(now);
    this.underwaterFilter.Q.cancelScheduledValues(now);
    this.lfoGain.gain.cancelScheduledValues(now);

    if (enabled) {
      // Deep muffled underwater lowpass (240Hz with resonant ripple)
      this.underwaterFilter.frequency.setTargetAtTime(240, now, 0.15);
      this.underwaterFilter.Q.setTargetAtTime(4.5, now, 0.15);
      this.lfoGain.gain.setTargetAtTime(75, now, 0.2);
    } else {
      this.underwaterFilter.frequency.setTargetAtTime(18000, now, 0.15);
      this.underwaterFilter.Q.setTargetAtTime(0.7, now, 0.15);
      this.lfoGain.gain.setTargetAtTime(0, now, 0.15);
    }
  }

  setVolume(normVal) {
    this.volume = Math.max(0, Math.min(1, normVal));
    if (this.masterGain && this.ctx && this.isPlaying) {
      this.masterGain.gain.setTargetAtTime(this.volume * 0.28, this.ctx.currentTime, 0.05);
    }
  }

  start(underwaterMode = false) {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.setUnderwater(underwaterMode);
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setValueAtTime(this.volume * 0.28, this.ctx.currentTime);

    const stepInterval = (60 / this.tempo) / 2;
    const melody = [
      440.00, 523.25, 659.25, 830.61,
      698.46, 659.25, 622.25, 659.25,
      440.00, 523.25, 587.33, 698.46,
      659.25, 523.25, 493.88, 415.30
    ];
    const bass = [110.00, 110.00, 87.31, 82.41];

    const tick = () => {
      if (!this.isPlaying) return;
      const t = this.ctx.currentTime;
      const idx = this.step % melody.length;
      const bar = Math.floor(idx / 4);

      this.playMusicBoxNote(melody[idx], t, 0.55);

      if (idx % 4 === 0) {
        this.playBassNote(bass[bar], t, 1.2);
        this.playSoftKick(t);
      }
      if (idx % 4 === 2) {
        this.playBrushTick(t);
      }

      this.step++;
      this.timer = setTimeout(tick, stepInterval * 1000);
    };

    tick();
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
    }
  }

  playMusicBoxNote(freq, time, dur) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.18, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(gain);
    gain.connect(this.underwaterFilter);
    osc.start(time);
    osc.stop(time + dur);
  }

  playBassNote(freq, time, dur) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.26, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(gain);
    gain.connect(this.underwaterFilter);
    osc.start(time);
    osc.stop(time + dur);
  }

  playSoftKick(time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(105, time);
    osc.frequency.exponentialRampToValueAtTime(32, time + 0.16);
    gain.gain.setValueAtTime(0.28, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    osc.connect(gain);
    gain.connect(this.underwaterFilter);
    osc.start(time);
    osc.stop(time + 0.16);
  }

  playBrushTick(time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(3200, time);
    gain.gain.setValueAtTime(0.025, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain);
    gain.connect(this.underwaterFilter);
    osc.start(time);
    osc.stop(time + 0.03);
  }
}
