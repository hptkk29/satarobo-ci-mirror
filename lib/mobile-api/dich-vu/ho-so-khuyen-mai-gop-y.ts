import { z } from "zod";

import { db } from "@/lib/db";
import { formatDateVN } from "@/lib/format/date";
import { docKhuyenMaiChoPhuHuynh, docMaCoSo } from "@/lib/portal/khuyen-mai-ph";
import { CHU_DE_GOP_Y, noiDungGopY } from "@/lib/portal/gop-y-thuan";
import { getParentProfile } from "@/lib/portal/parent-profile";
import { rateLimit } from "@/lib/rate-limit";

import { quyDoiSaoTuDiem } from "../gop-y-diem";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * B4.8 — ba màn ĐỌC / GỬI ĐƠN GIẢN dùng lại nghiệp vụ web có sẵn:
 *   · Hồ sơ gia đình (CHỈ ĐỌC)            ← `getParentProfile` (cùng nguồn trang `/portal/ho-so`).
 *   · Khuyến mãi đang áp dụng (CHỈ ĐỌC)   ← `docKhuyenMaiChoPhuHuynh` (không lộ mã giảm giá / mã văn bản nội bộ / tệp đính kèm — hàm nguồn đã chọn cột tường minh).
 *   · Góp ý cho trung tâm (đọc + gửi)     ← bảng `ParentFeedback` (cùng chỗ `createParentFeedback` của web ghi; admin trả lời ở `/parent-feedback`).
 *
 * KHÔNG có sửa hồ sơ, không đổi đồng ý hình ảnh, không ảnh đại diện (URL ảnh của con không đi qua API khi chưa có ký URL — blocker riêng).
 */

// ─── Hồ sơ ────────────────────────────────────────────────────────────────────

export type HoSoDto = {
  ten: string;
  email: string | null;
  phone: string | null;
  diaChi: string | null;
  maGiaDinh: string;
  phuHuynh2: { ten: string | null; phone: string | null } | null;
  quyDinh: { ap: boolean; daDongY: boolean; luc: string | null };
  con: Array<{
    id: string;
    ten: string;
    chuCai: string;
    maHocVien: string | null;
    lop: string | null;
    khoa: string | null;
    coSo: string | null;
    truong: string | null;
    khoi: number | null;
    /** Đồng ý sử dụng hình ảnh của con (NĐ 13/2023) — CHỈ ĐỌC; đổi đồng ý chưa có trong app. */
    dongYHinhAnh: boolean;
  }>;
};

export async function layHoSo(parentUserId: string): Promise<HoSoDto> {
  const p = await getParentProfile(parentUserId, null);
  return {
    ten: p.name,
    email: p.email || null,
    phone: p.phone,
    diaChi: p.address,
    maGiaDinh: p.familyCode,
    phuHuynh2: p.parent2Name || p.parent2Phone ? { ten: p.parent2Name, phone: p.parent2Phone } : null,
    quyDinh: p.quyDinh,
    // Cố ý KHÔNG chép `avatarUrl`, `active`, `className` (nhãn nội bộ) — chỉ những trường màn Hồ sơ cần.
    con: p.children.map((c) => ({
      id: c.id,
      ten: c.name,
      chuCai: c.initials,
      maHocVien: c.studentCode,
      lop: c.classCode,
      khoa: c.courseName,
      coSo: c.centerName,
      truong: c.school,
      khoi: c.grade,
      dongYHinhAnh: c.mediaConsent,
    })),
  };
}

// ─── Khuyến mãi ───────────────────────────────────────────────────────────────

export type KhuyenMaiDto = { chuongTrinh: Array<{ id: string; ten: string; loiIch: string; dieuKien: string | null; hetHan: string; moi: boolean }> };

