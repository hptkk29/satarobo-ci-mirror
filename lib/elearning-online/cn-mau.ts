import { createHash } from "node:crypto";
import { z } from "zod";
import { hienThiMaChungNhan } from "./ma-chung-nhan";

/**
 * E-LEARNING ONLINE — PHÔI CHỨNG NHẬN (V10.0, Q2). HÀM THUẦN. ĐỘC LẬP với chứng nhận Nội bộ (`lib/elearning/chung-nhan-*`) và Offline (`lib/pdf/certificate`):
 * không import chúng; chỉ chung tài sản thương hiệu (phông, màu). Ranh giới được ghim bởi `cn-mau.test.ts` [CNM-W1].
 *
 * Bất biến:
 * 1. Chứng nhận ĐÃ CẤP BẤT BIẾN: bản chụp (`CnSnapshot`) giữ bố cục + MÃ BĂM phôi + các dòng chữ; dựng lại luôn đối chiếu mã băm, sai ⇒ từ chối (không vẽ nhầm phôi).
 * 2. Phôi: định dạng xác định bằng CHỮ KÝ TỆP (PNG/JPEG), không tin MIME/đuôi do client gửi; ≥ 2000px bề rộng; ngang tỉ lệ A4 (±3%); ≤ 10 MB.
 * 3. Bố cục: bốn khung chữ nằm trong lề an toàn 5% bốn phía, KHÔNG chồng nhau.
 */

export const TRUONG_CN = ["hoTen", "tenKhoa", "ketQua", "ngayMa"] as const;
export type TruongCn = (typeof TRUONG_CN)[number];

export type Khung = { x: number; y: number; w: number; h: number; fontPct: number; align: "left" | "center" | "right"; color: string; bold: boolean; maxLines: number };
export type BoCuc = Record<TruongCn, Khung>;

export const TRANG_A4_NGANG = { w: 841.89, h: 595.28 } as const; // pt
export const LE_AN_TOAN = 5; // %

