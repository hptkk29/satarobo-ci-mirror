"use server";

// Chứng từ NGÂN HÀNG cần kế toán bổ sung — server action (P7-E, 06/11/2026). Luật trạng thái: lib/finance/hoa-don/chung-tu-ngan-hang.ts (thuần);
// ghi DB: lib/finance/hoa-don/chung-tu-ngan-hang-db.ts. Tệp này chỉ gác cửa (cờ → đăng nhập → quyền → phạm vi cơ sở), kiểm đầu vào và nối.
//
// ⚠️ KHÔNG BAO GIỜ đổi `Payment` (không xác nhận khoản, không đổi `evidenceUrl`), không Receipt, không hoá đơn. Lưới `[CTW-*]` canh.
// ⚠️ Tệp 'use server' CHỈ export async function (export const/type làm hỏng Server Action lúc chạy mà `pnpm build` vẫn xanh).
// ⚠️ Mọi thứ đến từ client (paymentId, khoá tệp, tên tệp, lý do) KHÔNG được tin: khoản/hồ sơ được tra lại qua `scopedDb`, rồi phạm vi KẾ TOÁN
//    (`coQuyenKeToanTaiCoSo`) — `payments:confirm` một mình không giới hạn được cơ sở (xem lib/finance/hoa-don/quyen.ts).

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { rateLimit } from "@/lib/rate-limit";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { coQuyenKeToanTaiCoSo } from "@/lib/finance/hoa-don/quyen";
import { khoHoaDonDaCauHinh, xoaTepHoaDon } from "@/lib/finance/hoa-don/kho-tep";
import { kyUrlTaiLenChungTu, xacMinhTepChungTu } from "@/lib/finance/hoa-don/kho-chung-tu";
import {
  LOAI_TEP_CHUNG_TU,
  MIME_TEP_CHUNG_TU,
  TRAN_CO_TEP_CHUNG_TU,
  TOI_DA_GHI_CHU_CHUNG_TU,
  TOI_DA_LY_DO_CHUNG_TU,
  chuyenTrangThai,
  khoaChungTu,
  khoaThuocKhoan,
  tenTepChungTuSach,
} from "@/lib/finance/hoa-don/chung-tu-ngan-hang";
import {
  LoiChungTu,
  danhDauCanChungTu,
  danhDauDaKiemTra,
  ghiTepChungTu,
  huyDanhDau,
  timKhoanTheoMaDon,
  yeuCauBoSungLai,
  type KhoanTimThay,
} from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";

/** URL PUT sống 5 phút — đủ để trình duyệt tải một tệp ≤ 10 MB lên. */
const TTL_PUT_GIAY = 300;

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string };

const ID = z.string().min(1).max(64);
const LOAI = z.enum(LOAI_TEP_CHUNG_TU as unknown as [string, ...string[]]);

type Cong = { ok: true; userId: string; userName: string; actor: Actor } | { ok: false; error: string };

/**
 * Cổng chung: cờ → đăng nhập → `payments:confirm` (trần) → actor. Phạm vi cơ sở hỏi ở từng hàm bên dưới sau khi biết khoản / hồ sơ thuộc cơ sở nào.
 * Wrapper cục bộ MỘT cấp, cùng tệp — lint `require-can-in-write-action` không tính wrapper import từ tệp khác.
 */
async function cong(): Promise<Cong> {
  if (!(await laHoaDonBat())) return { ok: false, error: "Màn hoá đơn điện tử chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, userId: session.user.id, userName: session.user.name ?? session.user.email ?? session.user.id, actor };
}

/** Hồ sơ theo khoản + mã cơ sở (khoá tệp cần mã). Ngoài phạm vi ⇒ cùng câu "không tìm thấy" như không có. */
async function congHoSo(paymentId: string) {
  const c = await cong();
  if (!c.ok) return c;
  const hs = await scopedDb(c.actor).chungTuNganHang.findUnique({
    where: { paymentId },
    select: { id: true, centerId: true, trangThai: true, tepKhoa: true },
  });
  if (!hs || !coQuyenKeToanTaiCoSo(c.actor, hs.centerId)) return { ok: false as const, error: "Không tìm thấy hồ sơ chứng từ" };
  const coSo = await scopedDb(c.actor).center.findUnique({ where: { id: hs.centerId }, select: { code: true } });
  const centerCode = coSo?.code?.trim();
  if (!centerCode) return { ok: false as const, error: "Cơ sở của khoản chưa có mã — báo quản trị hệ thống" };
  return { ...c, hoSo: hs, centerCode };
}

function lamMoi(): void {
  revalidatePath("/payments/hoa-don/chung-tu-ngan-hang");
}

/** Lỗi nghiệp vụ đã biết ⇒ câu cho người dùng; lỗi lạ ném tiếp. */
async function chayGhi<T>(f: () => Promise<T>): Promise<KetQua<T>> {
  try {
    const data = await f();
    lamMoi();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof LoiChungTu) return { ok: false, error: e.thongDiep };
    throw e;
  }
}

// ─── tìm khoản để đánh dấu ───────────────────────────────────────────────────────────────────────────────

const timSchema = z.object({ coSoId: ID, maDon: z.string().trim().min(3).max(40) });

export async function timKhoanTheoMaDonAction(input: unknown): Promise<KetQua<{ maDon: string; khoan: KhoanTimThay[] } | null>> {
  const p = timSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Nhập mã đơn (ví dụ ORD-261004-000007)" };
  const c = await cong();
  if (!c.ok) return c;
  return { ok: true, data: await timKhoanTheoMaDon(c.actor, p.data) };
}

// ─── đánh dấu / huỷ đánh dấu ─────────────────────────────────────────────────────────────────────────────

