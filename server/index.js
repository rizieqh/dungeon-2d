const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
// Generator dan collision dipakai bersama client agar hasilnya identik
const Dungeon = require('../public/dungeon.js');

const app = express();
const server = http.createServer(app);
// Izinkan koneksi Socket.io dari origin mana pun (game bisa diakses dari domain/IP apa pun)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;

// Sajikan folder public (client) secara statis
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check untuk platform cloud (Render/Railway) memverifikasi server hidup
app.get('/healthz', (req, res) => res.status(200).send('ok'));

const TICK_MS = 20;
const MAX_DT = 0.1; // batas delta time agar tidak "loncat" saat server tersendat
const PLAYER_RADIUS = 15; // juga setengah sisi hitbox AABB pemain

// --- Room / lobby ---
// Karakter kode room: tanpa 0/O dan 1/I agar tidak membingungkan saat dibaca
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const MAX_PLAYERS_PER_ROOM = 4;
const MAX_ROOMS = 50;
const MAX_NAME_LENGTH = 16;

// Semua room aktif, diindeks dengan kode room (misalnya 'A7B2')
const rooms = {};
// socket.id -> kode room tempat pemain berada
const socketRooms = {};

// Stat dasar pemain (sama untuk semua class).
// speed dalam piksel per tick (3 x 50 tick = 150 px/s)
const PLAYER_BASE_STATS = { hp: 10, maxHp: 10, speed: 3 };
const MAX_PLAYER_SPEED = 8; // batas agar pemain tidak "melompati" dinding tipis
const MIN_FIRE_RATE = 80; // batas jeda tembak (ms) setelah upgrade

// --- Class senjata ---
// fireRate = jeda antar tembakan (ms) dan damage = per peluru: stat awal class (bisa di-upgrade).
// projectileSpeed dalam piksel per tick (10 x 50 tick = 500 px/s), seperti speed pemain/musuh.
// spreadAngles = sudut tiap peluru terhadap bidikan (derajat). radius = ukuran & hitbox peluru.
// piercing = tembus musuh (tiap musuh terkena sekali); piercesWalls = juga tembus dinding.
const WEAPONS = {
  assault: {
    fireRate: 150,
    damage: 1,
    projectileSpeed: 10,
    spreadAngles: [0],
    radius: 4,
    piercing: false,
    piercesWalls: false,
  },
  shotgun: {
    fireRate: 600,
    damage: 1,
    projectileSpeed: 8,
    spreadAngles: [-15, -7.5, 0, 7.5, 15],
    radius: 3,
    piercing: false,
    piercesWalls: false,
  },
  sniper: {
    fireRate: 1000,
    damage: 4,
    projectileSpeed: 18,
    spreadAngles: [0],
    radius: 5,
    piercing: true,
    piercesWalls: true,
  },
};
const DEFAULT_WEAPON_CLASS = 'assault';

// Class dari client dipercaya hanya jika terdaftar; selain itu pakai default
const sanitizeWeaponClass = (value) =>
  typeof value === 'string' && Object.hasOwn(WEAPONS, value) ? value : DEFAULT_WEAPON_CLASS;
const INVULNERABILITY_MS = 1000; // kebal sesaat setelah terkena musuh

// --- Revive ---
const REVIVE_TIME_S = 3; // lama berdiri dekat teman downed untuk membangunkannya
const REVIVE_RADIUS = 45; // jarak maksimal penyelamat ke pemain downed (px)
const REVIVE_HP_FRACTION = 0.5; // HP yang dipulihkan saat revive (50% dari maxHp)

// --- Wave Mutator: tantangan acak tiap naik wave (mulai wave 2) ---
// hpMul/speedMul dikalikan ke stat musuh saat spawn. Mutator 'toxicFog' tidak mengubah musuh;
// efeknya (penglihatan menyempit) digambar client dari id mutator.
const MUTATOR_START_WAVE = 2;
const WAVE_MUTATORS = {
  toxicFog: { label: 'Toxic Fog', desc: 'Kabut beracun menyempitkan penglihatanmu', hpMul: 1, speedMul: 1 },
  frenzy: { label: 'Frenzy', desc: 'Musuh bergerak 25% lebih cepat', hpMul: 1, speedMul: 1.25 },
  armored: { label: 'Armored', desc: 'Musuh mendapat 50% HP tambahan', hpMul: 1.5, speedMul: 1 },
};
// Pengali mutator aktif untuk satu room (1 jika tidak ada mutator)
const mutatorMultipliers = (room) => WAVE_MUTATORS[room.mutator] || { hpMul: 1, speedMul: 1 };

// --- Tingkat kesulitan ---
// Skala dikalikan ke stat musuh saat spawn. dropMul menyesuaikan peluang item (makin sulit,
// makin jarang drop). label dipakai client untuk badge HUD.
const DIFFICULTIES = {
  easy: { label: 'Easy', hp: 0.7, damage: 1, speed: 0.85, dropMul: 1.5 },
  medium: { label: 'Medium', hp: 1, damage: 1, speed: 1, dropMul: 1 },
  hard: { label: 'Hard', hp: 1.5, damage: 2, speed: 1.15, dropMul: 0.7 },
  impossible: { label: 'Impossible', hp: 2.5, damage: 3, speed: 1.35, dropMul: 0.4 },
};
const DEFAULT_DIFFICULTY = 'medium';
const sanitizeDifficulty = (value) =>
  typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value) ? value : DEFAULT_DIFFICULTY;

// --- Item drop ---
const ITEM_DROP_CHANCE = 0.15; // peluang dasar musuh biasa menjatuhkan item (medium)
const BOSS_ITEM_DROPS = 3; // boss selalu menjatuhkan beberapa item
const ITEM_RADIUS = 10; // setengah sisi hitbox pickup
const ITEM_LIFETIME_S = 15; // item hilang jika tidak diambil
const MEDKIT_HEAL = 3; // HP yang dipulihkan medkit
const DOUBLE_DAMAGE_DURATION_S = 5;
const DOUBLE_DAMAGE_MULTIPLIER = 2;
// type: efek saat diambil. Bobot menentukan kemunculan relatif.
//  canPickup(p): item hanya terambil jika true (tetap di lantai jika tidak, mis. medkit saat HP penuh)
//  apply(p, room): menerapkan efek; boleh mengembalikan { heal } untuk umpan balik di client
const ITEM_TYPES = {
  medkit: {
    weight: 5, color: '#4cd964',
    canPickup: (p) => p.hp < p.maxHp,
    apply: (p) => {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, round2(p.hp + MEDKIT_HEAL));
      return { heal: round2(p.hp - before) }; // jumlah HP yang benar-benar bertambah
    },
  },
  shield: {
    weight: 3, color: '#9a8cff',
    canPickup: (p) => !p.shield, // sudah punya shield: jangan terbuang
    apply: (p) => { p.shield = true; },
  },
  nuke: {
    weight: 1, color: '#ff4d4d',
    apply: (p, room) => ({ killed: nukeEnemies(room, p) }),
  },
  doubleDamage: {
    weight: 2, color: '#ffcf33',
    apply: (p) => { p.damageBoostUntil = Date.now() + DOUBLE_DAMAGE_DURATION_S * 1000; },
  },
  speed: { weight: 2, color: '#56b4ff', apply: (p) => { p.speed = Math.min(p.speed + 1, MAX_PLAYER_SPEED); } },
  damage: { weight: 1, color: '#ff9d3d', apply: (p) => { p.damage = round2(p.damage + 1); } },
};
const ITEM_TYPE_TOTAL_WEIGHT = Object.values(ITEM_TYPES).reduce((s, t) => s + t.weight, 0);
// Jika tidak ada input baru selama ini, gerakan pemain di-reset ke nol. Client mengirim
// ulang input tiap 100 ms selama tombol ditahan, jadi 500 ms berarti 5 kiriman terlewat.
const INPUT_TIMEOUT_MS = 500;
const INPUT_DEADZONE = 0.01; // |dx| dan |dy| di bawah ini dianggap tidak ada input

const round2 = (value) => Math.round(value * 100) / 100;
// Stat pemain = stat dasar + stat awal senjata dari class yang dipilih
const createPlayerStats = (weaponClass) => ({
  ...PLAYER_BASE_STATS,
  weaponClass,
  fireRate: WEAPONS[weaponClass].fireRate,
  damage: WEAPONS[weaponClass].damage,
  isDowned: false, // HP habis: berlutut, tidak bisa gerak/tembak, bisa di-revive teman
  reviveProgress: 0, // 0..REVIVE_TIME_S, kemajuan revive oleh pemain lain
  ultimate: 0, // 0..ULTIMATE_MAX, energi jurus pamungkas
  shield: false, // melindungi dari 1 serangan berikutnya
  damageBoostUntil: 0, // Date.now() sampai kapan damage ganda aktif (tidak dipakai client)
  damageBoostLeft: 0, // sisa detik damage ganda (untuk indikator aura di client)
});

const PROJECTILE_LIFETIME = 1; // detik

