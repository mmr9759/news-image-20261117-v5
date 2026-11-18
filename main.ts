// news-image-20261117 v5 — "THE WORLD TODAY"
// One-page newspaper front page summing up Tuesday 17 November 2026:
// 40 stories, six continents, one front page, a world map and a numbers strip.
// Pure Node 22 stdlib: draws into an RGB buffer and encodes a PNG by hand.
// No network, no randomness, no dates at runtime: two runs write identical bytes.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 227];
const INK: RGB = [22, 20, 16];
const RED: RGB = [163, 31, 22];
const BLUE: RGB = [31, 78, 121];
const TEAL: RGB = [30, 107, 82];
const ORANGE: RGB = [178, 90, 16];
const PURPLE: RGB = [91, 58, 117];
const GREY: RGB = [107, 101, 90];
const RULE: RGB = [190, 182, 160];
const SKY: RGB = [214, 231, 235];
const SEA: RGB = [178, 203, 212];
const LAND: RGB = [232, 219, 190];
const LANDLINE: RGB = [120, 105, 80];
const SMOKE: RGB = [120, 118, 110];
const GOLD: RGB = [214, 158, 32];

// ------------------------------------------------------------- PNG encoder
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- framebuffer
class Canvas {
  px: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  fill(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
        i += 3;
      }
    }
  }
  hline(x: number, y: number, w: number, c: RGB, t = 1): void {
    this.fill(x, y, w, t, c);
  }
  vline(x: number, y: number, h: number, c: RGB, t = 1): void {
    this.fill(x, y, t, h, c);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.hline(x, y, w, c, t);
    this.hline(x, y + h - t, w, c, t);
    this.vline(x, y, h, c, t);
    this.vline(x + w - t, y, h, c, t);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fill(x - ((t - 1) >> 1), y - ((t - 1) >> 1), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.fill(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }
  // Scanline fill of a simple polygon (even-odd rule).
  poly(points: Array<[number, number]>, c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(this.h - 1, Math.floor(maxY)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fill(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c);
      }
    }
  }
}

// ------------------------------------------------------------ 5x7 bitmap font
// Each glyph is 7 rows of 5 cells; '#' is ink, '.' is blank.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".....", ".##..", "#...."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "#...."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "&": [".###.", "#...#", "#...#", ".#.#.", "#..#.", "#.#..", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.###", "#..##"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "*": [".....", ".#.#.", "..#..", "#####", "..#..", ".#.#.", "....."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "•": [".....", ".....", ".###.", ".###.", ".###.", ".....", "....."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
};

function glyph(ch: string): string[] {
  const g = FONT[ch];
  if (g) return g;
  return FONT["?"];
}

function textWidth(s: string, scale: number): number {
  if (s.length === 0) return 0;
  return s.length * 6 * scale - scale;
}

