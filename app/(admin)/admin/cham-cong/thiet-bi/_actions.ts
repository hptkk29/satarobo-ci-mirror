"use server";

// Thao tác quản lý THIẾT BỊ CHẤM CÔNG (P2.3). Quyền `hr_attendance:device-reset` tại ĐÚNG khối đang xem, và
// người sở hữu thiết bị phải thuộc khối đó (`nguoiThuocKhoi`) — quản lý CS1 không đụng máy của người chỉ làm CS2.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { nguoiThuocKhoi } from "@/lib/cham-cong/nghi-bu-db";
import { chuCuaThietBi, datLaiThietBi, docCauHinhThietBi, doiTrangThaiThietBi } from "@/lib/cham-cong/thiet-bi";

type Res = { ok: true; note?: string } | { ok: false; error: string };

async function gac(coSo: string, userId: string): Promise<string | null> {
  if (!(await checkPermission("hr_attendance:device-reset", { centerId: coSo }))) return "Không có quyền quản lý thiết bị ở cơ sở này";
  if (!(await nguoiThuocKhoi(userId, coSo, new Date()))) return "Người này không thuộc cơ sở đang xem";
  return null;
}

export async function doiTrangThaiThietBiAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z
    .object({ id: z.string().min(1), coSo: z.string().min(1), hanhDong: z.enum(["TIN_CAY", "THU_HOI", "BAO_MAT"]), lyDo: z.string().max(300) })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const chu = await chuCuaThietBi(p.data.id);
  if (!chu) return { ok: false, error: "Không tìm thấy thiết bị" };
  const loi = await gac(p.data.coSo, chu.userId);
  if (loi) return { ok: false, error: loi };
  const { toiDa } = await docCauHinhThietBi();
  const r = await doiTrangThaiThietBi({
    id: p.data.id,
    hanhDong: p.data.hanhDong,
    lyDo: p.data.lyDo,
    toiDa,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    now: new Date(),
  });
  if (r.ok) revalidatePath("/cham-cong/thiet-bi");
  return r;
}

export async function datLaiThietBiAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ userId: z.string().min(1), coSo: z.string().min(1), lyDo: z.string().max(300) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const loi = await gac(p.data.coSo, p.data.userId);
  if (loi) return { ok: false, error: loi };
  const r = await datLaiThietBi({
    userId: p.data.userId,
    lyDo: p.data.lyDo,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    now: new Date(),
  });
  if (!r.ok) return r;
  revalidatePath("/cham-cong/thiet-bi");
  return { ok: true, note: r.note }; // câu báo từ `thongBaoDatLai` — MỘT nguồn cho server, toast và test (D-04)
}