// --- Critical hit ---
const CRIT_CHANCE = 0.15; // peluang peluru pemain menjadi critical
const CRIT_MULTIPLIER = 2; // damage dikali ini saat crit

// --- Ultimate (jurus pamungkas, Spacebar) ---
const ULTIMATE_MAX = 100;
const ULTIMATE_PER_SHOT = 4; // energi per tembakan
const ULTIMATE_PER_KILL = 12; // energi per musuh terbunuh
const ULTIMATE_PER_BOSS_HIT = 2; // energi per peluru yang mengenai boss (boss butuh banyak peluru)
// Parameter efek ultimate per class
const ULT_ASSAULT_BULLETS = 36; // peluru 360 derajat
const ULT_ASSAULT_DAMAGE = 2;
const ULT_SHOTGUN_RADIUS = 220; // radius shockwave
const ULT_SHOTGUN_KNOCKBACK = 180; // px dorongan
const ULT_SHOTGUN_STUN_S = 1.5;
const ULT_SHOTGUN_DAMAGE = 3;
const ULT_SNIPER_WIDTH = 26; // setengah lebar laser (hitbox)
const ULT_SNIPER_DAMAGE = 12;
const ULT_SNIPER_LENGTH = 2000; // panjang laser (menembus dinding)

const MAX_ENEMIES = 10;
const ENEMY_SPAWN_MIN_S = 3;
const ENEMY_SPAWN_MAX_S = 5;
const ENEMY_MIN_SPAWN_DISTANCE = 150; // jarak minimal spawn dari pemain mana pun
const TICKS_PER_SECOND = 1000 / TICK_MS;

// --- Tipe musuh biasa ---
// hp di sini adalah nilai dasar di wave 1 (naik per wave, lihat ENEMY_HP_GROWTH_PER_WAVE).
// speed dalam piksel per tick, sama seperti pemain, dan tidak berubah antar wave.
// weight = bobot probabilitas spawn relatif terhadap tipe lain.
// radius = ukuran tubuh (kena peluru, menyentuh pemain, digambar). wallRadius = ukuran hitbox
// terhadap dinding dan navigasi; sama dengan radius kecuali disebut lain.
const ENEMY_TYPES = {
  grunt: { hp: 3, speed: 2, radius: 15, color: '#ff4444', behavior: 'melee', weight: 5, contactDamage: 1 },
  runner: { hp: 1, speed: 3.5, radius: 10, color: '#ffff44', behavior: 'melee', weight: 3, contactDamage: 1 },
  shooter: {
    hp: 2, speed: 1, radius: 14, color: '#aa44ff', behavior: 'ranged', weight: 2, contactDamage: 1,
    rangedStopDistance: 200, // berhenti mengejar begitu pemain sejauh ini atau lebih dekat
    fireIntervalS: 2,
  },
};
for (const type of Object.values(ENEMY_TYPES)) type.wallRadius = type.radius;
const ENEMY_TYPE_TOTAL_WEIGHT = Object.values(ENEMY_TYPES).reduce((sum, t) => sum + t.weight, 0);

// --- Boss ---
// Tubuh boss besar (radius 40 = 80px) tapi koridor dungeon hanya selebar 60px. Hitbox terhadap
// dinding dibuat lebih kecil (wallRadius) agar boss bisa mengejar pemain lewat koridor, bukan
// terkurung di ruangan tempat ia muncul. Konsekuensinya sebagian tubuh boss bisa terlihat
// menembus dinding saat melewati koridor.
const BOSS_WAVE_INTERVAL = 5; // boss muncul di wave 5, 10, 15, ...
const BOSS_TYPE = {
  radius: 40, wallRadius: 18, color: '#880000', behavior: 'melee', contactDamage: 1,
  hp: (wave) => 50 + wave * 10,
  speed: 1.2,
};

// Semua nilai wallRadius yang dipakai; peta tile yang bisa dilewati dibuat satu per radius
const ENEMY_WALL_RADII = [
  ...new Set([...Object.values(ENEMY_TYPES).map((t) => t.wallRadius), BOSS_TYPE.wallRadius]),
];

// --- Peluru musuh (dipakai tipe 'shooter') ---
const ENEMY_PROJECTILE_SPEED = 6; // piksel per tick (6 x 50 tick = 300 px/s)
const ENEMY_PROJECTILE_DAMAGE = 1;
const ENEMY_PROJECTILE_RADIUS = 4;
const ENEMY_PROJECTILE_LIFETIME = 3; // detik

// --- Wave ---
const WAVE_BASE_ENEMIES = 5; // jumlah musuh di wave 1
const WAVE_ENEMY_INCREMENT = 2; // tambahan musuh tiap wave
// HP musuh biasa naik proporsional tiap wave: hp = hpDasar * (1 + (wave - 1) * ini).
// 1/3 membuat grunt (HP dasar 3) tetap naik +1 HP per wave seperti sebelumnya, sementara
// runner (HP 1) tetap jauh lebih rapuh dari grunt di wave tinggi. Speed tidak berubah.
const ENEMY_HP_GROWTH_PER_WAVE = 1 / 3;

// Pool upgrade roguelite; 3 dipilih acak tiap wave clear.
// icon & desc dipakai client untuk kartu bergaya RPG (lihat showUpgrades).
const UPGRADES = [
  {
    id: 'speed',
    label: 'Kecepatan',
    icon: '⚡',
    desc: '+1 Kecepatan gerak',
    apply: (p) => { p.speed = Math.min(p.speed + 1, MAX_PLAYER_SPEED); },
  },
  {
    id: 'damage',
    label: 'Kekuatan',
    icon: '🗡️',
    desc: '+1 Damage per peluru',
    apply: (p) => { p.damage = round2(p.damage + 1); },
  },
  {
    id: 'maxHp',
    label: 'Vitalitas',
    icon: '❤️',
    desc: '+3 Max HP (langsung terisi)',
    apply: (p) => { p.maxHp += 3; p.hp += 3; },
  },
  {
    id: 'fireRate',
    label: 'Kecepatan Tembak',
    icon: '🎯',
    // Persentase, bukan nilai tetap, karena jeda awal tiap class sangat berbeda (150-1000 ms)
    desc: 'Tembak 15% lebih cepat',
    apply: (p) => { p.fireRate = Math.max(MIN_FIRE_RATE, Math.round(p.fireRate * 0.85)); },
  },
  {
    id: 'heal',
    label: 'Pemulihan',
    icon: '✚',
    desc: 'Pulihkan 5 HP sekarang',
    apply: (p) => { p.hp = Math.min(p.maxHp, p.hp + 5); },
  },
];

// Tingkat kelangkaan kartu (kosmetik). Bobot menentukan kemunculan: Common paling sering.
const RARITIES = [
  { id: 'common', weight: 55 },
  { id: 'rare', weight: 28 },
  { id: 'epic', weight: 13 },
  { id: 'legendary', weight: 4 },
];
const RARITY_TOTAL_WEIGHT = RARITIES.reduce((s, r) => s + r.weight, 0);

function randomRarity() {
  let roll = Math.random() * RARITY_TOTAL_WEIGHT;
  for (const r of RARITIES) {
    roll -= r.weight;
    if (roll < 0) return r.id;
  }
  return 'common';
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// Pastikan nilai sumbu berupa angka valid dalam rentang -1 sampai 1
const sanitizeAxis = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, -1, 1) : 0;

// Sudut ke rentang (-PI, PI]
const normalizeAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomColor = () =>
  '#' + randomInt(0, 0xffffff).toString(16).padStart(6, '0');

// Tabrakan AABB antara dua kotak berpusat di (ax, ay) dan (bx, by)
function overlapsAABB(ax, ay, aHalf, bx, by, bHalf) {
  return Math.abs(ax - bx) < aHalf + bHalf && Math.abs(ay - by) < aHalf + bHalf;
}

// Catat kejadian visual/audio untuk client. Tipe:
//   shoot     { weapon, ownerId, x, y, angle }   - pemain menembak (satu per tembakan, bukan per peluru)
//   hit       { x, y, color, damage }            - peluru pemain mengenai musuh yang masih hidup
//   kill      { x, y, color, radius, isBoss, damage } - musuh hancur
//   wallHit   { x, y, projectileType }           - peluru (pemain/'enemy') menabrak dinding
//   playerHit { playerId, x, y }                 - pemain terkena damage
//   meleeAttack { ex, ey, px, py, color }        - musuh melee menebas pemain (busur dari musuh ke pemain)
//   downed    { playerId, x, y }                 - pemain jatuh (HP habis)
//   revived   { playerId, x, y }                 - pemain dibangunkan kembali
//   pickup    { itemType, playerId, x, y, color } - pemain mengambil item
//   shieldBreak { playerId, x, y }                - shield pemain menyerap 1 serangan
//   nuke      { x, y }                            - item Nuke meledakkan semua musuh non-boss
//   pickup    juga membawa heal (HP yang benar-benar pulih, untuk medkit)
//   ultimate  { weapon, ownerId, x, y }           - pemain memicu jurus pamungkas
//   ultShockwave { x, y, radius }                 - efek area shockwave (Shotgun)
//   ultBeam   { x, y, angle, length }             - laser raksasa (Sniper)
const MAX_EVENTS_PER_TICK = 100; // batas aman payload
function pushEvent(room, event) {
  if (room.events.length < MAX_EVENTS_PER_TICK) {
    // Koordinat dibulatkan agar payload ringkas
    if (typeof event.x === 'number') event.x = Math.round(event.x);
    if (typeof event.y === 'number') event.y = Math.round(event.y);
    room.events.push(event);
  }
}

