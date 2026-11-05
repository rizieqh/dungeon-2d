// Synthesizer efek suara sederhana dengan Web Audio API: semua suara dibuat dari oscillator
// dan noise, tanpa file audio eksternal.
//
// Fungsi publik (global, dipakai app.js):
//   playShootSFX(type, volume)  type: 'assault' | 'shotgun' | 'sniper'
//   playHitSFX()                peluru mengenai musuh
//   playExplosionSFX(big)       musuh hancur (big = true untuk boss)
//   playPlayerHitSFX()          pemain terkena damage
//
// Browser hanya mengizinkan audio setelah interaksi pengguna, jadi AudioContext dibuat/
// di-resume pada klik atau tombol pertama. Sebelum itu semua fungsi diam saja (no-op).

const SFX_MASTER_VOLUME = 0.35;

// Jeda minimum (ms) antar pemutaran suara yang sama. Mencegah suara menumpuk dan pecah
// saat banyak kejadian di tick yang sama (mis. 5 peluru shotgun kena bersamaan).
const SFX_MIN_INTERVAL_MS = { shoot: 30, hit: 45, explosion: 70, playerHit: 120 };

let audioCtx = null;
let masterGain = null;
let noiseBuffer = null;
const lastPlayedAt = {};

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null; // browser tanpa Web Audio: SFX dimatikan

  audioCtx = new AudioContextClass();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = SFX_MASTER_VOLUME;
  masterGain.connect(audioCtx.destination);

  // 1 detik white noise, dipakai ulang untuk semua suara berbasis noise
  noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  return audioCtx;
}

// Dipanggil pada interaksi pertama pengguna (kebijakan autoplay browser)
function unlockAudio() {
  const ctx = ensureAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// AudioContext siap dipakai dan suara jenis ini tidak sedang di-throttle
function canPlay(name) {
  if (!audioCtx || audioCtx.state !== 'running') return false;
  if (document.hidden) return false; // tab di belakang: jangan bunyi
  const now = performance.now();
  if (now - (lastPlayedAt[name] || 0) < SFX_MIN_INTERVAL_MS[name]) return false;
  lastPlayedAt[name] = now;
  return true;
}

// Envelope volume: naik cepat, lalu turun eksponensial sampai hampir senyap
function envelope(gainNode, start, peak, duration) {
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
}

// Oscillator dengan sapuan frekuensi (pitch sweep)
function tone({ wave, from, to, duration, peak, delay = 0, destination = masterGain }) {
  const start = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  envelope(gain, start, peak, duration);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Semburan noise lewat filter (lowpass/highpass/bandpass), cutoff bisa disapu
function noise({ filter, from, to = from, duration, peak, q = 1, delay = 0, destination = masterGain }) {
  const start = audioCtx.currentTime + delay;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const biquad = audioCtx.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(from, start);
  biquad.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  const gain = audioCtx.createGain();
  envelope(gain, start, peak, duration);
  src.connect(biquad).connect(gain).connect(destination);
  src.start(start);
  src.stop(start + duration + 0.02);
}

// Gain tambahan untuk mengecilkan suara tertentu (mis. tembakan pemain lain)
function subMix(volume) {
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  gain.connect(masterGain);
  return gain;
}

// --- Suara ---

// Tiap senjata punya karakter & pitch berbeda:
// assault = "pew" tinggi & pendek, shotgun = dentuman rendah berderau, sniper = retakan tajam
// dengan ekor panjang.
function playShootSFX(type, volume = 1) {
  if (!canPlay('shoot')) return;
  const out = subMix(volume);

  if (type === 'shotgun') {
    noise({ filter: 'lowpass', from: 2200, to: 300, duration: 0.2, peak: 0.9, destination: out });
    tone({ wave: 'sine', from: 160, to: 55, duration: 0.18, peak: 0.6, destination: out });
  } else if (type === 'sniper') {
    noise({ filter: 'highpass', from: 3000, to: 1200, duration: 0.06, peak: 0.7, destination: out });
    tone({ wave: 'sawtooth', from: 1500, to: 110, duration: 0.32, peak: 0.35, destination: out });
    tone({ wave: 'sine', from: 90, to: 40, duration: 0.3, peak: 0.5, destination: out });
  } else {
    // assault (dan default)
    tone({ wave: 'square', from: 900, to: 240, duration: 0.08, peak: 0.22, destination: out });
    noise({ filter: 'bandpass', from: 2500, duration: 0.04, peak: 0.25, q: 2, destination: out });
  }
}

// Blip pendek bernada naik
function playHitSFX() {
  if (!canPlay('hit')) return;
  tone({ wave: 'triangle', from: 1200, to: 1900, duration: 0.05, peak: 0.3 });
}

// Boom: noise lowpass yang menurun + dentuman sine rendah. big = versi boss (lebih panjang & berat)
function playExplosionSFX(big = false) {
  if (!canPlay('explosion')) return;
  const scale = big ? 2.5 : 1;
  noise({ filter: 'lowpass', from: 1400, to: 80, duration: 0.35 * scale, peak: 0.9 });
  tone({ wave: 'sine', from: 140, to: 35, duration: 0.3 * scale, peak: big ? 0.9 : 0.6 });
}

// Suara "aduh": nada rendah turun yang agak kasar, mudah dibedakan dari suara musuh
function playPlayerHitSFX() {
  if (!canPlay('playerHit')) return;
  tone({ wave: 'sawtooth', from: 260, to: 80, duration: 0.22, peak: 0.35 });
  noise({ filter: 'bandpass', from: 600, to: 200, duration: 0.15, peak: 0.4, q: 3 });
}
