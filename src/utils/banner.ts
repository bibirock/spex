/**
 * Spex 啟動 banner — 斜體 ASCII art + 24-bit truecolor 漸層。
 * 風格參考 Electron / Vite / Nuxt 的 CLI 啟動畫面。
 */

const ART = [
  '   _____                ',
  '  / ___/____  ___  _  __',
  '  \\__ \\/ __ \\/ _ \\| |/_/',
  ' ___/ / /_/ /  __/>  <  ',
  '/____/ .___/\\___/_/|_|  ',
  '    /_/                 ',
];

/** 兩個顏色之間做線性內插（0..1） */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 將文字塗上 24-bit truecolor + bold + italic */
function paint(text: string, color: RGB, opts: { bold?: boolean; italic?: boolean } = {}): string {
  const codes: string[] = [];
  if (opts.bold) codes.push('1');
  if (opts.italic) codes.push('3');
  codes.push(`38;2;${color.r};${color.g};${color.b}`);
  return `\x1b[${codes.join(';')}m${text}\x1b[0m`;
}

/**
 * 從起始色到結束色，依字元位置做橫向漸層；同時依行做縱向位移，
 * 形成左上→右下的對角線色彩流。
 */
function gradientLine(line: string, row: number, totalRows: number): string {
  // 起始紫 (#a855f7) → 結束青 (#22d3ee)
  const start: RGB = { r: 168, g: 85, b: 247 };
  const end: RGB = { r: 34, g: 211, b: 238 };

  const out: string[] = [];
  for (let col = 0; col < line.length; col++) {
    const t =
      (col / Math.max(line.length - 1, 1)) * 0.6 +
      (row / Math.max(totalRows - 1, 1)) * 0.4;
    const color: RGB = {
      r: lerp(start.r, end.r, t),
      g: lerp(start.g, end.g, t),
      b: lerp(start.b, end.b, t),
    };
    out.push(paint(line[col]!, color, { bold: true, italic: true }));
  }
  return out.join('');
}

export function printBanner(version: string): void {
  // 終端機若不支援彩色或為 CI，輸出純文字版避免亂碼
  if (process.env.NO_COLOR || process.env.CI) {
    console.log('Spex v' + version);
    console.log('Spec-Driven Development CLI');
    console.log('');
    return;
  }

  console.log('');
  for (let i = 0; i < ART.length; i++) {
    console.log(gradientLine(ART[i]!, i, ART.length));
  }

  const tagline = '   ⚡  Spec-Driven Development CLI';
  const versionLine = `   ◆  v${version}`;
  // 副標題用青色 italic
  console.log(paint(tagline, { r: 110, g: 231, b: 234 }, { italic: true }));
  console.log(paint(versionLine, { r: 165, g: 180, b: 252 }, { italic: true }));
  console.log('');
}