function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB): void {
  const up = s.toUpperCase();
  let cx = x;
  for (const ch of up) {
    const g = glyph(ch === "’" ? "'" : ch === "—" || ch === "–" ? "-" : ch === "“" || ch === "”" ? '"' : ch);
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row[col] === "#") cv.fill(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(cv, s, cx - Math.floor(textWidth(s.toUpperCase(), scale) / 2), y, scale, c);
}

// Word-wrap plain text to lines of at most maxChars characters.
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ------------------------------------------------------------- world map data
// Rough continent outlines in [lon, lat]; projected equirectangular.
type LonLat = [number, number];
const CONTINENTS: LonLat[][] = [
  // North America
  [[-168, 66], [-150, 70], [-135, 69], [-125, 71], [-110, 73], [-95, 80], [-85, 70], [-76, 62], [-65, 60], [-60, 47], [-70, 42], [-75, 35], [-80, 26], [-90, 21], [-97, 16], [-105, 20], [-115, 28], [-125, 40], [-145, 60], [-165, 60]],
  // Greenland
  [[-55, 60], [-45, 60], [-30, 68], [-40, 76], [-58, 74]],
  // South America
  [[-80, 9], [-70, 11], [-60, 5], [-50, 0], [-40, -5], [-35, -8], [-40, -20], [-48, -28], [-55, -35], [-65, -45], [-70, -55], [-73, -40], [-70, -20], [-80, -5], [-81, 5]],
  // Europe
  [[-10, 36], [-9, 43], [-2, 48], [0, 51], [5, 53], [8, 57], [12, 55], [18, 56], [21, 55], [24, 59], [28, 60], [30, 70], [25, 71], [18, 69], [12, 65], [5, 60], [-5, 50], [-9, 43]],
  // Africa
  [[-17, 15], [-10, 31], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [43, 12], [51, 11], [48, 2], [40, -5], [40, -15], [35, -25], [28, -33], [20, -35], [15, -27], [12, -18], [9, 4], [-8, 5], [-15, 10]],
  // Asia
  [[30, 70], [40, 68], [55, 69], [70, 72], [90, 75], [110, 77], [130, 72], [150, 70], [170, 66], [178, 65], [170, 60], [162, 56], [158, 52], [142, 50], [140, 40], [135, 35], [130, 33], [127, 40], [122, 38], [120, 30], [115, 23], [108, 18], [105, 10], [100, 8], [98, 15], [95, 16], [92, 21], [88, 22], [80, 13], [77, 8], [75, 15], [70, 20], [66, 25], [60, 25], [57, 27], [52, 28], [50, 30], [48, 30], [44, 29], [40, 31], [36, 36], [30, 36], [28, 41], [30, 46], [32, 55], [30, 60]],
  // Australia
  [[113, -22], [114, -30], [115, -35], [120, -34], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -15], [142, -11], [136, -12], [132, -11], [126, -14], [122, -17], [118, -20]],
  // Indonesia
  [[95, 5], [100, 0], [105, -5], [110, -7], [115, -8], [120, -10], [125, -9], [130, -3], [135, -4], [140, -8], [138, -8], [130, -2], [120, 0], [110, 2], [100, 5]],
  // Japan
  [[130, 31], [132, 33], [135, 34], [137, 35], [139, 37], [140, 39], [141, 41], [142, 43], [144, 44], [145, 44], [143, 42], [141, 40], [139, 37], [137, 34], [134, 33], [131, 32]],
  // New Zealand
  [[167, -45], [170, -43], [173, -41], [175, -38], [177, -38], [175, -40], [172, -42], [168, -46]],
  // United Kingdom
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
];

// Where Tuesday's news happened: [lon, lat].
const PINS: LonLat[] = [
  [36, 45.3], // Kerch Strait
  [30.5, 50.4], // Kyiv
  [34.5, 31.5], // Gaza
  [-0.1, 51.5], // London
  [2.3, 48.9], // Paris
  [28.9, 47], // Chisinau
  [139.7, 35.7], // Tokyo
  [45, 12.8], // Aden
  [106.9, 47.9], // Ulaanbaatar
  [15.3, -4.3], // Kinshasa
  [-72.3, 18.5], // Port-au-Prince
  [-77, 38.9], // Washington
  [114.1, 22.5], // Shenzhen / APEC
];

function drawMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fill(x, y, w, h, SKY);
  cv.rect(x, y, w, h, INK, 1);
  const proj = (lon: number, lat: number): [number, number] => [
    Math.round(x + ((lon + 180) / 360) * w),
    Math.round(y + ((75 - lat) / 135) * h),
  ];
  for (const cont of CONTINENTS) {
    const pts = cont.map(([lon, lat]) => proj(lon, lat));
    cv.poly(pts, LAND);
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      cv.line(x0, y0, x1, y1, LANDLINE, 1);
    }
  }
  // Region labels, placed in open space.
  const labels: Array<[string, number, number]> = [
    ["N. AMERICA", -108, 55],
    ["S. AMERICA", -62, -18],
    ["EUROPE", -18, 58],
    ["AFRICA", 5, 15],
    ["ASIA", 95, 63],
    ["OCEANIA", 138, -30],
  ];
  for (const [t, lon, lat] of labels) {
    const [px, py] = proj(lon, lat);
    drawText(cv, t, px - Math.floor(textWidth(t, 1) / 2), py, 1, GREY);
  }
  // Pins: red dots with a white ring.
  for (const [lon, lat] of PINS) {
    const [px, py] = proj(lon, lat);
    cv.disc(px, py, 5, RED);
    cv.disc(px, py, 2, [255, 255, 255]);
  }
}