function randomSpawnDelay() {
  return ENEMY_SPAWN_MIN_S + Math.random() * (ENEMY_SPAWN_MAX_S - ENEMY_SPAWN_MIN_S);
}

// ======================================================================
// Pembuatan room
// ======================================================================

// Kode room acak 4 karakter yang belum dipakai
function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    }
  } while (Object.hasOwn(rooms, code));
  return code;
}

// Membuat room baru beserta seluruh state permainannya. Semua data yang dulu global
// (players, enemies, projectiles, dungeonSeed, waveState, ...) tinggal di sini.
function createRoom(code, difficulty = DEFAULT_DIFFICULTY) {
  const dungeonSeed = crypto.randomBytes(8).toString('hex');
  const dungeon = Dungeon.generate(dungeonSeed);

  // Semua tile lantai (tile 0), untuk lokasi spawn musuh
  const floorTiles = [];
  for (let row = 0; row < dungeon.rows; row++) {
    for (let col = 0; col < dungeon.cols; col++) {
      if (dungeon.grid[row][col] === Dungeon.FLOOR) floorTiles.push({ col, row });
    }
  }

  // Tile yang bisa dilewati musuh, satu peta per wallRadius: hitbox musuh yang berpusat di
  // tile itu tidak menyentuh dinding. enemyWalkable[radius][row][col] = true/false.
  const enemyWalkable = {};
  for (const radius of ENEMY_WALL_RADII) {
    enemyWalkable[radius] = dungeon.grid.map((rowTiles, row) =>
      rowTiles.map((_, col) =>
        !Dungeon.collidesWithWall(
          dungeon.grid,
          (col + 0.5) * Dungeon.TILE_SIZE,
          (row + 0.5) * Dungeon.TILE_SIZE,
          radius
        )
      )
    );
  }

  const room = {
    code,
    difficulty,
    difficultyScale: DIFFICULTIES[difficulty],
    dungeonSeed,
    dungeon,
    floorTiles,
    enemyWalkable,

    players: {},
    // Arah input terakhir tiap pemain, dipisah agar tidak ikut ter-broadcast
    inputs: {},
    // Waktu (Date.now) input gerak terakhir diterima dari tiap pemain
    lastInputAt: {},
    // Batas waktu kebal (Date.now) tiap pemain setelah terkena musuh
    invulnerableUntil: {},
    // Waktu tembakan terakhir tiap pemain (untuk cooldown)
    lastShotAt: {},

    // Peluru pemain: { id, ownerId, type, x, y, vx, vy, damage, radius, lifetime }
    projectiles: [],
    nextProjectileId: 1,
    // Kejadian sesaat selama tick ini (tembakan, kena, hancur, ...) untuk SFX & partikel di
    // client. Dikirim bersama stateUpdate lalu dikosongkan. Lihat pushEvent().
    events: [],

    // Peluru musuh (dari tipe 'shooter'): { id, x, y, vx, vy, damage, lifetime }
    enemyProjectiles: [],
    nextEnemyProjectileId: 1,
    // Item drop di lantai: { id, type, x, y, color, lifetime }
    items: [],
    nextItemId: 1,
    // Musuh: { id, type, x, y, hp, maxHp, speed, radius, wallRadius, color, behavior,
    //          contactDamage, isBoss, fireTimer }
    enemies: [],
    nextEnemyId: 1,

    wave: 1,
    waveState: 'IN_PROGRESS', // 'IN_PROGRESS' | 'WAVE_CLEAR' | 'GAME_OVER'
    waveEnemiesTotal: 0, // jumlah musuh biasa yang harus dimunculkan di wave ini (boss dihitung terpisah)
    waveEnemiesSpawned: 0,
    isBossWave: false,
    bossSpawned: false,
    gameOverAt: 0,
    spawnTimer: randomSpawnDelay(), // hitung mundur spawn berikutnya (detik)

    // Pilihan upgrade untuk wave ini, dan pemain yang belum memilih
    currentChoices: [],
    pendingUpgrades: new Set(),
  };

  rooms[code] = room;
  startWave(room, 1);
  console.log(`Room ${code} dibuat (seed ${dungeonSeed}, ${dungeon.rooms.length} ruangan, difficulty ${difficulty})`);
  return room;
}

// Nama pemain: buang karakter kontrol, rapikan spasi, batasi panjang
function sanitizeName(raw) {
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
    : '';
  return name || `Pemain${randomInt(100, 999)}`;
}

// Posisi spawn: titik acak di dalam salah satu ruangan dungeon (selalu lantai, bukan dinding)
function randomSpawnPoint(room) {
  const area = room.dungeon.rooms[randomInt(0, room.dungeon.rooms.length - 1)];
  // Sisakan 1 tile dari tepi ruangan agar hitbox tidak menyentuh dinding
  const col = randomInt(area.x + 1, area.x + area.w - 2);
  const row = randomInt(area.y + 1, area.y + area.h - 2);
  return {
    x: (col + 0.5) * Dungeon.TILE_SIZE,
    y: (row + 0.5) * Dungeon.TILE_SIZE,
  };
}

function addPlayerToRoom(socket, room, name, weaponClass) {
  const spawn = randomSpawnPoint(room);
  room.players[socket.id] = {
    id: socket.id,
    name,
    x: spawn.x,
    y: spawn.y,
    color: randomColor(),
    aimAngle: 0, // radian, arah moncong senjata (kosmetik, dari event 'aim' / 'shoot')
    ...createPlayerStats(weaponClass),
  };
  // Pemain baru selalu mulai diam, apa pun input yang pernah dikirim sebelumnya
  room.inputs[socket.id] = { dx: 0, dy: 0 };
  room.lastInputAt[socket.id] = Date.now();

  socketRooms[socket.id] = room.code;
  socket.join(room.code);

  // Kirim seed agar client membangun dungeon yang sama persis; ini juga tanda berhasil masuk
  socket.emit('initGame', {
    dungeonSeed: room.dungeonSeed, roomCode: room.code, name,
    difficulty: room.difficulty, difficultyLabel: room.difficultyScale.label,
    ultimateMax: ULTIMATE_MAX,
  });
  console.log(`${name} (${socket.id}) masuk room ${room.code} sebagai ${weaponClass}`);

  // Pemain yang bergabung saat fase upgrade ikut memilih
  if (room.waveState === 'WAVE_CLEAR') {
    room.pendingUpgrades.add(socket.id);
    sendUpgrades(room, socket.id);
  }
}

function removePlayerFromRoom(socketId) {
  const code = socketRooms[socketId];
  if (!code) return;
  delete socketRooms[socketId];

  const room = rooms[code];
  if (!room) return;

  console.log(`${room.players[socketId]?.name ?? socketId} keluar dari room ${code}`);
  delete room.players[socketId];
  delete room.inputs[socketId];
  delete room.lastInputAt[socketId];
  delete room.lastShotAt[socketId];
  delete room.invulnerableUntil[socketId];
  room.pendingUpgrades.delete(socketId);

  if (Object.keys(room.players).length === 0) {
    delete rooms[code]; // room kosong dihapus
    console.log(`Room ${code} dihapus (kosong)`);
  } else {
    checkUpgradesComplete(room); // pemain terakhir yang ditunggu mungkin baru saja keluar
  }
}

const getRoomOf = (socketId) => {
  const code = socketRooms[socketId];
  return code ? rooms[code] : undefined;
};

// ======================================================================
// Logika permainan (semuanya bekerja pada satu room)
// ======================================================================

// Menggerakkan pemain dengan tabrakan AABB: kotak pemain (2 x PLAYER_RADIUS) dicek
// terhadap tile dinding (bernilai 1). Jika menabrak, posisi dirapatkan ke tepi dinding.
function movePlayer(room, player, moveX, moveY) {
  const next = Dungeon.slideMove(
    room.dungeon.grid, player.x, player.y, moveX, moveY, PLAYER_RADIUS
  );
  player.x = next.x;
  player.y = next.y;
}

// Pemain yang masih aktif (belum downed): bisa bergerak, menembak, dikejar musuh, me-revive
const getAlivePlayers = (room) => Object.values(room.players).filter((p) => !p.isDowned);

// Pilih satu tipe musuh biasa secara acak sesuai bobot (grunt paling sering, shooter paling jarang)
function pickRandomEnemyType() {
  let roll = Math.random() * ENEMY_TYPE_TOTAL_WEIGHT;
  for (const [key, type] of Object.entries(ENEMY_TYPES)) {
    roll -= type.weight;
    if (roll < 0) return key;
  }
  return 'grunt'; // fallback, seharusnya tidak pernah tercapai
}