const khungSchema = z
  .object({
    x: z.number().min(LE_AN_TOAN).max(100 - LE_AN_TOAN),
    y: z.number().min(LE_AN_TOAN).max(100 - LE_AN_TOAN),
    w: z.number().min(5).max(100 - 2 * LE_AN_TOAN),
    h: z.number().min(2).max(100 - 2 * LE_AN_TOAN),
    /** Cỡ chữ theo % chiều cao trang (độc lập độ phân giải ảnh). */
    fontPct: z.number().min(1).max(8),
    align: z.enum(["left", "center", "right"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Màu dạng #RRGGBB"),
    bold: z.boolean(),
    maxLines: z.number().int().min(1).max(3),
  })
  .strict();

const giao = (a: Khung, b: Khung) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const boCucSchema = z
  .object({ hoTen: khungSchema, tenKhoa: khungSchema, ketQua: khungSchema, ngayMa: khungSchema })
  .strict()
  .superRefine((b, ctx) => {
    for (const t of TRUONG_CN) {
      const k = b[t];
      if (k.x + k.w > 100 - LE_AN_TOAN + 1e-9 || k.y + k.h > 100 - LE_AN_TOAN + 1e-9) ctx.addIssue({ code: "custom", message: `Khung "${NHAN_TRUONG[t]}" vượt lề an toàn ${LE_AN_TOAN}%`, path: [t] });
    }
    for (let i = 0; i < TRUONG_CN.length; i++) for (let j = i + 1; j < TRUONG_CN.length; j++) if (giao(b[TRUONG_CN[i]!], b[TRUONG_CN[j]!])) ctx.addIssue({ code: "custom", message: `Khung "${NHAN_TRUONG[TRUONG_CN[i]!]}" chồng lên "${NHAN_TRUONG[TRUONG_CN[j]!]}"`, path: [TRUONG_CN[i]!] });
  });

export const NHAN_TRUONG: Record<TruongCn, string> = { hoTen: "Tên người nhận", tenKhoa: "Tên khoá học", ketQua: "Kết quả", ngayMa: "Ngày cấp · mã" };

/** Bố cục theo bản mô tả phôi (QoCNPrompt): dải tên giữa trang 45%×9% ở 50–58% chiều cao; ô khoá, ô kết quả ngay dưới; góc dưới trái 22%×10% cho ngày/mã. */
export function boCucMacDinh(): BoCuc {
  const goc = { fontPct: 3, align: "center" as const, color: "#1F1B16", bold: false, maxLines: 1 };
  return {
    hoTen: { ...goc, x: 27.5, y: 50, w: 45, h: 9, fontPct: 5.5, bold: true, color: "#5B2A86" },
    tenKhoa: { ...goc, x: 27.5, y: 60, w: 45, h: 5, fontPct: 3, maxLines: 2 },
    ketQua: { ...goc, x: 29, y: 66, w: 42, h: 4, fontPct: 2.2 },
    ngayMa: { ...goc, x: 5, y: 85, w: 22, h: 10, fontPct: 1.8, align: "left", maxLines: 3 },
  };
}

// ───────── Phôi (ảnh nền) ─────────

export const GIOI_HAN_PHOI = { toiDaByte: 10 * 1024 * 1024, rongToiThieu: 2000, tiLeA4: 297 / 210, saiSoTiLe: 0.03 } as const;
export type ThongTinAnh = { mime: "image/png" | "image/jpeg"; ext: "png" | "jpg"; width: number; height: number };

/** Đọc loại + kích thước từ CHÍNH byte tệp. `null` nếu không phải PNG/JPEG hợp lệ. */
export function docThongTinAnh(b: Uint8Array): ThongTinAnh | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    if (!(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null; // IHDR phải đứng đầu
    const width = dv.getUint32(16), height = dv.getUint32(20);
    return width > 0 && height > 0 ? { mime: "image/png", ext: "png", width, height } : null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const height = dv.getUint16(i + 5), width = dv.getUint16(i + 7);
        return width > 0 && height > 0 ? { mime: "image/jpeg", ext: "jpg", width, height } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

export function kiemPhoi(b: Uint8Array): { ok: true; anh: ThongTinAnh } | { ok: false; thongBao: string } {
  if (b.byteLength === 0) return { ok: false, thongBao: "Tệp rỗng" };
  if (b.byteLength > GIOI_HAN_PHOI.toiDaByte) return { ok: false, thongBao: "Phôi vượt 10 MB" };
  const a = docThongTinAnh(b);
  if (!a) return { ok: false, thongBao: "Phôi phải là ảnh PNG hoặc JPEG hợp lệ" };
  if (a.width < GIOI_HAN_PHOI.rongToiThieu) return { ok: false, thongBao: `Phôi quá nhỏ (${a.width}px) — cần rộng ít nhất ${GIOI_HAN_PHOI.rongToiThieu}px (khuyên 3508×2480)` };
  const tl = a.width / a.height;
  if (Math.abs(tl - GIOI_HAN_PHOI.tiLeA4) / GIOI_HAN_PHOI.tiLeA4 > GIOI_HAN_PHOI.saiSoTiLe) return { ok: false, thongBao: "Phôi phải là khổ A4 nằm ngang (tỉ lệ 297:210)" };
  return { ok: true, anh: a };
}

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const khoaPhoi = (courseId: string, sha: string, ext: string) => `online/cn/${courseId}/${sha}.${ext}`;

// ───────── Dòng chữ + bản chụp ─────────

const NGAY = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

export type DuLieuCap = { hoTen: string; tenKhoa: string; finalScore: number | null; capLuc: Date; code: string };
export type DongChu = Record<TruongCn, string>;

export function dongChu(d: DuLieuCap): DongChu {
  return {
    hoTen: d.hoTen.trim(),
    tenKhoa: d.tenKhoa.trim(),
    ketQua: d.finalScore !== null ? `Hoàn thành khoá học · điểm thi cuối khoá ${d.finalScore}/100` : "Hoàn thành khoá học",
    ngayMa: `Ngày cấp ${NGAY.format(d.capLuc)}\nMã chứng nhận ${hienThiMaChungNhan(d.code)}`,
  };
}

/** Mọi thứ cần để dựng lại ĐÚNG bản đã cấp. `templateId = null` ⇒ khuôn mặc định (không phôi ảnh). */
export type CnSnapshot = {
  v: 1;
  templateId: string | null;
  background: { key: string; sha256: string; mime: "image/png" | "image/jpeg"; widthPx: number; heightPx: number } | null;
  fields: BoCuc;
  texts: DongChu;
};

export function taoSnapshot(o: { mau: { id: string; backgroundKey: string; backgroundSha256: string; backgroundMime: string; widthPx: number; heightPx: number; fieldsJson: unknown } | null; du: DuLieuCap }): CnSnapshot {
  const texts = dongChu(o.du);
  if (!o.mau) return { v: 1, templateId: null, background: null, fields: boCucMacDinh(), texts };
  const f = boCucSchema.parse(o.mau.fieldsJson);
  return { v: 1, templateId: o.mau.id, background: { key: o.mau.backgroundKey, sha256: o.mau.backgroundSha256, mime: o.mau.backgroundMime as "image/png" | "image/jpeg", widthPx: o.mau.widthPx, heightPx: o.mau.heightPx }, fields: f, texts };
}

/** Chứng nhận cấp TRƯỚC V10.0 (không có bản chụp): dựng từ các cột đã lưu, bằng khuôn mặc định. */
export const snapshotChoBanCu = (d: DuLieuCap): CnSnapshot => taoSnapshot({ mau: null, du: d });

// ───────── Kiểm trước khi duyệt (QoCNXem) ─────────

/** Mã dùng khi XEM THỬ / kiểm tràn khung: dạng DÀI NHẤT đang cấp (C10, in ra `SR-ON-…`) — dùng mã ngắn hơn thì bộ kiểm báo thiếu. */
export const MA_THU = "SRONABCDE23456";

export const MAU_THU = [
  { ten: "Tên dài nhất", hoTen: "Nguyễn Thị Phương Quỳnh Anh Thư", tenKhoa: "Lập trình Robot nâng cao: thuật toán bám tường và thoát mê cung", finalScore: 100 },
  { ten: "Tên ngắn nhất", hoTen: "Lê An", tenKhoa: "RoboSim 1", finalScore: null },
  { ten: "Khoá dài nhất", hoTen: "Trần Bảo Minh", tenKhoa: "Combo Sata 1 & 2 — Làm quen Robot và lập trình khối lệnh cho bé lớp 1–3 (bản đầy đủ)", finalScore: 87 },
] as const;

/** Ước lượng số dòng cần ở cỡ chữ `sizePt` (phông không đều ⇒ hệ số trung bình, nghiêng về BÁO DƯ hơn báo thiếu). */
export function uocSoDong(text: string, k: Khung, sizePt = (k.fontPct / 100) * TRANG_A4_NGANG.h): number {
  const rongPt = (k.w / 100) * TRANG_A4_NGANG.w;
  const heSo = k.bold ? 0.62 : 0.56;
  const kyTuMotDong = Math.max(1, Math.floor(rongPt / (sizePt * heSo)));
  return text.split("\n").reduce((tong, dong) => tong + Math.max(1, Math.ceil(dong.length / kyTuMotDong)), 0);
}

export const CO_CHU_NHO_NHAT = 0.6; // thu nhỏ tối đa còn 60% cỡ danh nghĩa
const DAN_DONG = 1.25;

/** Chọn cỡ chữ (pt) để chữ VỪA khung: thu dần từ cỡ danh nghĩa tới 60%. Không vừa ngay cả ở 60% ⇒ `vua = false`. Renderer và bộ kiểm dùng CÙNG hàm này. */
export function chonCoChu(text: string, k: Khung): { sizePt: number; soDong: number; heSo: number; vua: boolean } {
  const danhNghia = (k.fontPct / 100) * TRANG_A4_NGANG.h;
  const caoPt = (k.h / 100) * TRANG_A4_NGANG.h;
  for (let heSo = 1; heSo >= CO_CHU_NHO_NHAT - 1e-9; heSo = Math.round((heSo - 0.05) * 100) / 100) {
    const size = danhNghia * heSo;
    const so = uocSoDong(text, k, size);
    if (so <= k.maxLines && so * size * DAN_DONG <= caoPt + 1e-9) return { sizePt: size, soDong: so, heSo, vua: true };
  }
  const size = danhNghia * CO_CHU_NHO_NHAT;
  return { sizePt: size, soDong: uocSoDong(text, k, size), heSo: CO_CHU_NHO_NHAT, vua: false };
}

export type CanhBao = { muc: "LOI" | "CANH_BAO"; mau?: string; truong?: TruongCn; thongBao: string };

export function kiemTruocKhiDuyet(o: { fields: BoCuc; anh: { widthPx: number; heightPx: number } }): CanhBao[] {
  const ds: CanhBao[] = [];
  if (o.anh.widthPx < 3000) ds.push({ muc: "CANH_BAO", thongBao: `Độ phân giải ${o.anh.widthPx}px — in A4 sẽ mờ; khuyên 3508×2480` });
  for (const m of MAU_THU) {
    const t = dongChu({ hoTen: m.hoTen, tenKhoa: m.tenKhoa, finalScore: m.finalScore, capLuc: new Date(Date.UTC(2026, 10, 21)), code: MA_THU });
    for (const tr of TRUONG_CN) {
      const c = chonCoChu(t[tr], o.fields[tr]);
      if (!c.vua) ds.push({ muc: "LOI", mau: m.ten, truong: tr, thongBao: `"${NHAN_TRUONG[tr]}" tràn khung dù đã thu nhỏ chữ còn 60% (mẫu: ${m.ten}) — mở rộng khung hoặc tăng số dòng` });
      else if (c.heSo < 1) ds.push({ muc: "CANH_BAO", mau: m.ten, truong: tr, thongBao: `"${NHAN_TRUONG[tr]}" sẽ tự thu nhỏ chữ còn ${Math.round(c.heSo * 100)}% (mẫu: ${m.ten})` });
    }
  }
  return ds;
}
