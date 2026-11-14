"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { laKyUsbBat } from "@/lib/finance/hoa-don/feature";
import { duyetVaBatDauKy, huyLenhKy } from "@/lib/finance/hoa-don/lenh-ky-db";
import { CHINH_SACH_KY_NGHIEM_NHAT } from "@/lib/finance/hoa-don/lenh-ky-trang-thai";
import { taoLenhKyUsb, kiemTraLaiUsb } from "@/lib/finance/hoa-don/ky-usb/ky-usb-lenh";
import { taoMaGhep, thuHoiMay } from "@/lib/finance/hoa-don/ky-usb/may-ky";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";

// Khu «Ký USB token» (hub/13): tạo lệnh ký, «Ký lô», ghép / thu hồi máy ký, kiểm tra lại. Quyền: DÙNG LẠI `payments:confirm` + phạm vi kế toán (mỗi lệnh còn bị
// cổng cơ sở của S9 kiểm lại ở lớp dưới). Sau cờ `hoaDon.kyUsb` (TẮT mặc định).
// ⚠️ «Người yêu cầu» = CHÍNH người bấm. Chính sách S9 mặc định (nghiêm) đòi người ký ≠ người yêu cầu ⇒ một kế toán một mình KHÔNG tự tạo rồi tự ký được — đó là
//    quyết định của chủ dự án (hub/13 §10.2), không phải lỗi; ở đây không giả vờ người yêu cầu là «hệ thống» để lách.

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string };

async function congKyUsb(): Promise<{ ok: false; error: string } | { ok: true; actor: Actor; userId: string; userName: string }> {
  if (!(await laKyUsbBat())) return { ok: false, error: "Ký USB token chưa được bật (Cấu hình vận hành)" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  const actor = await resolveActor(session.user.id);
  const pham = phamViKeToan(actor);
  if (pham !== "ALL" && pham.length === 0) return { ok: false, error: "Bạn chưa là kế toán ở cơ sở nào" };
  return { ok: true, actor, userId: session.user.id, userName: session.user.name ?? session.user.email ?? session.user.id };
}

const TOI_DA_LO = 50;
const ids = z.array(z.string().min(1).max(64)).min(1).max(TOI_DA_LO);

export type KetQuaTungMuc = { id: string; ok: boolean; error: string | null };
const gop = (ds: KetQuaTungMuc[]) => ({ thanhCong: ds.filter((d) => d.ok).length, loi: ds.filter((d) => !d.ok) });

/** Tạo lệnh ký cho các hoá đơn chọn. Mỗi hoá đơn một lệnh; lỗi một hoá đơn không chặn các hoá đơn khác. */
export async function taoLenhKyUsbAction(input: unknown): Promise<KetQua<ReturnType<typeof gop>>> {
  const p = z.object({ hoaDonIds: ids }).safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ (tối đa 50 hoá đơn một lần)" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const kq: KetQuaTungMuc[] = [];
  for (const id of p.data.hoaDonIds) {
    const r = await taoLenhKyUsb({ actor: cong.actor, ten: cong.userName, hoaDonId: id, now: new Date() });
    kq.push({ id, ok: r.ok, error: r.ok ? null : r.error });
  }
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: gop(kq) };
}

/** «Ký lô»: người bấm nhận ký NHIỀU lệnh một lượt (CHO_KY → DANG_KY). Việc ký thật làm ở ứng dụng ký, từng lệnh một (phiên VIN mở lúc ứng dụng lấy việc). */
export async function kyLoUsbAction(input: unknown): Promise<KetQua<ReturnType<typeof gop>>> {
  const p = z.object({ lenhIds: ids }).safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ (tối đa 50 lệnh một lần)" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const kq: KetQuaTungMuc[] = [];
  for (const id of p.data.lenhIds) {
    const r = await duyetVaBatDauKy({ actor: cong.actor, ten: cong.userName, lenhId: id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: new Date() });
    kq.push({ id, ok: r.ok, error: r.ok ? null : r.error });
  }
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: gop(kq) };
}

const huySchema = z.object({ lenhId: z.string().min(1).max(64), lyDo: z.string().trim().min(10).max(500) });
export async function huyLenhKyUsbAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = huySchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Lý do huỷ phải có ít nhất 10 ký tự" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const r = await huyLenhKy({ actor: cong.actor, ten: cong.userName, lenhId: p.data.lenhId, lyDo: p.data.lyDo, now: new Date() });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { id: r.id } };
}

/** «Kiểm tra lại» một hoá đơn ký USB: CHỈ tra cứu theo mã tham chiếu đã lưu, KHÔNG BAO GIỜ gửi lại. */
export async function kiemTraLaiKyUsbAction(input: unknown): Promise<KetQua<{ trangThai: string }>> {
  const p = z.object({ hoaDonId: z.string().min(1).max(64) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const r = await kiemTraLaiUsb({ hoaDonId: p.data.hoaDonId, now: new Date(), nguoiGoiId: cong.actor.userId });
  if ("ok" in r && r.ok === false) return { ok: false, error: r.error };
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { trangThai: (r as { trangThai: string }).trangThai } };
}

const mayTen = z.object({ tenMay: z.string().trim().min(1).max(60) });
/** Cấp mã ghép máy ký cho CHÍNH người bấm. Mã hiện đúng một lần trong kết quả này (10 phút). */
export async function taoMaGhepMayKyAction(input: unknown): Promise<KetQua<{ ma: string; hetHan: string }>> {
  const p = mayTen.safeParse(input);
  if (!p.success) return { ok: false, error: "Tên máy phải từ 1 đến 60 ký tự" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const r = await taoMaGhep({ userId: cong.userId, userName: cong.userName, tenMay: p.data.tenMay, now: new Date() });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { ma: r.ma, hetHan: r.hetHan.toISOString() } };
}

export async function thuHoiMayKyAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const p = z.object({ mayId: z.string().min(1).max(64) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congKyUsb();
  if (!cong.ok) return cong;
  const ok = await thuHoiMay({ userId: cong.userId, userName: cong.userName, mayId: p.data.mayId, now: new Date() });
  if (!ok) return { ok: false, error: "Không tìm thấy máy này (hoặc đã thu hồi)" };
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: { id: p.data.mayId } };
}