// ------------------------------------------------------- lead illustration
// The Kerch Bridge: deck, two towers, a broken span, smoke over the strait.
function drawBridge(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fill(x, y, w, h, SKY);
  const horizon = y + Math.floor(h * 0.62);
  cv.fill(x, horizon, w, y + h - horizon, SEA);
  cv.rect(x, y, w, h, INK, 1);
  // Distant shore.
  cv.fill(x + 8, horizon - 8, 60, 8, LAND);
  cv.fill(x + w - 70, horizon - 6, 62, 6, LAND);
  // Towers.
  const t1 = x + Math.floor(w * 0.22);
  const t2 = x + Math.floor(w * 0.74);
  const deckY = horizon - 26;
  cv.fill(t1 - 3, deckY - 46, 6, 46 + 26, INK);
  cv.fill(t2 - 3, deckY - 46, 6, 46 + 26, INK);
  // Cables from tower tops to the deck.
  cv.line(t1, deckY - 46, x + 6, deckY, INK, 1);
  cv.line(t1, deckY - 46, x + Math.floor(w * 0.44), deckY, INK, 1);
  cv.line(t2, deckY - 46, x + Math.floor(w * 0.56), deckY, INK, 1);
  cv.line(t2, deckY - 46, x + w - 6, deckY, INK, 1);
  // Deck: intact on both sides, broken in the middle.
  const gapL = x + Math.floor(w * 0.44);
  const gapR = x + Math.floor(w * 0.58);
  cv.fill(x + 2, deckY, gapL - (x + 2), 5, INK);
  cv.fill(gapR, deckY, x + w - 2 - gapR, 5, INK);
  // Fallen span, tilted down into the water.
  cv.line(gapL + 2, deckY + 2, gapR - 6, deckY + 24, INK, 4);
  // Blast: gold starburst + grey smoke above the gap.
  const bx = Math.floor((gapL + gapR) / 2);
  const by = deckY - 6;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    cv.line(bx, by, Math.round(bx + Math.cos(a) * 16), Math.round(by + Math.sin(a) * 16), GOLD, 2);
  }
  cv.disc(bx, by, 7, GOLD);
  cv.disc(bx - 12, by - 16, 9, SMOKE);
  cv.disc(bx + 4, by - 26, 12, SMOKE);
  cv.disc(bx + 16, by - 14, 8, SMOKE);
  cv.disc(bx - 2, by - 34, 7, SMOKE);
  // Small boat on the strait.
  const boatX = x + Math.floor(w * 0.68);
  const boatY = horizon + 12;
  cv.fill(boatX, boatY, 26, 5, INK);
  cv.fill(boatX + 8, boatY - 8, 4, 8, INK);
  cv.line(boatX + 2, boatY + 8, boatX + 30, boatY + 8, [255, 255, 255], 1);
}

// ------------------------------------------------------------- story helpers
interface Story {
  n: number;
  tag: string;
  color: RGB;
  head: string;
  deck: string;
}

const C_EUROPE = BLUE;
const C_MIDEAST = RED;
const C_ASIA = TEAL;
const C_AFRICA = ORANGE;
const C_AMERICAS = PURPLE;
const C_MARKETS = [90, 90, 30] as RGB;
const C_SCIENCE = [40, 110, 130] as RGB;

// A compact grid item: red number + headline wrapped to two lines, scale 2.
// Lines sit on a 16 px pitch so the 14 px glyphs keep a 2 px gap.
function drawItem(cv: Canvas, s: Story, x: number, y: number, w: number): void {
  const numW = textWidth(String(s.n).padStart(2, "0"), 2) + 6;
  drawText(cv, String(s.n).padStart(2, "0"), x, y, 2, s.color);
  const lines = wrap(s.head, Math.floor((w - numW) / 12));
  drawText(cv, lines[0] ?? "", x + numW, y, 2, INK);
  if (lines[1]) drawText(cv, lines[1], x + numW, y + 16, 2, INK);
}

// A section header inside the grid: coloured square + small caps label.
function drawSection(cv: Canvas, label: string, color: RGB, x: number, y: number, w: number): void {
  cv.fill(x, y + 2, 14, 10, color);
  drawText(cv, label, x + 20, y, 2, INK);
}

