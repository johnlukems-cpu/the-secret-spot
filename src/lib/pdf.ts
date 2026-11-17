import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const CHARCOAL = rgb(0x17 / 255, 0x1a / 255, 0x18 / 255);
const GOLD = rgb(0xd8 / 255, 0xc4 / 255, 0x9a / 255);
const TAUPE = rgb(0x8a / 255, 0x81 / 255, 0x75 / 255);
const A4: [number, number] = [595.28, 841.89];
const M = 48;

/** Standard PDF fonts only support WinAnsi; replace anything else. */
export function safe(text: unknown): string {
  return String(text ?? "")
    .replace(/[→]/g, "->")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ–—€•]/g, "?");
}

export class DocBuilder {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;

  static async create(title: string, subtitle?: string) {
    const b = new DocBuilder();
    b.doc = await PDFDocument.create();
    b.doc.setTitle(safe(title));
    b.doc.setProducer("THE SECRET SPOT");
    b.font = await b.doc.embedFont(StandardFonts.Helvetica);
    b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.newPage();
    b.text(safe(title), { size: 18, bold: true });
    if (subtitle) b.text(safe(subtitle), { size: 10, color: TAUPE });
    b.y -= 8;
    return b;
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    const { width, height } = this.page.getSize();
    this.page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: CHARCOAL });
    this.page.drawCircle({ x: M + 14, y: height - 35, size: 14, borderColor: rgb(0.95, 0.93, 0.89), borderWidth: 1 });
    this.page.drawCircle({ x: M + 14, y: height - 31, size: 4, color: GOLD });
    this.page.drawRectangle({ x: M + 11.5, y: height - 44, width: 5, height: 9, color: GOLD });
    this.page.drawText("THE SECRET SPOT", { x: M + 38, y: height - 38, size: 15, font: this.bold, color: rgb(0.95, 0.93, 0.89) });
    this.page.drawText("YOUR STYLE. YOUR SECRET.", { x: M + 38, y: height - 52, size: 7, font: this.font, color: GOLD });
    this.page.drawText(safe(`Pagina ${this.doc.getPageCount()}`), { x: width - M - 50, y: 24, size: 8, font: this.font, color: TAUPE });
    this.y = height - 100;
  }

  ensure(space: number) {
    if (this.y - space < 50) this.newPage();
  }

  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const maxWidth = A4[0] - M * 2 - ((o.x ?? M) - M);
    const font = o.bold ? this.bold : this.font;
    for (const para of safe(t).split("\n")) {
      let line = "";
      const words = para.split(" ");
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
          this.ensure(size + 4);
          this.page.drawText(line, { x: o.x ?? M, y: this.y, size, font, color: o.color ?? CHARCOAL });
          this.y -= size + (o.gap ?? 4);
          line = w;
        } else line = test;
      }
      this.ensure(size + 4);
      this.page.drawText(line, { x: o.x ?? M, y: this.y, size, font, color: o.color ?? CHARCOAL });
      this.y -= size + (o.gap ?? 4);
    }
  }

  kv(rows: [string, string][], opts: { boldLast?: boolean } = {}) {
    rows.forEach(([k, v], i) => {
      this.ensure(16);
      const font = opts.boldLast && i === rows.length - 1 ? this.bold : this.font;
      this.page.drawText(safe(k), { x: M, y: this.y, size: 10, font, color: CHARCOAL });
      const w = font.widthOfTextAtSize(safe(v), 10);
      this.page.drawText(safe(v), { x: A4[0] - M - w, y: this.y, size: 10, font, color: CHARCOAL });
      this.y -= 15;
    });
  }

  table(headers: string[], rows: string[][], widths: number[], alignRight: number[] = []) {
    const total = A4[0] - M * 2;
    const cols = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * total);
    const drawRow = (cells: string[], bold = false) => {
      this.ensure(18);
      let x = M;
      cells.forEach((c, i) => {
        const font = bold ? this.bold : this.font;
        let s = safe(c);
        while (s.length > 1 && font.widthOfTextAtSize(s, 9) > cols[i] - 6) s = `${s.slice(0, -2)}.`;
        const w = font.widthOfTextAtSize(s, 9);
        this.page.drawText(s, { x: alignRight.includes(i) ? x + cols[i] - w - 3 : x + 3, y: this.y, size: 9, font, color: CHARCOAL });
        x += cols[i];
      });
      this.y -= 16;
    };
    this.ensure(30);
    this.page.drawRectangle({ x: M, y: this.y - 4, width: total, height: 16, color: rgb(0.953, 0.929, 0.886) });
    drawRow(headers, true);
    rows.forEach((r) => drawRow(r));
    this.page.drawLine({ start: { x: M, y: this.y + 10 }, end: { x: M + total, y: this.y + 10 }, thickness: 0.5, color: TAUPE });
    this.y -= 6;
  }

  spacer(h = 10) {
    this.y -= h;
  }

  async bytes(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function csvResponse(rows: Record<string, unknown>[], filename: string) {
  const headers = rows.length ? Object.keys(rows[0]) : ["leeg"];
  const esc = (v: unknown) => {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent CSV formula injection
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  return new Response("﻿" + body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}
