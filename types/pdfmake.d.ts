declare module 'pdfmake/build/pdfmake.js' {
  export interface PdfMakeFontFamily {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }

  export interface PdfMakeBrowserDocument {
    getBlob(): Promise<Blob>;
  }

  export interface PdfMakeBrowser {
    addVirtualFileSystem(vfs: Record<string, string>): void;
    addFonts(fonts: Record<string, PdfMakeFontFamily>): void;
    createPdf(definition: Record<string, unknown>): PdfMakeBrowserDocument;
  }

  const pdfMake: PdfMakeBrowser;
  export default pdfMake;
}

declare module 'pdfmake' {
  export interface PdfMakeServerDocument {
    getBuffer(): Promise<Buffer>;
  }

  export interface PdfMakeServer {
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    addFonts(fonts: Record<string, Record<string, string>>): void;
    createPdf(definition: Record<string, unknown>): PdfMakeServerDocument;
  }

  const pdfMake: PdfMakeServer;
  export default pdfMake;
}
