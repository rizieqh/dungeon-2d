const socket = io();
const statusEl = document.getElementById('status');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PLAYER_RADIUS = 15; // juga setengah sisi hitbox AABB

// Harus sama dengan server (1000 / TICK_MS) agar prediksi pemain lokal akurat.
// Kecepatan pemain dari server dalam piksel per tick.
const TICKS_PER_SECOND = 50;

const lobbyEl = document.getElementById('lobby');
const gameContainer = document.getElementById('gameContainer');
const playerNameInput = document.getElementById('playerNameInput');
const createRoomButton = document.getElementById('createRoomButton');
const joinForm = document.getElementById('joinForm');
const roomCodeInput = document.getElementById('roomCodeInput');
const joinRoomButton = document.getElementById('joinRoomButton');
const lobbyMessage = document.getElementById('lobbyMessage');

// Apakah pemain sudah berhasil masuk ke sebuah room (lobby tersembunyi, canvas tampil)
let inRoom = false;
let roomCode = '';

const upgradeOverlay = document.getElementById('upgradeOverlay');
const upgradeTitle = document.getElementById('upgradeTitle');
const upgradeChoices = document.getElementById('upgradeChoices');
const upgradeWaiting = document.getElementById('upgradeWaiting');

let wave = 1;
let waveState = 'IN_PROGRESS'; // 'IN_PROGRESS' | 'WAVE_CLEAR' | 'GAME_OVER'
let roomDifficulty = 'medium';
let roomDifficultyLabel = 'Medium';
let waveMutator = null; // { id, label, desc } atau null jika wave tanpa mutator

// Elemen modal Game Over
const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverSub = document.getElementById('gameOverSub');
const restartWaveButton = document.getElementById('restartWaveButton');
const backToLobbyButton = document.getElementById('backToLobbyButton');

// Gaya gambar peluru per jenis senjata. Ukuran (radius) datang dari server,
// jadi gambar selalu sama dengan hitbox peluru.
// glow = blur cahaya (px), trail = panjang garis jejak di belakang peluru (px)
const PROJECTILE_STYLES = {
  assault: { color: '#ffb020', glow: 0, trail: 0 },
  shotgun: { color: '#ff7a45', glow: 0, trail: 0 },
  sniper: { color: '#8ff3ff', glow: 16, trail: 34 },
};
const DEFAULT_PROJECTILE_STYLE = PROJECTILE_STYLES.assault;
const DEFAULT_PROJECTILE_RADIUS = 4;

const WEAPON_LABELS = { assault: 'Assault', shotgun: 'Shotgun', sniper: 'Sniper' };
const MAX_PROJECTILE_EXTRAPOLATION = 0.1; // detik; batasi jika update server terlambat

// Peluru musuh (tipe shooter): ungu, ukuran dari server
const ENEMY_PROJECTILE_COLOR = '#cc66ff';
const ENEMY_PROJECTILE_GLOW = 8;
const ENEMY_MIN_BAR_WIDTH = 20;
const BOSS_OUTLINE_COLOR = '#ff2a2a';

// --- HUD HTML (lihat index.html & style.css) ---
const hud = {
  player: document.getElementById('hudPlayer'),
  playerName: document.getElementById('hudPlayerName'),
  classBadge: document.getElementById('hudClassBadge'),
  health: document.getElementById('hudHealth'),
  healthFill: document.getElementById('hudHealthFill'),
  healthText: document.getElementById('hudHealthText'),
  playerStats: document.getElementById('hudPlayerStats'),
  roomCode: document.getElementById('hudRoomCode'),
  copyButton: document.getElementById('hudCopyButton'),
  copyStatus: document.getElementById('hudCopyStatus'),
  ultimate: document.getElementById('hudUltimate'),
  ultimateFill: document.getElementById('hudUltimateFill'),
  mutatorBox: document.getElementById('hudMutatorBox'),
  mutatorDivider: document.getElementById('hudMutatorDivider'),
  mutator: document.getElementById('hudMutator'),
  announce: document.getElementById('waveAnnounce'),
  announceTitle: document.getElementById('waveAnnounceTitle'),
  announceMutator: document.getElementById('waveAnnounceMutator'),
  announceDesc: document.getElementById('waveAnnounceDesc'),
  wave: document.getElementById('hudWave'),
  waveNumber: document.getElementById('hudWaveNumber'),
  difficulty: document.getElementById('hudDifficulty'),
  boss: document.getElementById('hudBoss'),
  bossBar: document.getElementById('hudBossBar'),
  bossFill: document.getElementById('hudBossFill'),
  bossText: document.getElementById('hudBossText'),
};
const HEALTH_MID_RATIO = 0.5; // di bawah ini bar kuning
const HEALTH_LOW_RATIO = 0.25; // di bawah ini bar merah
const COPY_FEEDBACK_MS = 1500;

// --- Mini-map (pojok kanan bawah canvas) ---
const MINIMAP_SCALE = 4; // px mini-map per tile (40x30 tile -> 160x120 px)
const MINIMAP_MARGIN = 10;
const MINIMAP_PADDING = 4;
const MINIMAP_BG_COLOR = 'rgba(10, 10, 16, 0.6)';
const MINIMAP_BORDER_COLOR = 'rgba(255, 255, 255, 0.25)';
const MINIMAP_FLOOR_COLOR = 'rgba(200, 200, 215, 0.35)';
const MINIMAP_SELF_COLOR = '#ffe600'; // kuning = diri sendiri
const MINIMAP_ALLY_COLOR = '#3dff6e'; // hijau = teman satu tim
const MINIMAP_ENEMY_COLOR = '#ff3b3b'; // merah = musuh
// Mini-map menutupi sebagian arena: dibuat lebih transparan saat pemain lokal berada di baliknya
const MINIMAP_FADED_ALPHA = 0.3;
let minimapCanvas = null; // denah dungeon skala kecil, digambar sekali per room

const PLAYER_HEALTH_BAR_WIDTH = 32;
const HEALTH_BAR_HEIGHT = 4;
const HEALTH_BAR_OFFSET = 4; // jarak bar dari tepi atas musuh
const HEALTH_BAR_BG_COLOR = '#400000';
const HEALTH_BAR_FILL_COLOR = '#4cd964';

// Data render tiap musuh: posisi yang digambar (x, y), target dari server, dan HP
const renderEnemies = {};

// --- Partikel (efek visual lokal, murni di client) ---
// { x, y, vx, vy, size, color, life, maxLife }
let particles = [];
const MAX_PARTICLES = 500;
const PARTICLE_MIN_COUNT = 6;
const PARTICLE_MAX_COUNT = 10;
const PARTICLE_LIFETIME = 0.5; // detik
const PARTICLE_DRAG = 0.02; // sisa kecepatan setelah 1 detik (melambat cepat)
const HIT_PARTICLE_OPTIONS = { minSpeed: 60, maxSpeed: 180, size: 2.5 };
const WALL_PARTICLE_OPTIONS = { minSpeed: 40, maxSpeed: 140, size: 2 };
const KILL_PARTICLE_OPTIONS = { minSpeed: 80, maxSpeed: 260, size: 3.5 };
const BOSS_PARTICLE_OPTIONS = { minSpeed: 120, maxSpeed: 420, size: 7 };

const OTHER_PLAYER_SHOT_VOLUME = 0.35;

// --- VFX serangan musuh ---
// Busur tebasan melee: { x, y, angle, color, life, maxLife }
let meleeSlashes = [];
const MAX_MELEE_SLASHES = 20;
const MELEE_SLASH_DURATION = 0.2; // detik
const MELEE_SLASH_RADIUS = 34; // jari-jari busur
const MELEE_SLASH_ARC = Math.PI * 0.7; // lebar busur (radian)

// Kilatan merah di tepi layar (vignette) saat pemain lokal kena damage
let damageFlash = 0; // sisa waktu (detik)
const DAMAGE_FLASH_DURATION = 0.15;

// Getaran kamera halus
let screenShake = 0; // magnitudo saat ini (px), meluruh tiap frame
const SCREEN_SHAKE_MAGNITUDE = 6; // px awal
const SCREEN_SHAKE_DECAY = 0.0001; // sisa magnitudo per detik (meluruh cepat)

// Critical hit (warna angka emas)
const CRIT_DAMAGE_COLOR = '#ffd34d';

// Item & buff
const HEAL_NUMBER_COLOR = '#4cd964';
const SHIELD_COLOR = '#9a8cff';
const DOUBLE_DAMAGE_COLOR = '#ffcf33';
const NUKE_FLASH_DURATION = 0.35; // detik kilatan putih-merah saat nuke
const NUKE_WAVE_RADIUS = 700; // gelombang ledakan yang menyapu layar
let nukeFlash = 0;

// Buff aura (saat ambil item) & efek ultimate
let buffAuras = []; // { playerId, color, life, maxLife }
const BUFF_AURA_DURATION = 1.2;
let ultEffects = []; // { kind:'shockwave'|'beam', ... life, maxLife }
const ULT_BEAM_HALF_WIDTH = 13;

// --- Dynamic lighting / fog of war ---
const AMBIENT_DARKNESS = 0.78; // 0 = terang, 1 = gelap total
const PLAYER_LIGHT_RADIUS = 160; // jangkauan cahaya pemain
const SHOOTER_LIGHT_RADIUS = 90; // musuh shooter memancarkan cahaya ungu redup
// Mutator Toxic Fog: lebih gelap & cahaya pemain menyusut
const TOXIC_FOG_DARKNESS = 0.92;
const TOXIC_FOG_LIGHT_SCALE = 0.5;

// --- Ultimate ---
let ultimateMax = 100; // dari server (initGame)

// Snapshot peluru terakhir dari server (peluru pemain dan peluru musuh)
let serverProjectiles = [];
let serverEnemyProjectiles = [];
// Item drop di lantai, dari server: { id, type, x, y, color, lifetime }
let serverItems = [];
let reviveTimeTotal = 3; // detik penuh untuk revive (dikirim server)

// --- Sprite ---
// Loader memuat sprite SVG (lihat sprites.js). Jika sebuah sprite gagal/belum dimuat,
// fungsi gambar jatuh ke bentuk geometris lama. Aman walau createSpriteLoader tidak ada.
const sprites = typeof createSpriteLoader === 'function'
  ? createSpriteLoader(window.SPRITE_SOURCES || {})
  : { ready: () => false, image: () => null };
const PLAYER_SPRITE_SCALE = 1.5; // sprite sedikit lebih besar dari hitbox agar terlihat jelas
const ENEMY_FACE_LERP = 0.3; // kehalusan putaran arah hadap musuh
const BULLET_SPRITE_SIZE_FACTOR = 2.4; // ukuran sprite peluru relatif terhadap radius