// Posisi spawn acak di tile lantai yang kosong: hitbox dinding tidak menyentuh dinding, tubuh
// tidak menimpa musuh lain, dan tidak terlalu dekat dengan pemain. null jika gagal.
function findEnemySpawnPosition(room, radius, wallRadius) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const tile = room.floorTiles[randomInt(0, room.floorTiles.length - 1)];
    const x = (tile.col + 0.5) * Dungeon.TILE_SIZE;
    const y = (tile.row + 0.5) * Dungeon.TILE_SIZE;

    if (Dungeon.collidesWithWall(room.dungeon.grid, x, y, wallRadius)) continue;
    if (room.enemies.some((e) => overlapsAABB(x, y, radius, e.x, e.y, e.radius))) continue;
    if (Object.values(room.players).some((p) => Math.hypot(p.x - x, p.y - y) < ENEMY_MIN_SPAWN_DISTANCE)) continue;

    return { x, y };
  }
  return null;
}

// Spawn satu musuh biasa (grunt/runner/shooter dipilih acak sesuai bobot), HP & speed
// disesuaikan dengan wave saat ini
function spawnEnemy(room) {
  const typeKey = pickRandomEnemyType();
  const type = ENEMY_TYPES[typeKey];
  const pos = findEnemySpawnPosition(room, type.radius, type.wallRadius);
  if (!pos) return;

  const scale = room.difficultyScale;
  const mut = mutatorMultipliers(room);
  const hp = round2(type.hp * (1 + (room.wave - 1) * ENEMY_HP_GROWTH_PER_WAVE) * scale.hp * mut.hpMul);
  room.enemies.push({
    id: room.nextEnemyId++,
    type: typeKey,
    x: pos.x,
    y: pos.y,
    hp,
    maxHp: hp,
    speed: round2(type.speed * scale.speed * mut.speedMul),
    radius: type.radius,
    wallRadius: type.wallRadius,
    color: type.color,
    behavior: type.behavior,
    contactDamage: type.contactDamage * scale.damage,
    isBoss: false,
    // Hitung mundur (detik) sampai tembakan berikutnya; hanya berjalan saat shooter sedang menembak
    fireTimer: type.fireIntervalS || 0,
  });
  room.waveEnemiesSpawned++;
}

// Spawn satu boss (dipanggil sekali per wave kelipatan BOSS_WAVE_INTERVAL)
function spawnBoss(room) {
  const pos = findEnemySpawnPosition(room, BOSS_TYPE.radius, BOSS_TYPE.wallRadius);
  if (!pos) return;

  const scale = room.difficultyScale;
  const mut = mutatorMultipliers(room);
  const hp = Math.round(BOSS_TYPE.hp(room.wave) * scale.hp * mut.hpMul);
  room.enemies.push({
    id: room.nextEnemyId++,
    type: 'boss',
    x: pos.x,
    y: pos.y,
    hp,
    maxHp: hp,
    speed: round2(BOSS_TYPE.speed * scale.speed * mut.speedMul),
    radius: BOSS_TYPE.radius,
    wallRadius: BOSS_TYPE.wallRadius,
    color: BOSS_TYPE.color,
    behavior: BOSS_TYPE.behavior,
    contactDamage: BOSS_TYPE.contactDamage * scale.damage,
    isBoss: true,
    fireTimer: 0,
  });
  room.bossSpawned = true;
  console.log(`Room ${room.code}: BOSS muncul di wave ${room.wave} (HP ${hp})`);
}

function updateEnemySpawning(room, dt) {
  if (getAlivePlayers(room).length === 0) return; // tidak ada yang dikejar

  // Wave boss: hanya 1 boss, tanpa musuh biasa, dan muncul langsung (tanpa menunggu timer)
  if (room.isBossWave) {
    if (!room.bossSpawned) spawnBoss(room);
    return;
  }

  if (room.waveEnemiesSpawned >= room.waveEnemiesTotal) return;

  room.spawnTimer -= dt;
  if (room.spawnTimer > 0) return;
  room.spawnTimer = randomSpawnDelay();

  if (room.enemies.length < MAX_ENEMIES) spawnEnemy(room);
}

// --- Pathfinding musuh ---

const tileOf = (value, max) => clamp(Math.floor(value / Dungeon.TILE_SIZE), 0, max - 1);

// BFS dari posisi (x, y) ke seluruh tile yang bisa dilewati (sesuai wallRadius musuh yang
// memakainya): field[row][col] = jumlah langkah tile ke posisi itu, atau -1 jika tidak terjangkau.
function buildDistanceField(room, x, y, wallRadius) {
  const { dungeon } = room;
  const walkable = room.enemyWalkable[wallRadius];
  const field = Array.from({ length: dungeon.rows }, () => new Array(dungeon.cols).fill(-1));
  const queue = [];
  const centerCol = tileOf(x, dungeon.cols);
  const centerRow = tileOf(y, dungeon.rows);

  // Sumber BFS: tile yang bisa dilewati di sekitar pemain (pemain bisa saja berdiri di tepi koridor)
  for (let radius = 1; radius <= 2 && queue.length === 0; radius++) {
    for (let row = centerRow - radius; row <= centerRow + radius; row++) {
      for (let col = centerCol - radius; col <= centerCol + radius; col++) {
        if (walkable[row]?.[col] && field[row][col] === -1) {
          field[row][col] = 0;
          queue.push([col, row]);
        }
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const [col, row] = queue[head];
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nc = col + dc;
      const nr = row + dr;
      if (walkable[nr]?.[nc] && field[nr][nc] === -1) {
        field[nr][nc] = field[row][col] + 1;
        queue.push([nc, nr]);
      }
    }
  }
  return field;
}

// Titik tengah tile tetangga yang lebih dekat ke pemain menurut field, atau null
function nextWaypoint(room, enemy, field) {
  const col = tileOf(enemy.x, room.dungeon.cols);
  const row = tileOf(enemy.y, room.dungeon.rows);
  const here = field[row][col];

  // Jika musuh berdiri di tile yang "tidak walkable" (misalnya di tepi), boleh pakai diagonal
  const directions = here >= 0
    ? [[0, -1], [0, 1], [-1, 0], [1, 0]]
    : [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  let best = null;
  let bestDist = here >= 0 ? here : Infinity;
  for (const [dc, dr] of directions) {
    const d = field[row + dr]?.[col + dc];
    if (d !== undefined && d >= 0 && d < bestDist) {
      bestDist = d;
      best = { col: col + dc, row: row + dr };
    }
  }

  if (!best) return null;
  return {
    x: (best.col + 0.5) * Dungeon.TILE_SIZE,
    y: (best.row + 0.5) * Dungeon.TILE_SIZE,
  };
}

// Apakah hitbox musuh bisa bergerak lurus dari A ke B tanpa menyentuh dinding
function hasLineOfSight(room, ax, ay, bx, by, half) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
  for (let i = 1; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    if (Dungeon.collidesWithWall(room.dungeon.grid, x, y, half)) return false;
  }
  return true;
}

// Tembakan musuh tipe 'ranged' (shooter) ke arah pemain target
function enemyShoot(room, enemy, target) {
  const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  const speed = ENEMY_PROJECTILE_SPEED * TICKS_PER_SECOND;
  room.enemyProjectiles.push({
    id: room.nextEnemyProjectileId++,
    x: enemy.x,
    y: enemy.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage: ENEMY_PROJECTILE_DAMAGE,
    radius: ENEMY_PROJECTILE_RADIUS,
    lifetime: ENEMY_PROJECTILE_LIFETIME,
  });
}

// AI: tiap musuh mengejar pemain hidup terdekat. Jika jalur lurus bebas, langsung maju;
// jika terhalang dinding, ikuti rute BFS lewat tile yang bisa dilewati.
// Musuh ranged (shooter) berhenti dalam jarak tertentu dan menembak secara berkala, bukan
// menabrak pemain seperti tipe melee.
function updateEnemies(room, dt) {
  const playerList = getAlivePlayers(room);
  if (playerList.length === 0) return;

  const fields = {}; // distance field per (pemain, wallRadius), dihitung sekali per tick bila dibutuhkan
  const type = (enemy) => (enemy.isBoss ? BOSS_TYPE : ENEMY_TYPES[enemy.type]);
  const nowMs = Date.now();

  for (const enemy of room.enemies) {
    // Musuh ter-stun (dari shockwave Shotgun) tidak bergerak/menembak sampai stun habis
    if (enemy.stunnedUntil && nowMs < enemy.stunnedUntil) continue;

    let target = null;
    let nearest = Infinity;
    for (const player of playerList) {
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (dist < nearest) {
        nearest = dist;
        target = player;
      }
    }
    if (!target) continue;

    // Shooter: berhenti begitu cukup dekat, lalu menembak berkala. Tetap mengejar jika pemain
    // menjauh lagi, dan tidak menembak jika tidak ada garis pandang lurus ke pemain.
    if (enemy.behavior === 'ranged') {
      const inRange = nearest <= type(enemy).rangedStopDistance;
      const canSeeTarget = hasLineOfSight(room, enemy.x, enemy.y, target.x, target.y, enemy.wallRadius);

      if (inRange && canSeeTarget) {
        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0) {
          enemyShoot(room, enemy, target);
          enemy.fireTimer = type(enemy).fireIntervalS;
        }
        continue; // berhenti bergerak selama target dalam jangkauan
      }
    }

    if (nearest < 1) continue; // sudah menempel, hindari bergetar

    let aim = target;
    if (!hasLineOfSight(room, enemy.x, enemy.y, target.x, target.y, enemy.wallRadius)) {
      const key = target.id + ':' + enemy.wallRadius;
      fields[key] = fields[key] || buildDistanceField(room, target.x, target.y, enemy.wallRadius);
      aim = nextWaypoint(room, enemy, fields[key]) || target;
    }

    const aimDist = Math.hypot(aim.x - enemy.x, aim.y - enemy.y);
    if (aimDist < 0.01) continue;

    const step = Math.min(enemy.speed * TICKS_PER_SECOND * dt, aimDist);
    moveEnemyWithSlide(room, enemy, Math.atan2(aim.y - enemy.y, aim.x - enemy.x), step);
  }
}