export async function layKhuyenMai(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<KhuyenMaiDto> {
  const sv = await db.student.findUnique({ where: { id: hs }, select: { centerId: true } });
  const ds = await docKhuyenMaiChoPhuHuynh(await docMaCoSo(sv?.centerId), now);
  return { chuongTrinh: ds.map((k) => ({ id: k.id, ten: k.ten, loiIch: k.loiIch, dieuKien: k.dieuKien, hetHan: k.hetHan, moi: k.moi })) };
}

// ─── Góp ý ────────────────────────────────────────────────────────────────────

export const guiGopYSchema = z
  .object({
    /** OD-16: điểm 0–10 (app mới). */
    diem: z.number().int("Điểm phải là số nguyên 0–10.").min(0, "Điểm từ 0 đến 10.").max(10, "Điểm từ 0 đến 10.").optional(),
    /** Tương thích bản app cũ (1–5 sao). Có `diem` thì `diem` thắng. */
    sao: z.number().int().min(1, "Ba mẹ chọn mức hài lòng nhé.").max(5).optional(),
    chuDe: z.enum(CHU_DE_GOP_Y as unknown as [string, ...string[]]),
    noiDung: z.string().trim().min(5, "Vui lòng nhập nội dung").max(2000),
  })
  .refine((v) => v.diem !== undefined || v.sao !== undefined, { message: "Ba mẹ chọn mức hài lòng nhé.", path: ["diem"] });
export type GuiGopYInput = z.infer<typeof guiGopYSchema>;

export type GopYDto = {
  chuDe: readonly string[];
  daGui: Array<{ id: string; sao: number; diem: number | null; noiDung: string; ngayGui: string; traLoi: string | null }>;
};

export async function layGopY(parentUserId: string): Promise<GopYDto> {
  const rows = await db.parentFeedback.findMany({
    where: { parentUserId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, rating: true, npsScore: true, content: true, createdAt: true, adminResponse: true },
  });
  return {
    chuDe: CHU_DE_GOP_Y,
    daGui: rows.map((r) => ({ id: r.id, sao: r.rating, diem: r.npsScore, noiDung: r.content, ngayGui: formatDateVN(r.createdAt), traLoi: r.adminResponse })),
  };
}

const CUA_SO_TRUNG_LAP_MS = 5 * 60_000;

/** Ghi vào `ParentFeedback` như `createParentFeedback` của web (kèm tên phụ huynh + con ĐÃ KIỂM SỞ HỮU; KHÔNG có chế độ ẩn danh). Trùng nội dung trong 5 phút ⇒ trả bản cũ. */
export async function guiGopY(hs: MaHocVienDaKiem, parentUserId: string, input: GuiGopYInput, now: Date = new Date()): Promise<{ id: string; trungLap: boolean }> {
  const noiDung = noiDungGopY(input.chuDe, input.noiDung);
  // `diem` (0–10, app mới) thắng `sao` (1–5, app cũ). Có `diem` ⇒ ghi cả `npsScore` và `rating` quy đổi để màn admin cũ vẫn đọc được.
  const diem = input.diem ?? null;
  const rating = diem !== null ? quyDoiSaoTuDiem(diem) : (input.sao as number);
  const trung = await db.parentFeedback.findFirst({
    where: { parentUserId, content: noiDung, rating, npsScore: diem, createdAt: { gte: new Date(now.getTime() - CUA_SO_TRUNG_LAP_MS) } },
    select: { id: true },
  });
  if (trung) return { id: trung.id, trungLap: true };
  // Web không giới hạn tần suất ở đường này; app thêm trần mềm để một máy lỗi không đổ hàng loạt góp ý vào hộp thư của trung tâm.
  const rl = await rateLimit({ key: `mobile-gop-y:${parentUserId}`, max: 5, windowMs: 10 * 60_000 });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn gửi quá nhanh. Vui lòng thử lại sau ít phút.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))); // V8.24: kèm Retry-After như mọi giới hạn khác của API di động
  const [phuHuynh, hocVien] = await Promise.all([
    db.user.findUnique({ where: { id: parentUserId }, select: { name: true } }),
    db.student.findUnique({ where: { id: hs }, select: { name: true } }),
  ]);
  const r = await db.parentFeedback.create({
    data: { parentUserId, parentName: phuHuynh?.name ?? null, studentId: hs, studentName: hocVien?.name ?? null, rating, npsScore: diem, content: noiDung },
    select: { id: true },
  });
  return { id: r.id, trungLap: false };
}
