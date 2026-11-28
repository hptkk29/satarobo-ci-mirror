import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { kiemQuyen, type BoiCanhDisc, type PhamViDisc } from "@/lib/disc/so-gia-dinh/mo-khoa";
import { isDiscEnabled } from "@/lib/flags";

/**
 * Cổng vào MỌI trang / route / server action của `/portal/disc`. Thứ tự cố định:
 *   1. cờ `DISC_ENABLED` tắt ⇒ 404 (không phân biệt với "không có trang") — kiểm TRƯỚC khi chạm phiên/DB;
 *   2. chưa đăng nhập hoặc không phải PARENT ⇒ về /login (layout portal đã gác, đây là lớp thứ hai — luật 5);
 *   3. `userId` lấy từ PHIÊN, KHÔNG BAO GIỜ từ URL / form / query;
 *   4. V8.31 — PIN ÉP Ở MÁY CHỦ: `kiemQuyen` (cờ `DISC_PIN_ENFORCE_ENABLED` BẬT ⇒ sổ đã đặt PIN chỉ vào được khi có phiên mở khoá còn hiệu lực, cookie HttpOnly `disc_mo_khoa` + phạm vi đủ).
 * Tham số `yc` là BẮT BUỘC (không có mặc định): mỗi chỗ gọi phải NÓI MÌNH CẦN PHẠM VI NÀO — quên là lỗi biên dịch. `phamVi: "KHONG"` = đường bootstrap (đặt/mở khoá PIN, lập sổ) — danh sách này ngắn và có lưới canh.
 * Không cần `assertCan`: vai quan hệ PARENT đã có; quyền đọc là QUYỀN SỞ HỮU (`DiscGiaDinh.ownerUserId = userId`).
 */
export type YeuCauPhienDisc = { readonly phamVi: PhamViDisc | "KHONG"; readonly thanhVienId?: string };
export type LyDoChan = "CO_TAT" | "CHUA_DANG_NHAP" | "CHUA_MO_KHOA" | "LOI_HE_THONG";
export type PhienDisc = { ok: true; userId: string; ctx: BoiCanhDisc } | { ok: false; loai: LyDoChan; ma?: string; thongBao?: string };

export const TEN_COOKIE_MO_KHOA = "disc_mo_khoa";
const KIEU_TOKEN = /^[A-Za-z0-9_-]{20,80}$/;

/** Token mở khoá THÔ trong cookie HttpOnly (chỉ để băm tra cứu ở máy chủ). Sai định dạng ⇒ coi như không có. */
export async function docTokenMoKhoaWeb(): Promise<string | null> {
  const v = (await cookies()).get(TEN_COOKIE_MO_KHOA)?.value;
  return v && KIEU_TOKEN.test(v) ? v : null;
}

export async function datCookieMoKhoa(token: string, hetHan: Date): Promise<void> {
  (await cookies()).set(TEN_COOKIE_MO_KHOA, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/portal/disc", expires: hetHan });
}

export async function xoaCookieMoKhoa(): Promise<void> {
  (await cookies()).set(TEN_COOKIE_MO_KHOA, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/portal/disc", maxAge: 0 });
}

export async function docPhienDisc(yc: YeuCauPhienDisc): Promise<PhienDisc> {
  if (!isDiscEnabled()) return { ok: false, loai: "CO_TAT" };
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "PARENT") return { ok: false, loai: "CHUA_DANG_NHAP" };
  const ctx: BoiCanhDisc = { userId: session.user.id, kenh: "WEB", phienDangNhapId: null, tokenWeb: await docTokenMoKhoaWeb(), hocSinhId: null };
  if (yc.phamVi === "KHONG") return { ok: true, userId: ctx.userId, ctx };
  const k = await kiemQuyen(ctx, { phamVi: yc.phamVi, thanhVienId: yc.thanhVienId });
  if (k.ok) return { ok: true, userId: ctx.userId, ctx };
  if (k.loi === "DISC_LOI_HE_THONG") return { ok: false, loai: "LOI_HE_THONG", ma: k.loi, thongBao: k.thongBao };
  return { ok: false, loai: "CHUA_MO_KHOA", ma: k.loi, thongBao: k.thongBao };
}

/** Dùng trong `page.tsx`: cờ tắt ⇒ `notFound()`, chưa đăng nhập ⇒ `/login`, chưa mở khoá ⇒ màn «Nhập PIN», lỗi hệ thống bảo vệ ⇒ ném lỗi (fail-closed, error.tsx). */
export async function yeuCauPhienDisc(yc: YeuCauPhienDisc): Promise<{ userId: string; ctx: BoiCanhDisc }> {
  const p = await docPhienDisc(yc);
  if (!p.ok) {
    if (p.loai === "CO_TAT") notFound();
    if (p.loai === "CHUA_MO_KHOA") redirect("/portal/disc/mo-khoa");
    if (p.loai === "LOI_HE_THONG") throw new Error("Hệ thống bảo vệ sổ DISC đang gặp sự cố.");
    redirect("/login");
  }
  return { userId: p.userId, ctx: p.ctx };
}