// Sudut deflection yang dicoba saat arah tujuan terhalang, dari yang paling kecil (derajat).
// Memungkinkan musuh "menyusur" dinding dengan berbelok sedikit, bukan diam menabrak sudut.
const SLIDE_DEFLECTIONS = [0, 20, -20, 40, -40, 60, -60, 80, -80];

// Gerakkan musuh dengan sliding collision. moveWithCollision merapatkan posisi ke tepi dinding
// per sumbu, tapi jika arah tujuan menusuk sudut dinding, musuh bisa menempel tanpa bergeser
// (stutter, terutama Runner yang cepat). Solusi: coba arah tujuan apa adanya; jika langkahnya
// nyaris nol, coba sudut yang dibelokkan sedikit demi sedikit sampai ketemu arah yang menggeser.
function moveEnemyWithSlide(room, enemy, desiredAngle, step) {
  const grid = room.dungeon.grid;
  const r = enemy.wallRadius;
  const threshold = step * 0.3; // dianggap "cukup bergerak" jika >= 30% langkah

  let best = null;
  for (const deg of SLIDE_DEFLECTIONS) {
    const a = desiredAngle + (deg * Math.PI) / 180;
    const next = Dungeon.moveWithCollision(grid, enemy.x, enemy.y, Math.cos(a) * step, Math.sin(a) * step, r);
    const moved = Math.hypot(next.x - enemy.x, next.y - enemy.y);

    // Arah tujuan asli (deg 0): kalau sudah cukup bergerak, langsung pakai (jalur paling lurus)
    if (deg === 0 && moved >= threshold) {
      enemy.x = next.x;
      enemy.y = next.y;
      return;
    }
    if (!best || moved > best.moved) best = { x: next.x, y: next.y, moved };
    // Sudut belok kecil yang sudah menggeser cukup jauh: cukup, tak perlu belok lebih tajam
    if (deg !== 0 && moved >= threshold) break;
  }

  // Pakai kandidat terbaik (paling banyak menggeser). Jika semua nol, musuh memang terjepit.
  if (best) {
    enemy.x = best.x;
    enemy.y = best.y;
  }
}

// Menggerakkan & membereskan peluru musuh: lifetime habis, menabrak dinding, atau mengenai
// pemain (pemain tetap tunduk pada invulnerability yang sama seperti damage kontak musuh)
function updateEnemyProjectiles(room, dt) {
  const { enemyProjectiles: list } = room;
  const nowMs = Date.now();

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.lifetime -= dt;
    if (p.lifetime <= 0) {
      list.splice(i, 1);
      continue;
    }

    const distance = Math.hypot(p.vx, p.vy) * dt;
    const steps = Math.max(1, Math.ceil(distance / (Dungeon.TILE_SIZE / 2)));
    let consumed = false;

    for (let s = 0; s < steps; s++) {
      p.x += (p.vx * dt) / steps;
      p.y += (p.vy * dt) / steps;

      if (Dungeon.collidesWithWall(room.dungeon.grid, p.x, p.y, p.radius)) {
        pushEvent(room, { type: 'wallHit', x: p.x, y: p.y, projectileType: 'enemy' });
        consumed = true;
        break;
      }

      // Pemain yang sedang kebal tidak menghentikan peluru (peluru lewat saja)
      const hitPlayer = getAlivePlayers(room).find(
        (pl) => nowMs >= (room.invulnerableUntil[pl.id] || 0) &&
          overlapsAABB(p.x, p.y, p.radius, pl.x, pl.y, PLAYER_RADIUS)
      );
      if (hitPlayer) {
        damagePlayer(room, hitPlayer, p.damage, nowMs);
        consumed = true;
        break;
      }
    }

    if (consumed) list.splice(i, 1);
  }
}

// Kurangi HP satu musuh. Kirim event hit/kill (dengan flag crit), jatuhkan item saat mati,
// dan isi energi ultimate penyerang. ownerId boleh null (mis. efek area tanpa pemilik jelas).
function damageEnemy(room, enemy, amount, hitX, hitY, crit, ownerId, opts = {}) {
  enemy.hp = round2(enemy.hp - amount);
  if (enemy.hp <= 0) {
    const index = room.enemies.indexOf(enemy);
    if (index !== -1) room.enemies.splice(index, 1);
    pushEvent(room, {
      type: 'kill', x: enemy.x, y: enemy.y, color: enemy.color,
      radius: enemy.radius, isBoss: enemy.isBoss, damage: amount, crit,
    });
    addUltimate(room, ownerId, ULTIMATE_PER_KILL);
    // Peluang item jatuh di lokasi kematian (boss selalu menjatuhkan beberapa)
    if (enemy.isBoss) {
      for (let n = 0; n < BOSS_ITEM_DROPS; n++) {
        spawnItem(room, enemy.x + randomInt(-30, 30), enemy.y + randomInt(-30, 30));
      }
    } else if (!opts.noDrop && Math.random() < ITEM_DROP_CHANCE * room.difficultyScale.dropMul) {
      spawnItem(room, enemy.x, enemy.y);
    }
  } else {
    pushEvent(room, { type: 'hit', x: hitX, y: hitY, color: enemy.color, damage: amount, crit });
  }
}

// Nuke: ledakkan semua musuh non-boss di room. Tanpa drop item dan tanpa energi ultimate,
// supaya satu nuke tidak berantai memunculkan item lain atau langsung mengisi gauge.
function nukeEnemies(room, player) {
  let killed = 0;
  for (const enemy of [...room.enemies]) {
    if (enemy.isBoss) continue;
    damageEnemy(room, enemy, enemy.hp, enemy.x, enemy.y, false, null, { noDrop: true });
    killed++;
  }
  pushEvent(room, { type: 'nuke', x: player.x, y: player.y });
  return killed;
}

// Tambah energi ultimate pemain (dibatasi 0..ULTIMATE_MAX)
function addUltimate(room, playerId, amount) {
  const player = playerId && room.players[playerId];
  if (!player || amount <= 0) return;
  player.ultimate = Math.min(ULTIMATE_MAX, round2(player.ultimate + amount));
}

// Jurus pamungkas per class. Semua efek otoritatif di server; client hanya menggambar
// visual lewat event 'ultimate'.
function triggerUltimate(room, player, angle) {
  const weaponClass = player.weaponClass;

  if (weaponClass === 'assault') {
    // Burst 360 derajat: peluru assault cepat ke segala arah
    const speed = WEAPONS.assault.projectileSpeed * TICKS_PER_SECOND;
    for (let i = 0; i < ULT_ASSAULT_BULLETS; i++) {
      const a = (i / ULT_ASSAULT_BULLETS) * Math.PI * 2;
      const projectile = {
        id: room.nextProjectileId++,
        ownerId: player.id,
        type: 'assault',
        x: player.x,
        y: player.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        damage: ULT_ASSAULT_DAMAGE,
        radius: WEAPONS.assault.radius,
        lifetime: PROJECTILE_LIFETIME,
      };
      Object.defineProperty(projectile, 'hitEnemyIds', { value: new Set() });
      room.projectiles.push(projectile);
    }
  } else if (weaponClass === 'shotgun') {
    // Shockwave: dorong (knockback) + stun musuh dalam radius, beri sedikit damage
    const nowMs = Date.now();
    for (const enemy of [...room.enemies]) {
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > ULT_SHOTGUN_RADIUS) continue;

      // Dorong menjauh, dihentikan dinding lewat moveWithCollision
      const push = ULT_SHOTGUN_KNOCKBACK * (1 - dist / ULT_SHOTGUN_RADIUS);
      const moved = Dungeon.moveWithCollision(
        room.dungeon.grid, enemy.x, enemy.y, (dx / dist) * push, (dy / dist) * push, enemy.wallRadius
      );
      enemy.x = moved.x;
      enemy.y = moved.y;
      enemy.stunnedUntil = nowMs + ULT_SHOTGUN_STUN_S * 1000;
      damageEnemy(room, enemy, ULT_SHOTGUN_DAMAGE, enemy.x, enemy.y, false, player.id);
    }
    pushEvent(room, { type: 'ultShockwave', x: player.x, y: player.y, radius: ULT_SHOTGUN_RADIUS });
  } else if (weaponClass === 'sniper') {
    // Laser lurus menembus dinding & semua musuh di garis
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const endX = player.x + dirX * ULT_SNIPER_LENGTH;
    const endY = player.y + dirY * ULT_SNIPER_LENGTH;
    for (const enemy of [...room.enemies]) {
      if (pointToSegmentDistance(enemy.x, enemy.y, player.x, player.y, endX, endY) <= ULT_SNIPER_WIDTH + enemy.radius) {
        damageEnemy(room, enemy, ULT_SNIPER_DAMAGE, enemy.x, enemy.y, false, player.id);
      }
    }
    pushEvent(room, { type: 'ultBeam', x: player.x, y: player.y, angle: round2(angle), length: ULT_SNIPER_LENGTH });
  }

  pushEvent(room, { type: 'ultimate', weapon: weaponClass, ownerId: player.id, x: player.x, y: player.y });
}

