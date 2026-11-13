"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { batLaiKy, luuHanMucKy, tamDungKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";

// «Chính sách ký» (BGĐ 04/11/2026): TẠM DỪNG KÝ khẩn cấp, BẬT LẠI, HẠN MỨC ký tự động — theo PHÁP NHÂN.
// Quyền: CHỈ Quản trị tối cao (`settings:edit`, không đẻ quyền mới). Mọi thay đổi kèm lý do ≥ 10 ký tự + nhật ký trước/sau (ở lớp DB, cùng giao dịch).
// Tạm dừng chỉ chặn việc GỬI mới; tra cứu / đối soát vẫn chạy (xem `cong-theo-phap-nhan.ts`). Không giả định thu hồi được thứ đã gửi nhà cung cấp.

type KetQua<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Cổng chung — wrapper cục bộ MỘT cấp, cùng tệp (lint `require-can-in-write-action` không tính wrapper import). Lưới `[KCS-W1]` ghim ở MỌI action ghi. */
async function congQuanTri(): Promise<{ ok: false; error: string } | { ok: true; actor: Actor; userId: string; userName: string }> {
  if (!(await laHoaDonBat())) return { ok: false, error: "Màn hoá đơn điện tử chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Chỉ Quản trị tối cao được thay đổi chính sách ký, hạn mức hoặc tạm dừng ký" };
  const actor = await resolveActor(session.user.id);
  return { ok: true, actor, userId: session.user.id, userName: session.user.name ?? session.user.email ?? session.user.id };
}

const pn = z.string().trim().min(1).max(64);
const soTuyChon = z.number().int().positive().max(2_000_000_000).nullable();

const hanMucSchema = z.object({
  phapNhanMa: pn,
  hanMucMoiHoaDon: soTuyChon,
  hanMucMoiNgay: soTuyChon,
  soToiDa: soTuyChon,
  cuaSoPhut: z.number().int().positive().max(1440).nullable(),
  nguongTanSuat: soTuyChon,
  lyDo: z.string().trim().max(500).nullish(),
  /** Tick xác nhận NỚI hạn mức (máy chủ kiểm lại bằng `phanTichThayDoiHanMuc`, không tin màn). */
  xacNhanNoiLong: z.boolean().optional(),
  /** Mã / ghi chú chỉ đạo của Ban Giám đốc — tuỳ chọn, chỉ ghi vào nhật ký. */
  maChiDao: z.string().trim().max(120).nullish(),
});

export async function luuHanMucKyAction(input: unknown): Promise<KetQua> {
  const p = hanMucSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congQuanTri();
  if (!cong.ok) return cong;
  const r = await luuHanMucKy({
    actor: cong.actor,
    nguoi: { id: cong.userId, name: cong.userName },
    phapNhanMa: v.phapNhanMa,
    han: { hanMucMoiHoaDon: v.hanMucMoiHoaDon, hanMucMoiNgay: v.hanMucMoiNgay, soToiDa: v.soToiDa, cuaSoPhut: v.cuaSoPhut, nguongTanSuat: v.nguongTanSuat },
    lyDo: v.lyDo ?? null,
    xacNhanNoiLong: v.xacNhanNoiLong,
    maChiDao: v.maChiDao ?? null,
  });
  if (!r.ok) return r;
  revalidatePath("/payments/hoa-don/cau-hinh");
  return { ok: true, data: null };
}

const tamDungSchema = z.object({ phapNhanMa: pn, lyDo: z.string().trim().max(500).nullish(), suCo: z.boolean() });

export async function tamDungKyAction(input: unknown): Promise<KetQua> {
  const p = tamDungSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congQuanTri();
  if (!cong.ok) return cong;
  const r = await tamDungKy({ actor: cong.actor, nguoi: { id: cong.userId, name: cong.userName }, phapNhanMa: v.phapNhanMa, lyDo: v.lyDo ?? null, suCo: v.suCo, now: new Date() });
  if (!r.ok) return r;
  revalidatePath("/payments/hoa-don/cau-hinh");
  revalidatePath("/payments/hoa-don");
  return { ok: true, data: null };
}

const batLaiSchema = z.object({ phapNhanMa: pn, lyDo: z.string().trim().max(500).nullish(), xacNhanSuCo: z.boolean().optional() });

/** Bật lại ký: bước RIÊNG, không gộp vào «lưu chính sách». Dừng vì sự cố bảo mật ⇒ cần `xacNhanSuCo === true` (kiểm lại ở lớp DB). */
export async function batLaiKyAction(input: unknown): Promise<KetQua> {
  const p = batLaiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congQuanTri();
  if (!cong.ok) return cong;
  const r = await batLaiKy({ actor: cong.actor, nguoi: { id: cong.userId, name: cong.userName }, phapNhanMa: v.phapNhanMa, lyDo: v.lyDo ?? null, xacNhanSuCo: v.xacNhanSuCo });
  if (!r.ok) return r;
  revalidatePath("/payments/hoa-don/cau-hinh");
  revalidatePath("/payments/hoa-don");
  return { ok: true, data: null };
}