// ------------------------------------------------------------- the 40 stories
// All events reported on Tuesday 17 November 2026, grouped by region.
// Lead (1) + three majors (2-4) + 36 compact items (5-40) = 40 stories.
const LEAD_HEAD = "UKRAINE HITS KERCH BRIDGE; RUSSIA STRIKES KYIV BRIDGES";
const LEAD_DECK =
  "Second strike in two days wrecks a span; Moscow hits two Dnipro bridges and the metro in reply.";

const MAJORS: Array<{ n: number; tag: string; color: RGB; head: string; deck: string }> = [
  {
    n: 2,
    tag: "MIDDLE EAST",
    color: C_MIDEAST,
    head: "FOUR NATIONS DEMAND GAZA AID",
    deck: "UK, Australia, Canada, Italy: open the crossings.",
  },
  {
    n: 3,
    tag: "ASIA-PACIFIC",
    color: C_ASIA,
    head: "TRUMP HEADS TO ASIA FOR SUMMIT",
    deck: "Quad seals minerals pacts; Xi-Putin talks at APEC.",
  },
  {
    n: 4,
    tag: "EUROPE",
    color: C_EUROPE,
    head: "UK SANCTIONS 8 FIRMS",
    deck: "West Bank building hit; Israel calls it hostile.",
  },
];