// Jarak titik (px,py) ke segmen garis (ax,ay)-(bx,by)
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Menggerakkan peluru; hapus jika lifetime habis, menabrak dinding (tile 1),
// atau mengenai musuh (HP musuh berkurang, musuh dihapus jika HP <= 0)
function updateProjectiles(room, dt) {
  const { projectiles, enemies } = room;
  const worldWidth = room.dungeon.cols * Dungeon.TILE_SIZE;
  const worldHeight = room.dungeon.rows * Dungeon.TILE_SIZE;

  // Iterasi mundur supaya splice aman
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const weapon = WEAPONS[p.type];

    p.lifetime -= dt;
    if (p.lifetime <= 0) {
      projectiles.splice(i, 1);
      continue;
    }

    // Gerak dipecah menjadi langkah kecil (maks setengah tile) agar peluru cepat
    // tidak melompati dinding tipis di antara dua tick
    const distance = Math.hypot(p.vx, p.vy) * dt;
    const steps = Math.max(1, Math.ceil(distance / (Dungeon.TILE_SIZE / 2)));
    let consumed = false;

    for (let s = 0; s < steps; s++) {
      p.x += (p.vx * dt) / steps;
      p.y += (p.vy * dt) / steps;

      // Peluru yang keluar dari peta dihapus (peluru tembus dinding bisa terbang ke luar)
      if (p.x < 0 || p.x > worldWidth || p.y < 0 || p.y > worldHeight) {
        consumed = true;
        break;
      }

      if (!weapon.piercesWalls &&
          Dungeon.collidesWithWall(room.dungeon.grid, p.x, p.y, p.radius)) {
        pushEvent(room, { type: 'wallHit', x: p.x, y: p.y, projectileType: p.type });
        consumed = true;
        break;
      }

      // Cek tiap langkah kecil, bukan hanya akhir tick, agar peluru tidak menembus musuh.
      // Iterasi mundur supaya splice musuh yang mati aman.
      for (let e = enemies.length - 1; e >= 0; e--) {
        const enemy = enemies[e];
        if (p.hitEnemyIds.has(enemy.id)) continue; // peluru tembus tidak melukai musuh yang sama dua kali
        if (!overlapsAABB(p.x, p.y, p.radius, enemy.x, enemy.y, enemy.radius)) continue;

        // Critical hit 15%: damage dikali, ditandai agar client menggambar angka emas membal
        const crit = Math.random() < CRIT_CHANCE;
        const dealt = round2(p.damage * (crit ? CRIT_MULTIPLIER : 1));
        const wasBoss = enemy.isBoss;
        damageEnemy(room, enemy, dealt, p.x, p.y, crit, p.ownerId);
        // Boss butuh banyak peluru, jadi beri sedikit energi ultimate per peluru yang mengenainya
        if (wasBoss && enemy.hp > 0) addUltimate(room, p.ownerId, ULTIMATE_PER_BOSS_HIT);

        if (weapon.piercing) {
          p.hitEnemyIds.add(enemy.id); // lanjut terbang, bisa mengenai musuh berikutnya
        } else {
          consumed = true;
          break;
        }
      }
      if (consumed) break;
    }

    if (consumed) projectiles.splice(i, 1);
  }
}

// Musuh yang menyentuh pemain mengurangi HP-nya; setelah kena, pemain kebal sesaat
function applyEnemyContactDamage(room) {
  const nowMs = Date.now();

  for (const player of getAlivePlayers(room)) {
    if (nowMs < (room.invulnerableUntil[player.id] || 0)) continue;

    // Jika menyentuh beberapa musuh sekaligus, yang paling menyakitkan yang dihitung.
    // attacker = musuh penyerang, untuk menggambar efek tebasan di antara musuh dan pemain.
    let damage = 0;
    let attacker = null;
    for (const e of room.enemies) {
      if (overlapsAABB(player.x, player.y, PLAYER_RADIUS, e.x, e.y, e.radius)) {
        if (e.contactDamage >= damage) { damage = e.contactDamage; attacker = e; }
      }
    }
    if (damage > 0 && damagePlayer(room, player, damage, nowMs) && attacker) {
      // Efek tebasan melee: dari posisi musuh ke posisi pemain
      pushEvent(room, {
        type: 'meleeAttack', ex: Math.round(attacker.x), ey: Math.round(attacker.y),
        px: Math.round(player.x), py: Math.round(player.y), color: attacker.color,
      });
    }
  }
}

// Kurangi HP pemain lalu beri masa kebal sesaat. Dipakai damage kontak maupun peluru musuh,
// sehingga keduanya berbagi invulnerability. Mengembalikan false jika sedang kebal.
function damagePlayer(room, player, amount, nowMs) {
  if (player.isDowned || nowMs < (room.invulnerableUntil[player.id] || 0)) return false;

  // Shield menyerap 1 serangan penuh: tanpa kehilangan HP, tetap diberi masa kebal sesaat
  if (player.shield) {
    player.shield = false;
    room.invulnerableUntil[player.id] = nowMs + INVULNERABILITY_MS;
    pushEvent(room, { type: 'shieldBreak', playerId: player.id, x: player.x, y: player.y });
    return true;
  }

  player.hp = Math.max(0, round2(player.hp - amount));
  room.invulnerableUntil[player.id] = nowMs + INVULNERABILITY_MS;
  pushEvent(room, { type: 'playerHit', playerId: player.id, x: player.x, y: player.y });

  if (player.hp <= 0) {
    player.isDowned = true; // berlutut: tidak bisa bergerak/menembak, menunggu revive
    player.reviveProgress = 0;
    room.inputs[player.id] = { dx: 0, dy: 0 };
    pushEvent(room, { type: 'downed', playerId: player.id, x: player.x, y: player.y });
  }
  return true;
}

// Revive: tiap pemain downed yang punya penyelamat (pemain aktif dalam REVIVE_RADIUS) mengisi
// progress; penuh -> bangun dengan 50% HP. Jika tidak ada penyelamat, progress mundur perlahan.
function updateRevives(room, dt) {
  const rescuers = getAlivePlayers(room);

  for (const player of Object.values(room.players)) {
    if (!player.isDowned) continue;

    const beingRevived = rescuers.some(
      (r) => Math.hypot(r.x - player.x, r.y - player.y) <= REVIVE_RADIUS
    );

    if (beingRevived) {
      player.reviveProgress = Math.min(REVIVE_TIME_S, round2(player.reviveProgress + dt));
      if (player.reviveProgress >= REVIVE_TIME_S) {
        player.isDowned = false;
        player.reviveProgress = 0;
        player.hp = Math.max(1, round2(player.maxHp * REVIVE_HP_FRACTION));
        room.invulnerableUntil[player.id] = Date.now() + INVULNERABILITY_MS;
        pushEvent(room, { type: 'revived', playerId: player.id, x: player.x, y: player.y });
      }
    } else if (player.reviveProgress > 0) {
      // Batal: progress surut 2x kecepatan isi, jadi tidak langsung hilang saat penyelamat mundur sejenak
      player.reviveProgress = Math.max(0, round2(player.reviveProgress - dt * 2));
    }
  }
}

// --- Item drop ---

function pickRandomItemType() {
  let roll = Math.random() * ITEM_TYPE_TOTAL_WEIGHT;
  for (const [key, type] of Object.entries(ITEM_TYPES)) {
    roll -= type.weight;
    if (roll < 0) return key;
  }
  return 'medkit';
}

function spawnItem(room, x, y, typeKey = pickRandomItemType()) {
  room.items.push({
    id: room.nextItemId++,
    type: typeKey,
    x: Math.round(x),
    y: Math.round(y),
    color: ITEM_TYPES[typeKey].color,
    lifetime: ITEM_LIFETIME_S,
  });
}

