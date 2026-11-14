"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { docTaiKhoanKetNoi, ghiKetQuaKiemTra, luuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { moiTruongKetNoiTuMoiTruongChay } from "@/lib/finance/hoa-don/ket-noi/luat";
import { rateLimit } from "@/lib/rate-limit";
import { laProductionThat } from "@/lib/security/client-ip";
import { taoCongVin, type MaKiemTraKetNoi } from "@/lib/vin-hoadon/http";

// «Kết nối & ký» (hub/13): tài khoản nhà cung cấp hoá đơn + cách ký của từng pháp nhân.
// [BGĐ 04/11/2026] Quyền THAY ĐỔI: CHỈ Quản trị tối cao — DÙNG LẠI `settings:edit` (không đẻ quyền mới: SUPER_ADMIN qua nhánh bypass của `can()`, nên không cần bấm seed-prod-roles).
// Kế toán Hội sở chỉ XEM (đọc ở trang, không qua action). Lý do: bảng này không có centerId và mang thông tin xác thực; đổi nó là đổi ai ký, ký bằng gì, hoá đơn đi đâu.
// ⚠️ Mật khẩu CHỈ đi MỘT CHIỀU (vào): không action nào trả mật khẩu hay chuỗi mã hoá. Không `trim` mật khẩu (khoảng trắng là một phần của nó).

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Cổng chung — wrapper cục bộ MỘT cấp, cùng tệp (lint `require-can-in-write-action` không tính wrapper import).
 * cờ màn → đăng nhập → `settings:edit` (CHỈ Quản trị tối cao). Lưới `[KCS-W1]` ghim cổng này ở MỌI action ghi của tệp.
 */
async function congQuanTri(): Promise<{ ok: false; error: string } | { ok: true; actor: Actor; userId: string; userName: string }> {
  if (!(await laHoaDonBat())) return { ok: false, error: "Màn hoá đơn điện tử chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) {
    return { ok: false, error: "Chỉ Quản trị tối cao được thay đổi kết nối nhà cung cấp, cách ký và tài khoản tích hợp" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, actor, userId: session.user.id, userName: session.user.name ?? session.user.email ?? session.user.id };
}

/** Chỉ cấu hình môi trường ĐANG CHẠY: máy test lưu SANDBOX, máy production lưu PROD — không lưu chéo. */
const moiTruongDangChay = () => moiTruongKetNoiTuMoiTruongChay(laProductionThat());

const khoaNhanh = z.string().trim().max(300).nullish();
const luuSchema = z.object({
  phapNhanMa: z.string().trim().min(1).max(64),
  moiTruong: z.enum(["SANDBOX", "PROD"]),
  nhaCungCapMa: z.enum(["VIN_HOADON", "MISA_MEINVOICE"]),
  dangBat: z.boolean(),
  baseUrl: khoaNhanh,
  mst: z.string().trim().max(20).nullish(),
  tenDangNhap: z.string().trim().max(100).nullish(),
  phuongThucKy: z.enum(["HSM_NHA_CUNG_CAP", "USB_TOKEN"]),
  cheDoKy: z.enum(["TUNG_LENH", "LO", "NEN"]),
  chungThuSerial: z.string().trim().max(64).nullish(),
  chungThuHetHan: z.string().trim().max(10).nullish(),
  misaAppId: z.string().trim().max(100).nullish(),
  misaLoaiHoaDon: z.enum(["co-ma", "khong-ma"]).nullish(),
  /** KHÔNG trim. Rỗng/vắng = giữ mật khẩu đang lưu. */
  matKhauMoi: z.string().max(200).nullish(),
  lyDo: z.string().trim().max(300).nullish(),
});

/** Thêm / sửa MỘT kết nối (pháp nhân × môi trường đang chạy). */
export async function luuKetNoiAction(input: unknown): Promise<KetQua<{ id: string; doiMatKhau: boolean }>> {
  const p = luuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congQuanTri();
  if (!cong.ok) return cong;
  if (v.moiTruong !== moiTruongDangChay()) return { ok: false, error: "Chỉ cấu hình được môi trường đang chạy của máy chủ này" };
  const kq = await luuKetNoi({
    actor: cong.actor,
    nguoi: { id: cong.userId, name: cong.userName },
    du: {
      phapNhanMa: v.phapNhanMa,
      moiTruong: v.moiTruong,
      nhaCungCapMa: v.nhaCungCapMa,
      dangBat: v.dangBat,
      baseUrl: v.baseUrl || null,
      mst: v.mst || null,
      tenDangNhap: v.tenDangNhap || null,
      phuongThucKy: v.phuongThucKy,
      cheDoKy: v.cheDoKy,
      chungThuSerial: v.chungThuSerial || null,
      chungThuHetHan: v.chungThuHetHan || null,
      misaAppId: v.misaAppId || null,
      misaLoaiHoaDon: v.misaLoaiHoaDon ?? null,
    },
    matKhauMoi: v.matKhauMoi ?? null,
    lyDo: v.lyDo ?? null,
  });
  if (!kq.ok) return kq;
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { id: kq.id, doiMatKhau: kq.doiMatKhau } };
}

const kiemTraSchema = z.object({ phapNhanMa: z.string().trim().min(1).max(64) });

/**
 * «Kiểm tra kết nối»: đăng nhập thử bằng tài khoản ĐÃ LƯU (GetToken). Chỉ chứng minh địa chỉ + MST + tài khoản + mật khẩu được nhà cung cấp chấp nhận
 * — KHÔNG chứng minh chứng thư / ký được. Ghi lại MÃ cố định, không bao giờ trả hay ghi mật khẩu, token, địa chỉ.
 */
export async function kiemTraKetNoiAction(input: unknown): Promise<KetQua<{ ma: MaKiemTraKetNoi }>> {
  const p = kiemTraSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congQuanTri();
  if (!cong.ok) return cong;
  const gioiHan = await rateLimit({ key: `hoa-don-ket-noi-kiem-tra:${cong.userId}`, max: 10, windowMs: 10 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Kiểm tra quá nhiều lần — thử lại sau ít phút" };
  const moiTruong = moiTruongDangChay();
  const tk = await docTaiKhoanKetNoi(p.data.phapNhanMa, moiTruong, undefined, { choKiemTra: true });
  if (!tk.hang) return { ok: false, error: "Chưa khai kết nối cho pháp nhân này" };
  if (tk.hang.nhaCungCapMa !== "VIN_HOADON") return { ok: false, error: "Chỉ kiểm tra được kết nối VIN-HOADON ở đây — MISA đọc tài khoản từ máy chủ" };
  if (tk.loi === "KHOA_THIEU") return { ok: false, error: "Máy chủ chưa đặt khoá mã hoá bí mật (HOA_DON_KHOA_BI_MAT)" };
  if (tk.loi === "KHONG_GIAI_MA_DUOC") return { ok: false, error: "Không giải mã được mật khẩu đã lưu — nhập lại mật khẩu rồi lưu" };
  if (!tk.cauHinhVin || !tk.mst) return { ok: false, error: "Kết nối chưa đủ địa chỉ, MST, tên đăng nhập và mật khẩu" };
  const ma = await taoCongVin({ cauHinh: tk.cauHinhVin, fetchImpl: (i, init) => fetch(i, init) }).kiemTraDangNhap(tk.mst);
  await ghiKetQuaKiemTra({ phapNhanMa: p.data.phapNhanMa, moiTruong, ketQua: ma, now: new Date() });
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { ma } };
}