// --- Item drop & revive (visual) ---
const ITEM_RADIUS = 10;
const ITEM_ICON = { medkit: '💊', shield: '🛡️', nuke: '💣', doubleDamage: '⚡', speed: '»', damage: '✸' };
const ITEM_PULSE_SPEED = 4; // kecepatan denyut glow (rad/detik)
const REVIVE_RING_RADIUS = 20;

// Dungeon dibangun saat server mengirim seed (event initGame)
let dungeon = null;
let tilemapCanvas = null; // tilemap digambar sekali ke canvas offscreen

// --- Tilemap ---
const FLOOR_BASE_LIGHTNESS = 15; // % (HSL), divariasikan sedikit per tile
const FLOOR_HUE = 240;
const FLOOR_SATURATION = 6;
const FLOOR_GRID_COLOR = 'rgba(255, 255, 255, 0.045)'; // pola grid halus
const FLOOR_SUBGRID_COLOR = 'rgba(255, 255, 255, 0.018)';
const FLOOR_SHADOW_SIZE = 7; // px bayangan dinding yang jatuh ke lantai
const WALL_TOP_COLOR = '#6e5340'; // permukaan atas dinding yang berbatasan dengan lantai
const WALL_FACE_COLOR = '#3e2d21'; // sisi depan dinding (efek kedalaman)
const WALL_FACE_HEIGHT = 6; // px
const WALL_HIGHLIGHT_COLOR = 'rgba(255, 230, 200, 0.18)';
const WALL_BORDER_COLOR = '#1e140e'; // garis gelap di tepi dinding
const WALL_INNER_COLOR = '#211912'; // dinding "dalam" yang tidak bersentuhan dengan lantai

// --- Player & senjata ---
// Moncong senjata digambar berputar mengikuti kursor. tip = jarak ujung moncong dari pusat pemain.
const GUN_STYLES = {
  assault: { length: 14, width: 5, color: '#d9d9d9', flashColor: '255, 200, 90', flashSize: 11 },
  shotgun: { length: 11, width: 8, color: '#b98a55', flashColor: '255, 150, 70', flashSize: 17 },
  sniper: { length: 23, width: 3.5, color: '#a6ecff', flashColor: '150, 240, 255', flashSize: 14 },
};
const DEFAULT_GUN_STYLE = GUN_STYLES.assault;
const gunTipDistance = (style) => PLAYER_RADIUS + style.length;

const AIM_SEND_INTERVAL_MS = 50; // kirim arah bidik ke server maksimal 20x per detik
const AIM_SEND_THRESHOLD = 0.04; // radian; perubahan sekecil ini tidak perlu dikirim
const AIM_LERP_FACTOR = 0.35; // kehalusan rotasi moncong pemain lain

// Jejak pergerakan di belakang pemain
const TRAIL_DURATION = 0.25; // detik sebuah titik jejak bertahan
const TRAIL_MIN_SPACING = 3; // px jarak minimum antar titik
const TRAIL_MAX_POINTS = 24;
const TRAIL_ALPHA = 0.3;

// Muzzle flash: kilatan singkat di ujung moncong + cahaya di sekitar
const MUZZLE_FLASH_DURATION = 0.08; // detik
const MUZZLE_LIGHT_RADIUS = 70; // px cahaya yang menerangi sekitar
let muzzleFlashes = []; // { ownerId, x, y, angle, weapon, life, maxLife }
const MAX_MUZZLE_FLASHES = 40;

// Angka damage melayang
const DAMAGE_NUMBER_DURATION = 0.8; // detik
const DAMAGE_NUMBER_RISE_SPEED = 55; // px/detik di awal, melambat
const DAMAGE_NUMBER_COLOR = '#ffffff';
const KILL_DAMAGE_NUMBER_COLOR = '#ffd34d';
let damageNumbers = []; // { x, y, vy, text, color, size, life, maxLife }
const MAX_DAMAGE_NUMBERS = 80;

// Tingkat kehalusan lerp per frame pada 60 FPS (0 = diam, 1 = instan)
const LERP_FACTOR = 0.3;
const RECONCILE_FACTOR = 0.2; // koreksi pemain lokal ke posisi server
const RECONCILE_DEADZONE = 60; // selisih (px) yang masih ditoleransi saat bergerak
const SNAP_DISTANCE = 150; // selisih (px) yang langsung dipaksa ke posisi server

// Data render tiap pemain: posisi yang digambar (x, y) dan target dari server
const renderPlayers = {};

// Lerp yang konsisten di berbagai refresh rate (LERP_FACTOR berlaku pada 60 FPS)
const lerpAmount = (factor, dt) => 1 - Math.pow(1 - factor, dt * 60);

// --- Lobby ---

// Class senjata yang dipilih di radio button lobby (server tetap memvalidasi ulang)
function getSelectedWeaponClass() {
  const selected = document.querySelector('input[name="weaponClass"]:checked');
  return selected ? selected.value : 'assault';
}

// Tingkat kesulitan yang dipilih (server tetap memvalidasi ulang)
function getSelectedDifficulty() {
  const selected = document.querySelector('input[name="difficulty"]:checked');
  return selected ? selected.value : 'medium';
}

function setLobbyBusy(busy) {
  createRoomButton.disabled = busy || !socket.connected;
  joinRoomButton.disabled = busy || !socket.connected;
}

function showLobbyMessage(message) {
  lobbyMessage.textContent = message;
}

function showLobby(message = '') {
  inRoom = false;
  roomCode = '';
  gameContainer.hidden = true;
  lobbyEl.hidden = false;
  showLobbyMessage(message);
  setLobbyBusy(false);
}

createRoomButton.addEventListener('click', () => {
  showLobbyMessage('Membuat room...');
  setLobbyBusy(true);
  socket.emit('createRoom', {
    name: playerNameInput.value,
    weaponClass: getSelectedWeaponClass(),
    difficulty: getSelectedDifficulty(),
  });
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    showLobbyMessage('Masukkan kode room 4 karakter.');
    roomCodeInput.focus();
    return;
  }
  showLobbyMessage('Bergabung ke room...');
  setLobbyBusy(true);
  socket.emit('joinRoom', { name: playerNameInput.value, weaponClass: getSelectedWeaponClass(), code });
});

// --- Game Over modal ---

// Tampilkan modal saat semua pemain downed; sembunyikan saat wave berjalan lagi
let gameOverShown = false;
function updateGameOverOverlay() {
  const over = waveState === 'GAME_OVER';
  if (over === gameOverShown) return;
  gameOverShown = over;
  gameOverOverlay.hidden = !over;
  if (over) {
    gameOverSub.textContent = `Kamu tumbang di Wave ${wave}.`;
    restartWaveButton.disabled = false;
    backToLobbyButton.disabled = false;
    restartWaveButton.focus();
  }
}

restartWaveButton.addEventListener('click', () => {
  socket.emit('restartWave');
  // Nonaktifkan sementara; overlay tertutup saat server mengirim wave IN_PROGRESS lagi
  restartWaveButton.disabled = true;
  backToLobbyButton.disabled = true;
});

backToLobbyButton.addEventListener('click', () => {
  socket.emit('backToLobby');
  backToLobbyButton.disabled = true;
});

// Server mengonfirmasi pemain sudah keluar room -> kembali ke lobby
socket.on('leftRoom', () => {
  gameOverOverlay.hidden = true;
  gameOverShown = false;
  showLobby('');
});

// Kode salah, room penuh, dll.
socket.on('roomError', ({ message }) => {
  showLobbyMessage(message);
  setLobbyBusy(false);
});

socket.on('connect', () => {
  statusEl.textContent = 'Terhubung. Buat room baru atau masukkan kode room.';
  setLobbyBusy(false);
});

// Berhasil masuk room: sembunyikan lobby dan tampilkan canvas
socket.on('initGame', ({ dungeonSeed, roomCode: code, name, difficulty, difficultyLabel, ultimateMax: ultMax }) => {
  dungeon = Dungeon.generate(dungeonSeed);
  tilemapCanvas = renderTilemap(dungeon);
  roomDifficulty = difficulty || 'medium';
  roomDifficultyLabel = difficultyLabel || 'Medium';
  waveMutator = null;
  lastAnnouncedWaveNumber = ''; // pengumuman wave tampil lagi di room baru
  nukeFlash = 0;
  if (typeof ultMax === 'number') ultimateMax = ultMax;
  minimapCanvas = renderMinimap(dungeon);
  console.log('Dungeon seed:', dungeonSeed);

  // Mulai dari keadaan bersih di room baru: tidak ada tombol tercatat ditahan, dan server
  // mendapat input nol (sejalan dengan input awal { dx: 0, dy: 0 } di server)
  resetKeys();
  particles = [];
  muzzleFlashes = [];
  damageNumbers = [];
  meleeSlashes = [];
  buffAuras = [];
  ultEffects = [];
  damageFlash = 0;
  screenShake = 0;
  lastAimSent = null; // kirim arah bidik terkini ke room baru

  inRoom = true;
  roomCode = code;
  gameOverShown = false;
  gameOverOverlay.hidden = true;
  lobbyEl.hidden = true;
  gameContainer.hidden = false;
  setText(hud.roomCode, code); // langsung tampil, tanpa menunggu stateUpdate pertama
  statusEl.textContent = `Room ${code} | ${name} | Bagikan kode ini ke temanmu`;
});

