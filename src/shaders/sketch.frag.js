export const sketchFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_sceneTexture;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_beatPulse;
uniform float u_kickEnergy;
uniform float u_biomeProgress;
uniform float u_style;    // 0 = Gothic Ink, 1 = Neon Pulse, 2 = Frozen Stained Glass
uniform float u_finale;   // 0..1 end-of-track crescendo
uniform vec3 u_accent;
uniform vec3 u_ink;
uniform vec3 u_crimson;
uniform float u_ultra;   // better21: КРАСИВЕЙШИЙ ВИЗУАЛ master pass (0/1)

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 6 PROGRESSIVE WORLD BIOMES (shared hue path for all styles):
// 0 Parchment/Pumpkin, 1 Blood Moon, 2 Phantom Violet, 3 Necro-Emerald,
// 4 Frozen Requiem, 5 Gilded Nocturne.
void biomeParams(out vec3 surfaceA, out vec3 surfaceB, out vec3 deepA, out vec3 deepB) {
  float cycle = mod(u_biomeProgress, 6.0);
  int stageA = int(floor(cycle));
  int stageB = (stageA + 1) % 6;
  float blend = smoothstep(0.15, 0.85, fract(cycle));

  if (u_style < 0.5) {
    vec3 paperPalettes[6] = vec3[6](
      vec3(0.92, 0.86, 0.75), vec3(0.89, 0.76, 0.72), vec3(0.80, 0.76, 0.88),
      vec3(0.76, 0.86, 0.80), vec3(0.88, 0.90, 0.93), vec3(0.93, 0.85, 0.66)
    );
    vec3 deepPalettes[6] = vec3[6](
      vec3(0.24, 0.17, 0.12), vec3(0.32, 0.08, 0.10), vec3(0.15, 0.08, 0.28),
      vec3(0.07, 0.22, 0.16), vec3(0.10, 0.14, 0.24), vec3(0.30, 0.20, 0.06)
    );
    surfaceA = paperPalettes[stageA]; surfaceB = paperPalettes[stageB];
    deepA = deepPalettes[stageA]; deepB = deepPalettes[stageB];
  } else if (u_style < 1.5) {
    vec3 nightPalettes[6] = vec3[6](
      vec3(0.030, 0.045, 0.095), vec3(0.080, 0.020, 0.045), vec3(0.045, 0.025, 0.090),
      vec3(0.015, 0.060, 0.050), vec3(0.020, 0.045, 0.085), vec3(0.075, 0.050, 0.015)
    );
    vec3 gridPalettes[6] = vec3[6](
      vec3(0.10, 0.35, 0.55), vec3(0.50, 0.10, 0.20), vec3(0.30, 0.12, 0.55),
      vec3(0.08, 0.40, 0.30), vec3(0.12, 0.30, 0.50), vec3(0.45, 0.30, 0.08)
    );
    surfaceA = nightPalettes[stageA]; surfaceB = nightPalettes[stageB];
    deepA = gridPalettes[stageA]; deepB = gridPalettes[stageB];
  } else {
    vec3 icePalettes[6] = vec3[6](
      vec3(0.87, 0.93, 0.98), vec3(0.93, 0.87, 0.90), vec3(0.85, 0.87, 0.97),
      vec3(0.83, 0.94, 0.92), vec3(0.87, 0.92, 0.98), vec3(0.96, 0.91, 0.82)
    );
    vec3 auroraPalettes[6] = vec3[6](
      vec3(0.06, 0.45, 0.60), vec3(0.55, 0.12, 0.30), vec3(0.30, 0.16, 0.62),
      vec3(0.08, 0.50, 0.42), vec3(0.14, 0.36, 0.62), vec3(0.55, 0.40, 0.12)
    );
    surfaceA = icePalettes[stageA]; surfaceB = icePalettes[stageB];
    deepA = auroraPalettes[stageA]; deepB = auroraPalettes[stageB];
  }
}

