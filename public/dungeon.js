// Generator dungeon + collision berbasis grid.
// File ini dipakai bersama oleh browser (window.Dungeon) dan server (require),
// supaya denah dan tabrakan di kedua sisi selalu identik.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Dungeon = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 40;
  const ROWS = 30;
  const TILE_SIZE = 20; // 40 x 20 = 800px, 30 x 20 = 600px (ukuran canvas)
  const FLOOR = 0;
  const WALL = 1;

  const MAX_ROOMS = 8;
  const ROOM_ATTEMPTS = 40;
  const ROOM_MIN_W = 6;
  const ROOM_MAX_W = 10;
  const ROOM_MIN_H = 5;
  const ROOM_MAX_H = 8;
  // Lebar koridor (tile). Harus cukup untuk hitbox pemain (30px = 1.5 tile)
  const CORRIDOR_WIDTH = 3;

  // --- Random number generator berbasis seed string ---

  // Mengubah string menjadi angka 32-bit (xmur3)
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  // PRNG deterministik (mulberry32): menghasilkan angka 0 <= n < 1
  function createRng(seed) {
    let a = hashSeed(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Generator ---

  function intersects(a, b, padding) {
    return (
      a.x - padding < b.x + b.w &&
      a.x + a.w + padding > b.x &&
      a.y - padding < b.y + b.h &&
      a.y + a.h + padding > b.y
    );
  }

  // Menghasilkan { grid, rooms, cols, rows, tileSize } dari seed string.
  // grid[baris][kolom]: 0 = lantai, 1 = dinding. Seed sama => hasil sama.
  function generate(seed) {
    const rng = createRng(seed);
    const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));

    const grid = [];
    for (let row = 0; row < ROWS; row++) {
      grid.push(new Array(COLS).fill(WALL));
    }

    // Tepi peta (indeks 0 dan terakhir) selalu dinding
    const carve = (col, row) => {
      if (col >= 1 && col <= COLS - 2 && row >= 1 && row <= ROWS - 2) {
        grid[row][col] = FLOOR;
      }
    };

    // 1. Taruh ruangan acak yang tidak saling bersentuhan
    const rooms = [];
    for (let i = 0; i < ROOM_ATTEMPTS && rooms.length < MAX_ROOMS; i++) {
      const w = randInt(ROOM_MIN_W, ROOM_MAX_W);
      const h = randInt(ROOM_MIN_H, ROOM_MAX_H);
      const room = {
        x: randInt(1, COLS - 1 - w),
        y: randInt(1, ROWS - 1 - h),
        w,
        h,
      };
      if (rooms.some((other) => intersects(room, other, 2))) continue;
      rooms.push(room);
    }

    for (const room of rooms) {
      for (let row = room.y; row < room.y + room.h; row++) {
        for (let col = room.x; col < room.x + room.w; col++) carve(col, row);
      }
    }

    // 2. Hubungkan tiap ruangan ke ruangan sebelumnya dengan koridor berbentuk L
    const center = (room) => ({
      col: Math.floor(room.x + room.w / 2),
      row: Math.floor(room.y + room.h / 2),
    });
    const half = Math.floor(CORRIDOR_WIDTH / 2);

    for (let i = 1; i < rooms.length; i++) {
      const from = center(rooms[i - 1]);
      const to = center(rooms[i]);

      const colStep = from.col <= to.col ? 1 : -1;
      for (let col = from.col; col !== to.col + colStep; col += colStep) {
        for (let o = -half; o <= half; o++) carve(col, from.row + o);
      }
      const rowStep = from.row <= to.row ? 1 : -1;
      for (let row = from.row; row !== to.row + rowStep; row += rowStep) {
        for (let o = -half; o <= half; o++) carve(to.col + o, row);
      }

      // Isi penuh pojok L. Tanpa ini tile pojok luar tidak ikut tergali, sehingga di sudut
      // koridor hanya tersisa sambungan diagonal selebar 1 tile: hitbox yang lebih besar dari
      // satu tile (pemain/musuh) tidak bisa dianggap "lewat" oleh pathfinding berbasis grid.
      for (let dr = -half; dr <= half; dr++) {
        for (let dc = -half; dc <= half; dc++) carve(to.col + dc, from.row + dr);
      }
    }

    return { grid, rooms, cols: COLS, rows: ROWS, tileSize: TILE_SIZE };
  }

  // --- Collision AABB ---

  // Tile di luar peta dianggap dinding
  function isWallTile(grid, col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
    return grid[row][col] === WALL;
  }

  // Cek apakah kotak (pusat x,y; setengah sisi `half`) menimpa tile dinding.
  // EPS membuat kotak yang hanya "menempel" di tepi dinding tidak dianggap menabrak.
  const EPS = 1e-6;

  function collidesWithWall(grid, x, y, half) {
    const minCol = Math.floor((x - half + EPS) / TILE_SIZE);
    const maxCol = Math.ceil((x + half - EPS) / TILE_SIZE) - 1;
    const minRow = Math.floor((y - half + EPS) / TILE_SIZE);
    const maxRow = Math.ceil((y + half - EPS) / TILE_SIZE) - 1;

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (isWallTile(grid, col, row)) return true;
      }
    }
    return false;
  }

  // Menggeser kotak sejauh (moveX, moveY) per sumbu. Jika menabrak dinding,
  // posisi dirapatkan ke tepi dinding sehingga pemain bisa "menyusur" dinding.
  function moveWithCollision(grid, x, y, moveX, moveY, half) {
    let nx = x + moveX;
    if (moveX !== 0 && collidesWithWall(grid, nx, y, half)) {
      if (moveX > 0) {
        const col = Math.ceil((nx + half - EPS) / TILE_SIZE) - 1;
        nx = col * TILE_SIZE - half;
      } else {
        const col = Math.floor((nx - half + EPS) / TILE_SIZE);
        nx = (col + 1) * TILE_SIZE + half;
      }
      if (collidesWithWall(grid, nx, y, half)) nx = x;
    }

    let ny = y + moveY;
    if (moveY !== 0 && collidesWithWall(grid, nx, ny, half)) {
      if (moveY > 0) {
        const row = Math.ceil((ny + half - EPS) / TILE_SIZE) - 1;
        ny = row * TILE_SIZE - half;
      } else {
        const row = Math.floor((ny - half + EPS) / TILE_SIZE);
        ny = (row + 1) * TILE_SIZE + half;
      }
      if (collidesWithWall(grid, nx, ny, half)) ny = y;
    }

    return { x: nx, y: ny };
  }

  // Gerak pemain dengan sliding yang menjaga kecepatan. moveWithCollision memisahkan sumbu X
  // dan Y, tapi saat gerak diagonal menabrak dinding, komponen sumbu yang terhalang terbuang
  // sehingga pemain meluncur hanya ~70% kecepatan dan terasa "mentok". Di sini sisa gerakan
  // itu disalurkan ke sumbu yang bebas, jadi meluncur menyusur dinding terasa penuh.
  // Dipakai server dan client agar hasilnya identik.
  function slideMove(grid, x, y, moveX, moveY, half) {
    const first = moveWithCollision(grid, x, y, moveX, moveY, half);
    const dx = first.x - x;
    const dy = first.y - y;
    const blockedX = Math.abs(moveX) > 1e-9 && Math.abs(dx) < Math.abs(moveX) * 0.5;
    const blockedY = Math.abs(moveY) > 1e-9 && Math.abs(dy) < Math.abs(moveY) * 0.5;

    // Tidak ada yang terhalang, atau keduanya terhalang (sudut): tidak ada yang disalurkan
    if (blockedX === blockedY) return first;

    // Panjang langkah total dijaga sama dengan kecepatan normal: sumbu yang terhalang masih
    // bisa bergerak sedikit (dx/dy), jadi sumbu bebas hanya mendapat sisanya (Pythagoras).
    const total = Math.hypot(moveX, moveY);
    if (blockedX) {
      if (Math.abs(moveY) < 1e-9) return first; // gerak murni horizontal: tak ada yang dialihkan
      const wantY = Math.sign(moveY) * Math.sqrt(Math.max(0, total * total - dx * dx));
      return moveWithCollision(grid, first.x, first.y, 0, wantY - dy, half);
    }
    if (Math.abs(moveX) < 1e-9) return first;
    const wantX = Math.sign(moveX) * Math.sqrt(Math.max(0, total * total - dy * dy));
    return moveWithCollision(grid, first.x, first.y, wantX - dx, 0, half);
  }

  return {
    COLS,
    ROWS,
    TILE_SIZE,
    FLOOR,
    WALL,
    generate,
    collidesWithWall,
    moveWithCollision,
    slideMove,
  };
});