// Variasi deterministik per tile (0..1) supaya lantai tidak terlihat datar; sama untuk semua
// pemain karena hanya bergantung pada posisi tile
function tileNoise(col, row) {
  let h = Math.imul(col, 73856093) ^ Math.imul(row, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Menggambar seluruh tile ke canvas offscreen supaya per frame cukup satu drawImage.
// Lantai: warna sedikit bervariasi + pola grid halus + bayangan dari dinding.
// Dinding: permukaan atas, sisi depan yang lebih gelap (kedalaman), dan garis tepi gelap.
function renderTilemap({ grid, cols, rows, tileSize }) {
  const offscreen = document.createElement('canvas');
  offscreen.width = cols * tileSize;
  offscreen.height = rows * tileSize;
  const tctx = offscreen.getContext('2d');
  const isWall = (col, row) =>
    row < 0 || row >= rows || col < 0 || col >= cols || grid[row][col] === Dungeon.WALL;
  const touchesFloor = (col, row) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) if (!isWall(col + dc, row + dr)) return true;
    }
    return false;
  };

  // 1. Lantai
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isWall(col, row)) continue;
      const x = col * tileSize;
      const y = row * tileSize;
      const lightness = FLOOR_BASE_LIGHTNESS + (tileNoise(col, row) - 0.5) * 2.5;
      tctx.fillStyle = `hsl(${FLOOR_HUE}, ${FLOOR_SATURATION}%, ${lightness}%)`;
      tctx.fillRect(x, y, tileSize, tileSize);

      // Pola grid halus: garis tile + garis bantu tipis di tengah tile
      tctx.fillStyle = FLOOR_GRID_COLOR;
      tctx.fillRect(x, y, tileSize, 1);
      tctx.fillRect(x, y, 1, tileSize);
      tctx.fillStyle = FLOOR_SUBGRID_COLOR;
      tctx.fillRect(x + tileSize / 2, y + 2, 1, tileSize - 4);
      tctx.fillRect(x + 2, y + tileSize / 2, tileSize - 4, 1);
    }
  }

  // 2. Bayangan dinding di lantai (cahaya seolah dari atas): bayangan lebih tebal di bawah
  //    dinding, lebih tipis di samping kiri/kanan
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isWall(col, row)) continue;
      const x = col * tileSize;
      const y = row * tileSize;
      const shade = (x0, y0, x1, y1, w, h, alpha) => {
        const g = tctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        tctx.fillStyle = g;
        tctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
      };
      if (isWall(col, row - 1)) shade(x, y, x, y + FLOOR_SHADOW_SIZE, tileSize, FLOOR_SHADOW_SIZE, 0.45);
      if (isWall(col - 1, row)) shade(x, y, x + FLOOR_SHADOW_SIZE * 0.6, y, FLOOR_SHADOW_SIZE * 0.6, tileSize, 0.25);
      if (isWall(col + 1, row)) {
        const x1 = x + tileSize;
        shade(x1, y, x1 - FLOOR_SHADOW_SIZE * 0.6, y, FLOOR_SHADOW_SIZE * 0.6, tileSize, 0.25);
      }
    }
  }

  // 3. Dinding
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!isWall(col, row)) continue;
      const x = col * tileSize;
      const y = row * tileSize;

      // Dinding yang jauh dari lantai digambar gelap agar tepi dungeon menonjol
      if (!touchesFloor(col, row)) {
        tctx.fillStyle = WALL_INNER_COLOR;
        tctx.fillRect(x, y, tileSize, tileSize);
        continue;
      }

      tctx.fillStyle = WALL_TOP_COLOR;
      tctx.fillRect(x, y, tileSize, tileSize);

      // Variasi bata halus pada permukaan atas
      tctx.fillStyle = `rgba(0, 0, 0, ${0.04 + tileNoise(row, col) * 0.08})`;
      tctx.fillRect(x, y, tileSize, tileSize);

      // Sisi depan: terlihat jika tepat di bawahnya lantai (efek kedalaman 3D tipis)
      if (!isWall(col, row + 1)) {
        tctx.fillStyle = WALL_FACE_COLOR;
        tctx.fillRect(x, y + tileSize - WALL_FACE_HEIGHT, tileSize, WALL_FACE_HEIGHT);
      }
      // Sorotan tipis di tepi atas yang menghadap lantai
      if (!isWall(col, row - 1)) {
        tctx.fillStyle = WALL_HIGHLIGHT_COLOR;
        tctx.fillRect(x, y, tileSize, 2);
      }

      // Garis tepi gelap di setiap sisi yang berbatasan dengan lantai
      tctx.fillStyle = WALL_BORDER_COLOR;
      if (!isWall(col, row - 1)) tctx.fillRect(x, y, tileSize, 1);
      if (!isWall(col, row + 1)) tctx.fillRect(x, y + tileSize - 1, tileSize, 1);
      if (!isWall(col - 1, row)) tctx.fillRect(x, y, 1, tileSize);
      if (!isWall(col + 1, row)) tctx.fillRect(x + tileSize - 1, y, 1, tileSize);
    }
  }
  return offscreen;
}

// --- Overlay pilihan upgrade ---

socket.on('showUpgrades', ({ wave: clearedWave, choices }) => {
  upgradeTitle.textContent = `Wave ${clearedWave} selesai! Pilih satu upgrade`;
  upgradeChoices.replaceChildren();
  upgradeWaiting.hidden = true;

  for (const choice of choices) {
    upgradeChoices.appendChild(createUpgradeCard(choice));
  }

  upgradeOverlay.hidden = false;
  const firstCard = upgradeChoices.querySelector('.card');
  if (firstCard) firstCard.focus();
});

const RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

// Kartu upgrade bergaya RPG: badge rarity + ikon + judul + deskripsi. Styling per rarity
// lewat data-rarity (lihat style.css).
function createUpgradeCard(choice) {
  const rarity = RARITY_LABELS[choice.rarity] ? choice.rarity : 'common';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.rarity = rarity;
  card.dataset.rarityLabel = RARITY_LABELS[rarity];
  card.setAttribute('aria-label', `${RARITY_LABELS[rarity]} — ${choice.label}: ${choice.desc || ''}`);

  const icon = document.createElement('div');
  icon.className = 'card-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = choice.icon || '★';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = choice.label;

  const desc = document.createElement('div');
  desc.className = 'card-desc';
  desc.textContent = choice.desc || '';

  card.append(icon, title, desc);
  card.addEventListener('click', () => selectUpgrade(choice.id));
  return card;
}

function selectUpgrade(id) {
  socket.emit('selectUpgrade', { id });
  // Cegah klik ganda dan tunggu pemain lain
  for (const card of upgradeChoices.querySelectorAll('.card')) card.disabled = true;
  upgradeWaiting.hidden = false;
}

// --- Kejadian dari server: SFX + partikel ---

function projectileColor(type) {
  if (type === 'enemy') return ENEMY_PROJECTILE_COLOR;
  return (PROJECTILE_STYLES[type] || DEFAULT_PROJECTILE_STYLE).color;
}

function handleServerEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'shoot':
        // Tembakan sendiri terdengar penuh, tembakan pemain lain lebih pelan
        playShootSFX(ev.weapon, ev.ownerId === socket.id ? 1 : OTHER_PLAYER_SHOT_VOLUME);
        spawnMuzzleFlash(ev);
        break;
      case 'hit':
        spawnParticles(ev.x, ev.y, ev.color);
        // Critical: angka emas besar dengan efek membal (lihat spawnDamageNumber)
        spawnDamageNumber(ev.x, ev.y, ev.damage, ev.crit ? CRIT_DAMAGE_COLOR : DAMAGE_NUMBER_COLOR, ev.crit);
        playHitSFX();
        break;
      case 'kill':
        spawnParticles(ev.x, ev.y, ev.color, ev.isBoss ? BOSS_PARTICLE_OPTIONS : KILL_PARTICLE_OPTIONS);
        spawnDamageNumber(ev.x, ev.y - (ev.radius || 0) * 0.5, ev.damage, ev.crit ? CRIT_DAMAGE_COLOR : KILL_DAMAGE_NUMBER_COLOR, ev.crit);
        playExplosionSFX(ev.isBoss);
        break;
      case 'downed':
        spawnParticles(ev.x, ev.y, '#ff4d4d', KILL_PARTICLE_OPTIONS);
        if (ev.playerId === socket.id) playPlayerHitSFX();
        break;
      case 'revived':
        spawnParticles(ev.x, ev.y, '#4cd964', KILL_PARTICLE_OPTIONS);
        playHitSFX();
        break;
      case 'pickup': {
        spawnParticles(ev.x, ev.y, ev.color || '#ffffff');
        // Aura buff di bawah kaki pemain yang mengambil item
        spawnBuffAura(ev.playerId, ev.color || '#ffffff');
        // Medkit: angka "+N" hijau melayang di atas pemain yang pulih (jumlah HP yang benar-benar naik)
        if (ev.heal > 0) {
          const healed = renderPlayers[ev.playerId];
          spawnFloatingText(healed ? healed.x : ev.x, (healed ? healed.y : ev.y) - PLAYER_RADIUS - 8,
            `+${Math.round(ev.heal * 10) / 10} HP`, HEAL_NUMBER_COLOR, 18);
        }
        playHitSFX();
        break;
      }
      case 'nuke':
        nukeFlash = NUKE_FLASH_DURATION;
        screenShake = Math.max(screenShake, SCREEN_SHAKE_MAGNITUDE * 2);
        spawnShockwave(ev.x, ev.y, NUKE_WAVE_RADIUS);
        break;
      case 'shieldBreak':
        spawnParticles(ev.x, ev.y, SHIELD_COLOR, KILL_PARTICLE_OPTIONS);
        spawnFloatingText(ev.x, ev.y - PLAYER_RADIUS - 8, 'BLOCK', SHIELD_COLOR, 16);
        playHitSFX();
        break;
      case 'ultimate':
        if (ev.ownerId === socket.id) screenShake = Math.max(screenShake, SCREEN_SHAKE_MAGNITUDE * 1.3);
        break;
      case 'ultShockwave':
        spawnShockwave(ev.x, ev.y, ev.radius);
        break;
      case 'ultBeam':
        spawnBeam(ev.x, ev.y, ev.angle, ev.length);
        break;
      case 'wallHit':
        spawnParticles(ev.x, ev.y, projectileColor(ev.projectileType), WALL_PARTICLE_OPTIONS);
        break;
      case 'playerHit':
        // Suara + kilatan merah + getaran kamera hanya untuk pemain lokal; luka pemain lain
        // cukup terlihat dari health bar
        if (ev.playerId === socket.id) {
          playPlayerHitSFX();
          triggerDamageFeedback();
        }
        break;
      case 'meleeAttack':
        spawnMeleeSlash(ev);
        break;
    }
  }
}

// --- Serangan melee musuh: busur cahaya merah di antara musuh dan pemain ---
function spawnMeleeSlash(ev) {
  if (meleeSlashes.length >= MAX_MELEE_SLASHES) meleeSlashes.shift();
  meleeSlashes.push({
    // Busak digambar di titik tengah antara musuh dan pemain, menghadap pemain
    x: (ev.ex + ev.px) / 2,
    y: (ev.ey + ev.py) / 2,
    angle: Math.atan2(ev.py - ev.ey, ev.px - ev.ex),
    color: ev.color || '#ff3b3b',
    life: MELEE_SLASH_DURATION,
    maxLife: MELEE_SLASH_DURATION,
  });
}

// Kilatan merah di tepi layar + getaran kamera halus saat pemain lokal terkena damage
function triggerDamageFeedback() {
  damageFlash = DAMAGE_FLASH_DURATION;
  screenShake = SCREEN_SHAKE_MAGNITUDE;
}

// --- Muzzle flash ---