void main() {
  vec2 center = vec2(0.5, 0.5);
  vec2 toCenter = v_uv - center;
  float dist = length(toCenter);

  float finale = clamp(u_finale, 0.0, 1.0);
  float totalKick = u_beatPulse * 0.85 + u_kickEnergy * 0.45;
  totalKick *= (1.0 + finale * 0.9);
  totalKick = min(totalKick, 1.6);

  // Radial kick zoom + shockwave
  float kickZoom = 1.0 - (totalKick * 0.032) * smoothstep(0.0, 0.75, dist);
  vec2 zoomedUV = center + toCenter * kickZoom;

  // Chromatic aberration on strong kicks (neon uses the widest split)
  float caAmt = (u_style > 0.5 && u_style < 1.5 ? 0.005 : 0.0022) * (0.35 + totalKick);
  caAmt *= (u_ultra > 0.5 ? 1.7 : 1.0); // ultra: juicier prism split
  vec2 caDir = normalize(toCenter + vec2(0.0001)) * caAmt;

  // Boiling line displacement (ink style strongest, finale accelerates it)
  float boilFps = 11.0 + finale * 14.0 + (u_ultra > 0.5 ? 3.0 : 0.0);
  float t = floor(u_time * boilFps) / boilFps;
  float jitterAmt = (u_style < 0.5 ? 0.0019 : 0.0011) + totalKick * (u_style < 0.5 ? 0.0024 : 0.0016);
  vec2 jitter = vec2(
    noise(zoomedUV * 175.0 + vec2(t * 6.7, 0.0)) - 0.5,
    noise(zoomedUV * 175.0 + vec2(0.0, t * 6.7)) - 0.5
  ) * jitterAmt;

  vec2 sampleUV = clamp(zoomedUV + jitter, 0.001, 0.999);

  vec3 scene;
  vec3 sceneSum = vec3(0.0);
  if (u_style > 0.5 && u_style < 1.5) {
    // better19: 3 taps total (was 7) — the same CA samples feed the neon bloom
    vec3 sL = texture(u_sceneTexture, clamp(sampleUV + caDir, 0.001, 0.999)).rgb;
    vec3 sC = texture(u_sceneTexture, clamp(sampleUV, 0.001, 0.999)).rgb;
    vec3 sR = texture(u_sceneTexture, clamp(sampleUV - caDir, 0.001, 0.999)).rgb;
    scene = vec3(sL.r, sC.g, sR.b);
    sceneSum = sL + sC + sR;
  } else {
    scene = texture(u_sceneTexture, sampleUV).rgb;
  }

  float lum = scene.r * 0.299 + scene.g * 0.587 + scene.b * 0.114;
  float sat = max(scene.r, max(scene.g, scene.b)) - min(scene.r, min(scene.g, scene.b));
  float darkness = 1.0 - lum;

  vec3 surfaceA, surfaceB, deepA, deepB;
  biomeParams(surfaceA, surfaceB, deepA, deepB);
  vec3 surface = mix(surfaceA, surfaceB, smoothstep(0.15, 0.85, fract(mod(u_biomeProgress, 6.0))));
  vec3 deep = mix(deepA, deepB, smoothstep(0.15, 0.85, fract(mod(u_biomeProgress, 6.0))));

  // Stroke color: ink -> crimson -> theme accent
  float isRed = clamp((scene.r - scene.g) * 2.3, 0.0, 1.0);
  float isAccent = smoothstep(0.16, 0.40, sat) * (1.0 - isRed * 0.85);
  vec3 strokeColor = u_ink;
  strokeColor = mix(strokeColor, u_crimson, isRed);
  strokeColor = mix(strokeColor, u_accent, isAccent);

  vec3 finalColor;

  if (u_style < 0.5) {
    // ---------------- STYLE 0: GOTHIC INK (hand-drawn engraving) ----------------
    float kickWave = sin(dist * 28.0 - u_time * 16.0) * totalKick * 0.045;
    surface += u_accent * (totalKick * 0.08) + vec3(kickWave * 0.5);

    float grain = (hash(v_uv * 620.0) - 0.5) * 0.055;
    float fiber = (noise(v_uv * 18.0 + vec2(2.1, 4.3)) - 0.5) * 0.045;
    surface += vec3(grain + fiber);

    vec2 gridUV = sampleUV * vec2(38.0, 22.0);
    if (fract(gridUV.x) < 0.025 || fract(gridUV.y) < 0.025) {
      surface = mix(surface, deep, 0.12 + totalKick * 0.08);
    }

    float hatch1 = clamp(sin((sampleUV.x + sampleUV.y) * 660.0) * 1.5, 0.0, 1.0);
    float hatch2 = clamp(sin((sampleUV.x - sampleUV.y) * 660.0) * 1.5, 0.0, 1.0);
    float shade = 0.0;
    if (darkness > 0.12 && darkness < 0.75) shade += hatch1 * 0.34;
    if (darkness > 0.40) shade += hatch2 * 0.38;

    float inkMask = smoothstep(0.14, 0.68, darkness);
    finalColor = mix(surface, strokeColor, clamp(inkMask * 0.95 + shade * 0.28, 0.0, 0.98));

    float vig = smoothstep(0.32, 0.95, dist);
    vec3 vigColor = mix(deep, u_accent * 0.75, totalKick * 0.65);
    finalColor = mix(finalColor, vigColor, vig * 0.64);

  } else if (u_style < 1.5) {
    // ---------------- STYLE 1: NEON PULSE (synthwave glow) ----------------
    finalColor = surface;

    // Retro perspective grid floor
    float horizon = smoothstep(0.50, 0.62, v_uv.y);
    vec2 gridUV = vec2(v_uv.x * 26.0, (v_uv.y - 0.56) * 14.0 - u_time * (0.9 + finale * 1.6));
    gridUV.x += u_time * 0.4;
    vec2 gf = abs(fract(gridUV) - 0.5);
    float gridLine = smoothstep(0.46, 0.5, max(gf.x, gf.y));
    finalColor += deep * gridLine * horizon * (0.55 + totalKick * 0.55);

    // Sun disc glow above horizon
    float sun = smoothstep(0.55, 0.0, length((v_uv - vec2(0.5, 0.34)) * vec2(1.6, 1.0)));
    finalColor += u_accent * sun * (0.10 + totalKick * 0.12);

    // Neon strokes from scene brightness (value-based mask)
    float val = max(scene.r, max(scene.g, scene.b));
    float neonMask = smoothstep(0.22, 0.55, val);
    float redness = smoothstep(0.25, 0.55, scene.r - scene.g);
    vec3 neonColor = mix(u_ink, u_accent, redness);

    // Bloom: bright halo derived from the 3 CA taps already fetched (better19,
    // was 4 extra texture fetches — the main cause of neon-theme stutter)
    float glowSum = max(sceneSum.r, max(sceneSum.g, sceneSum.b)) * 0.62;
    float glow = smoothstep(0.35, 1.35, glowSum);

    finalColor = mix(finalColor, neonColor, neonMask * 0.92);
    finalColor += mix(u_ink, u_accent, 0.35) * glow * (0.38 + totalKick * 0.45);

    // Scanlines
    float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 2.4);
    finalColor *= 1.0 - scan * 0.055;

    float vig = smoothstep(0.30, 0.98, dist);
    finalColor = mix(finalColor, vec3(0.01, 0.015, 0.04), vig * 0.72);

  } else {
    // ---------------- STYLE 2: FROZEN STAINED GLASS ----------------
    // Aurora gradient wash
    float band = sin(v_uv.x * 7.0 + u_time * 0.35 + u_biomeProgress) * 0.5 + 0.5;
    float band2 = sin(v_uv.x * 13.0 - u_time * 0.22) * 0.5 + 0.5;
    finalColor = surface;
    finalColor += deep * band * 0.14 * smoothstep(0.9, 0.15, v_uv.y);
    finalColor += deep * band2 * 0.08;

    // Caustic light refraction
    float caustic = noise(v_uv * 9.0 + vec2(u_time * 0.12, -u_time * 0.07));
    finalColor += vec3(0.05) * caustic * (0.5 + totalKick * 0.8);

    // Facet lines (stained glass lead)
    vec2 facet = abs(fract(v_uv * vec2(9.0, 6.0) + 0.25) - 0.5);
    float lead = smoothstep(0.465, 0.5, max(facet.x, facet.y));
    finalColor = mix(finalColor, deep, lead * 0.10);

    // Ink strokes on darkness (pale bg, deep blue ink)
    float inkMask = smoothstep(0.16, 0.62, darkness);
    finalColor = mix(finalColor, strokeColor, inkMask * 0.94);

    // Soft icy bloom — single extra tap (better19, was 2)
    vec2 px2 = vec2(3.0) / u_resolution * 2.2;
    float b2 = scene.b + texture(u_sceneTexture, clamp(sampleUV + px2, 0.001, 0.999)).b;
    finalColor += vec3(0.55, 0.75, 0.95) * smoothstep(0.8, 1.9, b2) * 0.16;

    // Twinkling frost sparkles
    vec2 cell = floor(v_uv * vec2(150.0, 85.0));
    float tw = hash(cell + floor(u_time * 2.0));
    float sparkle = step(0.9965, tw) * (0.4 + totalKick * 0.8);
    finalColor += vec3(sparkle);

    float vig = smoothstep(0.34, 0.99, dist);
    finalColor = mix(finalColor, deep * 0.55, vig * 0.5);
  }

  // ---------------- FINALE CRESCENDO (end of track) ----------------
  if (finale > 0.001) {
    // Palette pushes toward accent on every kick
    finalColor = mix(finalColor, finalColor + u_accent * (0.10 + 0.16 * totalKick), finale * 0.6);

    // Closing ring of light
    float finVig = smoothstep(0.92 - finale * 0.42, 1.06, dist + 0.02);
    finalColor = mix(finalColor, u_accent * (0.35 + 0.65 * totalKick), finVig * finale * 0.55);

    // Rising whiteout in the very last seconds
    float whiteout = smoothstep(0.87, 1.0, finale);
    vec3 finWhite = mix(vec3(1.0), u_accent, 0.22);
    finalColor = mix(finalColor, finWhite, whiteout * (0.78 + 0.22 * sin(u_time * 14.0)));
  }

  // ---------------- better21: КРАСИВЕЙШИЙ ВИЗУАЛ ----------------
  // A uniform-gated beauty pass: the GPU skips the whole branch when off.
  if (u_ultra > 0.5) {
    // Wide soft bloom ring — 4 extra taps, richer halos on bright ink
    vec2 pxU = vec2(3.2) / u_resolution;
    vec3 bl = texture(u_sceneTexture, clamp(sampleUV + vec2(pxU.x, 0.0), 0.001, 0.999)).rgb
            + texture(u_sceneTexture, clamp(sampleUV - vec2(pxU.x, 0.0), 0.001, 0.999)).rgb
            + texture(u_sceneTexture, clamp(sampleUV + vec2(0.0, pxU.y), 0.001, 0.999)).rgb
            + texture(u_sceneTexture, clamp(sampleUV - vec2(0.0, pxU.y), 0.001, 0.999)).rgb;
    float blVal = max(bl.r, max(bl.g, bl.b)) * 0.25;
    finalColor += strokeColor * smoothstep(0.42, 1.25, blVal) * (0.16 + totalKick * 0.22);

    // Engraved light: accent halo hugging the dark ink strokes
    float edge = smoothstep(0.10, 0.30, darkness) * (1.0 - smoothstep(0.30, 0.62, darkness));
    finalColor += u_accent * edge * (0.05 + totalKick * 0.11);

    // Slow breathing vignette — the whole scene inhales with the music
    float breathe = 0.5 + 0.5 * sin(u_time * 1.4);
    float vig2 = smoothstep(0.22, 0.92, dist);
    finalColor = mix(finalColor, deep * (0.75 + 0.2 * breathe), vig2 * 0.20);

    // Glitter dust: tiny accent sparkles popping on the beat
    vec2 cell2 = floor(v_uv * vec2(190.0, 107.0));
    float tw2 = hash(cell2 + floor(u_time * 3.0));
    finalColor += u_accent * step(0.9975, tw2) * (0.35 + totalKick * 0.6);
  }

  fragColor = vec4(finalColor, 1.0);
}
`;
