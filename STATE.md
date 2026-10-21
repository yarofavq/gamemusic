# STATE.md — NOCTURNE RHYTHM better16 (GitHub Pages Edition)

## Архитектура
Статический сайт (без сервера): ES-модули + WebGL2 пост-шейдер + Web Audio.

- `index.html` — UI: сворачиваемый заголовок (btn-title-toggle/#title-block),
  режимы, MP-лобби (PeerJS), настройки (#settings-panel: темы/частицы/тряска),
  HUD, пауза-оверлей, баннер финала, ранг в game-over.
- `src/main.js` — GameApp: цикл, темы (applyTheme + uniforms), паузы
  (pauseState: none/local/peer; visibilitychange+blur; MP-рассылка pause/resume),
  финал (updateFinale: крещендо, ×2 монеты, райзер+бум, эмберы), ранги,
  PeerJS-флоу (sendTrack → track_sent → start; track_done → loadFromHost).
- `src/render/Theme.js` — 3 темы (ink/neon/crystal): палитра P для 2D-сцены,
  data-theme для CSS, hexToRgb01; шейдерные vec3.
- `src/shaders/sketch.frag.js` — u_style 0/1/2 (чернила/неон/витраж),
  u_finale (крещендо: акцентный пуish, кольцо света, whiteout),
  u_accent/u_ink/u_crimson; 6 биомов × 3 стиля палитр.
- `src/audio/BeatDetector.js` — DSP-детектор бочки v2 (адаптивный порог,
  ghost-energy floor, комб-поиск BPM ±2 с шагом 0.25, pass-2 тихих киков),
  loadFile/loadArrayBuffer/loadFromHost, pause/resume, getDuration.
- `src/audio/BeatJudge.js` — единый источник таймингов: PERFECT 0.13 / GOOD 0.24,
  ×2.0/×1.2/×0.2, флип ×1.5.
- `src/game/NetClient.js` — PeerJS (CDN jsdelivr→unpkg fallback), комнаты:
  префикс `noctrhy-b16-` + код 4 симв.; хост-ретрай unavailable-id;
  передача трека: meta JSON → чанки 16KB (bufferedAmount<1MB, pump 20ms) →
  track_end; события: created/joined/peer/peer_left/track_*/start/pause/resume/
  state/over/error.
- `src/game/World.js` — 6 типов препятствий, монеты (тройки/бонус), 6 биомов,
  палитра P, shakeEnabled/glowEnabled, волна финала на дороге.
- `src/game/Player.js` — 10 скинов, 11 предметов (внутри flip-трансформации —
  крутятся при кувырке), ghost-силуэт напарника, glow для неона/витража.
- `src/game/StoreManager.js` — сейв v2 (миграция v1): монеты, скины, предметы,
  settings {theme, quality, shake, titleCollapsed}; 10 скинов, 11 предметов,
  3 темы.
- `src/render/ParticleSystem.js` — cap по качеству (170/300/420), kick-шок,
  финальные эмберы, judgment-текст.
- `README.md` — публикация на GitHub Pages, мультиплеер, управление.

## Мультиплеер (синхронизация)
Хост анализирует трек и шлёт готовую карту битов + сам файл → гость
использует её как есть (нет расхождений DSP между браузерами). Старт:
отсчёт 3-2-1 по сообщению start{delay}. Пауза: скрытие окна → pause →
у напарника оверлей + audio.pause; возврат → resume{delay} → общий отсчёт
и audio.resume. Статусы пира: wait/play/pause/dead/done/left.

## Логика монет
×(bpm/100)^1.65, PERFECT=3 базовых, серия /5 бонус, в финале ×2.

## better19
Конец трека (соло) → blast 2.2с → fadeToMenu (вейл #fade-veil 0.42с +
тост #menu-toast 2.9с + бамп казны) вместо showGameOver. MP сохраняет
экран результата. Перф: шейдер стиль1 3 выборки (bloom из CA-тапов),
стиль2 2 выборки; World.buildStaticLayers (скайлайн+звёзды в офскрин,
ребилд по markThemeChanged/setQuality); адаптивный renderScale 1.0→0.6 по
_frameAvg>22.5мс, возврат <14.5мс с кулдауном 7с; caps по качеству:
stars 45/80/110, motes 10/18/26, bats 4/6/9, comets 1/2/3, pillars 14/22/32.
Fever: combo≥20 → world.fever (край дороги crimson, магнит монет 50/54,
порталы ×1.5). onLand-колбэк → пыль приземления. this.dom — кэш горячих
DOM-ссылок (score/combo/coins/beat/banner/vs).