const ITEMS: Story[] = [
  { n: 5, tag: "EUROPE", color: C_EUROPE, head: "DEPARDIEU ADMITS SEXUAL ASSAULT, DROPS APPEAL", deck: "" },
  { n: 6, tag: "EUROPE", color: C_EUROPE, head: "RUSSIAN DRONE FLEW OVER CHISINAU, MOLDOVA SAYS", deck: "" },
  { n: 7, tag: "EUROPE", color: C_EUROPE, head: "LE PEN PROMISES EARLIER RETIREMENT IF ELECTED", deck: "" },
  { n: 8, tag: "EUROPE", color: C_EUROPE, head: "EU CHARGES TEMU OVER ILLEGAL PRODUCT SALES", deck: "" },
  { n: 9, tag: "EUROPE", color: C_EUROPE, head: "FIVE EU STATES PLAN RWANDA RETURN HUB", deck: "" },
  { n: 10, tag: "MIDDLE EAST", color: C_MIDEAST, head: "SETTLER MOB KILLS WOMAN, 72, IN JERICHO", deck: "" },
  { n: 11, tag: "MIDDLE EAST", color: C_MIDEAST, head: "ISRAEL SUSPENDS E1 SETTLEMENT TENDER", deck: "" },
  { n: 12, tag: "MIDDLE EAST", color: C_MIDEAST, head: "KAHANA ELECTED SPEAKER OF KNESSET", deck: "" },
  { n: 13, tag: "MIDDLE EAST", color: C_MIDEAST, head: "HOUTHIS ADVANCE AS YEMEN ARMY FALLS BACK", deck: "" },
  { n: 14, tag: "MIDDLE EAST", color: C_MIDEAST, head: "SAUDI STRIKE KILLS 7 AT HUDAYDAH FACTORY", deck: "" },
  { n: 15, tag: "MIDDLE EAST", color: C_MIDEAST, head: "IRAN DRONE HITS US BASE IN BAHRAIN AGAIN", deck: "" },
  { n: 16, tag: "MIDDLE EAST", color: C_MIDEAST, head: "THIRD US CARRIER REACHES THE MIDDLE EAST", deck: "" },
  { n: 17, tag: "MIDDLE EAST", color: C_MIDEAST, head: "TRUMP 'LOOKING INTO' DIRTY-BOMB CLAIM", deck: "" },
  { n: 18, tag: "MIDDLE EAST", color: C_MIDEAST, head: "KATAIB HEZBOLLAH VOWS TO RESIST IRAQ ARMY", deck: "" },
  { n: 19, tag: "ASIA-PACIFIC", color: C_ASIA, head: "JAPAN SCRAMBLES JETS AS RUSSIAN PLANES INTRUDE", deck: "" },
  { n: 20, tag: "ASIA-PACIFIC", color: C_ASIA, head: "MONGOLIA PRESIDENT QUITS IN GRAFT SCANDAL", deck: "" },
  { n: 21, tag: "AFRICA", color: C_AFRICA, head: "EBOLA IN CONGO SPREADS AT 'RECORD PACE'", deck: "" },
  { n: 22, tag: "AFRICA", color: C_AFRICA, head: "2.3M MORE FACE CRISIS HUNGER IN EAST CONGO", deck: "" },
  { n: 23, tag: "AMERICAS", color: C_AMERICAS, head: "FAA HALTS ROUTERS AFTER GROUND STOP", deck: "" },
  { n: 24, tag: "AMERICAS", color: C_AMERICAS, head: "UNITED AIRLINES HIT BY 90-MINUTE OUTAGE", deck: "" },
  { n: 25, tag: "AMERICAS", color: C_AMERICAS, head: "JPMORGAN BLAMES BUG FOR BANKING OUTAGE", deck: "" },
  { n: 26, tag: "AMERICAS", color: C_AMERICAS, head: "US LOSES MEASLES-FREE STATUS AFTER 30 YEARS", deck: "" },
  { n: 27, tag: "AMERICAS", color: C_AMERICAS, head: "PENTAGON FAILS AUDIT FOR NINTH YEAR RUNNING", deck: "" },
  { n: 28, tag: "AMERICAS", color: C_AMERICAS, head: "NSA NETWORK CRASHES AS OUTAGES SPREAD", deck: "" },
  { n: 29, tag: "AMERICAS", color: C_AMERICAS, head: "EXPERT: EPSTEIN DEATH WAS MURDER, NOT SUICIDE", deck: "" },
  { n: 30, tag: "AMERICAS", color: C_AMERICAS, head: "EX-NVIDIA CHIEF: I'D RETURN IF BOARD ASKED", deck: "" },
  { n: 31, tag: "AMERICAS", color: C_AMERICAS, head: "JUDGE VOIDS CURBS ON FOREIGN STUDENTS' STAYS", deck: "" },
  { n: 32, tag: "AMERICAS", color: C_AMERICAS, head: "HAITI PROTESTS BACK SALVADORAN TROOPS", deck: "" },
  { n: 33, tag: "MARKETS", color: C_MARKETS, head: "AI STOCKS LEAD WALL STREET LOSSES", deck: "" },
  { n: 34, tag: "MARKETS", color: C_MARKETS, head: "BITCOIN STALLS BELOW $65,000 AFTER SELLOFF", deck: "" },
  { n: 35, tag: "MARKETS", color: C_MARKETS, head: "OIL CAUGHT BETWEEN EXPORTS AND TANKER HITS", deck: "" },
  { n: 36, tag: "MARKETS", color: C_MARKETS, head: "SITES HACKED TO STEAL CRYPTO, IPHONES HIT", deck: "" },
  { n: 37, tag: "MARKETS", color: C_MARKETS, head: "DEUTSCHE BANK SLIDES AS EUROPE SHARES FALL", deck: "" },
  { n: 38, tag: "SCIENCE", color: C_SCIENCE, head: "UN: CHEMICALS COST $1.1 TRILLION A YEAR", deck: "" },
  { n: 39, tag: "SCIENCE", color: C_SCIENCE, head: "PHONE POUCHES LIFT TEST SCORES A LITTLE", deck: "" },
  { n: 40, tag: "SCIENCE", color: C_SCIENCE, head: "BECKHAM FIRM SUES COTY FOR $41M", deck: "" },
];

// Grid columns: each block is a section header plus its items.
interface Block {
  label: string;
  color: RGB;
  items: Story[];
}
const byNum = (n: number): Story => ITEMS.find((s) => s.n === n) as Story;
const COLUMNS: Block[][] = [
  [
    { label: "EUROPE", color: C_EUROPE, items: [5, 6, 7, 8, 9].map(byNum) },
    { label: "MIDDLE EAST", color: C_MIDEAST, items: [10, 11, 12, 13, 14, 15, 16].map(byNum) },
  ],
  [
    { label: "MIDDLE EAST", color: C_MIDEAST, items: [17, 18].map(byNum) },
    { label: "ASIA & AFRICA", color: C_ASIA, items: [19, 20, 21, 22].map(byNum) },
    { label: "AMERICAS", color: C_AMERICAS, items: [23, 24, 25, 26, 27, 28].map(byNum) },
  ],
  [
    { label: "AMERICAS", color: C_AMERICAS, items: [29, 30, 31, 32].map(byNum) },
    { label: "MARKETS", color: C_MARKETS, items: [33, 34, 35, 36, 37].map(byNum) },
    { label: "SCIENCE & CULTURE", color: C_SCIENCE, items: [38, 39, 40].map(byNum) },
  ],
];