// Kilatan menempel pada pemain penembak (bukan posisi tetap), jadi tetap pas di ujung moncong
// meskipun pemain bergerak selama kilatan tampil. x/y event dipakai jika pemain tidak ada.
function spawnMuzzleFlash(ev) {
  if (typeof ev.angle !== 'number') return;
  if (muzzleFlashes.length >= MAX_MUZZLE_FLASHES) muzzleFlashes.shift();
  muzzleFlashes.push({
    ownerId: ev.ownerId,
    x: ev.x,
    y: ev.y,
    angle: ev.angle,
    weapon: ev.weapon,
    life: MUZZLE_FLASH_DURATION,
    maxLife: MUZZLE_FLASH_DURATION,
  });
}

function updateTimed(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].life -= dt;
    if (list[i].life <= 0) list.splice(i, 1);
  }
}

function drawMuzzleFlashes() {
  if (muzzleFlashes.length === 0) return;
  ctx.save();
  // 'lighter' = cahaya bersifat aditif, sehingga lantai & dinding di sekitar ikut terang
  ctx.globalCompositeOperation = 'lighter';

  for (const f of muzzleFlashes) {
    const owner = renderPlayers[f.ownerId];
    const style = GUN_STYLES[f.weapon] || DEFAULT_GUN_STYLE;
    const baseX = owner ? owner.x : f.x;
    const baseY = owner ? owner.y : f.y;
    const tip = gunTipDistance(style);
    const fx = baseX + Math.cos(f.angle) * tip;
    const fy = baseY + Math.sin(f.angle) * tip;
    const t = f.life / f.maxLife; // 1 -> 0

    // Cahaya lembut yang menerangi area sekitar
    const light = ctx.createRadialGradient(fx, fy, 0, fx, fy, MUZZLE_LIGHT_RADIUS);
    light.addColorStop(0, `rgba(${style.flashColor}, ${0.35 * t})`);
    light.addColorStop(1, `rgba(${style.flashColor}, 0)`);
    ctx.fillStyle = light;
    ctx.fillRect(fx - MUZZLE_LIGHT_RADIUS, fy - MUZZLE_LIGHT_RADIUS, MUZZLE_LIGHT_RADIUS * 2, MUZZLE_LIGHT_RADIUS * 2);

    // Inti kilatan: elips memanjang searah tembakan, putih di tengah
    const size = style.flashSize * (0.6 + 0.4 * t);
    ctx.translate(fx, fy);
    ctx.rotate(f.angle);
    const core = ctx.createRadialGradient(size * 0.3, 0, 0, size * 0.3, 0, size);
    core.addColorStop(0, `rgba(255, 255, 255, ${t})`);
    core.addColorStop(0.35, `rgba(${style.flashColor}, ${0.9 * t})`);
    core.addColorStop(1, `rgba(${style.flashColor}, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.ellipse(size * 0.3, 0, size, size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
}

// --- Angka damage melayang ---

// -1, -4, -2.2 (maksimal 1 desimal, tanpa nol di belakang)
const formatDamage = (damage) => `-${Math.round(damage * 10) / 10}`;

// Teks melayang umum (heal, BLOCK, dll.): naik lalu memudar, memakai sistem damageNumbers
function spawnFloatingText(x, y, text, color, size = 16) {
  if (damageNumbers.length >= MAX_DAMAGE_NUMBERS) damageNumbers.shift();
  damageNumbers.push({
    x, y, vy: -DAMAGE_NUMBER_RISE_SPEED, text, color, crit: false, size,
    life: DAMAGE_NUMBER_DURATION + 0.3, maxLife: DAMAGE_NUMBER_DURATION + 0.3, age: 0,
  });
}

function spawnDamageNumber(x, y, damage, color, crit = false) {
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage <= 0) return;
  if (damageNumbers.length >= MAX_DAMAGE_NUMBERS) damageNumbers.shift();
  damageNumbers.push({
    x: x + (Math.random() - 0.5) * 12, // sedikit acak agar angka yang bertumpuk tetap terbaca
    y: y - 6,
    vy: -DAMAGE_NUMBER_RISE_SPEED,
    text: crit ? `${formatDamage(damage)}!` : formatDamage(damage),
    color,
    crit,
    // Crit jauh lebih besar; selain itu ukuran naik dengan damage
    size: crit ? Math.round(22 + Math.min(damage, 12) * 1.6) : Math.round(12 + Math.min(damage, 8) * 1.5),
    life: DAMAGE_NUMBER_DURATION,
    maxLife: DAMAGE_NUMBER_DURATION,
    age: 0,
  });
}

function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const n = damageNumbers[i];
    n.life -= dt;
    n.age += dt;
    if (n.life <= 0) {
      damageNumbers.splice(i, 1);
      continue;
    }
    n.y += n.vy * dt;
    n.vy *= Math.pow(0.15, dt); // melambat sambil naik
  }
}

// Skala membal untuk crit: melonjak besar lalu mengecil ke 1 (bounce)
function critBounceScale(age) {
  const T = 0.3; // durasi bounce
  if (age >= T) return 1;
  const p = age / T;
  return 1 + 0.6 * Math.sin(p * Math.PI); // 1 -> 1.6 -> 1
}

function drawDamageNumbers() {
  if (damageNumbers.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const n of damageNumbers) {
    const t = n.life / n.maxLife; // 1 -> 0
    ctx.globalAlpha = Math.min(1, t * 2); // tampil penuh di paruh pertama, lalu memudar
    const size = n.crit ? n.size * critBounceScale(n.age) : n.size;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.lineWidth = n.crit ? 4 : 3;
    if (n.crit) {
      ctx.shadowColor = 'rgba(255, 190, 40, 0.9)';
      ctx.shadowBlur = 10;
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'; // garis gelap agar terbaca di atas warna apa pun
    ctx.strokeText(n.text, n.x, n.y);
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, n.x, n.y);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// --- Buff aura & efek ultimate ---

// Aura cahaya melingkar di bawah kaki pemain yang baru mengambil item boost
function spawnBuffAura(playerId, color) {
  buffAuras.push({ playerId, color, life: BUFF_AURA_DURATION, maxLife: BUFF_AURA_DURATION });
}

// Gelombang kejut (Shotgun ultimate): cincin yang mengembang ke radius penuh lalu memudar
function spawnShockwave(x, y, radius) {
  ultEffects.push({ kind: 'shockwave', x, y, radius, life: 0.5, maxLife: 0.5 });
}

// Laser raksasa (Sniper ultimate): garis tebal bersinar yang memudar
function spawnBeam(x, y, angle, length) {
  ultEffects.push({ kind: 'beam', x, y, angle, length, life: 0.4, maxLife: 0.4 });
}

function updateBuffAuras(dt) {
  for (let i = buffAuras.length - 1; i >= 0; i--) {
    buffAuras[i].life -= dt;
    if (buffAuras[i].life <= 0) buffAuras.splice(i, 1);
  }
}

// Aura yang menetap selama buff aktif: cahaya kuning berdenyut di bawah kaki (2x Damage).
// Ring shield digambar terpisah di atas badan (lihat drawShieldRing).
function drawPersistentAuras() {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 6);
  for (const id in renderPlayers) {
    const p = renderPlayers[id];
    if (p.isDowned || !(p.damageBoostLeft > 0)) continue;
    // Berkedip cepat di 1 detik terakhir sebagai peringatan buff hampir habis
    const ending = p.damageBoostLeft < 1;
    const blink = ending ? (Math.floor(performance.now() / 120) % 2 === 0 ? 1 : 0.35) : 1;
    const r = PLAYER_RADIUS + 8 + pulse * 4;
    ctx.save();
    ctx.globalAlpha = (0.55 + pulse * 0.25) * blink;
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.25, p.x, p.y, r);
    g.addColorStop(0, DOUBLE_DAMAGE_COLOR);
    g.addColorStop(1, 'rgba(255, 207, 51, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + PLAYER_RADIUS * 0.45, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Ring tipis berdenyut mengelilingi pemain yang memiliki shield
function drawShieldRings() {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 4);
  for (const id in renderPlayers) {
    const p = renderPlayers[id];
    if (p.isDowned || !p.shield) continue;
    ctx.save();
    ctx.shadowColor = SHIELD_COLOR;
    ctx.shadowBlur = 8 + pulse * 8;
    ctx.strokeStyle = SHIELD_COLOR;
    ctx.globalAlpha = 0.6 + pulse * 0.3;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// Kilatan layar penuh saat Nuke meledak (putih memudar ke merah)
function drawNukeFlash() {
  if (nukeFlash <= 0) return;
  const t = nukeFlash / NUKE_FLASH_DURATION; // 1 -> 0
  ctx.save();
  ctx.fillStyle = `rgba(255, ${Math.round(120 + 135 * t)}, ${Math.round(100 * t)}, ${0.65 * t})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawBuffAuras() {
  for (const a of buffAuras) {
    const p = renderPlayers[a.playerId];
    if (!p) continue;
    const t = a.life / a.maxLife; // 1 -> 0
    const r = PLAYER_RADIUS + 6 + (1 - t) * 10; // sedikit mengembang
    ctx.save();
    ctx.globalAlpha = t * 0.7;
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
    g.addColorStop(0, a.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + PLAYER_RADIUS * 0.4, r, r * 0.5, 0, 0, Math.PI * 2); // elips "di lantai"
    ctx.fill();
    ctx.restore();
  }
}

function drawUltEffects() {
  for (const e of ultEffects) {
    const t = e.life / e.maxLife; // 1 -> 0
    ctx.save();
    if (e.kind === 'shockwave') {
      const r = e.radius * (1 - t); // mengembang dari pusat ke radius penuh
      ctx.globalAlpha = t;
      ctx.lineWidth = 6 * t + 2;
      ctx.strokeStyle = '#ff9d3d';
      ctx.shadowColor = '#ff7a45';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.kind === 'beam') {
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      ctx.globalAlpha = t;
      ctx.shadowColor = '#8ff3ff';
      ctx.shadowBlur = 24;
      // Inti terang + selubung lebih lebar
      ctx.fillStyle = 'rgba(180, 245, 255, 0.35)';
      ctx.fillRect(0, -ULT_BEAM_HALF_WIDTH * 2, e.length, ULT_BEAM_HALF_WIDTH * 4);
      ctx.fillStyle = '#eafcff';
      ctx.fillRect(0, -ULT_BEAM_HALF_WIDTH, e.length, ULT_BEAM_HALF_WIDTH * 2);
    }
    ctx.restore();
  }
}

// --- Particle system ---

// Spawn 6-10 partikel kecil yang menyebar ke segala arah lalu memudar dalam ~0.5 detik
function spawnParticles(x, y, color, options = HIT_PARTICLE_OPTIONS) {
  const { minSpeed, maxSpeed, size } = options;
  const count = PARTICLE_MIN_COUNT + Math.floor(Math.random() * (PARTICLE_MAX_COUNT - PARTICLE_MIN_COUNT + 1));

  for (let i = 0; i < count; i++) {
    // Buang yang paling lama jika sudah penuh, supaya ledakan baru tetap terlihat
    if (particles.length >= MAX_PARTICLES) particles.shift();

    const angle = Math.random() * Math.PI * 2;
    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    const life = PARTICLE_LIFETIME * (0.8 + Math.random() * 0.4); // 0.4 - 0.6 detik
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: size * (0.7 + Math.random() * 0.6),
      color,
      life,
      maxLife: life,
    });
  }
}

function updateParticles(dt) {
  const drag = Math.pow(PARTICLE_DRAG, dt); // melambat secara halus, tidak bergantung FPS
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.maxLife; // 1 -> 0
    ctx.globalAlpha = t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size * t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Pengumuman awal wave: tampil saat wave baru dimulai (atau diulang lewat Restart Wave),
// berisi nomor wave dan mutator aktif (jika ada). Menghilang sendiri lewat animasi CSS.
function maybeAnnounceWave(prevState) {
  if (waveState !== 'IN_PROGRESS' || !inRoom) return;
  const startedNow = prevState !== 'IN_PROGRESS' || `${wave}` !== lastAnnouncedWaveNumber;
  if (!startedNow) return;
  lastAnnouncedWaveNumber = `${wave}`;

  const el = hud.announce;
  hud.announceTitle.textContent = `WAVE ${wave}`;
  hud.announceMutator.textContent = waveMutator ? waveMutator.label : '';
  hud.announceDesc.textContent = waveMutator ? waveMutator.desc : '';
  el.setAttribute('data-mutator', waveMutator ? waveMutator.id : '');
  // Mulai ulang animasi CSS: sembunyikan, paksa reflow, tampilkan lagi
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;

  // Auto-hide: batalkan timer lama (wave berganti cepat), lalu sembunyikan total setelah 2,5 detik
  clearTimeout(announceHideTimer);
  announceHideTimer = setTimeout(() => {
    el.hidden = true;
    announceHideTimer = null;
  }, WAVE_ANNOUNCE_DURATION_MS);
}
let lastAnnouncedWaveNumber = '';
let announceHideTimer = null;
const WAVE_ANNOUNCE_DURATION_MS = 2500;

socket.on('stateUpdate', ({ players, projectiles, enemyProjectiles, enemies, items, wave: serverWave, waveState: serverWaveState, mutator, reviveTime, events }) => {
  const prevWaveState = waveState;
  waveMutator = mutator || null;
  console.log('State received:', players);

  wave = serverWave;
  waveState = serverWaveState;
  // Overlay ditutup otomatis saat wave berikutnya dimulai
  if (waveState !== 'WAVE_CLEAR') upgradeOverlay.hidden = true;
  updateGameOverOverlay();
  maybeAnnounceWave(prevWaveState);

  // Musuh diperlakukan seperti pemain lain: simpan target, posisi render di-lerp
  for (const { id, x, y, hp, maxHp, color, radius, type, isBoss } of enemies) {
    const entry = renderEnemies[id];
    if (entry) {
      Object.assign(entry, { targetX: x, targetY: y, hp, maxHp, color, radius, type, isBoss });
    } else {
      renderEnemies[id] = { x, y, targetX: x, targetY: y, hp, maxHp, color, radius, type, isBoss, faceAngle: 0 };
    }
  }
  const activeEnemyIds = new Set(enemies.map((e) => String(e.id)));
  for (const id in renderEnemies) {
    if (!activeEnemyIds.has(id)) delete renderEnemies[id];
  }

  // Peluru bergerak lurus, jadi cukup simpan snapshot terakhir beserta waktu terimanya
  const receivedAt = performance.now();
  serverProjectiles = projectiles.map((p) => ({ ...p, receivedAt }));
  serverEnemyProjectiles = enemyProjectiles.map((p) => ({ ...p, receivedAt }));
  serverItems = items || [];
  if (typeof reviveTime === 'number') reviveTimeTotal = reviveTime;

  if (events) handleServerEvents(events);

  // Simpan hanya target baru; posisi render diperbarui perlahan di loop render
  for (const id in players) {
    const { x, y, name, color, hp, maxHp, speed, damage, fireRate, weaponClass, isDowned, reviveProgress, ultimate, shield, damageBoostLeft, aimAngle } = players[id];
    const stats = { name, color, hp, maxHp, speed, damage, fireRate, weaponClass, isDowned, reviveProgress, ultimate, shield, damageBoostLeft };
    const targetAim = typeof aimAngle === 'number' ? aimAngle : 0;
    const entry = renderPlayers[id];
    if (entry) {
      Object.assign(entry, stats, { targetX: x, targetY: y, targetAim });
    } else {
      // Pemain baru langsung muncul di posisinya, tanpa meluncur dari (0, 0)
      renderPlayers[id] = { x, y, targetX: x, targetY: y, ...stats, aim: targetAim, targetAim, trail: [] };
    }
  }

  // Hapus pemain yang sudah tidak ada di server
  for (const id in renderPlayers) {
    if (!(id in players)) delete renderPlayers[id];
  }

  updateHud();
});

// Koneksi putus berarti keanggotaan room di server hilang, jadi kembali ke lobby
socket.on('itemPickedUp', ({ itemId }) => {
  // Hapus item dari list lokal segera, sebelum stateUpdate berikutnya datang,
  // sehingga visual item di canvas langsung lenyap tanpa jeda.
  serverItems = serverItems.filter((it) => it.id !== itemId);
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Terputus dari server. Menghubungkan ulang...';
  for (const id in renderPlayers) delete renderPlayers[id];
  serverProjectiles = [];
  serverEnemyProjectiles = [];
  serverItems = [];
  particles = [];
  muzzleFlashes = [];
  damageNumbers = [];
  meleeSlashes = [];
  buffAuras = [];
  ultEffects = [];
  damageFlash = 0;
  screenShake = 0;
  for (const id in renderEnemies) delete renderEnemies[id];
  upgradeOverlay.hidden = true;
  dungeon = null;
  tilemapCanvas = null;
  minimapCanvas = null;
  wave = 1;
  waveState = 'IN_PROGRESS';
  waveMutator = null;
  nukeFlash = 0;
  hud.announce.hidden = true;
  clearTimeout(announceHideTimer);
  hud.boss.hidden = true;
  gameOverOverlay.hidden = true;
  gameOverShown = false;
  resetKeys();
  showLobby('Terputus dari server. Silakan buat atau gabung room lagi.');
});

// Selisih sudut terpendek (-PI..PI), supaya rotasi tidak berputar jauh lewat sisi lain
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

let lastAimSentAt = 0;
let lastAimSent = null;

// Arah moncong pemain lokal mengikuti kursor setiap frame (juga saat hanya pemain yang bergerak),
// dan dikirim ke server secara terbatas agar pemain lain melihat arah bidikan yang sama
function updateLocalAim(me) {
  if (!mouse.seen || me.isDowned) return;
  me.aim = Math.atan2(mouse.y - me.y, mouse.x - me.x);

  const now = performance.now();
  const changed = lastAimSent === null || Math.abs(angleDelta(lastAimSent, me.aim)) > AIM_SEND_THRESHOLD;
  if (changed && now - lastAimSentAt >= AIM_SEND_INTERVAL_MS && socket.connected) {
    socket.emit('aim', { angle: me.aim });
    lastAimSent = me.aim;
    lastAimSentAt = now;
  }
}

// Tambahkan titik jejak saat pemain berpindah, buang titik yang sudah kedaluwarsa
function updateTrail(p, dt) {
  for (const point of p.trail) point.age += dt;
  while (p.trail.length && p.trail[0].age > TRAIL_DURATION) p.trail.shift();

  if (p.isDowned) return;
  const last = p.trail[p.trail.length - 1];
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= TRAIL_MIN_SPACING) {
    p.trail.push({ x: p.x, y: p.y, age: 0 });
    if (p.trail.length > TRAIL_MAX_POINTS) p.trail.shift();
  }
}

function update(dt) {
  updateParticles(dt);
  updateTimed(muzzleFlashes, dt);
  updateTimed(meleeSlashes, dt);
  updateTimed(ultEffects, dt);
  updateBuffAuras(dt);
  if (nukeFlash > 0) nukeFlash = Math.max(0, nukeFlash - dt);
  updateDamageNumbers(dt);

  // Kilatan damage & getaran kamera meluruh
  if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt);
  if (screenShake > 0.1) screenShake *= Math.pow(SCREEN_SHAKE_DECAY, dt);
  else screenShake = 0;

  const t = lerpAmount(LERP_FACTOR, dt);
  for (const id in renderEnemies) {
    const e = renderEnemies[id];
    const px = e.x, py = e.y;
    e.x += (e.targetX - e.x) * t;
    e.y += (e.targetY - e.y) * t;

    // Arah hadap sprite musuh: ikuti arah gerak, hanya jika pergerakan cukup berarti
    const mx = e.x - px, my = e.y - py;
    if (Math.hypot(mx, my) > 0.2) {
      const target = Math.atan2(my, mx);
      e.faceAngle = (e.faceAngle || 0) + angleDelta(e.faceAngle || 0, target) * lerpAmount(ENEMY_FACE_LERP, dt);
    }
  }

  for (const id in renderPlayers) {
    const p = renderPlayers[id];

    if (id === socket.id) {
      updateLocalPlayer(p, dt);
      updateLocalAim(p);
    } else {
      // Entity interpolation: bergerak perlahan menuju target dari server
      const t = lerpAmount(LERP_FACTOR, dt);
      p.x += (p.targetX - p.x) * t;
      p.y += (p.targetY - p.y) * t;
      // Rotasi moncong juga dihaluskan, lewat arah putar terpendek
      p.aim += angleDelta(p.aim, p.targetAim) * lerpAmount(AIM_LERP_FACTOR, dt);
    }

    updateTrail(p, dt);
  }
}