const danhDauSchema = z.object({ paymentId: ID, lyDo: z.string().trim().max(TOI_DA_LY_DO_CHUNG_TU) });

export async function danhDauCanChungTuAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = danhDauSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  return chayGhi(() => danhDauCanChungTu({ actor: c.actor, nguoi: { id: c.userId, ten: c.userName }, paymentId: p.data.paymentId, lyDo: p.data.lyDo }));
}

export async function huyDanhDauChungTuAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = danhDauSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  return chayGhi(() => huyDanhDau({ actor: c.actor, nguoi: { id: c.userId, ten: c.userName }, paymentId: p.data.paymentId, lyDo: p.data.lyDo }));
}

// ─── tải lên: ký URL → trình duyệt PUT → xác minh byte + ghi ───────────────────────────────────────────────

const kySchema = z.object({ paymentId: ID, loai: LOAI });

/** Bước 1 — ký URL PUT. Từ chối SỚM nếu trạng thái hồ sơ không cho tải (nút không được hứa suông). */
export async function kyTaiLenChungTuAction(
  input: unknown,
): Promise<KetQua<{ khoa: string; url: string; contentType: string; tranCo: number; hetHanGiay: number }>> {
  const p = kySchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await congHoSo(p.data.paymentId);
  if (!c.ok) return c;
  const loai = p.data.loai as (typeof LOAI_TEP_CHUNG_TU)[number];

  const chuyen = chuyenTrangThai(c.hoSo.trangThai, "TAI_LEN");
  if (!chuyen.ok) return { ok: false, error: chuyen.lyDo };

  const gioiHan = await rateLimit({ key: `chung-tu-tep:${c.userId}`, max: 60, windowMs: 60 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Tải lên quá nhiều lần — thử lại sau ít phút" };
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu chứng từ chưa cấu hình — báo người vận hành" };

  const khoa = khoaChungTu({ centerCode: c.centerCode, paymentId: p.data.paymentId, loai, nam: new Date().getUTCFullYear(), uuid: randomUUID() });
  const url = await kyUrlTaiLenChungTu(khoa, loai, TTL_PUT_GIAY);
  return { ok: true, data: { khoa, url, contentType: MIME_TEP_CHUNG_TU[loai], tranCo: TRAN_CO_TEP_CHUNG_TU, hetHanGiay: TTL_PUT_GIAY } };
}

const ghiSchema = z.object({
  paymentId: ID,
  loai: LOAI,
  khoa: z.string().min(1).max(300),
  ten: z.string().max(300),
  ghiChu: z.string().max(TOI_DA_GHI_CHU_CHUNG_TU).optional(),
});

/**
 * Bước 2 — XÁC MINH byte (khoá đến từ trình duyệt: không tin lượt ký trước) rồi ghi vào hồ sơ → DA_TAI_LEN.
 * KHÔNG xác nhận khoản thu. Ghi hỏng sau khi tệp đã lên kho ⇒ dọn đúng khoá vừa tải (tệp của hồ sơ khác không bị đụng).
 */
export async function ghiChungTuDaTaiAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = ghiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await congHoSo(p.data.paymentId);
  if (!c.ok) return c;
  const loai = p.data.loai as (typeof LOAI_TEP_CHUNG_TU)[number];

  // Khoá phải nằm dưới ĐÚNG khoản + cơ sở, đuôi khớp loại khai, và KHÔNG phải khoá đang giữ của hồ sơ (không "tải" lại tệp cũ như tệp mới).
  if (!khoaThuocKhoan(p.data.khoa, c.centerCode, p.data.paymentId) || !p.data.khoa.endsWith(`.${loai}`) || p.data.khoa === c.hoSo.tepKhoa) {
    return { ok: false, error: "Tệp không thuộc khoản thu này" };
  }
  const chuyen = chuyenTrangThai(c.hoSo.trangThai, "TAI_LEN");
  if (!chuyen.ok) {
    await xoaTepHoaDon(p.data.khoa).catch(() => undefined);
    return { ok: false, error: chuyen.lyDo };
  }
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu chứng từ chưa cấu hình — báo người vận hành" };

  const kq = await xacMinhTepChungTu({ khoa: p.data.khoa, loai });
  if (!kq.ok) return { ok: false, error: kq.thongDiep };

  const ten = tenTepChungTuSach(p.data.ten, loai);
  try {
    const r = await ghiTepChungTu({
      actor: c.actor,
      nguoi: { id: c.userId, ten: c.userName },
      paymentId: p.data.paymentId,
      tep: { khoa: p.data.khoa, ten, loai, co: kq.co, sha256: kq.sha256 },
      ghiChu: p.data.ghiChu ?? null,
      now: new Date(),
    });
    lamMoi();
    return { ok: true, data: { id: r.id } };
  } catch (e) {
    await xoaTepHoaDon(p.data.khoa).catch(() => undefined);
    if (e instanceof LoiChungTu) return { ok: false, error: e.thongDiep };
    throw e;
  }
}

// ─── kiểm tra / yêu cầu bổ sung lại ──────────────────────────────────────────────────────────────────────────

const kiemTraSchema = z.object({ paymentId: ID, ghiChu: z.string().max(TOI_DA_GHI_CHU_CHUNG_TU).optional() });

export async function kiemTraChungTuAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = kiemTraSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  return chayGhi(() => danhDauDaKiemTra({ actor: c.actor, nguoi: { id: c.userId, ten: c.userName }, paymentId: p.data.paymentId, ghiChu: p.data.ghiChu ?? null, now: new Date() }));
}

export async function yeuCauBoSungLaiChungTuAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = danhDauSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  return chayGhi(() => yeuCauBoSungLai({ actor: c.actor, nguoi: { id: c.userId, ten: c.userName }, paymentId: p.data.paymentId, lyDo: p.data.lyDo, now: new Date() }));
}
