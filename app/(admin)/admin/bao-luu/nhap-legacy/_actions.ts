"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { nhapLegacy, xemTruocLegacy } from "@/lib/bao-luu/legacy-nhap-db";
import { TRAN_CA_MOI_LUOT, type CaNhap } from "@/lib/bao-luu/legacy-nhap";

// Server Action của màn "Nhập ca bảo lưu cũ" (K14). MỎNG có chủ đích: đăng nhập → ĐÚNG quyền (`bao-luu:approve`, KHÔNG đẻ quyền mới) → mọi id trình
// duyệt gửi lên phải nằm trong tầm nhìn cơ sở (`scopedDb`) → dịch vụ. Luật nghiệp vụ ở `lib/bao-luu/legacy-nhap.ts` (thuần) và `legacy-nhap-db.ts`.
// Xem trước và ghi nhận CÙNG đầu vào; hàm ghi tự tính lại kế hoạch, không tin bản xem trước của trình duyệt.

const caSchema = z.object({
  nhom: z.enum(["A", "B", "C"]),
  studentId: z.string().min(1),
  enrollmentId: z.string().min(1).nullable(),
  reserveId: z.string().min(1).nullable(),
  ngayBatDau: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu không hợp lệ"),
  applicationFileKey: z.string().min(1).nullable(),
});
const loSchema = z.object({ cas: z.array(caSchema).min(1, "Chưa chọn ca nào").max(TRAN_CA_MOI_LUOT, `Mỗi lượt nhập tối đa ${TRAN_CA_MOI_LUOT} ca`) });

export type DauVaoNhapLegacy = z.input<typeof loSchema>;

export type CaXemTruoc = {
  nhom: "A" | "B" | "C";
  studentId: string;
  enrollmentId: string | null;
  tenHocVien: string | null;
  khoa: string | null;
  trangThaiGhiDanhTruoc: string | null;
  chuyenSangTamDung: boolean;
  batDau: string | null;
  han: string | null;
  loi: string[];
  canhBao: string[];
};
export type KetQuaXemTruoc = { ok: true; sanSang: boolean; loLoi: string[]; cac: CaXemTruoc[] } | { ok: false; error: string };
export type KetQuaNhapLegacy = { ok: true; soCa: number } | { ok: false; error: string };

async function vao() {
  const session = await auth();
  if (!session?.user) return null;
  return { session, actor: await resolveActor(session.user.id) };
}

/** Mọi id đến từ trình duyệt: học viên / ghi danh / dòng cũ phải nằm trong tầm nhìn — ngoài tầm nhìn thì "không tìm thấy" (chống IDOR). */
async function trongTamNhin(actor: Awaited<ReturnType<typeof resolveActor>>, cas: readonly CaNhap[]): Promise<string | null> {
  const sdb = scopedDb(actor);
  for (const ca of cas) {
    if (!(await sdb.student.findFirst({ where: { id: ca.studentId, deletedAt: null }, select: { id: true } }))) return "Không tìm thấy học viên";
    if (ca.enrollmentId && !(await sdb.enrollment.findFirst({ where: { id: ca.enrollmentId }, select: { id: true } }))) return "Không tìm thấy ghi danh";
    if (ca.reserveId && !(await sdb.studentReserve.findUnique({ where: { id: ca.reserveId }, select: { id: true } }))) return "Không tìm thấy dòng bảo lưu";
  }
  return null;
}

async function chuanBi(input: unknown) {
  const ctx = await vao();
  if (!ctx) return { ok: false as const, loi: "Chưa đăng nhập" };
  if (!(await checkPermission("bao-luu:approve"))) return { ok: false as const, loi: "Chỉ Quản lý cơ sở / Admin được nhập ca bảo lưu cũ" };
  const p = loSchema.safeParse(input);
  if (!p.success) return { ok: false as const, loi: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cas: CaNhap[] = p.data.cas;
  const ngoai = await trongTamNhin(ctx.actor, cas);
  if (ngoai) return { ok: false as const, loi: ngoai };
  return { ok: true as const, ctx, cas };
}

/** XEM TRƯỚC — CHỈ ĐỌC. Cho biết từng ca sẽ đổi gì (ghi danh, hạn, cảnh báo) hoặc vì sao bị chặn. */
export async function xemTruocLegacyAction(input: DauVaoNhapLegacy): Promise<KetQuaXemTruoc> {
  const c = await chuanBi(input);
  if (!c.ok) return { ok: false, error: c.loi };
  const r = await xemTruocLegacy(c.cas, new Date());
  return {
    ok: true,
    sanSang: r.ok,
    loLoi: r.loLoi,
    cac: r.cac.map((x) => ({
      nhom: x.ca.nhom,
      studentId: x.ca.studentId,
      enrollmentId: x.ca.enrollmentId,
      tenHocVien: x.tenHocVien,
      khoa: x.khoa,
      trangThaiGhiDanhTruoc: x.enrollmentTruoc,
      chuyenSangTamDung: x.ke?.chuyenGhiDanhSangPaused ?? false,
      batDau: x.ke ? x.ke.startedAt.toISOString() : null,
      han: x.ke ? x.ke.han.toISOString() : null,
      loi: x.loi,
      canhBao: x.canhBao,
    })),
  };
}

/** GHI — một giao dịch, tất cả hoặc không. */
export async function nhapLegacyAction(input: DauVaoNhapLegacy): Promise<KetQuaNhapLegacy> {
  const c = await chuanBi(input);
  if (!c.ok) return { ok: false, error: c.loi };
  const r = await nhapLegacy(c.cas, { id: c.ctx.session.user.id, name: c.ctx.session.user.name ?? "Nhân sự" }, new Date());
  if (!r.ok) return { ok: false, error: r.loi.join("\n") };
  revalidatePath("/bao-luu");
  revalidatePath("/bao-luu/nhap-legacy");
  revalidatePath("/classes");
  revalidatePath("/students");
  return { ok: true, soCa: r.data.soCa };
}
