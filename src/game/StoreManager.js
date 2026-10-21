export class StoreManager {
  constructor() {
    this.storageKey = 'nocturne_rhythm_save_v2';
    this.legacyKey = 'gothic_rhythm_save_v1';
    this.data = {
      coins: 150,
      unlockedSkins: ['pumpkin'],
      equippedSkin: 'pumpkin',
      unlockedItems: ['none'],
      equippedItem: 'none',
      settings: {
        theme: 'ink',
        quality: 'high',
        shake: true,
        titleCollapsed: false
      }
    };

    this.skinsCatalog = [
      { id: 'pumpkin', name: 'Джек-Фонарь', price: 0, badge: 'I' },
      { id: 'ghost', name: 'Фантом', price: 250, badge: 'II' },
      { id: 'skeleton', name: 'Костяной Лорд', price: 600, badge: 'III' },
      { id: 'witch', name: 'Верховная Ведьма', price: 1200, badge: 'IV' },
      { id: 'reaper', name: 'Жнец Бездны', price: 2500, badge: 'V' },
      { id: 'vampire', name: 'Граф Ноктюрн', price: 4000, badge: 'VI' },
      { id: 'mummy', name: 'Пробудившаяся Мумия', price: 5500, badge: 'VII' },
      { id: 'franken', name: 'Тварь Лаборатории', price: 7000, badge: 'VIII' },
      { id: 'frost_maiden', name: 'Ледяная Дева', price: 9000, badge: 'IX' },
      { id: 'neon_ronin', name: 'Нео-Ронин', price: 12000, badge: 'X' },
      { id: 'raven', name: 'Вестник Ворона', price: 15000, badge: 'XI' },
      { id: 'doll', name: 'Фарфоровая Дева', price: 18500, badge: 'XII' },
      { id: 'candle_monk', name: 'Монах Воскового Ордена', price: 22000, badge: 'XIII' },
      { id: 'hellhound', name: 'Пёс Преисподней', price: 26000, badge: 'XIV' },
      { id: 'plague', name: 'Чумной Доктор', price: 30000, badge: 'XV' },
      { id: 'star_weaver', name: 'Ткач Звёзд', price: 35000, badge: 'XVI' }
    ];

    this.itemsCatalog = [
      { id: 'none', name: 'Без предмета', price: 0, desc: 'Классический вид' },
      { id: 'bat_familiar', name: 'Фамильяр Нетопырь', price: 300, desc: 'Летит рядом и пульсирует в кик' },
      { id: 'flame_halo', name: 'Печать Пламени', price: 750, desc: 'Вращающаяся огненная руна за спиной' },
      { id: 'floating_lantern', name: 'Астральный Фонарь', price: 1400, desc: 'Освещает путь и оставляет искры' },
      { id: 'skull_orbit', name: 'Хоровод Черепов', price: 1800, desc: 'Три черепа кружат вокруг тебя' },
      { id: 'ghost_candles', name: 'Призрачные Свечи', price: 3200, desc: 'Парящие свечи с дрожащим огнём' },
      { id: 'spider_charm', name: 'Амулет Паука', price: 4600, desc: 'Паук на нити следит за дорожкой' },
      { id: 'blood_wings', name: 'Крылья Ворона', price: 2800, desc: 'Раскрываются при прыжке и кувырке' },
      { id: 'scythe_aura', name: 'Аура Жатвы', price: 6000, desc: 'Две косы смерти вращаются за спиной' },
      { id: 'frost_orb', name: 'Око Бури', price: 3800, desc: 'Ледяной спутник с холодным дыханием' },
      { id: 'star_chain', name: 'Звёздная Цепь', price: 8000, desc: 'Созвездие звёзд кружит вокруг тебя' }
    ];

    this.themesCatalog = [
      { id: 'ink', name: 'ЧЕРНИЛА', desc: 'Рукописная гравюра' },
      { id: 'neon', name: 'НЕОН', desc: 'Синтвейв-контур' },
      { id: 'crystal', name: 'ВИТРАЖ', desc: 'Ледяная аврора' },
      { id: 'blood', name: 'КРОВЬ', desc: 'Алая мгла' },
      { id: 'glacier', name: 'ЛЕДНИК', desc: 'Серебро севера' },
      { id: 'toxic', name: 'ТОКСИН', desc: 'Кислотное свечение' },
      { id: 'solar', name: 'ЗОЛОТО', desc: 'Закатная месса' },
      { id: 'abyss', name: 'БЕЗДНА', desc: 'Затонувший собор' },
      { id: 'ash', name: 'ПЕПЕЛ', desc: 'Ч/б нойр' },
      { id: 'ember', name: 'УГЛИ', desc: 'Пылающий хор' },
      { id: 'sakura', name: 'САКУРА', desc: 'Лепестки в ночи' },
      { id: 'verdigris', name: 'ПАТИНА', desc: 'Медный крипт' },
      { id: 'violet', name: 'ПОЛУНОЧЬ', desc: 'Лиловая аврора' }
    ];

    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey) || localStorage.getItem(this.legacyKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed, settings: { ...this.data.settings, ...(parsed.settings || {}) } };
      }
    } catch (_) {}
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (_) {}
  }

  getBpmCoinMultiplier(bpm) {
    // Higher BPM rewards exponentially more coins!
    // e.g. 90 BPM -> 0.85x, 120 BPM -> 1.35x, 150 BPM -> 2.1x, 180 BPM -> 3.0x
    const clamped = Math.max(70, Math.min(220, bpm || 120));
    return Math.round(Math.pow(clamped / 100, 1.65) * 100) / 100;
  }

  addCoins(amount) {
    const gained = Math.max(0, Math.round(amount));
    this.data.coins += gained;
    this.save();
    return gained;
  }

  buyOrEquipSkin(skinId) {
    const item = this.skinsCatalog.find((s) => s.id === skinId);
    if (!item) return { status: 'error' };

    if (this.data.unlockedSkins.includes(skinId)) {
      this.data.equippedSkin = skinId;
      this.save();
      return { status: 'equipped' };
    }

    if (this.data.coins >= item.price) {
      this.data.coins -= item.price;
      this.data.unlockedSkins.push(skinId);
      this.data.equippedSkin = skinId;
      this.save();
      return { status: 'purchased' };
    }
    return { status: 'insufficient_funds' };
  }

  buyOrEquipItem(itemId) {
    const item = this.itemsCatalog.find((i) => i.id === itemId);
    if (!item) return { status: 'error' };

    if (this.data.unlockedItems.includes(itemId)) {
      this.data.equippedItem = itemId;
      this.save();
      return { status: 'equipped' };
    }

    if (this.data.coins >= item.price) {
      this.data.coins -= item.price;
      this.data.unlockedItems.push(itemId);
      this.data.equippedItem = itemId;
      this.save();
      return { status: 'purchased' };
    }
    return { status: 'insufficient_funds' };
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }
}