// Radius pickup: lingkaran jarak antara pusat pemain dan pusat item.
// Lebih besar dari PLAYER_RADIUS + ITEM_RADIUS agar terasa responsif meski ada lag.
const ITEM_PICKUP_RADIUS = PLAYER_RADIUS + ITEM_RADIUS + 10; // 15 + 10 + 10 = 35 px

// Item kedaluwarsa dihapus; item yang disentuh pemain aktif memberi efek lalu hilang.
// Deteksi pakai jarak Euclidean (bukan AABB) agar sesuai tampilan lingkaran di canvas.
function updateItems(room, dt) {
  for (let i = room.items.length - 1; i >= 0; i--) {
    const item = room.items[i];

    item.lifetime -= dt;
    if (item.lifetime <= 0) {
      room.items.splice(i, 1);
      continue;
    }

    const type = ITEM_TYPES[item.type];
    const picker = getAlivePlayers(room).find(
      (p) =>
        Math.hypot(p.x - item.x, p.y - item.y) < ITEM_PICKUP_RADIUS &&
        (!type.canPickup || type.canPickup(p))
    );
    if (picker) {
      const result = type.apply(picker, room) || {};
      room.items.splice(i, 1);

      // Kliping HP agar tidak melebihi maxHp (medkit sudah melakukan ini, tapi jaga-jaga)
      if (item.type === 'medkit') {
        picker.hp = Math.min(picker.maxHp, Math.max(0, picker.hp));
      }

      pushEvent(room, {
        type: 'pickup', itemType: item.type, playerId: picker.id,
        x: item.x, y: item.y, color: item.color, heal: result.heal || 0,
      });
      // Event terpisah untuk client yang ingin langsung menyembunyikan visual item
      io.to(room.code).emit('itemPickedUp', { itemId: item.id, playerId: picker.id });
    }
  }
}

function pickRandomUpgrades(count) {
  // Fisher-Yates shuffle pada salinan pool
  const pool = [...UPGRADES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Tiap kartu dapat rarity acak (kosmetik). Dibuat sekali di sini supaya sama untuk semua
  // pemain di room dan konsisten antar pengiriman.
  return pool.slice(0, count).map((u) => ({ ...u, rarity: randomRarity() }));
}

function sendUpgrades(room, socketId) {
  io.to(socketId).emit('showUpgrades', {
    wave: room.wave,
    choices: room.currentChoices.map(({ id, label, icon, desc, rarity }) => ({ id, label, icon, desc, rarity })),
  });
}

// Semua musuh wave habis: tampilkan pilihan upgrade ke pemain yang masih hidup
function startUpgradePhase(room) {
  room.waveState = 'WAVE_CLEAR';
  room.projectiles.length = 0;
  room.enemyProjectiles.length = 0;
  room.currentChoices = pickRandomUpgrades(3);
  room.pendingUpgrades.clear();

  for (const player of getAlivePlayers(room)) {
    room.pendingUpgrades.add(player.id);
    sendUpgrades(room, player.id);
  }
}

// Pilih mutator acak, dihindari sama dengan mutator wave sebelumnya agar tidak monoton
function pickRandomMutator(previous) {
  const ids = Object.keys(WAVE_MUTATORS).filter((id) => id !== previous);
  return ids[randomInt(0, ids.length - 1)];
}

// forcedMutator: undefined = acak (wave >= MUTATOR_START_WAVE); null/id = pakai nilai itu
// (dipakai Restart Wave agar wave yang diulang tetap punya tantangan yang sama)
function startWave(room, number, forcedMutator) {
  room.wave = number;
  room.waveState = 'IN_PROGRESS';
  room.mutator = forcedMutator !== undefined
    ? forcedMutator
    : (number >= MUTATOR_START_WAVE ? pickRandomMutator(room.mutator) : null);
  // Wave kelipatan BOSS_WAVE_INTERVAL: hanya 1 boss (dihitung di bawah), tanpa musuh biasa
  room.isBossWave = number % BOSS_WAVE_INTERVAL === 0;
  room.bossSpawned = false;
  room.waveEnemiesTotal = room.isBossWave
    ? 0
    : WAVE_BASE_ENEMIES + (number - 1) * WAVE_ENEMY_INCREMENT;
  room.waveEnemiesSpawned = 0;
  room.spawnTimer = randomSpawnDelay();
  room.currentChoices = [];
  room.pendingUpgrades.clear();
  room.enemies.length = 0;
  room.projectiles.length = 0;
  room.enemyProjectiles.length = 0;
  room.items.length = 0;

  // Pemain yang downed di wave sebelumnya bangkit lagi dengan HP penuh
  for (const player of Object.values(room.players)) {
    if (!player.isDowned) continue;
    const spawn = randomSpawnPoint(room);
    Object.assign(player, { x: spawn.x, y: spawn.y, hp: player.maxHp, isDowned: false, reviveProgress: 0 });
  }
  room.items.length = 0;
}

// Ulangi wave yang gagal dari awal: semua pemain hidup lagi dengan HP penuh di posisi baru,
// stat upgrade dipertahankan. Dipakai saat pemain memilih "Restart Wave" di layar Game Over.
function restartCurrentWave(room) {
  const failedWave = room.wave;
  for (const player of Object.values(room.players)) {
    const spawn = randomSpawnPoint(room);
    Object.assign(player, {
      x: spawn.x, y: spawn.y, hp: player.maxHp, isDowned: false, reviveProgress: 0,
      shield: false, damageBoostUntil: 0, damageBoostLeft: 0, // buff dari percobaan gagal tidak dibawa
    });
    room.inputs[player.id] = { dx: 0, dy: 0 };
  }
  for (const id in room.invulnerableUntil) delete room.invulnerableUntil[id];
  startWave(room, failedWave, room.mutator); // mutator wave yang sama
}

function checkUpgradesComplete(room) {
  if (room.waveState === 'WAVE_CLEAR' && room.pendingUpgrades.size === 0) {
    startWave(room, room.wave + 1);
  }
}

// Cek akhir tick: game over jika semua pemain mati, wave clear jika musuh habis
function checkWaveProgress(room) {
  // Game over hanya jika SEMUA pemain downed (tidak ada yang bisa me-revive)
  const playerList = Object.values(room.players);
  if (playerList.length > 0 && playerList.every((p) => p.isDowned)) {
    room.waveState = 'GAME_OVER';
    room.gameOverAt = Date.now();
    room.projectiles.length = 0;
    room.enemyProjectiles.length = 0;
    return;
  }

  const waveSpawningDone = room.isBossWave ? room.bossSpawned : room.waveEnemiesSpawned >= room.waveEnemiesTotal;
  if (waveSpawningDone && room.enemies.length === 0) {
    startUpgradePhase(room);
  }
}

// Satu tick untuk satu room
function updateRoom(room, dt, nowMs) {
  for (const id in room.players) {
    const player = room.players[id];

    // Sisa waktu buff 2x Damage (dibulatkan 0,1 detik) untuk indikator aura di client
    player.damageBoostLeft = Math.max(0, Math.round(((player.damageBoostUntil - nowMs) / 1000) * 10) / 10);

    // Input basi (client macet, tab dibekukan, atau keyup hilang): hentikan pemain
    if (nowMs - room.lastInputAt[id] > INPUT_TIMEOUT_MS) {
      room.inputs[id] = { dx: 0, dy: 0 };
    }

    if (player.isDowned) continue; // pemain downed tidak bisa bergerak

    let { dx, dy } = room.inputs[id];

    // Tidak ada input arah: jangan ubah x/y sama sekali (tidak ada gerak sisa/meluncur).
    // Deadzone kecil juga menutup nilai sangat kecil yang bukan nol persis.
    if (Math.abs(dx) < INPUT_DEADZONE && Math.abs(dy) < INPUT_DEADZONE) continue;

    // Normalisasi agar gerak diagonal tidak lebih cepat
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }

    const pixelsPerSecond = player.speed * TICKS_PER_SECOND;
    movePlayer(room, player, dx * pixelsPerSecond * dt, dy * pixelsPerSecond * dt);
  }

  if (room.waveState === 'IN_PROGRESS') {
    updateEnemySpawning(room, dt);
    updateEnemies(room, dt);
  }

  updateProjectiles(room, dt);
  updateEnemyProjectiles(room, dt);

  if (room.waveState === 'IN_PROGRESS') {
    applyEnemyContactDamage(room);
    updateRevives(room, dt);
    updateItems(room, dt);
    checkWaveProgress(room);
  }
  // Saat GAME_OVER, server menunggu pilihan pemain (restartWave / backToLobby). Tidak ada
  // auto-restart lagi.
}

// ======================================================================
// Socket
// ======================================================================

