// Sprite 2D top-down sebagai SVG data-URI, jadi tidak butuh file atau jaringan eksternal.
// Dimuat lewat SpriteLoader; jika sebuah sprite gagal dimuat, render jatuh ke bentuk lama
// (lingkaran/segitiga) — lihat app.js.
//
// Semua sprite digambar "menghadap kanan" (sumbu +x). Rotasi dilakukan saat menggambar
// (ctx.rotate) agar karakter menghadap arah bidik/gerak.
(function (root) {
  // Bungkus markup SVG jadi data-URI yang bisa dipakai sebagai Image.src
  const svg = (w, h, body) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
    );

  // --- Player: badan bulat biru-abu dengan "moncong" di sisi kanan (menghadap +x) ---
  const PLAYER = svg(48, 48, `
    <g>
      <rect x="30" y="20" width="16" height="8" rx="2" fill="#cfd6e0" stroke="#2a2f3a" stroke-width="1.5"/>
      <circle cx="24" cy="24" r="15" fill="#5b8dd9" stroke="#eef3fb" stroke-width="2.5"/>
      <circle cx="24" cy="24" r="15" fill="none" stroke="#2a3550" stroke-width="1" opacity="0.5"/>
      <polygon points="37,24 28,19 28,29" fill="#eef3fb"/>
      <circle cx="24" cy="24" r="4" fill="#2a3550" opacity="0.35"/>
    </g>`);

  // --- Musuh: bentuk berbeda per tipe (menghadap +x) ---
  // Grunt: bulat gempal merah
  const GRUNT = svg(40, 40, `
    <g>
      <circle cx="20" cy="20" r="16" fill="#ff4444" stroke="#7a1414" stroke-width="2.5"/>
      <circle cx="26" cy="15" r="3" fill="#2a0000"/>
      <circle cx="26" cy="25" r="3" fill="#2a0000"/>
      <path d="M30 20 l5 -3 v6 z" fill="#b02020"/>
    </g>`);

  // Runner: belah ketupat kecil kuning, ramping dan cepat
  const RUNNER = svg(32, 32, `
    <g>
      <polygon points="16,3 29,16 16,29 3,16" fill="#ffff44" stroke="#9a9a12" stroke-width="2.5"/>
      <polygon points="29,16 20,12 20,20" fill="#c9c915"/>
      <circle cx="19" cy="13" r="2" fill="#4a4a00"/>
      <circle cx="19" cy="19" r="2" fill="#4a4a00"/>
    </g>`);

  // Shooter: segi enam ungu dengan mata-meriam di depan
  const SHOOTER = svg(40, 40, `
    <g>
      <polygon points="12,6 28,6 36,20 28,34 12,34 4,20" fill="#aa44ff" stroke="#4d1a7a" stroke-width="2.5"/>
      <rect x="30" y="16" width="9" height="8" rx="1.5" fill="#6a2aa0" stroke="#2a0a44" stroke-width="1"/>
      <circle cx="20" cy="20" r="5" fill="#2a0a44"/>
      <circle cx="21" cy="19" r="2" fill="#e0b3ff"/>
    </g>`);

  // Boss: bintang gerigi merah tua besar
  const BOSS = svg(96, 96, `
    <g>
      <circle cx="48" cy="48" r="42" fill="#880000" stroke="#ff2a2a" stroke-width="4"/>
      <circle cx="48" cy="48" r="30" fill="#5a0000" stroke="#c81414" stroke-width="2"/>
      <polygon points="78,48 64,42 64,54" fill="#ff2a2a"/>
      <circle cx="58" cy="38" r="5" fill="#ff4a4a"/>
      <circle cx="58" cy="58" r="5" fill="#ff4a4a"/>
      <circle cx="58" cy="38" r="2" fill="#2a0000"/>
      <circle cx="58" cy="58" r="2" fill="#2a0000"/>
    </g>`);

  // --- Peluru & item (tidak dirotasi) ---
  const BULLET = svg(16, 16, `
    <g>
      <circle cx="8" cy="8" r="6" fill="#ffd36b" stroke="#a6761a" stroke-width="1.5"/>
      <circle cx="6" cy="6" r="2" fill="#fff6d8"/>
    </g>`);

  const ITEM = svg(28, 28, `
    <g>
      <rect x="3" y="3" width="22" height="22" rx="5" fill="#ffffff" stroke="#2a7a3a" stroke-width="2"/>
      <rect x="12" y="7" width="4" height="14" fill="#e23b3b"/>
      <rect x="7" y="12" width="14" height="4" fill="#e23b3b"/>
    </g>`);

  root.SPRITE_SOURCES = {
    player: PLAYER,
    grunt: GRUNT,
    runner: RUNNER,
    shooter: SHOOTER,
    boss: BOSS,
    bullet: BULLET,
    item: ITEM,
  };

  // Loader: memuat semua sprite menjadi HTMLImageElement. ready(name) true hanya jika sprite
  // berhasil dimuat; jika gagal, pemanggil memakai fallback bentuk lama.
  function createSpriteLoader(sources) {
    const images = {};
    const loaded = {};

    // Di lingkungan tanpa Image (mis. uji Node), loader tetap aman: semua ready() = false
    const hasImage = typeof Image === 'function';

    for (const name in sources) {
      loaded[name] = false;
      if (!hasImage) continue;
      const img = new Image();
      img.onload = () => { loaded[name] = true; };
      img.onerror = () => { loaded[name] = false; };
      img.src = sources[name];
      images[name] = img;
    }

    return {
      image: (name) => images[name],
      ready: (name) => Boolean(loaded[name]),
    };
  }

  root.createSpriteLoader = createSpriteLoader;
})(typeof window !== 'undefined' ? window : this);
