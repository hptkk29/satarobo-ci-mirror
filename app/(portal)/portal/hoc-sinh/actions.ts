"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTIVE_SITE_COOKIE, assertOwnsStudent, getPortalContext, makeActiveSiteToken, requireActiveStudent } from "@/lib/portal/session";
import { tenCookieDaXem } from "@/lib/portal/hv-thong-bao-thuan";
import { HV_COOKIE, HV_COOKIE_MAX_AGE_S, kiemVeXacMinh, taoTokenCheDo, taoVeXacMinh, type MucDichVe } from "@/lib/portal/hv-token";
import { CAU_LOI_MA, dongHoKhoa, laMaDeDoan } from "@/lib/portal/hv-ma-thuan";
import {
  coMaThoat,
  docNamSinhCacCon,
  ghiNhatKy,
  kiemMaCoDem,
  kiemMatKhauPhuHuynh,
  luuMaThoat,
  trungMaHienTai,
} from "@/lib/portal/hv-ma";
import { getSigningSecret } from "@/lib/security/signing-key";
import { vnParts } from "@/lib/time/vn";

// Cổng học sinh — vào / thoát chế độ học sinh và quản lý MÃ THOÁT 4 SỐ.
// Mọi hành động: auth() + vai PARENT TRƯỚC, zod, rồi mới ghi. Chuỗi lỗi hiển thị nguyên cho người dùng.

type Ok<T = object> = { ok: true } & T;
type Loi = { ok: false; error: string; khoaGiay?: number };

const maSchema = z.string().regex(/^\d{4}$/, "Mã gồm đúng 4 chữ số.");
const idSchema = z.string().min(1).max(64);

// Cổng chung của portal: `getPortalContext` tự trả null cho người không phải phụ huynh đang đăng nhập (luật no-inline-authz cấm so `.role` trong Server Action).
async function phuHuynhDangDangNhap(): Promise<{ userId: string } | null> {
  const ctx = await getPortalContext();
  return ctx ? { userId: ctx.parentUserId } : null;
}

const khongPhaiLucNay: Loi = { ok: false, error: "Bây giờ chưa làm được việc này." };

/** Cho con vào Cổng học sinh. Chỉ khi ba mẹ ĐÃ có mã thoát — vào mà không có mã thì không ai thoát được. */
export async function vaoCheDoHocSinhAction(studentId: unknown): Promise<Ok | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const sid = idSchema.safeParse(studentId);
  if (!sid.success) return { ok: false, error: "Học viên không hợp lệ" };
  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return khongPhaiLucNay;
  if (!(await assertOwnsStudent(sid.data))) return { ok: false, error: "Không có quyền chọn học viên này" };
  if (!(await coMaThoat(pa.userId))) return { ok: false, error: "Ba mẹ tạo mã thoát trước nhé." };

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(HV_COOKIE, taoTokenCheDo(pa.userId, sid.data, Date.now(), getSigningSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: HV_COOKIE_MAX_AGE_S,
  });
  jar.set(ACTIVE_SITE_COOKIE, makeActiveSiteToken(sid.data), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  await ghiNhatKy(pa.userId, sid.data, "VAO");
  revalidatePath("/portal", "layout");
  return { ok: true };
}

/** Con (hoặc ba mẹ) nhập mã để về chế độ ba mẹ. Đây là CỔNG DUY NHẤT xoá cookie chế độ học sinh. */
// eslint-disable-next-line authz/require-can-in-write-action -- tự phục vụ: người gọi là CHÍNH phụ huynh đang đăng nhập (getPortalContext); chỉ ghi nhật ký và xoá cookie của chính mình, không đụng tài nguyên của người khác.
export async function thoatCheDoHocSinhAction(ma: unknown): Promise<Ok | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const m = maSchema.safeParse(ma);
  if (!m.success) return { ok: false, error: m.error.issues[0]?.message ?? "Mã không hợp lệ" };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  // Không ở chế độ học sinh thì không có gì để thoát — KHÔNG lộ trạng thái mã, KHÔNG đếm lần sai.
  if (ctx.cheDo !== "hoc-sinh") return { ok: true };

  const r = await kiemMaCoDem(pa.userId, m.data, new Date(), {
    studentId: ctx.activeStudent?.id ?? null,
    tenCon: ctx.activeStudent?.name ?? null,
  });
  if (r.ket === "chua-co-ma") return { ok: false, error: "Máy này chưa có mã thoát. Nhờ ba mẹ đăng nhập lại." };
  if (r.ket === "khoa") return { ok: false, error: `Tạm khoá ${dongHoKhoa(r.giayCon)}`, khoaGiay: r.giayCon };
  if (r.ket === "sai") return { ok: false, error: `Mã chưa đúng. Còn ${r.conLai} lần thử.` };

  (await cookies()).delete({ name: HV_COOKIE, path: "/" });
  await ghiNhatKy(pa.userId, ctx.activeStudent?.id ?? null, "THOAT_DUNG_MA");
  revalidatePath("/portal", "layout");
  return { ok: true };
}

