import { crc32, deflateSync } from "node:zlib";

/** PNG xám 8-bit một màu, kích thước tuỳ ý — đủ để react-pdf nhận ảnh thật; `mau` khác nhau ⇒ mã băm khác nhau. */
export function taoPng(width: number, height: number, mau = 200): Uint8Array {
  const chunk = (loai: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(loai, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const dong = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, mau)]); // filter 0 + pixel
  const raw = Buffer.concat(Array.from({ length: height }, () => dong));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** JPEG tối thiểu CHỈ có SOI + SOF0 (đủ để đọc kích thước; KHÔNG giải mã được) — dùng cho test đọc chữ ký. */
export function taoJpegDauTep(width: number, height: number): Uint8Array {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3;
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]));
}
