// SINH TỰ ĐỘNG từ public/portal/sticker/*.webp (kích thước pixel THẬT của tệp) — đừng sửa tay; thêm ảnh thì chạy lại bước cắt rồi sinh lại.
// Bộ sticker robot của thiết kế (giaodien_v2): nền đen đã tách thành WebP trong suốt. Lưới [STK-*] canh bảng này khớp tệp.
export const STICKER = {
  "an-mung": { w: 158, h: 182 },
  "but-chi": { w: 130, h: 181 },
  chao: { w: 292, h: 420 },
  "doc-sach": { w: 134, h: 177 },
  khen: { w: 127, h: 188 },
  "may-tinh": { w: 142, h: 164 },
  qua: { w: 289, h: 420 },
  "sieu-nhan": { w: 188, h: 194 },
  "thu-gian": { w: 136, h: 146 },
  tim: { w: 420, h: 364 },
  "tim-kiem": { w: 154, h: 188 },
  "tot-nghiep": { w: 144, h: 198 },
} as const;

export type TenSticker = keyof typeof STICKER;
