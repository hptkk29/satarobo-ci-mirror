"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { parseVnYmd, vnYmd } from "@/lib/time/vn";
import { lapHoSo, duyetHoSo, tuChoiHoSo, huyHoSo, type KetQua } from "@/lib/bao-luu/dich-vu";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { apDungDoiHanBaoLuu } from "@/lib/finance/bao-luu-tien";
import { baoChoDuyet, baoDaDuyet, baoGiaHanChoDuyet, baoGiaHanKetQua, baoTuChoi, type HoSoBao } from "@/lib/bao-luu/thong-bao";
import {
  deNghiGiaHan as deNghiGiaHanDv,
  duyetGiaHan as duyetGiaHanDv,
  ghiLienHe,
  ghiThongBaoChinhThuc,
  khoiPhuc,
  KENH_THONG_BAO,
  tuChoiGiaHan as tuChoiGiaHanDv,
} from "@/lib/bao-luu/vong-doi";
import { baoPhucHoc, chuyenSangTrungTam, goiYLopPhucHoc, phucHoc } from "@/lib/bao-luu/phuc-hoc-db";
import type { LopPhucHoc } from "@/lib/bao-luu/phuc-hoc";
import { tamDungLop } from "@/lib/bao-luu/tam-dung-lop";
import { sinhYeuCauHoan } from "@/lib/bao-luu/yeu-cau-hoan";

// Server Action của module Bảo lưu (Phiên 3). MỎNG có chủ đích: đăng nhập + quyền + tầm nhìn cơ sở + dịch lỗi; mọi luật
// nghiệp vụ (công tắc `pause.enabled`, maker–checker, BR-xx) ở `lib/bao-luu/dich-vu.ts` — nơi duy nhất ghi.
//
// `scopedDb` KHÔNG che write (luật cứng #5) nên MỌI action đọc hồ sơ/học viên qua `scopedDb` TRƯỚC khi gọi dịch vụ: ngoài
// tầm nhìn thì "không tìm thấy" (chống IDOR theo id gửi từ trình duyệt).

type KQ = { ok: true; canhBao?: string[]; ids?: string[] } | { ok: false; error: string };

const dongLoi = (loi: string[]): { ok: false; error: string } => ({ ok: false, error: loi.join("\n") });

async function vao() {
  const session = await auth();
  if (!session?.user) return null;
  return { session, actor: await resolveActor(session.user.id) };
}

const ngay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ")
  .nullable()
  .optional();

const lapSchema = z.object({
  studentId: z.string().min(1),
  enrollmentIds: z.array(z.string().min(1)).min(1, "Chọn ít nhất một ghi danh để bảo lưu").max(20),
  reasonCode: z.enum(["ILLNESS", "FAMILY", "RELOCATION", "SCHEDULE", "OTHER"]).nullable(),
  reasonNote: z.string().trim().max(1000, "Ghi chú quá dài (tối đa 1000 ký tự)"),
  expectedReturnDate: ngay,
  firstAbsentDate: ngay,
  applicationFileKey: z.string().min(1).nullable(),
  evidenceFileKeys: z.array(z.string().min(1)).max(10),
  vuotTranLyDo: z.string().trim().max(500).nullable().optional(),
});

export type LapBaoLuuInput = z.input<typeof lapSchema>;

function ngayHoacNull(s: string | null | undefined): Date | null | "loi" {
  if (!s) return null;
  // `parseVnYmd` cuốn chiếu ngày tràn ("2026-13-45" → 14/02/2027) thay vì từ chối. Hồ sơ này quyết định NGÀY BẮT ĐẦU nghỉ
  // và hạn tối đa nên phải khớp ngược: ngày đọc ra phải in lại đúng chuỗi người dùng gửi.
  const d = parseVnYmd(s);
  return d && vnYmd(d) === s ? d : "loi";
}