/** Lần đầu: tạo mã. Đã có mã thì phải Đổi mã / Quên mã (không cho tạo đè). */
export async function taoMaThoatAction(input: unknown): Promise<Ok | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const p = z.object({ ma: maSchema, xacNhan: maSchema }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return khongPhaiLucNay;
  if (p.data.ma !== p.data.xacNhan) return { ok: false, error: "Hai lần nhập chưa khớp. Ba mẹ đặt lại nhé." };
  const loi = laMaDeDoan(p.data.ma, await docNamSinhCacCon(pa.userId), vnParts(new Date()).year);
  if (loi) return { ok: false, error: CAU_LOI_MA[loi] };
  if (await coMaThoat(pa.userId)) return { ok: false, error: "Ba mẹ đã có mã thoát. Hãy dùng Đổi mã hoặc Quên mã." };
  await luuMaThoat(pa.userId, p.data.ma);
  await ghiNhatKy(pa.userId, null, "TAO_MA");
  revalidatePath("/portal/hoc-sinh/vao");
  revalidatePath("/portal/hoc-sinh/ma");
  return { ok: true };
}

/**
 * Bước 1 của "Đổi mã": nhập mã HIỆN TẠI. Đi qua CÙNG bộ đếm sai/khoá với màn thoát — nếu không, bước này là cỗ máy đoán mã
 * không giới hạn. Đúng thì cấp vé 10 phút dùng cho `datMaMoiAction`.
 */
export async function kiemMaHienTaiAction(ma: unknown): Promise<Ok<{ ve: string }> | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const m = maSchema.safeParse(ma);
  if (!m.success) return { ok: false, error: m.error.issues[0]?.message ?? "Mã không hợp lệ" };
  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return khongPhaiLucNay;
  const r = await kiemMaCoDem(pa.userId, m.data, new Date(), { studentId: ctx.activeStudent?.id ?? null, tenCon: ctx.activeStudent?.name ?? null });
  if (r.ket === "chua-co-ma") return { ok: false, error: "Ba mẹ chưa tạo mã thoát." };
  if (r.ket === "khoa") return { ok: false, error: `Nhập sai nhiều lần. Thử lại sau ${dongHoKhoa(r.giayCon)}.`, khoaGiay: r.giayCon };
  if (r.ket === "sai") return { ok: false, error: `Mã hiện tại chưa đúng. Còn ${r.conLai} lần thử.` };
  return { ok: true, ve: taoVeXacMinh(pa.userId, "doi", Date.now(), getSigningSecret()) };
}

/** Bước 1 của "Quên mã": xác minh bằng mật khẩu đăng nhập (giới hạn riêng theo tài khoản). */
export async function xacMinhMatKhauAction(matKhau: unknown): Promise<Ok<{ ve: string }> | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const mk = z.string().min(1).max(200).safeParse(matKhau);
  if (!mk.success) return { ok: false, error: "Nhập mật khẩu đăng nhập của ba mẹ." };
  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return khongPhaiLucNay;
  const r = await kiemMatKhauPhuHuynh(pa.userId, mk.data);
  if (r.ket === "qua-nhieu-lan") return { ok: false, error: "Nhập sai mật khẩu nhiều lần. Thử lại sau 15 phút." };
  if (r.ket === "khong-co-mat-khau") return { ok: false, error: "Tài khoản này chưa có mật khẩu đăng nhập. Gọi 0837.312.860 để được hỗ trợ." };
  if (r.ket === "sai") return { ok: false, error: "Mật khẩu chưa đúng. Ba mẹ thử lại nhé." };
  return { ok: true, ve: taoVeXacMinh(pa.userId, "quen", Date.now(), getSigningSecret()) };
}