// Pemain lokal diprediksi di client agar langsung responsif terhadap WASD,
// lalu dikoreksi pelan-pelan ke posisi otoritatif dari server.
function updateLocalPlayer(p, dt) {
  // Pemain downed tidak bergerak (sama seperti di server)
  let { dx, dy } = p.isDowned ? { dx: 0, dy: 0 } : lastInput;
  const length = Math.hypot(dx, dy);
  if (length > 1) {
    dx /= length;
    dy /= length;
  }

  // Prediksi memakai collision yang sama dengan server agar tidak menembus dinding
  if (dungeon) {
    const speed = p.speed * TICKS_PER_SECOND; // piksel per detik
    const next = Dungeon.slideMove(
      dungeon.grid, p.x, p.y, dx * speed * dt, dy * speed * dt, PLAYER_RADIUS
    );
    p.x = next.x;
    p.y = next.y;
  }

  const error = Math.hypot(p.targetX - p.x, p.targetY - p.y);
  const isMoving = dx !== 0 || dy !== 0;

  if (error > SNAP_DISTANCE) {
    // Terlalu jauh (misalnya lag besar): ikuti server
    p.x = p.targetX;
    p.y = p.targetY;
  } else if (!isMoving || error > RECONCILE_DEADZONE) {
    // Posisi server selalu tertinggal sebesar latensi saat bergerak, jadi
    // koreksi halus hanya dilakukan saat diam atau selisih sudah besar
    const t = lerpAmount(RECONCILE_FACTOR, dt);
    p.x += (p.targetX - p.x) * t;
    p.y += (p.targetY - p.y) * t;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Getaran kamera halus: geser seluruh scene beberapa piksel acak saat screenShake aktif.
  // Flash vignette digambar setelah restore, jadi tidak ikut bergetar.
  ctx.save();
  if (screenShake > 0) {
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
  }

  // Tilemap digambar lebih dulu, karakter pemain di atasnya
  if (tilemapCanvas) ctx.drawImage(tilemapCanvas, 0, 0);

  drawBuffAuras(); // aura di lantai, paling bawah
  drawPersistentAuras(); // aura 2x Damage selama buff aktif
  drawItems(); // item di lantai, di bawah musuh & pemain
  drawEnemies();

  // Jejak semua pemain digambar lebih dulu supaya selalu berada di bawah karakter
  for (const id in renderPlayers) drawTrail(renderPlayers[id]);

  for (const id in renderPlayers) {
    const p = renderPlayers[id];
    const { x, y, name, hp, maxHp, isDowned } = p;

    // Pemain downed digambar pudar (berlutut) dan tanpa health bar
    ctx.globalAlpha = isDowned ? 0.35 : 1;
    drawPlayerBody(p, id === socket.id);
    ctx.globalAlpha = 1;

    if (isDowned) {
      drawReviveRing(p); // ring progress revive di atas kepala
    }

    // Nama di atas karakter (di atas health bar jika masih hidup)
    const barTop = y - PLAYER_RADIUS - HEALTH_BAR_OFFSET - HEALTH_BAR_HEIGHT;
    ctx.globalAlpha = isDowned ? 0.5 : 1;
    ctx.font = id === socket.id ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = isDowned ? '#ff8888' : '#fff';
    ctx.fillText(name || '', x, isDowned ? y - PLAYER_RADIUS - 12 : barTop - 2);
    ctx.globalAlpha = 1;

    if (!isDowned) {
      drawHealthBar(x, barTop, PLAYER_HEALTH_BAR_WIDTH, hp / maxHp);
    }
  }

  drawProjectiles();
  drawEnemyProjectiles();
  drawMuzzleFlashes();
  drawMeleeSlashes();
  drawShieldRings();
  drawUltEffects(); // laser/shockwave digambar sebelum lighting agar bersinar menembus gelap
  drawParticles();

  // Lapisan kegelapan + cahaya radial (fog of war). Setelah entitas dunia, sebelum angka damage.
  drawLighting();

  drawDamageNumbers(); // angka tetap terbaca di atas kegelapan
  drawNukeFlash();
  ctx.restore(); // akhir getaran kamera

  drawMinimap();
  drawDamageFlash(); // vignette merah menempel di tepi layar, tidak ikut bergetar
  drawHud(); // pesan game over / downed digambar paling atas
}

// Lapisan gelap di atas dunia, dilubangi cahaya radial di sekitar pemain dan musuh shooter.
// Dibuat di canvas offscreen: isi gelap, lalu "hapus" (destination-out) lingkaran cahaya,
// lalu tempel ke canvas utama.
function drawLighting() {
  if (!dungeon) return;
  const lc = getLightCanvas();
  const lctx = lc.getContext('2d');

  // Mutator Toxic Fog: kabut hijau gelap, penglihatan jauh lebih sempit
  const fog = !!waveMutator && waveMutator.id === 'toxicFog';
  const darkness = fog ? TOXIC_FOG_DARKNESS : AMBIENT_DARKNESS;
  const lightRadius = fog ? PLAYER_LIGHT_RADIUS * TOXIC_FOG_LIGHT_SCALE : PLAYER_LIGHT_RADIUS;

  lctx.clearRect(0, 0, lc.width, lc.height);
  lctx.fillStyle = fog ? `rgba(6, 22, 8, ${darkness})` : `rgba(0, 0, 0, ${darkness})`;
  lctx.fillRect(0, 0, lc.width, lc.height);

  lctx.globalCompositeOperation = 'destination-out';
  // Cahaya pemain (lebih terang & luas)
  for (const id in renderPlayers) {
    if (renderPlayers[id].isDowned) continue;
    punchLight(lctx, renderPlayers[id].x, renderPlayers[id].y, lightRadius, 1);
  }
  // Cahaya musuh shooter (redup, menandai posisi penembak di kegelapan)
  for (const id in renderEnemies) {
    if (renderEnemies[id].type === 'shooter') {
      punchLight(lctx, renderEnemies[id].x, renderEnemies[id].y, SHOOTER_LIGHT_RADIUS, 0.85);
    }
  }
  lctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(lc, 0, 0);
}

// "Lubangi" kegelapan dengan gradien radial (tengah paling transparan)
function punchLight(lctx, x, y, radius, strength) {
  const g = lctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
  g.addColorStop(0.6, `rgba(0, 0, 0, ${strength * 0.6})`);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  lctx.fillStyle = g;
  lctx.beginPath();
  lctx.arc(x, y, radius, 0, Math.PI * 2);
  lctx.fill();
}

let lightCanvas = null;
function getLightCanvas() {
  if (!lightCanvas) {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = canvas.width;
    lightCanvas.height = canvas.height;
  }
  return lightCanvas;
}

// Busur cahaya merah (tebasan) di antara musuh dan pemain, memudar cepat
function drawMeleeSlashes() {
  for (const s of meleeSlashes) {
    const t = s.life / s.maxLife; // 1 -> 0
    const half = MELEE_SLASH_ARC / 2;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.globalAlpha = t;
    ctx.strokeStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 12;
    ctx.lineCap = 'round';

    // Dua garis busur berlapis: lebar memudar untuk kesan tebasan tajam
    ctx.lineWidth = 5 * t + 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, MELEE_SLASH_RADIUS, -half, half);
    ctx.stroke();

    ctx.globalAlpha = t * 0.6;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * t;
    ctx.beginPath();
    ctx.arc(0, 0, MELEE_SLASH_RADIUS, -half * 0.7, half * 0.7);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// Vignette merah di tepi layar saat pemain lokal kena damage
function drawDamageFlash() {
  if (damageFlash <= 0) return;
  const intensity = damageFlash / DAMAGE_FLASH_DURATION; // 1 -> 0
  const g = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.72
  );
  g.addColorStop(0, 'rgba(255, 0, 0, 0)');
  g.addColorStop(1, `rgba(200, 0, 0, ${0.55 * intensity})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Jejak halus: lingkaran warna pemain yang mengecil & memudar di posisi-posisi sebelumnya.
// Saat pemain diam, titik jejak tidak bertambah dan yang lama habis dalam TRAIL_DURATION.
function drawTrail(p) {
  if (p.trail.length < 2) return;
  ctx.fillStyle = p.color;
  // Titik terbaru (posisi sekarang) dilewati karena tertutup tubuh pemain
  for (let i = 0; i < p.trail.length - 1; i++) {
    const point = p.trail[i];
    const t = 1 - point.age / TRAIL_DURATION; // 1 = baru, 0 = hilang
    if (t <= 0) continue;
    ctx.globalAlpha = TRAIL_ALPHA * t * (p.isDowned ? 0.3 : 1);
    ctx.beginPath();
    ctx.arc(point.x, point.y, PLAYER_RADIUS * (0.35 + 0.5 * t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Item drop: lingkaran warna tipe item dengan glow berdenyut dan ikon di tengah
function drawItems() {
  const now = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(now * ITEM_PULSE_SPEED); // 0..1

  for (const item of serverItems) {
    // Piringan gelap dengan glow berdenyut berwarna tipe item, lalu ikon emoji di tengah.
    // Tiap tipe punya warna + ikon sendiri supaya mudah dibedakan sekilas.
    ctx.save();
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 8 + pulse * 14;
    ctx.beginPath();
    ctx.arc(item.x, item.y, ITEM_RADIUS + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 14, 20, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = item.color;
    ctx.stroke();
    ctx.restore();

    // Cincin luar berdenyut
    ctx.beginPath();
    ctx.arc(item.x, item.y, ITEM_RADIUS + 6 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = item.color;
    ctx.globalAlpha = 0.5 * (1 - pulse);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffffff';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ITEM_ICON[item.type] || '?', item.x, item.y + 1);
  }
}

// Ring progress revive di atas pemain downed: lingkaran latar + busur yang terisi 0..penuh
function drawReviveRing(p) {
  const progress = reviveTimeTotal > 0 ? Math.max(0, Math.min((p.reviveProgress || 0) / reviveTimeTotal, 1)) : 0;
  const cx = p.x;
  const cy = p.y - PLAYER_RADIUS - 14;

  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(cx, cy, REVIVE_RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  if (progress > 0) {
    ctx.strokeStyle = '#4cd964';
    ctx.beginPath();
    ctx.arc(cx, cy, REVIVE_RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }

  // Ikon + di tengah ring
  ctx.fillStyle = progress > 0 ? '#4cd964' : 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', cx, cy + 1);
}

// Menggambar sprite berukuran (size x size) berpusat di (0,0) setelah ctx di-translate & -rotate
function drawSpriteCentered(name, size) {
  if (!sprites.ready(name)) return false;
  ctx.drawImage(sprites.image(name), -size / 2, -size / 2, size, size);
  return true;
}

// Tubuh pemain. Jika sprite siap: moncong senjata (bentuk per class) + sprite karakter,
// keduanya berputar mengikuti arah bidik. Jika tidak: fallback bentuk lama (lingkaran + segitiga).
function drawPlayerBody(p, isLocal) {
  const style = GUN_STYLES[p.weaponClass] || DEFAULT_GUN_STYLE;
  const aim = p.aim || 0;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(aim);

  // Moncong senjata (di bawah badan, jadi pangkalnya tertutup tubuh) — tetap digambar baik
  // memakai sprite maupun fallback, karena bentuknya menandakan class senjata
  ctx.fillStyle = style.color;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(PLAYER_RADIUS * 0.3, -style.width / 2, PLAYER_RADIUS * 0.7 + style.length, style.width);
  ctx.fill();
  ctx.stroke();

  if (drawSpriteCentered('player', PLAYER_RADIUS * 2 * PLAYER_SPRITE_SCALE)) {
    // Penanda pemain lokal: cincin putih tipis mengelilingi sprite
    if (isLocal) {
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 1, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Fallback: badan bulat + penunjuk arah segitiga
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = isLocal ? '#ffffff' : 'rgba(0, 0, 0, 0.6)';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(PLAYER_RADIUS - 1, 0);
  ctx.lineTo(PLAYER_RADIUS * 0.35, -PLAYER_RADIUS * 0.4);
  ctx.lineTo(PLAYER_RADIUS * 0.35, PLAYER_RADIUS * 0.4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();

  ctx.restore();
}

// Health bar kecil; (centerX, topY) adalah titik tengah atas bar, ratio 0..1
function drawHealthBar(centerX, topY, width, ratio) {
  const barX = centerX - width / 2;
  const filled = Math.max(0, Math.min(ratio, 1));

  ctx.fillStyle = HEALTH_BAR_BG_COLOR;
  ctx.fillRect(barX, topY, width, HEALTH_BAR_HEIGHT);
  ctx.fillStyle = HEALTH_BAR_FILL_COLOR;
  ctx.fillRect(barX, topY, width * filled, HEALTH_BAR_HEIGHT);
}

function drawEnemies() {
  for (const id in renderEnemies) {
    const e = renderEnemies[id];
    const { x, y, hp, maxHp, color, radius, isBoss } = e;
    // Sprite menghadap arah gerak (dihitung dari perpindahan antar frame)
    const spriteName = isBoss ? 'boss' : e.type;
    const angle = e.faceAngle || 0;

    let drawn = false;
    if (sprites.ready(spriteName)) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(sprites.image(spriteName), -radius, -radius, radius * 2, radius * 2);
      if (isBoss) {
        // Lingkaran tepi merah agar boss tetap menonjol
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = BOSS_OUTLINE_COLOR;
        ctx.stroke();
      }
      ctx.restore();
      drawn = true;
    }

    if (!drawn) {
      // Fallback: lingkaran berwarna
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (isBoss) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = BOSS_OUTLINE_COLOR;
        ctx.stroke();
      }
    }

    if (isBoss) continue; // HP boss ada di big boss bar, bukan bar kecil

    // Lebar bar mengikuti ukuran musuh (runner kecil punya bar lebih pendek dari grunt)
    drawHealthBar(
      x,
      y - radius - HEALTH_BAR_OFFSET - HEALTH_BAR_HEIGHT,
      Math.max(ENEMY_MIN_BAR_WIDTH, radius * 2),
      hp / maxHp
    );
  }
}

// ======================================================================
// HUD HTML
// ======================================================================

// Tulis ke DOM hanya jika nilainya berubah: stateUpdate datang 50x per detik, sementara
// sebagian besar nilai HUD jarang berubah
function setText(el, value) {
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}
function setAttr(el, name, value) {
  const text = String(value);
  if (el.getAttribute(name) !== text) el.setAttribute(name, text);
}
function setBarRatio(fillEl, ratio) {
  const clamped = Math.max(0, Math.min(ratio, 1));
  const transform = `scaleX(${clamped.toFixed(3)})`;
  if (fillEl.style.transform !== transform) fillEl.style.transform = transform;
}

function updateHud() {
  const me = renderPlayers[socket.id];

  // --- Pemain (kiri atas) ---
  if (me) {
    setText(hud.playerName, me.name || '');
    setText(hud.classBadge, WEAPON_LABELS[me.weaponClass] || '');
    setAttr(hud.classBadge, 'data-class', me.weaponClass || '');
    setAttr(hud.player, 'data-dead', me.isDowned ? 'true' : 'false');

    const hp = Math.max(0, Math.ceil(me.hp));
    const ratio = me.maxHp > 0 ? me.hp / me.maxHp : 0;
    setBarRatio(hud.healthFill, ratio);
    setText(hud.healthText, `${hp} / ${me.maxHp}`);
    setAttr(hud.health, 'data-level', ratio <= HEALTH_LOW_RATIO ? 'low' : ratio <= HEALTH_MID_RATIO ? 'mid' : 'ok');
    setAttr(hud.health, 'aria-valuenow', hp);
    setAttr(hud.health, 'aria-valuemax', me.maxHp);
    setText(hud.playerStats, `DMG ${me.damage}  ·  SPD ${me.speed}  ·  ROF ${me.fireRate}ms`);

    // Gauge ultimate; "ready" saat penuh
    const ult = typeof me.ultimate === 'number' ? me.ultimate : 0;
    const ultRatio = ultimateMax > 0 ? ult / ultimateMax : 0;
    setBarRatio(hud.ultimateFill, ultRatio);
    setAttr(hud.ultimate, 'data-ready', ultRatio >= 1 ? 'true' : 'false');
    setAttr(hud.ultimate, 'aria-valuenow', Math.round(ult));
  }

  // --- Room, wave & difficulty (kanan atas) ---
  setText(hud.roomCode, roomCode);
  setText(hud.waveNumber, wave);
  setText(hud.difficulty, roomDifficultyLabel);
  setAttr(hud.difficulty, 'data-difficulty', roomDifficulty);

  // Badge mutator wave aktif (tersembunyi jika tidak ada)
  const hasMutator = !!waveMutator;
  if (hud.mutatorBox.hidden === hasMutator) hud.mutatorBox.hidden = !hasMutator;
  if (hud.mutatorDivider.hidden === hasMutator) hud.mutatorDivider.hidden = !hasMutator;
  if (hasMutator) {
    setText(hud.mutator, waveMutator.label);
    setAttr(hud.mutator, 'data-mutator', waveMutator.id);
    hud.mutatorBox.title = waveMutator.desc;
  }

  // --- Boss (tengah atas): hanya tampil saat ada boss hidup ---
  let boss = null;
  for (const id in renderEnemies) {
    if (renderEnemies[id].isBoss) { boss = renderEnemies[id]; break; }
  }
  setAttr(hud.wave, 'data-boss', boss ? 'true' : 'false');
  if (hud.boss.hidden !== !boss) hud.boss.hidden = !boss;
  if (boss) {
    const bossHp = Math.max(0, Math.ceil(boss.hp));
    setBarRatio(hud.bossFill, boss.hp / boss.maxHp);
    setText(hud.bossText, `${bossHp} / ${boss.maxHp}`);
    setAttr(hud.bossBar, 'aria-valuenow', bossHp);
    setAttr(hud.bossBar, 'aria-valuemax', boss.maxHp);
  }
}

// Salin kode room ke clipboard. navigator.clipboard butuh konteks aman (https/localhost);
// selain itu dipakai cara lama lewat textarea tersembunyi.
async function copyRoomCode() {
  if (!roomCode) return;
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(roomCode);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }
  if (!copied) {
    const area = document.createElement('textarea');
    area.value = roomCode;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
    area.remove();
  }

  hud.copyButton.textContent = copied ? 'Tersalin' : 'Gagal';
  hud.copyButton.setAttribute('data-copied', copied ? 'true' : 'false');
  hud.copyStatus.textContent = copied ? `Kode room ${roomCode} disalin` : 'Gagal menyalin kode room';
  clearTimeout(copyRoomCode.timer);
  copyRoomCode.timer = setTimeout(() => {
    hud.copyButton.textContent = 'Copy';
    hud.copyButton.removeAttribute('data-copied');
    hud.copyStatus.textContent = '';
  }, COPY_FEEDBACK_MS);
}

hud.copyButton.addEventListener('click', () => {
  copyRoomCode();
  hud.copyButton.blur(); // kembalikan fokus agar Spasi/Enter tidak memicu copy saat bermain
});

// ======================================================================
// Mini-map
// ======================================================================

// Denah dungeon skala kecil (lantai terang, dinding transparan), digambar sekali per room
function renderMinimap({ grid, cols, rows }) {
  const mini = document.createElement('canvas');
  mini.width = cols * MINIMAP_SCALE;
  mini.height = rows * MINIMAP_SCALE;
  const mctx = mini.getContext('2d');
  mctx.fillStyle = MINIMAP_FLOOR_COLOR;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] !== Dungeon.WALL) {
        mctx.fillRect(col * MINIMAP_SCALE, row * MINIMAP_SCALE, MINIMAP_SCALE, MINIMAP_SCALE);
      }
    }
  }
  return mini;
}

// Area mini-map di canvas (termasuk padding panel)
function minimapRect() {
  const w = minimapCanvas.width + MINIMAP_PADDING * 2;
  const h = minimapCanvas.height + MINIMAP_PADDING * 2;
  return { x: canvas.width - w - MINIMAP_MARGIN, y: canvas.height - h - MINIMAP_MARGIN, w, h };
}

function drawMinimap() {
  if (!minimapCanvas || !dungeon) return;
  const rect = minimapRect();
  const originX = rect.x + MINIMAP_PADDING;
  const originY = rect.y + MINIMAP_PADDING;
  const scale = MINIMAP_SCALE / Dungeon.TILE_SIZE; // dunia (px) -> mini-map (px)
  const me = renderPlayers[socket.id];

  ctx.save();
  // Pemain lokal di balik mini-map: buat transparan agar karakter tetap terlihat
  if (me && me.x >= rect.x - PLAYER_RADIUS && me.x <= rect.x + rect.w + PLAYER_RADIUS &&
      me.y >= rect.y - PLAYER_RADIUS && me.y <= rect.y + rect.h + PLAYER_RADIUS) {
    ctx.globalAlpha = MINIMAP_FADED_ALPHA;
  }

  ctx.fillStyle = MINIMAP_BG_COLOR;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = MINIMAP_BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.drawImage(minimapCanvas, originX, originY);

  const dot = (x, y, radius, color) => {
    ctx.beginPath();
    ctx.arc(originX + x * scale, originY + y * scale, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Musuh (merah); boss digambar lebih besar
  for (const id in renderEnemies) {
    const e = renderEnemies[id];
    dot(e.x, e.y, e.isBoss ? 4.5 : 2, MINIMAP_ENEMY_COLOR);
  }

  // Teman satu tim (hijau); yang sedang mati dibuat pudar
  const baseAlpha = ctx.globalAlpha;
  for (const id in renderPlayers) {
    if (id === socket.id) continue;
    const p = renderPlayers[id];
    ctx.globalAlpha = baseAlpha * (p.isDowned ? 0.4 : 1);
    dot(p.x, p.y, 3, MINIMAP_ALLY_COLOR);
  }
  ctx.globalAlpha = baseAlpha;

  // Diri sendiri (kuning), paling atas & bergaris tepi agar mudah ditemukan
  if (me) {
    dot(me.x, me.y, 3.5, MINIMAP_SELF_COLOR);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  ctx.restore();
}

function drawEnemyProjectiles() {
  const now = performance.now();

  ctx.save();
  ctx.shadowColor = ENEMY_PROJECTILE_COLOR;
  ctx.shadowBlur = ENEMY_PROJECTILE_GLOW;
  ctx.fillStyle = ENEMY_PROJECTILE_COLOR;

  for (const p of serverEnemyProjectiles) {
    // Perkirakan posisi sejak snapshot terakhir agar gerak peluru mulus antar tick
    const elapsed = Math.min((now - p.receivedAt) / 1000, MAX_PROJECTILE_EXTRAPOLATION);
    ctx.beginPath();
    ctx.arc(p.x + p.vx * elapsed, p.y + p.vy * elapsed, p.radius || DEFAULT_PROJECTILE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Info wave dan stat pemain lokal di pojok kiri atas, plus pesan status di tengah
// Info pemain/room/wave/boss kini ada di HUD HTML (lihat updateHud). Canvas hanya menggambar
// pesan status besar di tengah: layar game over dan pesan saat pemain mati.
function drawHud() {
  const me = renderPlayers[socket.id];

  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  // Layar GAME_OVER kini berupa modal HTML (lihat updateGameOverOverlay). Canvas hanya
  // menampilkan pesan singkat saat pemain downed tapi game belum berakhir.
  if (waveState !== 'GAME_OVER' && me && me.isDowned) {
    ctx.fillStyle = '#ff8888';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Kamu mati. Hidup lagi di wave berikutnya.', canvas.width / 2, canvas.height - 40);
  }
}

function drawProjectiles() {
  const now = performance.now();

  for (const p of serverProjectiles) {
    const style = PROJECTILE_STYLES[p.type] || DEFAULT_PROJECTILE_STYLE;
    const radius = p.radius || DEFAULT_PROJECTILE_RADIUS;

    // Perkirakan posisi sejak snapshot terakhir agar gerak peluru mulus antar tick
    const elapsed = Math.min((now - p.receivedAt) / 1000, MAX_PROJECTILE_EXTRAPOLATION);
    const x = p.x + p.vx * elapsed;
    const y = p.y + p.vy * elapsed;

    ctx.save();
    if (style.glow > 0) {
      ctx.shadowColor = style.color;
      ctx.shadowBlur = style.glow;
    }

    // Garis jejak di belakang peluru (arah berlawanan dengan kecepatan)
    if (style.trail > 0) {
      const speed = Math.hypot(p.vx, p.vy) || 1;
      ctx.beginPath();
      ctx.moveTo(x - (p.vx / speed) * style.trail, y - (p.vy / speed) * style.trail);
      ctx.lineTo(x, y);
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = radius;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Sprite peluru jika siap, selain itu lingkaran berwarna (fallback). Sprite diberi warna
    // senjata lewat glow di atasnya; bentuk dasar tetap dari sprite bullet.
    if (sprites.ready('bullet')) {
      const size = radius * BULLET_SPRITE_SIZE_FACTOR;
      ctx.drawImage(sprites.image('bullet'), x - size / 2, y - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
    }
    ctx.restore();
  }
}

// Loop render: berjalan setiap frame, terpisah dari tick server
let lastFrame = performance.now();

function frame(now) {
  // Batasi dt agar tidak loncat saat tab tersembunyi lalu aktif kembali
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  update(dt);
  draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// --- Input keyboard (WASD) ---
const keys = { w: false, a: false, s: false, d: false };
let lastInput = { dx: 0, dy: 0 };

// Pakai event.code (posisi fisik tombol), bukan event.key: nilai key bisa berbeda antara
// keydown dan keyup (Shift, Alt/AltGr, ganti layout), sehingga keyup tidak cocok dan
// tombol terasa "menyangkut".
const KEY_CODES = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

// Server menganggap input basi jika tidak ada kabar baru; selama tombol ditahan,
// input dikirim ulang berkala (heartbeat). Harus jauh lebih kecil dari INPUT_TIMEOUT_MS server.
const INPUT_HEARTBEAT_MS = 100;

// Kirim arah gerak ke server. Secara default hanya dikirim jika arah berubah;
// force = true selalu mengirim (dipakai untuk reset dan heartbeat).
function sendInput(force = false) {
  const dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);

  const changed = dx !== lastInput.dx || dy !== lastInput.dy;
  lastInput = { dx, dy };

  // Saat terputus tidak ada yang dikirim (supaya tidak menumpuk di buffer dan terkirim
  // basi setelah tersambung lagi); keadaan terkini dikirim ulang saat 'connect'.
  if ((changed || force) && socket.connected) {
    socket.emit('playerInput', lastInput);
  }
}

// Lepaskan semua tombol dan paksa kirim { dx: 0, dy: 0 } ke server
function resetKeys() {
  for (const key in keys) keys[key] = false;
  sendInput(true);
}

// Apakah fokus keyboard sedang ada di kolom teks (nama, kode room, dll.)
function isTypingTarget(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

window.addEventListener('keydown', (event) => {
  // Spacebar: picu ultimate (hanya di dalam room, bukan saat mengetik). Server memvalidasi
  // gauge penuh; client cukup mengirim arah bidik terkini.
  if (event.code === 'Space' && inRoom && !isTypingTarget(event.target)) {
    event.preventDefault(); // cegah scroll halaman
    const me = renderPlayers[socket.id];
    if (me && !me.isDowned) socket.emit('ultimate', { angle: me.aim || 0 });
    return;
  }

  const key = KEY_CODES[event.code];
  // Abaikan saat masih di lobby atau saat mengetik di kolom teks: W/A/S/D di sana adalah
  // huruf biasa (nama, kode room), bukan perintah gerak.
  if (key && inRoom && !isTypingTarget(event.target)) {
    keys[key] = true;
    sendInput();
  }
});

window.addEventListener('keyup', (event) => {
  const key = KEY_CODES[event.code];
  if (key) {
    keys[key] = false;
    sendInput();
  }
});

// Keyup tidak akan diterima saat jendela/halaman kehilangan perhatian pengguna,
// jadi semua tombol dianggap dilepas.
window.addEventListener('blur', resetKeys);
// Saat jendela kembali aktif mulai dari keadaan bersih: keyup yang terjadi selama jendela
// tidak fokus tidak pernah diterima, jadi status tombol lama tidak boleh dipercaya.
window.addEventListener('focus', resetKeys);
// Berpindah fokus ke kolom teks juga membersihkan tombol yang masih tercatat ditahan
document.addEventListener('focusin', (event) => {
  if (isTypingTarget(event.target)) resetKeys();
});
document.documentElement.addEventListener('mouseleave', resetKeys);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetKeys();
});
// Menu klik kanan menelan keyup tombol yang sedang ditahan
window.addEventListener('contextmenu', resetKeys);

// Heartbeat: selama ada tombol yang ditahan, kirim ulang arah agar server tahu
// pemain masih mengendalikan (lihat INPUT_TIMEOUT_MS di server)
setInterval(() => {
  if (lastInput.dx !== 0 || lastInput.dy !== 0) sendInput(true);
}, INPUT_HEARTBEAT_MS);

// --- Mouse: bidik dan tembak ---
// seen = kursor sudah pernah bergerak di canvas (sebelum itu arah bidik dibiarkan apa adanya)
const mouse = { x: 0, y: 0, seen: false };

// Ubah koordinat mouse di layar ke koordinat canvas (memperhitungkan skala CSS)
function updateMouse(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (event.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (event.clientY - rect.top) * (canvas.height / rect.height);
  mouse.seen = true;
}

canvas.addEventListener('mousemove', updateMouse);

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return; // hanya klik kiri
  updateMouse(event);

  const me = renderPlayers[socket.id];
  if (!inRoom || !me || me.isDowned) return;

  // Sudut dari pemain ke kursor (radian)
  const angle = Math.atan2(mouse.y - me.y, mouse.x - me.x);
  socket.emit('shoot', { angle });
});

// ======================================================================
// Partikel bara/debu di layar lobby (dark fantasy). Loop mandiri yang hanya aktif
// saat lobby terlihat; tidak terkait dengan loop render game.
// ======================================================================
(function setupLobbyEmbers() {
  const emberCanvas = document.getElementById('emberCanvas');
  if (!emberCanvas) return;
  const ectx = emberCanvas.getContext('2d');
  let embers = [];
  let lastT = performance.now();

  function resize() {
    emberCanvas.width = emberCanvas.clientWidth || window.innerWidth;
    emberCanvas.height = emberCanvas.clientHeight || window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnEmber() {
    const w = emberCanvas.width, h = emberCanvas.height;
    return {
      x: Math.random() * w,
      y: h + Math.random() * 40,
      vx: (Math.random() - 0.5) * 12, // sedikit melayang menyamping
      vy: -(8 + Math.random() * 22), // naik perlahan
      size: 1 + Math.random() * 2.2,
      life: 4 + Math.random() * 5,
      maxLife: 0,
      hue: 20 + Math.random() * 25, // oranye-merah bara
    };
  }

  const MAX_EMBERS = 70;

  function frameEmbers(now) {
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;

    // Hanya jalan & gambar saat lobby terlihat (hemat saat dalam game)
    if (!lobbyEl || lobbyEl.hidden) {
      embers.length = 0;
      ectx.clearRect(0, 0, emberCanvas.width, emberCanvas.height);
      requestAnimationFrame(frameEmbers);
      return;
    }

    // Isi ulang populasi bara
    while (embers.length < MAX_EMBERS) {
      const e = spawnEmber();
      e.maxLife = e.life;
      // Sebar posisi awal agar tidak muncul serempak di frame pertama
      e.y = Math.random() * emberCanvas.height;
      embers.push(e);
    }

    ectx.clearRect(0, 0, emberCanvas.width, emberCanvas.height);
    ectx.globalCompositeOperation = 'lighter';
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.life -= dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy *= Math.pow(0.6, dt); // sedikit melambat saat naik
      if (e.life <= 0 || e.y < -10) { embers.splice(i, 1); continue; }

      const t = e.life / e.maxLife; // 1 -> 0
      const alpha = Math.min(1, t * 1.4) * 0.8;
      ectx.beginPath();
      ectx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ectx.fillStyle = `hsla(${e.hue}, 90%, 60%, ${alpha})`;
      ectx.shadowColor = `hsla(${e.hue}, 90%, 55%, ${alpha})`;
      ectx.shadowBlur = 8;
      ectx.fill();
    }
    ectx.globalCompositeOperation = 'source-over';
    ectx.shadowBlur = 0;
    requestAnimationFrame(frameEmbers);
  }
  requestAnimationFrame(frameEmbers);
})();
