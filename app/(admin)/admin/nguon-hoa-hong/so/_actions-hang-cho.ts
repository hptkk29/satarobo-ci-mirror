"use server";
// Server Action của «Hàng chờ cần xử lý» (tab Sổ — R9 · T1). MỎNG có chủ đích: auth → quyền → xác thực đầu vào → điều phối (`lib/hoa-hong/hang-cho-xu-ly-hanh-dong`) → làm mới trang.
// Mọi luật (một/hai người · tiền bị ảnh hưởng · phạm vi cơ sở · cổng của `giaiHangCho`) nằm ở `hang-cho-xu-ly-service` — action KHÔNG viết lại.
//
// MỘT quyền cho cả bốn thao tác: `commission_periods:manage` — ĐÚNG key mà tab Sổ dùng để vẽ nút «Xử lý» (`KEY_QUAN_LY_KY`, luật 12) và ĐÚNG key mà `giaiHangCho` ghi trong chú thích
// «action gác `commission_periods:manage`». Không đẻ quyền mới: RBAC v2 đọc quyền từ DB nên quyền mới chỉ sống sau khi bấm `seed-prod-roles.yml` (08/R9). Tách nhiệm cho tiền lớn
// KHÔNG dựa vào quyền mà vào danh tính: người đề nghị ≠ người duyệt (service).
//
// ⚠️ File `"use server"` ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import { BANG_CHUNG_TOI_DA, LY_DO_TOI_DA } from "@/lib/hoa-hong/hang-cho-xu-ly";
import { chuyenXemTayHanhDong, deNghiHanhDong, quyetHanhDong, xemTruocHanhDong, type XemTruocView } from "@/lib/hoa-hong/hang-cho-xu-ly-hanh-dong";
import { PHU_THUOC_THAT, type KetQua } from "@/lib/hoa-hong/ky-hanh-dong";
import type { NguoiThaoTacKy } from "@/lib/hoa-hong/ky-service";

const KHONG_QUYEN = "Bạn không có quyền xử lý hàng chờ hoa hồng (commission_periods:manage).";
const CHUA_DANG_NHAP = "Chưa đăng nhập.";
const DAU_VAO_SAI = "Yêu cầu không hợp lệ — tải lại trang rồi thử lại.";

const idSchema = z.string().min(1).max(64);
const lyDoSchema = z.string().max(LY_DO_TOI_DA);
const bangChungSchema = z.string().max(BANG_CHUNG_TOI_DA);
const quyetDinhSchema = z.enum(["AP_DUNG", "GIU_NGUYEN"]);

type Loi = { ok: false; ma: string; loi: string };
const tuChoi = (ma: string, loi: string): Loi => ({ ok: false, ma, loi });

async function vaoViec(): Promise<{ nguoi: NguoiThaoTacKy } | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi("CHUA_DANG_NHAP", CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_periods:manage");
  } catch {
    return tuChoi("KHONG_QUYEN", KHONG_QUYEN);
  }
  const quyen = await resolveActor(session.user.id);
  return { nguoi: { userId: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id, quyen } };
}

function lamMoi() {
  // Số hàng chờ trên pill các tab nằm ở khung chung ⇒ làm mới cả module, không chỉ trang Sổ.
  revalidatePath("/nguon-hoa-hong", "layout");
}

/** CHỈ ĐỌC — chạy đúng các cổng của «Giải phóng» rồi dừng trước phép ghi đầu tiên. Không làm mới trang (không đổi gì). */
export async function xemTruocHangChoAction(vao: { holdId: string }): Promise<KetQua<{ xem: XemTruocView }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ holdId: idSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return xemTruocHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data });
}

/** CẤP 1 (chỉ khi số tiền cần hai người): ghi đề nghị. Hàng chờ vẫn mở, sổ không đổi. */
export async function deNghiHangChoAction(vao: { holdId: string; quyetDinh: "AP_DUNG" | "GIU_NGUYEN"; lyDo: string; bangChung: string }): Promise<KetQua<{ daCoTruoc: boolean }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ holdId: idSchema, quyetDinh: quyetDinhSchema, lyDo: lyDoSchema, bangChung: bangChungSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  const r = await deNghiHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data });
  if (r.ok) lamMoi();
  return r;
}

/**
 * QUYẾT: «Giải phóng» (`AP_DUNG`) hoặc «Từ chối / giữ nguyên» (`GIU_NGUYEN`). Một người nếu dưới ngưỡng; từ ngưỡng thì đây là CẤP 2 (người KHÁC người đề nghị).
 * `tienDaThay` = số tiền hộp thoại đã in — chỉ là TRẦN, server tính lại sau khoá.
 */
export async function quyetHangChoAction(vao: {
  holdId: string;
  quyetDinh: "AP_DUNG" | "GIU_NGUYEN";
  lyDo: string;
  bangChung: string;
  tienDaThay: number;
}): Promise<KetQua<{ daXuLyTruoc: boolean; soDong: number; tong: number }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ holdId: idSchema, quyetDinh: quyetDinhSchema, lyDo: lyDoSchema, bangChung: bangChungSchema, tienDaThay: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  const r = await quyetHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data });
  if (r.ok) lamMoi();
  return r;
}

/** «Chuyển xem tay»: dấu vết kiểm toán + nhãn; hàng chờ vẫn mở và vẫn chặn khoá kỳ. */
export async function chuyenXemTayHangChoAction(vao: { holdId: string; lyDo: string }): Promise<KetQua<{ daCoTruoc: boolean }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ holdId: idSchema, lyDo: lyDoSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  const r = await chuyenXemTayHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data });
  if (r.ok) lamMoi();
  return r;
}