/** Bước cuối của Đổi mã / Quên mã: đặt mã mới, đòi vé của bước 1. */
export async function datMaMoiAction(input: unknown): Promise<Ok | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const p = z
    .object({ ve: z.string().min(1).max(400), luong: z.enum(["doi", "quen"]), ma: maSchema, xacNhan: maSchema })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return khongPhaiLucNay;
  const luong: MucDichVe = p.data.luong;
  if (!kiemVeXacMinh(p.data.ve, pa.userId, luong, Date.now(), getSigningSecret())) {
    return { ok: false, error: "Phiên xác minh đã hết hạn. Ba mẹ làm lại từ đầu nhé." };
  }
  if (p.data.ma !== p.data.xacNhan) return { ok: false, error: "Hai lần nhập chưa khớp. Ba mẹ đặt lại mã mới nhé." };
  const loi = laMaDeDoan(p.data.ma, await docNamSinhCacCon(pa.userId), vnParts(new Date()).year);
  if (loi) return { ok: false, error: CAU_LOI_MA[loi] };
  if (!(await coMaThoat(pa.userId))) return { ok: false, error: "Ba mẹ chưa tạo mã thoát." };
  if (luong === "doi" && (await trungMaHienTai(pa.userId, p.data.ma))) {
    return { ok: false, error: CAU_LOI_MA.TRUNG_MA_CU };
  }
  await luuMaThoat(pa.userId, p.data.ma);
  await ghiNhatKy(pa.userId, null, luong === "doi" ? "DOI_MA" : "DAT_LAI_MA");
  revalidatePath("/portal/hoc-sinh/vao");
  revalidatePath("/portal/hoc-sinh/ma");
  return { ok: true };
}

/**
 * "Ba mẹ quên mã" ngay trên màn thoát: xác minh bằng MẬT KHẨU đăng nhập (giới hạn riêng theo tài khoản — đây là cửa thử mật khẩu
 * ngoài màn đăng nhập) rồi thoát chế độ học sinh để đặt mã mới ở màn Mã thoát. Không đi qua bộ đếm mã vì không thử mã.
 */
// eslint-disable-next-line authz/require-can-in-write-action -- tự phục vụ: người gọi là CHÍNH phụ huynh đang đăng nhập (getPortalContext); chỉ ghi nhật ký và xoá cookie của chính mình, không đụng tài nguyên của người khác.
export async function thoatBangMatKhauAction(matKhau: unknown): Promise<Ok | Loi> {
  const pa = await phuHuynhDangDangNhap();
  if (!pa) return { ok: false, error: "Chưa đăng nhập" };
  const mk = z.string().min(1).max(200).safeParse(matKhau);
  if (!mk.success) return { ok: false, error: "Nhập mật khẩu đăng nhập của ba mẹ." };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };
  if (ctx.cheDo !== "hoc-sinh") return { ok: true };
  const r = await kiemMatKhauPhuHuynh(pa.userId, mk.data);
  if (r.ket === "qua-nhieu-lan") return { ok: false, error: "Nhập sai mật khẩu nhiều lần. Thử lại sau 15 phút." };
  if (r.ket === "khong-co-mat-khau") return { ok: false, error: "Tài khoản này chưa có mật khẩu đăng nhập. Gọi 0837.312.860 để được hỗ trợ." };
  if (r.ket === "sai") return { ok: false, error: "Mật khẩu chưa đúng. Ba mẹ thử lại nhé." };
  (await cookies()).delete({ name: HV_COOKIE, path: "/" });
  await ghiNhatKy(pa.userId, ctx.activeStudent?.id ?? null, "THOAT_DUNG_MA", "Thoát bằng mật khẩu đăng nhập (quên mã)");
  revalidatePath("/portal", "layout");
  return { ok: true };
}

/** "Đánh dấu đã đọc hết" của EM: chỉ một mốc thời gian lưu cookie trên máy này — KHÔNG chạm trạng thái chuông của ba mẹ. */
export async function danhDauDaDocHocSinhAction(): Promise<Ok | Loi> {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  (await cookies()).set(tenCookieDaXem(studentId), String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/portal", "layout");
  return { ok: true };
}
