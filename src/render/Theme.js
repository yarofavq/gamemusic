// NOCTURNE RHYTHM — Visual Theme System (better16)
// 3 full-game visual styles: Gothic Ink (hand-drawn), Neon Pulse, Frozen Stained Glass.
// applyTheme() mutates the shared scene palette P (used by World/Player/Particles)
// and switches the UI via body[data-theme] CSS variables.

export const THEMES = {
  ink: {
    id: 'ink',
    name: 'ГОТИЧЕСКИЕ ЧЕРНИЛА',
    badge: 'I',
    desc: 'Классика: кипящие линии, гравюра, пергамент',
    style: 0,
    swatches: ['#f6efe0', '#1b1714', '#e85d12'],
    scene: {
      paper: '#ffffff',
      ink: '#1b1714',
      accent: '#e85d12',
      crimson: '#a81c1c',
      bone: '#f2eadb',
      pale: '#f5ebd6',
      hill: '#cfc2ad',
      hillDark: '#6e6256',
      cloud: '#e6dac6',
      cloudDark: '#5c5046',
      bark: '#473d35',
      grave: '#bfb19c',
      road: '#c4b59d',
      stone: '#d4c7b0',
      stoneSide: '#8c7f70',
      stoneFront: '#dfd3be',
      cloth: '#3b312b',
      rust: '#6e1414',
      metal: '#8c7f70',
      line: '#5e5246',
      glow: false,
      glowColor: '#e85d12',
      glowBlur: 0
    }
  },
  neon: {
    id: 'neon',
    name: 'НЕОНОВЫЙ ПУЛЬС',
    badge: 'II',
    desc: 'Синтвейв: неоновые контуры, сетка, свечение',
    style: 1,
    swatches: ['#0b0f1e', '#00e5ff', '#ff2e88'],
    scene: {
      paper: '#070b16',
      ink: '#00e5ff',
      accent: '#ff2e88',
      crimson: '#ff4d5e',
      bone: '#baf7ff',
      pale: '#eaffff',
      hill: '#101c30',
      hillDark: '#24405e',
      cloud: '#0e1830',
      cloudDark: '#2b4a6f',
      bark: '#0c1526',
      grave: '#16243c',
      road: '#131f38',
      stone: '#182642',
      stoneSide: '#0e1a30',
      stoneFront: '#1d2e50',
      cloth: '#101a30',
      rust: '#5e1030',
      metal: '#2c4668',
      line: '#2b4a6f',
      glow: true,
      glowColor: 'rgba(0, 229, 255, 0.85)',
      glowBlur: 14
    }
  },
  crystal: {
    id: 'crystal',
    name: 'ЛЕДЯНОЙ ВИТРАЖ',
    badge: 'III',
    desc: 'Мороз: аврора-градиенты, сияние, искры',
    style: 2,
    swatches: ['#dbeefb', '#16405f', '#0fa3c4'],
    scene: {
      paper: '#e9f4fc',
      ink: '#16405f',
      accent: '#0fa3c4',
      crimson: '#8a4fd0',
      bone: '#ffffff',
      pale: '#f4fbff',
      hill: '#b9d9ec',
      hillDark: '#4a7396',
      cloud: '#dceefb',
      cloudDark: '#6d95b5',
      bark: '#3a5f7d',
      grave: '#c5dfee',
      road: '#bcd8ea',
      stone: '#cfe6f4',
      stoneSide: '#8fb4cc',
      stoneFront: '#ddeefb',
      cloth: '#33506b',
      rust: '#5e3f96',
      metal: '#8fb4cc',
      line: '#6d95b5',
      glow: true,
      glowColor: 'rgba(255, 255, 255, 0.9)',
      glowBlur: 9
    }
  }
};

// Shared mutable palette — modules import P and read colors at draw time.
export const P = JSON.parse(JSON.stringify(THEMES.ink.scene));

export function hexToRgb01(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.slice(0, 6).padEnd(6, '0');
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255
  ];
}

export function applyTheme(id) {
  const t = THEMES[id] || THEMES.ink;
  Object.assign(P, JSON.parse(JSON.stringify(t.scene)));
  P.inkRGB = hexToRgb01(t.scene.ink).map((x) => Math.round(x * 255)).join(', ');
  P.accentRGB = hexToRgb01(t.scene.accent).map((x) => Math.round(x * 255)).join(', ');
  P.crimsonRGB = hexToRgb01(t.scene.crimson).map((x) => Math.round(x * 255)).join(', ');
  document.body.dataset.theme = t.id;
  return t;
}

export function themeAccentVec(id) {
  const t = THEMES[id] || THEMES.ink;
  return { accent: hexToRgb01(t.scene.accent), ink: hexToRgb01(t.scene.ink), crimson: hexToRgb01(t.scene.crimson) };
}