// ------------------------------------------------------------------- render
function render(): Buffer {
  const cv = new Canvas(W, H);
  cv.fill(0, 0, W, H, PAPER);

  // Masthead.
  drawTextCentered(cv, "THE WORLD TODAY", 512, 24, 8, INK);
  drawTextCentered(
    cv,
    "TUESDAY 17 NOVEMBER 2026 — 40 STORIES — SIX CONTINENTS — ONE FRONT PAGE",
    512,
    88,
    2,
    RED,
  );
  cv.hline(24, 108, 976, INK, 2);

  // Lead story (left) + bridge illustration (right).
  drawText(cv, "01 — LEAD STORY • EUROPE", 24, 122, 2, RED);
  const leadLines = wrap(LEAD_HEAD, 25);
  leadLines.forEach((ln, i) => drawText(cv, ln, 24, 142 + i * 32, 4, INK));
  const deckLines = wrap(LEAD_DECK, 51);
  deckLines.forEach((ln, i) => drawText(cv, ln, 24, 240 + i * 16, 2, INK));
  drawBridge(cv, 664, 118, 336, 142);
  drawText(cv, "THE KERCH BRIDGE AFTER TUESDAY'S STRIKE", 664, 266, 1, GREY);
  cv.hline(24, 284, 976, INK, 1);

  // Three majors.
  const majorX = [24, 356, 688];
  MAJORS.forEach((m, i) => {
    const x = majorX[i];
    drawText(cv, `0${m.n} — ${m.tag}`, x, 290, 2, m.color);
    const hl = wrap(m.head, 17);
    hl.forEach((ln, j) => drawText(cv, ln, x, 308 + j * 24, 3, INK));
    const dl = wrap(m.deck, 26);
    dl.forEach((ln, j) => drawText(cv, ln, x, 358 + j * 16, 2, INK));
  });
  cv.hline(24, 396, 976, INK, 1);

  // World map (left) + day in numbers (right).
  drawMap(cv, 24, 404, 600, 118);
  drawText(cv, "THE DAY IN NUMBERS", 648, 404, 2, RED);
  drawText(cv, "93,000", 648, 422, 3, INK);
  drawText(cv, "TENTS SENT INTO", 763, 422, 2, INK);
  drawText(cv, "GAZA", 763, 438, 2, INK);
  drawText(cv, "8,600", 648, 454, 3, INK);
  drawText(cv, "AID TRUCKS HAVE", 763, 454, 2, INK);
  drawText(cv, "ENTERED", 763, 470, 2, INK);
  drawText(cv, "$1.1 TRILLION", 648, 486, 3, INK);
  drawText(cv, "COST OF CHEMICALS, PER YEAR", 648, 508, 2, INK);

  // Numbers strip.
  cv.hline(24, 530, 976, INK, 1);
  drawTextCentered(cv, "11,254 EBOLA CASES • 5,505 DEATHS • BITCOIN BELOW $65,000 • UNITED OUTAGE 90 MIN", 512, 536, 2, INK);
  cv.hline(24, 556, 976, INK, 1);

  // Story grid.
  const gridY = 562;
  const gridH = 441;
  const colX = [24, 356, 688];
  COLUMNS.forEach((blocks, ci) => {
    const x = colX[ci];
    const needed = blocks.reduce((sum, b) => sum + 14 + b.items.length * 32, 0);
    const gap = Math.max(0, Math.floor((gridH - needed) / blocks.length));
    let y = gridY;
    for (const b of blocks) {
      drawSection(cv, b.label, b.color, x, y, 312);
      y += 14;
      for (const s of b.items) {
        drawItem(cv, s, x, y, 312);
        y += 32;
      }
      y += gap;
    }
  });

  // Footer.
  drawTextCentered(
    cv,
    "ALL EVENTS REPORTED ON TUESDAY 17 NOVEMBER 2026 • SOURCES: WIRE REPORTS",
    512,
    1008,
    1,
    GREY,
  );

  return encodePNG(W, H, Buffer.from(cv.px));
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + "/entry.png", render());
}

main();