async function thongTinChuong(sdb: ReturnType<typeof scopedDb>, id: string): Promise<(HoSoBao & { nguoiLapId: string | null }) | null> {
  const r = await sdb.studentReserve.findUnique({
    where: { id },
    select: {
      id: true,
      centerId: true,
      createdByUserId: true,
      student: { select: { name: true } },
      enrollment: { select: { course: { select: { name: true } }, class: { select: { name: true } } } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    centerId: r.centerId,
    nguoiLapId: r.createdByUserId,
    tenHocVien: r.student.name,
    tenKhoa: r.enrollment ? `${r.enrollment.course.name} — ${r.enrollment.class.name}` : "Toàn bộ khoá đang học",
  };
}

/**
 * Dời hạn các đợt thu CHƯA TỚI HẠN của bé theo ngày quay lại (BR-15) — chạy SAU khi hồ sơ đã commit, KHÔNG nằm trong giao dịch học vụ (mọi phép ghi lên sổ tiền
 * đi qua `ghiTienChoDon` với khoá theo đơn). Cờ là `pause.enabled`, không phải `billing.flexV1Enabled`. Hỏng ⇒ chỉ CẢNH BÁO người bấm, không làm hỏng việc đã xong:
 * hạn giữ nguyên và bé vẫn không bị báo quá hạn (phép tha đọc `StudentReserve`, không đọc kết quả hàm này). An toàn khi gọi lại (khoá chống dời hai lần theo số ngày).
 */
async function doiHanSauKhiCommit(reserveId: string, nguoi: { id: string; name: string }, now: Date): Promise<string[]> {
  try {
    const r = await apDungDoiHanBaoLuu({ reserveId, actor: { id: nguoi.id, name: nguoi.name }, now, coChoPhep: laBaoLuuBat });
    if (!r.ok) return [`Đã lưu, nhưng chưa dời được hạn các đợt thu: ${r.error}`];
    if (r.soDotDaDoi > 0) for (const id of r.donDaCham) revalidatePath(`/orders/${id}`);
    return [];
  } catch (err) {
    console.error("[bao-luu] dời hạn đợt thất bại:", err);
    return ["Đã lưu, nhưng CHƯA dời được hạn các đợt thu — nhờ kế toán kiểm lại."];
  }
}

function lamMoi(studentId?: string, reserveId?: string) {
  revalidatePath("/bao-luu");
  if (reserveId) revalidatePath(`/bao-luu/${reserveId}`);
  if (studentId) revalidatePath(`/students/${studentId}/edit`);
  revalidatePath("/students");
}

// ─── Lập ────────────────────────────────────────────────────────────────────

export async function lapBaoLuuAction(input: LapBaoLuuInput): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:create"))) return { ok: false, error: "Bạn không có quyền lập hồ sơ bảo lưu" };

  const p = lapSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;
  const tra = ngayHoacNull(d.expectedReturnDate);
  const dau = ngayHoacNull(d.firstAbsentDate);
  if (tra === "loi" || dau === "loi") return { ok: false, error: "Ngày không hợp lệ" };

  // Vượt trần thời hạn: CHỈ người có `bao-luu:exception` (Quản trị tối cao). Có lý do mà thiếu quyền ⇒ từ chối rõ ràng,
  // không lặng lẽ bỏ qua (người bấm tưởng đã vượt được).
  let vuotTran: { lyDo: string } | null = null;
  if (d.vuotTranLyDo) {
    if (!(await checkPermission("bao-luu:exception"))) return { ok: false, error: "Chỉ Quản trị tối cao được cho phép vượt trần thời hạn bảo lưu" };
    vuotTran = { lyDo: d.vuotTranLyDo };
  }

  const sdb = scopedDb(ctx.actor);
  const hv = await sdb.student.findFirst({ where: { id: d.studentId, deletedAt: null }, select: { id: true } });
  if (!hv) return { ok: false, error: "Không tìm thấy học viên" };

  const now = new Date();
  const r = await lapHoSo(
    {
      studentId: d.studentId,
      enrollmentIds: d.enrollmentIds,
      reasonCode: d.reasonCode,
      reasonNote: d.reasonNote,
      expectedReturnDate: tra,
      firstAbsentDate: dau,
      applicationFileKey: d.applicationFileKey,
      evidenceFileKeys: d.evidenceFileKeys,
      vuotTran,
    },
    { id: ctx.session.user.id, name: ctx.session.user.name ?? "Nhân sự" },
    now,
  );
  if (!r.ok) return dongLoi(r.loi);

  for (const id of r.data.reserveIds) {
    const tt = await thongTinChuong(sdb, id);
    if (tt) await baoChoDuyet(tt, ctx.session.user.id);
  }
  lamMoi(d.studentId);
  return { ok: true, canhBao: r.data.canhBao, ids: r.data.reserveIds };
}

// ─── Duyệt · từ chối · huỷ ─────────────────────────────────────────────────

const duyetSchema = z.object({ reserveId: z.string().min(1), lui: z.boolean(), ghiChu: z.string().trim().max(500).nullable().optional() });

export async function duyetBaoLuuAction(input: z.input<typeof duyetSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được duyệt bảo lưu" };
  const p = duyetSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const sdb = scopedDb(ctx.actor);
  const tt = await thongTinChuong(sdb, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r: KetQua<{ startedAt: Date }> = await duyetHoSo(
    { reserveId: p.data.reserveId, lui: p.data.lui, ghiChu: p.data.ghiChu ?? null },
    { id: ctx.session.user.id, name: ctx.session.user.name ?? "Nhân sự" },
    new Date(),
  );
  if (!r.ok) return dongLoi(r.loi);

  await baoDaDuyet(tt, tt.nguoiLapId, vnYmd(r.data.startedAt).split("-").reverse().join("/"));
  const canhBao = await doiHanSauKhiCommit(p.data.reserveId, nguoiLam(ctx), new Date());
  const hs = await sdb.studentReserve.findUnique({ where: { id: p.data.reserveId }, select: { studentId: true } });
  lamMoi(hs?.studentId, p.data.reserveId);
  revalidatePath("/classes");
  return { ok: true, canhBao };
}

const lyDoSchema = z.object({ reserveId: z.string().min(1), lyDo: z.string().trim().min(5, "Ghi lý do (ít nhất 5 ký tự)").max(500) });

export async function tuChoiBaoLuuAction(input: z.input<typeof lyDoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được từ chối bảo lưu" };
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const sdb = scopedDb(ctx.actor);
  const tt = await thongTinChuong(sdb, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await tuChoiHoSo(p.data, { id: ctx.session.user.id, name: ctx.session.user.name ?? "Nhân sự" }, new Date());
  if (!r.ok) return dongLoi(r.loi);

  await baoTuChoi(tt, tt.nguoiLapId, p.data.lyDo);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

/**
 * Huỷ hồ sơ CHƯA bắt đầu. Người lập được rút hồ sơ của MÌNH (`bao-luu:create`); người duyệt (`bao-luu:approve`) huỷ được
 * hồ sơ của bất kỳ ai trong tầm nhìn. Người chỉ có `create` mà huỷ hồ sơ của người khác ⇒ từ chối.
 */
export async function huyBaoLuuAction(input: z.input<typeof lyDoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const [laNguoiLap, laNguoiDuyet] = await Promise.all([checkPermission("bao-luu:create"), checkPermission("bao-luu:approve")]);
  if (!laNguoiLap && !laNguoiDuyet) return { ok: false, error: "Bạn không có quyền huỷ hồ sơ bảo lưu" };
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const sdb = scopedDb(ctx.actor);
  const tt = await thongTinChuong(sdb, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };
  if (!laNguoiDuyet && tt.nguoiLapId !== ctx.session.user.id) {
    return { ok: false, error: "Bạn chỉ huỷ được hồ sơ do chính bạn lập" };
  }

  const r = await huyHoSo(p.data, { id: ctx.session.user.id, name: ctx.session.user.name ?? "Nhân sự" }, new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHIÊN 5 — VÒNG ĐỜI SAU KHI BẮT ĐẦU: liên hệ · thông báo chính thức · gia hạn · khôi phục
// Cùng khuôn: đăng nhập → ĐÚNG quyền → tầm nhìn cơ sở (`scopedDb`) → dịch vụ (`lib/bao-luu/vong-doi.ts`) → chuông sau commit.
// ═══════════════════════════════════════════════════════════════════════════════

const idHoSo = z.object({ reserveId: z.string().min(1) });

type NguCanh = NonNullable<Awaited<ReturnType<typeof vao>>>;

async function coHoSoTrongTamNhin(ctx: NguCanh, reserveId: string) {
  return thongTinChuong(scopedDb(ctx.actor), reserveId);
}

const nguoiLam = (ctx: NguCanh) => ({ id: ctx.session.user.id, name: ctx.session.user.name ?? "Nhân sự" });

const lienHeSchema = idHoSo.extend({ ghiChu: z.string().trim().min(5, "Ghi nội dung liên hệ (ít nhất 5 ký tự)").max(500), henNgay: ngay });

export async function lienHeBaoLuuAction(input: z.input<typeof lienHeSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const [laNguoiLap, laNguoiDuyet] = await Promise.all([checkPermission("bao-luu:create"), checkPermission("bao-luu:approve")]);
  if (!laNguoiLap && !laNguoiDuyet) return { ok: false, error: "Bạn không có quyền ghi liên hệ bảo lưu" };
  const p = lienHeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const hen = ngayHoacNull(p.data.henNgay);
  if (hen === "loi") return { ok: false, error: "Ngày hẹn không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await ghiLienHe({ reserveId: p.data.reserveId, ghiChu: p.data.ghiChu, henNgay: hen }, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

const thongBaoSchema = idHoSo.extend({ kenh: z.enum(KENH_THONG_BAO), ghiChu: z.string().trim().max(500).nullable().optional() });

/** Ghi NHẬN đã gửi thông báo chính thức (không tự gửi). Quyền duyệt — đây là bước dẫn tới chấm dứt, không để người lập tự bấm. */
export async function thongBaoChinhThucAction(input: z.input<typeof thongBaoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được ghi thông báo chính thức" };
  const p = thongBaoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await ghiThongBaoChinhThuc({ reserveId: p.data.reserveId, kenh: p.data.kenh, ghiChu: p.data.ghiChu ?? null }, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

const giaHanSchema = idHoSo.extend({
  denNgay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  lyDo: z.string().trim().min(5, "Ghi lý do gia hạn (ít nhất 5 ký tự)").max(500),
  vuotTranLyDo: z.string().trim().max(500).nullable().optional(),
});

export async function deNghiGiaHanAction(input: z.input<typeof giaHanSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const [laNguoiLap, coQuyenGiaHan] = await Promise.all([checkPermission("bao-luu:create"), checkPermission("bao-luu:extend")]);
  if (!laNguoiLap && !coQuyenGiaHan) return { ok: false, error: "Bạn không có quyền đề nghị gia hạn bảo lưu" };
  const p = giaHanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const den = ngayHoacNull(p.data.denNgay);
  if (den === "loi" || den === null) return { ok: false, error: "Ngày không hợp lệ" };
  if (p.data.vuotTranLyDo && !(await checkPermission("bao-luu:exception"))) {
    return { ok: false, error: "Chỉ Quản trị tối cao được cho phép vượt trần tổng thời gian bảo lưu" };
  }
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await deNghiGiaHanDv(
    { reserveId: p.data.reserveId, denNgay: den, lyDo: p.data.lyDo, vuotTranLyDo: p.data.vuotTranLyDo || null },
    nguoiLam(ctx),
    new Date(),
  );
  if (!r.ok) return dongLoi(r.loi);
  await baoGiaHanChoDuyet(tt, ctx.session.user.id);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

export async function duyetGiaHanAction(input: z.input<typeof idHoSo>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:extend"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được duyệt gia hạn bảo lưu" };
  const p = idHoSo.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const now = new Date();
  const r = await duyetGiaHanDv({ reserveId: p.data.reserveId }, nguoiLam(ctx), now);
  if (!r.ok) return dongLoi(r.loi);
  await baoGiaHanKetQua(tt, true, vnYmd(now), vnYmd(r.data.denNgay).split("-").reverse().join("/"));
  // Gia hạn làm ngày quay lại dài ra ⇒ dời thêm phần chênh cho các đợt chưa tới hạn (chỉ khi phụ huynh ĐÃ khai ngày quay lại).
  const canhBao = await doiHanSauKhiCommit(p.data.reserveId, nguoiLam(ctx), now);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true, canhBao };
}

/** Từ chối đề nghị gia hạn (người có `bao-luu:extend`) HOẶC chính người đề nghị rút lại. */
export async function tuChoiGiaHanAction(input: z.input<typeof lyDoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const coQuyen = await checkPermission("bao-luu:extend");
  if (!coQuyen) {
    // Không có quyền duyệt thì chỉ rút được đề nghị của CHÍNH MÌNH.
    const ban = await scopedDb(ctx.actor).studentReserve.findUnique({ where: { id: p.data.reserveId }, select: { extendRequest: true, centerId: true } });
    const dn = ban?.extendRequest as { requestedById?: string } | null;
    if (!dn || dn.requestedById !== ctx.session.user.id) {
      return { ok: false, error: "Chỉ Quản lý hoặc chính người đề nghị mới từ chối / rút được đề nghị gia hạn" };
    }
  }
  const now = new Date();
  const r = await tuChoiGiaHanDv(p.data, nguoiLam(ctx), now);
  if (!r.ok) return dongLoi(r.loi);
  await baoGiaHanKetQua(tt, false, vnYmd(now), p.data.lyDo);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

const khoiPhucSchema = idHoSo.extend({
  denNgay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  lyDo: z.string().trim().min(10, "Ghi lý do khôi phục (ít nhất 10 ký tự)").max(500),
});

/** KHÔI PHỤC hồ sơ đã bị chấm dứt: chỉ `bao-luu:exception` (Quản trị tối cao) — ngoại lệ có chữ ký, lý do bắt buộc. */
export async function khoiPhucBaoLuuAction(input: z.input<typeof khoiPhucSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:exception"))) return { ok: false, error: "Chỉ Quản trị tối cao được khôi phục hồ sơ đã chấm dứt" };
  const p = khoiPhucSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const den = ngayHoacNull(p.data.denNgay);
  if (den === "loi" || den === null) return { ok: false, error: "Ngày không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await khoiPhuc({ reserveId: p.data.reserveId, denNgay: den, lyDo: p.data.lyDo }, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  revalidatePath("/classes");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHIÊN 6 — PHỤC HỌC · TẠM DỪNG CẢ LỚP (CENTER) · CHUYỂN LOẠI CENTER · YÊU CẦU HOÀN
// Cùng khuôn: đăng nhập → ĐÚNG quyền → tầm nhìn cơ sở (`scopedDb`) → dịch vụ → chuông / dời hạn sau commit.
// ═══════════════════════════════════════════════════════════════════════════════

const baoPhucHocSchema = idHoSo.extend({ ghiChu: z.string().trim().min(5, "Ghi nội dung phụ huynh báo (ít nhất 5 ký tự)").max(500) });

/** Phụ huynh báo muốn học lại ⇒ RESUME_PENDING. Sale (người lập) hoặc Quản lý ghi nhận. */
export async function baoPhucHocAction(input: z.input<typeof baoPhucHocSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const [laNguoiLap, laNguoiDuyet] = await Promise.all([checkPermission("bao-luu:create"), checkPermission("bao-luu:approve")]);
  if (!laNguoiLap && !laNguoiDuyet) return { ok: false, error: "Bạn không có quyền ghi nhận phụ huynh báo phục học" };
  const p = baoPhucHocSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };

  const r = await baoPhucHoc(p.data, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

export type GoiYLopKQ = { ok: true; dungOBai: number; dungSai: number; lop: LopPhucHoc[] } | { ok: false; error: string };

/** Hộp chọn lớp phục học: lớp cùng khoá/cơ sở, lệch bài ≤ dung sai, kèm hướng (học lại / sinh bù). Chỉ ĐỌC. */
export async function goiYLopPhucHocAction(input: z.input<typeof idHoSo>): Promise<GoiYLopKQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  const [laNguoiLap, laNguoiDuyet] = await Promise.all([checkPermission("bao-luu:create"), checkPermission("bao-luu:approve")]);
  if (!laNguoiLap && !laNguoiDuyet) return { ok: false, error: "Bạn không có quyền xem lớp phục học" };
  const p = idHoSo.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };
  const r = await goiYLopPhucHoc(p.data.reserveId, new Date());
  if (!r.ok) return { ok: false, error: r.loi.join("\n") };
  return { ok: true, ...r.data };
}

const phucHocSchema = idHoSo.extend({ lopMoiId: z.string().min(1), ghiChu: z.string().trim().max(500).nullable().optional() });

/** THỰC HIỆN phục học vào lớp đã chọn: chuyển ghi danh, gỡ tạm dừng, sinh buổi bù PHUC_HOC (nếu lớp đi trước), đóng hồ sơ — một giao dịch. Quyền duyệt (Quản lý). */
export async function phucHocAction(input: z.input<typeof phucHocSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được xếp phục học" };
  const p = phucHocSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const sdb = scopedDb(ctx.actor);
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };
  // Lớp đích cũng phải trong tầm nhìn — id lớp đến từ trình duyệt.
  const lop = await sdb.class.findFirst({ where: { id: p.data.lopMoiId, deletedAt: null }, select: { id: true } });
  if (!lop) return { ok: false, error: "Không tìm thấy lớp" };

  const r = await phucHoc({ reserveId: p.data.reserveId, lopMoiId: p.data.lopMoiId, ghiChu: p.data.ghiChu ?? null }, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  revalidatePath("/classes");
  const canhBao = r.data.thieuBuoiBu > 0 ? [`Còn thiếu ${r.data.thieuBuoiBu} buổi bù: lớp mới chưa có đủ buổi cho các bài bé bỏ lỡ — xếp thủ công ở mục Học bù.`] : undefined;
  return { ok: true, canhBao };
}

const tamDungLopSchema = z.object({
  classId: z.string().min(1),
  ngayMoLai: ngay,
  lyDo: z.string().trim().min(5, "Ghi lý do tạm dừng lớp (ít nhất 5 ký tự)").max(500),
});

/** Trung tâm TẠM DỪNG CẢ LỚP (loại CENTER) — một giao dịch cho mọi học viên; một em hỏng ⇒ cả lớp cuộn ngược. Quyền `bao-luu:center-pause`. */
export async function tamDungLopAction(input: z.input<typeof tamDungLopSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:center-pause"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được tạm dừng cả lớp" };
  const p = tamDungLopSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const mo = ngayHoacNull(p.data.ngayMoLai);
  if (mo === "loi") return { ok: false, error: "Ngày dự kiến mở lại không hợp lệ" };
  const lop = await scopedDb(ctx.actor).class.findFirst({ where: { id: p.data.classId, deletedAt: null }, select: { id: true } });
  if (!lop) return { ok: false, error: "Không tìm thấy lớp" };

  const now = new Date();
  const r = await tamDungLop({ classId: p.data.classId, ngayMoLai: mo, lyDo: p.data.lyDo }, nguoiLam(ctx), now);
  if (!r.ok) return dongLoi(r.loi);
  // Dời hạn đợt thu cho từng bé (nếu có ngày mở lại) — sau commit, không chặn việc đã xong.
  const canhBao: string[] = [];
  if (mo) for (const id of r.data.reserveIds) canhBao.push(...(await doiHanSauKhiCommit(id, nguoiLam(ctx), now)));
  if (r.data.boQua.length > 0) canhBao.push(`Bỏ qua ${r.data.boQua.length} học viên: ${r.data.boQua.map((b) => `${b.ten} (${b.lyDo})`).join("; ")}`);
  revalidatePath("/bao-luu");
  revalidatePath("/classes");
  return { ok: true, ids: r.data.reserveIds, canhBao: canhBao.length ? [...new Set(canhBao)] : undefined };
}

/** BR-24: không xếp được lớp phù hợp ⇒ hồ sơ PARENT chuyển loại CENTER. Quyền duyệt. */
export async function chuyenSangTrungTamAction(input: z.input<typeof lyDoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được chuyển hồ sơ sang Trung tâm" };
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };
  const r = await chuyenSangTrungTam(p.data, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  return { ok: true };
}

/** Hồ sơ CENTER sinh yêu cầu hoàn (RefundRequest PENDING) theo số buổi chưa học. Quyền `bao-luu:refund-request`. KHÔNG chi tiền. */
export async function sinhYeuCauHoanAction(input: z.input<typeof lyDoSchema>): Promise<KQ> {
  const ctx = await vao();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:refund-request"))) return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được sinh yêu cầu hoàn" };
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tt = await coHoSoTrongTamNhin(ctx, p.data.reserveId);
  if (!tt) return { ok: false, error: "Không tìm thấy hồ sơ bảo lưu" };
  const r = await sinhYeuCauHoan(p.data, nguoiLam(ctx), new Date());
  if (!r.ok) return dongLoi(r.loi);
  lamMoi(undefined, p.data.reserveId);
  revalidatePath("/hoan-tien");
  return { ok: true, canhBao: r.data.biKepVeSoDaThu ? ["Đề xuất đã bị kẹp về số tiền đã thu."] : undefined };
}
