declare module 'fontkit' {
  export interface FontkitFont {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }

  export function openSync(path: string): FontkitFont;
}