io.on('connection', (socket) => {
  console.log(`Client terhubung: ${socket.id}`);

  // --- Lobby ---

  socket.on('createRoom', (data) => {
    if (socketRooms[socket.id]) {
      socket.emit('roomError', { message: 'Kamu sudah berada di dalam room.' });
      return;
    }
    if (Object.keys(rooms).length >= MAX_ROOMS) {
      socket.emit('roomError', { message: 'Server penuh, coba lagi nanti.' });
      return;
    }

    const room = createRoom(generateRoomCode(), sanitizeDifficulty(data && data.difficulty));
    addPlayerToRoom(socket, room, sanitizeName(data && data.name), sanitizeWeaponClass(data && data.weaponClass));
  });

  socket.on('joinRoom', (data) => {
    if (socketRooms[socket.id]) {
      socket.emit('roomError', { message: 'Kamu sudah berada di dalam room.' });
      return;
    }

    const code = data && typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      socket.emit('roomError', { message: 'Kode room harus 4 karakter huruf/angka.' });
      return;
    }
    if (!Object.hasOwn(rooms, code)) {
      socket.emit('roomError', { message: `Room ${code} tidak ditemukan.` });
      return;
    }

    const room = rooms[code];
    if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit('roomError', { message: `Room ${code} sudah penuh (maksimal ${MAX_PLAYERS_PER_ROOM} pemain).` });
      return;
    }

    addPlayerToRoom(socket, room, sanitizeName(data.name), sanitizeWeaponClass(data.weaponClass));
  });

  // --- Dalam permainan: semua event hanya berlaku jika pemain sudah berada di sebuah room ---

  // Game Over -> "Restart Wave": ulang wave gagal dari awal. Cukup satu pemain yang menekan.
  socket.on('restartWave', () => {
    const room = getRoomOf(socket.id);
    if (room && room.waveState === 'GAME_OVER') restartCurrentWave(room);
  });

  // Game Over -> "Back to Lobby": keluarkan pemain dari room (client kembali ke lobby saat
  // tidak lagi menerima stateUpdate / lewat konfirmasi di bawah)
  socket.on('backToLobby', () => {
    if (!socketRooms[socket.id]) return;
    socket.leave(socketRooms[socket.id]);
    removePlayerFromRoom(socket.id);
    socket.emit('leftRoom');
  });

  // Pemain memilih satu upgrade; wave berikutnya mulai setelah semua pemain hidup memilih
  socket.on('selectUpgrade', (data) => {
    const room = getRoomOf(socket.id);
    const player = room && room.players[socket.id];
    if (!room || room.waveState !== 'WAVE_CLEAR' || !player || player.isDowned) return;
    if (!room.pendingUpgrades.has(socket.id) || !data || typeof data !== 'object') return;

    const upgrade = room.currentChoices.find((u) => u.id === data.id);
    if (!upgrade) return;

    upgrade.apply(player);
    room.pendingUpgrades.delete(socket.id);
    checkUpgradesComplete(room);
  });

  // Client hanya mengirim arah; posisi dihitung di server pada tiap tick
  socket.on('playerInput', (input) => {
    const room = getRoomOf(socket.id);
    if (!room || !input || typeof input !== 'object') return;
    room.inputs[socket.id] = {
      dx: sanitizeAxis(input.dx),
      dy: sanitizeAxis(input.dy),
    };
    room.lastInputAt[socket.id] = Date.now();
  });

  // Client hanya mengirim sudut bidikan; posisi awal dan kecepatan ditentukan server
  socket.on('shoot', (data) => {
    const room = getRoomOf(socket.id);
    const player = room && room.players[socket.id];
    if (!player || player.isDowned || !data || typeof data !== 'object') return;
    const angle = data.angle;
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return;

    // Batasi laju tembakan sesuai fireRate pemain agar client tidak bisa spam peluru
    const nowMs = Date.now();
    if (nowMs - (room.lastShotAt[socket.id] || 0) < player.fireRate) return;
    room.lastShotAt[socket.id] = nowMs;

    // Satu tembakan bisa menghasilkan banyak peluru (shotgun) dengan sudut menyebar
    const weapon = WEAPONS[player.weaponClass];
    const speed = weapon.projectileSpeed * TICKS_PER_SECOND; // piksel per detik

    for (const offsetDegrees of weapon.spreadAngles) {
      const pelletAngle = angle + (offsetDegrees * Math.PI) / 180;
      const projectile = {
        id: room.nextProjectileId++,
        ownerId: socket.id,
        type: player.weaponClass, // client memakai ini untuk gaya gambar
        x: player.x,
        y: player.y,
        vx: Math.cos(pelletAngle) * speed,
        vy: Math.sin(pelletAngle) * speed,
        // Buff 2x Damage aktif: damage peluru dikali sesuai pengali
        damage: round2(player.damage * (nowMs < player.damageBoostUntil ? DOUBLE_DAMAGE_MULTIPLIER : 1)),
        radius: weapon.radius,
        lifetime: PROJECTILE_LIFETIME,
      };
      // Musuh yang sudah tertembus; non-enumerable supaya tidak ikut dikirim ke client
      Object.defineProperty(projectile, 'hitEnemyIds', { value: new Set() });
      room.projectiles.push(projectile);
    }

    // Satu event per tembakan (shotgun 5 peluru tetap satu suara)
    player.aimAngle = round2(normalizeAngle(angle));
    addUltimate(room, socket.id, ULTIMATE_PER_SHOT);
    pushEvent(room, {
      type: 'shoot', weapon: player.weaponClass, ownerId: socket.id,
      x: player.x, y: player.y, angle: round2(angle),
    });
  });

  // Jurus pamungkas (Spacebar). Hanya jalan jika gauge penuh; langsung menghabiskan energi.
  socket.on('ultimate', (data) => {
    const room = getRoomOf(socket.id);
    const player = room && room.players[socket.id];
    if (!player || player.isDowned || room.waveState !== 'IN_PROGRESS') return;
    if (player.ultimate < ULTIMATE_MAX) return;

    const angle = data && typeof data.angle === 'number' && Number.isFinite(data.angle)
      ? data.angle : player.aimAngle;
    player.ultimate = 0;
    triggerUltimate(room, player, angle);
  });

  // Arah bidikan (untuk menggambar moncong senjata pemain di layar pemain lain). Hanya
  // kosmetik: tidak memengaruhi arah tembakan, yang tetap dikirim lewat event 'shoot'.
  socket.on('aim', (data) => {
    const room = getRoomOf(socket.id);
    const player = room && room.players[socket.id];
    if (!player || !data || typeof data !== 'object') return;
    if (typeof data.angle !== 'number' || !Number.isFinite(data.angle)) return;
    player.aimAngle = round2(normalizeAngle(data.angle));
  });

  socket.on('disconnect', () => {
    console.log(`Client terputus: ${socket.id}`);
    removePlayerFromRoom(socket.id);
  });
});

// Game loop: 50 tick per detik (setiap 20ms), memproses semua room
let lastTick = process.hrtime.bigint();

setInterval(() => {
  // Pakai waktu nyata antar tick, karena setInterval tidak selalu tepat 20ms
  const now = process.hrtime.bigint();
  const dt = Math.min(Number(now - lastTick) / 1e9, MAX_DT);
  lastTick = now;

  const nowMs = Date.now();

  for (const code in rooms) {
    const room = rooms[code];
    updateRoom(room, dt, nowMs);

    // State dikirim hanya ke anggota room ini
    io.to(code).emit('stateUpdate', {
      players: room.players,
      projectiles: room.projectiles,
      enemyProjectiles: room.enemyProjectiles,
      enemies: room.enemies,
      items: room.items,
      wave: room.wave,
      waveState: room.waveState,
      mutator: room.mutator
        ? { id: room.mutator, label: WAVE_MUTATORS[room.mutator].label, desc: WAVE_MUTATORS[room.mutator].desc }
        : null,
      reviveTime: REVIVE_TIME_S,
      events: room.events,
    });
    room.events = []; // kejadian hanya dikirim sekali
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);

  // Panduan deploy hanya dicetak saat jalan lokal (bukan di platform cloud yang sudah set PORT)
  if (!process.env.PORT) {
    console.log(`
==================== PANDUAN DEPLOY ====================
Agar game bisa diakses publik lewat HTTPS/WSS, deploy ke layanan gratis:

1) Push ke GitHub:
     git init
     git add .
     git commit -m "Ashfall Arena"
     git branch -M main
     git remote add origin https://github.com/<user>/<repo>.git
     git push -u origin main
   (node_modules tidak ikut ter-push; sudah diabaikan lewat .gitignore)

2a) Deploy di Render.com (pakai render.yaml):
     - Buka https://render.com > New > Blueprint
     - Hubungkan repo GitHub tadi; Render membaca render.yaml otomatis
     - Tunggu build selesai -> dapat URL https://<nama>.onrender.com

2b) Atau Railway.app:
     - Buka https://railway.app > New Project > Deploy from GitHub repo
     - Railway mendeteksi Node, menjalankan "npm install" lalu "npm start"
     - Generate domain di tab Settings -> dapat URL https publik

Catatan: PORT disuntikkan otomatis oleh platform (kode sudah memakai
process.env.PORT), dan Socket.io sudah mengizinkan CORS dari origin mana pun,
jadi koneksi WSS langsung jalan tanpa konfigurasi tambahan.
=======================================================
`);
  }
});
