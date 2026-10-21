export class BeatDetector {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.kickFilter1 = null;
    this.kickFilter2 = null;
    this.kickFilter3 = null;
    this.kickAnalyser = null;
    this.midFilter = null;
    this.midAnalyser = null;
    this.source = null;

    this.bpm = 120;
    this.isLoaded = false;
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseOffset = 0;
    this.startTime = 0;
    this.onEndedCallback = null;

    this.audioBuffer = null;
    this.kickMap = [];       // Verified pure kick drum timestamps
    this.obstacleKicks = []; // Kick timestamps spaced for obstacles
    this.coinKicks = [];     // Kick timestamps for coins
    this.lastTriggeredKickIndex = -1;

    // YouTube mode (better17): an external clock provider replaces the
    // AudioBufferSourceNode. Beat timings come from the calibrated grid.
    this.yt = null;
    this.ytDuration = 0;

    this.prevSubRms = 0;
    this.subHistory = [];
    this.historySize = 25;
    this.gainNode = null;
    this.volume = 0.75;
    this.kickIntensity = 0;

    // Preallocated realtime buffers (no per-frame GC churn)
    this.subBuf = null;
    this.midBuf = null;
  }

  async init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.15;

      // Steep 36dB/oct Cascaded Lowpass Filter Chain (42Hz - 95Hz) to strip melody & vocals in real-time
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 42;
      hp.Q.value = 0.707;

      this.kickFilter1 = this.ctx.createBiquadFilter();
      this.kickFilter1.type = 'lowpass';
      this.kickFilter1.frequency.value = 95;
      this.kickFilter1.Q.value = 0.707;

      this.kickFilter2 = this.ctx.createBiquadFilter();
      this.kickFilter2.type = 'lowpass';
      this.kickFilter2.frequency.value = 95;
      this.kickFilter2.Q.value = 0.707;

      this.kickFilter3 = this.ctx.createBiquadFilter();
      this.kickFilter3.type = 'lowpass';
      this.kickFilter3.frequency.value = 95;
      this.kickFilter3.Q.value = 1.1;

      this.kickAnalyser = this.ctx.createAnalyser();
      this.kickAnalyser.fftSize = 256;
      this.kickAnalyser.smoothingTimeConstant = 0.0;

      // Melody / Midrange Reject Monitor (250Hz - 1200Hz)
      this.midFilter = this.ctx.createBiquadFilter();
      this.midFilter.type = 'bandpass';
      this.midFilter.frequency.value = 500;
      this.midFilter.Q.value = 0.8;

      this.midAnalyser = this.ctx.createAnalyser();
      this.midAnalyser.fftSize = 256;
      this.midAnalyser.smoothingTimeConstant = 0.0;

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;

      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);

      this.analyser.connect(hp);
      hp.connect(this.kickFilter1);
      this.kickFilter1.connect(this.kickFilter2);
      this.kickFilter2.connect(this.kickFilter3);
      this.kickFilter3.connect(this.kickAnalyser);

      this.analyser.connect(this.midFilter);
      this.midFilter.connect(this.midAnalyser);

      this.subBuf = new Float32Array(this.kickAnalyser.fftSize);
      this.midBuf = new Float32Array(this.midAnalyser.fftSize);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  setVolume(normVal) {
    this.volume = Math.max(0, Math.min(1, normVal));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  async loadFile(file) {
    await this.init();
    const arrayBuffer = await file.arrayBuffer();
    return this.loadArrayBuffer(arrayBuffer);
  }

  /**
   * Full offline path: decode -> analyze -> build timelines.
   */
  async loadArrayBuffer(arrayBuffer) {
    await this.init();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    const analysis = await this.extractPureKickDrumMap(this.audioBuffer);
    this.applyAnalysis(analysis);
    return this.bpm;
  }

  /**
   * Multiplayer guest path: same audio buffer as the host, but the host's
   * verified kick map is reused verbatim -> identical obstacle timelines.
   */
  async loadFromHost(arrayBuffer, map) {
    await this.init();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.applyAnalysis({
      bpm: map.bpm || 120,
      kickMap: map.kickMap || [],
      obstacleKicks: map.obstacleKicks || [],
      coinKicks: map.coinKicks || []
    });
    return this.bpm;
  }

  applyAnalysis(analysis) {
    this.bpm = analysis.bpm;
    this.kickMap = analysis.kickMap;
    this.obstacleKicks = analysis.obstacleKicks;
    this.coinKicks = analysis.coinKicks;
    this.isLoaded = true;
  }

  /**
   * YouTube mode: delegate playback/clock to the IFrame player wrapper.
   * The kick grid must already be installed via applyAnalysis()/buildKicksFromBpm.
   */
  attachYouTube(yt, durationSec) {
    this.yt = yt;
    this.ytDuration = durationSec || 0;
  }

  detachYouTube() {
    this.yt = null;
    this.ytDuration = 0;
  }

  /**
   * Tap-calibration path (YouTube): synthesize a verified kick grid from a
   * calibrated BPM + phase. Grid starts after the musical intro window so the
   * gameplay timeline begins cleanly.
   */
  buildKicksFromBpm(bpm, phaseSec, durationSec) {
    const interval = 60 / Math.max(40, Math.min(240, bpm));
    const kicks = [];
    let t = ((phaseSec % interval) + interval) % interval;
    while (t < 1.15) t += interval; // keep the 1.1s warm-up window clean
    for (; t < durationSec - 0.3; t += interval) {
      kicks.push(Math.round(t * 1000) / 1000);
    }
    return kicks;
  }

  applySyntheticTrack(bpm, phaseSec, durationSec) {
    const kicks = this.buildKicksFromBpm(bpm, phaseSec, durationSec);
    this.applyAnalysis({ bpm, kickMap: kicks, ...this.buildGameplayTimelines(kicks, durationSec) });
    return this.bpm;
  }

  /**
   * Multi-band DSP Kick Drum Isolator v2:
   * 1. Mono center extraction with stereo side-cancellation penalty.
   * 2. 4-stage cascaded sub-bass filter (42Hz - 92Hz) for pure kick thump.
   * 3. Parallel midrange band (220Hz - 1400Hz) to reject melody/synth/vocals.
   * 4. Adaptive attack threshold (median of positive rises) instead of a fixed one.
   * 5. Ghost-energy floor: reject onsets below the track's typical sub energy.
   * 6. BPM: inter-onset histogram + fine grid-coverage search (+-2 BPM, 0.25 steps).
   * 7. Pass 2: re-scan the beat grid for missed quiet-but-real kicks.
   */
  async extractPureKickDrumMap(buffer) {
    try {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const targetRate = 11025;
      const length = Math.floor(buffer.duration * targetRate);

      // Mono sum buffer with stereo side-cancellation penalty
      const offlineSubCtx = new OfflineCtx(1, length, targetRate);
      const monoBuffer = offlineSubCtx.createBuffer(1, buffer.length, buffer.sampleRate);
      const monoOut = monoBuffer.getChannelData(0);
      const chL = buffer.getChannelData(0);
      const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;

      for (let i = 0; i < buffer.length; i++) {
        const mid = (chL[i] + chR[i]) * 0.5;
        const side = Math.abs(chL[i] - chR[i]) * 0.35;
        monoOut[i] = Math.abs(mid) > side ? mid : mid * 0.25;
      }

      // Pass 1a: 48dB/octave Sub-Bass Kick Band (42Hz - 92Hz)
      const subSource = offlineSubCtx.createBufferSource();
      subSource.buffer = monoBuffer;

      const hp = offlineSubCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 42;
      hp.Q.value = 0.707;

      const lp1 = offlineSubCtx.createBiquadFilter();
      lp1.type = 'lowpass';
      lp1.frequency.value = 92;
      lp1.Q.value = 0.707;

      const lp2 = offlineSubCtx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 92;
      lp2.Q.value = 0.707;

      const lp3 = offlineSubCtx.createBiquadFilter();
      lp3.type = 'lowpass';
      lp3.frequency.value = 92;
      lp3.Q.value = 0.9;

      const lp4 = offlineSubCtx.createBiquadFilter();
      lp4.type = 'lowpass';
      lp4.frequency.value = 92;
      lp4.Q.value = 0.9;

      subSource.connect(hp);
      hp.connect(lp1);
      lp1.connect(lp2);
      lp2.connect(lp3);
      lp3.connect(lp4);
      lp4.connect(offlineSubCtx.destination);
      subSource.start(0);

      // Pass 1b: Midrange Melody/Synth Band (220Hz - 1400Hz) for melody suppression
      const offlineMidCtx = new OfflineCtx(1, length, targetRate);
      const midSource = offlineMidCtx.createBufferSource();
      midSource.buffer = monoBuffer;

      const midHp = offlineMidCtx.createBiquadFilter();
      midHp.type = 'highpass';
      midHp.frequency.value = 220;

      const midLp = offlineMidCtx.createBiquadFilter();
      midLp.type = 'lowpass';
      midLp.frequency.value = 1400;

      midSource.connect(midHp);
      midHp.connect(midLp);
      midLp.connect(offlineMidCtx.destination);
      midSource.start(0);

      const [subRendered, midRendered] = await Promise.all([
        offlineSubCtx.startRendering(),
        offlineMidCtx.startRendering()
      ]);

      const subData = subRendered.getChannelData(0);
      const midData = midRendered.getChannelData(0);

      // 5ms frame analysis
      const hopTime = 0.005;
      const hopSamples = Math.max(1, Math.floor(targetRate * hopTime));
      const numFrames = Math.floor(subData.length / hopSamples);

      const subEnv = new Float32Array(numFrames);
      const midEnv = new Float32Array(numFrames);
      const kickScoreFlux = new Float32Array(numFrames);

      for (let i = 0; i < numFrames; i++) {
        let sSum = 0;
        let mSum = 0;
        const offset = i * hopSamples;
        for (let j = 0; j < hopSamples; j++) {
          const s = subData[offset + j];
          const m = midData[offset + j];
          sSum += s * s;
          mSum += m * m;
        }
        subEnv[i] = Math.sqrt(sSum / hopSamples);
        midEnv[i] = Math.sqrt(mSum / hopSamples);
      }

      // --- Adaptive thresholds ---
      // Collect positive attack rises to derive a track-relative minimum onset.
      const rises = [];
      for (let i = 3; i < numFrames; i++) {
        const prevMin = Math.min(subEnv[i - 1], subEnv[i - 2], subEnv[i - 3]);
        const r = subEnv[i] - prevMin;
        if (r > 0) rises.push(r);
      }
      rises.sort((a, b) => a - b);
      const medianRise = rises.length > 0 ? rises[Math.floor(rises.length * 0.5)] : 0.01;
      const minAttack = Math.max(0.008, medianRise * 0.45);

      // Typical sub energy of the track (ghost-energy floor)
      const envSorted = Array.from(subEnv).sort((a, b) => a - b);
      const medianEnv = envSorted.length > 0 ? envSorted[Math.floor(envSorted.length * 0.5)] : 0.01;
      const energyFloor = medianEnv * 1.15;

      // Compute pure Kick Transient Score with Melody Rejection & Decay Verification
      for (let i = 3; i < numFrames - 18; i++) {
        const prevMin = Math.min(subEnv[i - 1], subEnv[i - 2], subEnv[i - 3]);
        const attackRise = subEnv[i] - prevMin;
        if (attackRise <= minAttack) continue;

        // Midrange melody onset rejection
        const midRise = Math.max(0, midEnv[i] - midEnv[i - 2]);
        const subToMidRatio = subEnv[i] / (midEnv[i] * 0.55 + 0.002);
        if (subToMidRatio < 0.75 && midRise > attackRise * 1.1) {
          continue;
        }

        // Ghost-energy floor: real kicks sit above the track's typical sub level
        if (subEnv[i] < energyFloor) continue;

        // Verify kick envelope shape: real kick decays within 60-90ms
        const futureEnv = (subEnv[i + 12] + subEnv[i + 15] + subEnv[i + 18]) / 3;
        const decayFactor = subEnv[i] > futureEnv * 1.12 ? 1.35 : 0.7;

        kickScoreFlux[i] = attackRise * Math.min(2.2, subToMidRatio) * decayFactor;
      }

      // Peak picking on kickScoreFlux (pass 1, strict)
      const candidates = [];
      const localWin = 45; // 225ms window
      for (let i = localWin; i < numFrames - localWin; i++) {
        const val = kickScoreFlux[i];
        if (val <= 0.005) continue;

        let sum = 0;
        for (let k = -localWin; k <= localWin; k++) {
          sum += kickScoreFlux[i + k];
        }
        const avg = sum / (localWin * 2 + 1);

        if (
          val > avg * 2.25 &&
          val >= kickScoreFlux[i - 1] &&
          val >= kickScoreFlux[i + 1] &&
          val >= kickScoreFlux[i - 2] &&
          val >= kickScoreFlux[i + 2]
        ) {
          const tSec = i * hopTime;
          if (candidates.length === 0 || (tSec - candidates[candidates.length - 1].time) >= 0.21) {
            candidates.push({ time: tSec, strength: val });
          } else if (val > candidates[candidates.length - 1].strength) {
            candidates[candidates.length - 1] = { time: tSec, strength: val };
          }
        }
      }

      // --- BPM estimation: inter-onset histogram + fine grid-coverage search ---
      let bestBpm = 120;
      if (candidates.length >= 4) {
        const tempoHist = {};
        for (let i = 0; i < candidates.length; i++) {
          for (let j = 1; j <= 8 && (i + j) < candidates.length; j++) {
            const dt = candidates[i + j].time - candidates[i].time;
            if (dt < 0.23 || dt > 2.1) continue;
            let bpmCand = 60 / dt;
            while (bpmCand < 85) bpmCand *= 2;
            while (bpmCand > 175) bpmCand /= 2;
            const rounded = Math.round(bpmCand);
            const w = candidates[i].strength + candidates[i + j].strength;
            tempoHist[rounded] = (tempoHist[rounded] || 0) + w;
          }
        }
        let bestScore = 0;
        for (const [bpmStr, score] of Object.entries(tempoHist)) {
          const b = parseInt(bpmStr, 10);
          const cluster = score + (tempoHist[b - 1] || 0) * 0.7 + (tempoHist[b + 1] || 0) * 0.7;
          if (cluster > bestScore) {
            bestScore = cluster;
            bestBpm = b;
          }
        }

        // Fine comb search: the true tempo aligns the most kick strength to a
        // phase-locked grid. Search +-2 BPM around the histogram winner.
        let bestCoverage = -1;
        let bestFine = bestBpm;
        for (let fine = bestBpm - 2.0; fine <= bestBpm + 2.0 + 1e-9; fine += 0.25) {
          const interval = 60 / fine;
          let coverage = 0;
          for (const c of candidates) {
            const phase = (c.time % interval) / interval;
            const d = Math.min(phase, 1 - phase) * interval; // distance to nearest beat
            if (d <= 0.045 || Math.abs(d - interval * 0.5) <= 0.045) {
              coverage += c.strength;
            }
          }
          if (coverage > bestCoverage + 1e-12) {
            bestCoverage = coverage;
            bestFine = fine;
          }
        }
        bestBpm = Math.round(bestFine * 100) / 100;
      }

      // --- Pass 2: recover quiet-but-real kicks sitting exactly on the grid ---
      if (candidates.length >= 4) {
        const interval = 60 / bestBpm;
        const have = (t) => candidates.some((c) => Math.abs(c.time - t) < 0.12);
        const t0 = candidates[0].time;
        for (let t = Math.max(0.35, t0 - interval); t < buffer.duration - 0.05; t += interval) {
          if (have(t)) continue;
          const center = Math.round(t / hopTime);
          let bestIdx = -1;
          let bestVal = 0;
          for (let k = -9; k <= 9; k++) {
            const idx = center + k;
            if (idx < 3 || idx >= numFrames - 18) continue;
            if (kickScoreFlux[idx] > bestVal) {
              bestVal = kickScoreFlux[idx];
              bestIdx = idx;
            }
          }
          if (bestIdx < 0 || bestVal <= 0.004) continue;
          // Real kick check with relaxed attack (it was missed for being quiet)
          const prevMin = Math.min(subEnv[bestIdx - 1], subEnv[bestIdx - 2], subEnv[bestIdx - 3]);
          const rise = subEnv[bestIdx] - prevMin;
          const subToMidRatio = subEnv[bestIdx] / (midEnv[bestIdx] * 0.55 + 0.002);
          if (rise > minAttack * 0.55 && subEnv[bestIdx] >= energyFloor * 0.85 && subToMidRatio >= 0.6) {
            candidates.push({ time: bestIdx * hopTime, strength: bestVal * 0.9 });
          }
        }
        candidates.sort((a, b) => a.time - b.time);
      }

      // Filter out weak ghost hits using local strength thresholding
      const strengths = candidates.map((c) => c.strength).sort((a, b) => a - b);
      const medianStrength = strengths.length > 0 ? strengths[Math.floor(strengths.length * 0.45)] : 0.01;
      const verifiedKicks = candidates
        .filter((c) => c.strength >= medianStrength * 0.55)
        .map((c) => c.time);

      if (verifiedKicks.length < 6) {
        const interval = 60 / bestBpm;
        for (let t = 0.6; t < buffer.duration; t += interval) verifiedKicks.push(t);
        verifiedKicks.sort((a, b) => a - b);
      }

      return {
        bpm: bestBpm,
        kickMap: verifiedKicks,
        ...this.buildGameplayTimelines(verifiedKicks, buffer.duration)
      };
    } catch (e) {
      console.warn('DSP Kick isolation fallback:', e);
      const fallback = [];
      for (let t = 0.5; t < buffer.duration; t += 0.5) fallback.push(t);
      return {
        bpm: 120,
        kickMap: fallback,
        ...this.buildGameplayTimelines(fallback, buffer.duration)
      };
    }
  }

  /**
   * Build obstacle & coin timelines with section variety:
   * section 0: standard spacing (>=0.68s), 1: sparse break (>=0.95s, more coins),
   * 2: dense run (>=0.68s + double coin kicks). 8 kicks per section.
   */
  buildGameplayTimelines(verifiedKicks, duration) {
    const obstacleKicks = [];
    const coinKicks = [];
    let lastObsTime = 0.8;
    let section = 0;
    let sectionCount = 0;

    for (const kt of verifiedKicks) {
      if (kt < 1.1) continue;
      sectionCount++;
      if (sectionCount >= 8) {
        sectionCount = 0;
        section = (section + 1) % 3;
      }
      const minGap = section === 1 ? 0.95 : 0.68;
      const gap = kt - lastObsTime;
      if (gap >= minGap) {
        obstacleKicks.push(kt);
        lastObsTime = kt;
      } else if (gap >= 0.28) {
        coinKicks.push(kt);
        if (section === 2) coinKicks.push(kt + 0.001); // dense: double coin kick
      }
    }
    return { obstacleKicks, coinKicks };
  }

  play(onEnded, offset = 0) {
    if (this.yt) {
      this.stop(false);
      this.onEndedCallback = onEnded || this.onEndedCallback;
      this.pauseOffset = offset;
      this.yt.seekPlay(offset);
      this.isPlaying = true;
      this.isPaused = false;
      return;
    }
    if (!this.audioBuffer || !this.ctx) return;
    this.stop(false);
    this.onEndedCallback = onEnded || this.onEndedCallback;
    this.pauseOffset = offset;

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.connect(this.analyser);

    this.source.onended = () => {
      if (this.isPlaying && !this.isPaused) {
        this.isPlaying = false;
        if (this.onEndedCallback) this.onEndedCallback();
      }
    };

    this.startTime = this.ctx.currentTime - offset;
    this.source.start(0, offset);
    this.isPlaying = true;
    this.isPaused = false;
  }

  pause() {
    if (this.yt) {
      if (!this.isPlaying || this.isPaused) return;
      this.pauseOffset = this.getElapsedTime();
      this.isPaused = true;
      this.yt.pause();
      return;
    }
    if (!this.isPlaying || this.isPaused) return;
    this.pauseOffset = this.getElapsedTime();
    this.isPaused = true;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (_) {}
      this.source = null;
    }
  }

  resume() {
    if (this.yt) {
      if (!this.isPaused) return;
      this.isPaused = false;
      this.yt.play();
      return;
    }
    if (!this.isPaused || !this.audioBuffer) return;
    this.play(this.onEndedCallback, this.pauseOffset);
  }

  stop(resetOffset = true) {
    this.isPlaying = false;
    this.isPaused = false;
    if (resetOffset) {
      this.pauseOffset = 0;
      this.lastTriggeredKickIndex = -1;
    }
    if (this.yt) {
      this.yt.stop();
      return;
    }
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (_) {}
      this.source = null;
    }
  }

  getDuration() {
    if (this.yt) return this.ytDuration || this.yt.getDuration() || 0;
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  getElapsedTime() {
    if (this.yt) {
      if (this.isPaused) return this.pauseOffset;
      if (!this.isPlaying) return 0;
      return Math.max(0, this.yt.getTime());
    }
    if (!this.ctx) return 0;
    if (this.isPaused) return this.pauseOffset;
    if (!this.isPlaying) return 0;
    return Math.max(0, this.ctx.currentTime - this.startTime);
  }

  getNearestKickDiff(currentTrackTime) {
    if (!this.kickMap || this.kickMap.length === 0) return 999;
    let minDiff = Infinity;
    for (let i = 0; i < this.kickMap.length; i++) {
      const d = Math.abs(this.kickMap[i] - currentTrackTime);
      if (d < minDiff) minDiff = d;
      if (this.kickMap[i] > currentTrackTime + 1.0) break;
    }
    return minDiff;
  }

  getNextKickProgress(currentTrackTime) {
    if (!this.kickMap || this.kickMap.length < 2) return 0;
    for (let i = 0; i < this.kickMap.length - 1; i++) {
      const k1 = this.kickMap[i];
      const k2 = this.kickMap[i + 1];
      if (currentTrackTime >= k1 && currentTrackTime <= k2) {
        return (currentTrackTime - k1) / Math.max(0.18, k2 - k1);
      }
    }
    return 0;
  }

  update() {
    if (!this.isPlaying || this.isPaused) return false;

    // YouTube mode: no realtime analysers — derive the visual kick energy
    // from the calibrated grid itself (spike right after each grid hit).
    if (this.yt) {
      const trackTime = this.getElapsedTime();
      let triggeredKick = false;
      for (let i = this.lastTriggeredKickIndex + 1; i < this.kickMap.length; i++) {
        if (trackTime >= this.kickMap[i] - 0.008) {
          if (trackTime - this.kickMap[i] < 0.09) triggeredKick = true;
          this.lastTriggeredKickIndex = i;
        } else {
          break;
        }
      }
      // Envelope: 1.0 at the hit, linear-ish decay over 0.16s
      const idx = Math.max(0, this.lastTriggeredKickIndex);
      if (idx < this.kickMap.length) {
        const since = trackTime - this.kickMap[idx];
        const env = Math.max(0, 1 - since / 0.16);
        this.kickIntensity = Math.max(env, this.kickIntensity * 0.82);
      }
      this.prevSubRms = this.kickIntensity;
      return triggeredKick;
    }

    if (!this.kickAnalyser || !this.midAnalyser) return false;

    const trackTime = this.getElapsedTime();
    this.kickAnalyser.getFloatTimeDomainData(this.subBuf);
    this.midAnalyser.getFloatTimeDomainData(this.midBuf);

    let subSum = 0;
    let midSum = 0;
    for (let i = 0; i < this.subBuf.length; i++) {
      subSum += this.subBuf[i] * this.subBuf[i];
      midSum += this.midBuf[i] * this.midBuf[i];
    }
    const subRms = Math.sqrt(subSum / this.subBuf.length);
    const midRms = Math.sqrt(midSum / this.midBuf.length);

    // Suppress visual kickIntensity if midrange melody is louder than sub-bass
    const subDominance = subRms / (midRms * 0.65 + 0.005);
    this.subHistory.push(subRms);
    if (this.subHistory.length > this.historySize) this.subHistory.shift();
    const avgSub = this.subHistory.reduce((a, b) => a + b, 0) / this.subHistory.length;

    if (subDominance > 0.85 && avgSub > 0.01) {
      this.kickIntensity = Math.min(1.0, Math.max(0.0, (subRms / avgSub - 0.95) * 1.6));
    } else {
      this.kickIntensity *= 0.75;
    }

    // Trigger main beat pulse ONLY on verified offline Kick Drum Map timestamps
    let triggeredKick = false;
    for (let i = this.lastTriggeredKickIndex + 1; i < this.kickMap.length; i++) {
      if (trackTime >= this.kickMap[i] - 0.008) {
        if (trackTime - this.kickMap[i] < 0.09) {
          triggeredKick = true;
        }
        this.lastTriggeredKickIndex = i;
      } else {
        break;
      }
    }

    this.prevSubRms = subRms;
    return triggeredKick;
  }
}
