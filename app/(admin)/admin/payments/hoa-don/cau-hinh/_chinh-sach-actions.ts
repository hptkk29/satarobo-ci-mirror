"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { laHubChinhSachBat } from "@/lib/finance/hoa-don/feature";
import { duocDuyetChinhSach, duocGhiChinhSach } from "@/lib/finance/hoa-don/quyen";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { duyet, guiDuyet, hetHieuLuc, taoNhap, tuChoi, type KetQuaGhi } from "@/lib/finance/hoa-don/chinh-sach-db";

// Chính sách hoá đơn có phiên bản (lát S7, Invoice Hub). Quyền: DÙNG LẠI `payments:confirm` (TD-07 — không đẻ quyền mới):
//   · tạo nháp / gửi duyệt   = `payments:confirm` tại phạm vi của chính sách (dùng chung ⇒ chỉ kế toán Hội sở) — `duocGhiChinhSach`;
//   · duyệt / từ chối / kết thúc = `payments:confirm` ∧ phạm vi ALL (kế toán Hội sở) — `duocDuyetChinhSach` + `kiemChuyen` trong dịch vụ.
//     Người soạn cũng duyệt được bản của mình: chủ dự án chốt 02/11/2026 bỏ luật «người khác duyệt» (migration 20261121090000).
// Action là LỚP NGOÀI: kiểm sớm cho thông báo rõ. Dịch vụ (`chinh-sach-db.ts`) KHÔNG tin action — nó kiểm lại trên dòng đọc lại từ DB, vì
// chính sách dùng chung là luật của MỌI cơ sở. Cờ `hoaDon.hubChinhSach` TẮT ⇒ mọi action từ chối, không chạm DB.
//
// ⚠️ KHÔNG có action nào sửa CỘT NHẠY CẢM của `CauHinhHoaDonCoSo` (nhà cung cấp · môi trường · ký · khoá bí mật · chế độ Hub): cần action
// riêng Hội sở + maker-checker (04 §2.8) — chưa làm ở lát S7; giao diện chỉ ĐỌC. Đừng thêm vào tệp này mà không có cơ chế duyệt hai người.

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string; ma?: string };
type KetQuaThaoTac = KetQua<{ id: string; phienBan: number; trangThai: string }>;

/**
 * Cổng chung — wrapper cục bộ MỘT cấp, cùng tệp (lint `require-can-in-write-action` không tính wrapper import).
 * cờ → đăng nhập → `payments:confirm` (trần). Phạm vi (cơ sở / Hội sở) kiểm ở từng action và ở dịch vụ.
 */
async function congChinhSach(): Promise<{ ok: false; error: string } | { ok: true; actor: Actor; ten: string }> {
  if (!(await laHubChinhSachBat())) return { ok: false, error: "Khu Chính sách hoá đơn chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, actor, ten: session.user.name ?? session.user.email ?? session.user.id };
}

const KHONG_DUOC_GHI = "Không tìm thấy cơ sở hoặc bạn không có quyền với phạm vi này";
/** Thông báo khi không được tạo ở phạm vi này (tham số, không so `.centerId` inline — lint no-inline-authz). */
const lyDoKhongTao = (centerId: string | null): string => (centerId === null ? "Chính sách dùng chung chỉ kế toán Hội sở được tạo." : KHONG_DUOC_GHI);
const CHI_HOI_SO = "Chỉ kế toán Hội sở được duyệt, từ chối hay kết thúc chính sách.";

const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = z.string().min(1).max(64);
const LY_DO = z.string().max(500);

const taoSchema = z.object({
  phapNhanMa: z.string().trim().min(1).max(64),
  /** `null` = DÙNG CHUNG toàn pháp nhân. */
  centerId: ID.nullable(),
  hieuLucTu: z.string().regex(NGAY),
  hieuLucDen: z.string().regex(NGAY).nullable(),
  noiDung: z.record(z.string(), z.unknown()),
  lyDo: LY_DO,
});
const guiSchema = z.object({ id: ID, lyDo: LY_DO });
const duyetSchema = z.object({ id: ID, lyDo: LY_DO, hashMoPhong: z.string().max(128).nullable() });
const tuChoiSchema = z.object({ id: ID, lyDo: LY_DO });
const ketThucSchema = z.object({ id: ID, lyDo: LY_DO, ngayKetThuc: z.string().regex(NGAY) });

function lamMoi() {
  revalidatePath("/payments/hoa-don/cau-hinh");
}

function dich(kq: KetQuaGhi): KetQuaThaoTac {
  if (!kq.ok) return { ok: false, error: kq.error, ma: kq.ma };
  lamMoi();
  return { ok: true, data: { id: kq.id, phienBan: kq.phienBan, trangThai: kq.trangThai } };
}

/** Tạo BẢN NHÁP chính sách (phiên bản kế tiếp của phạm vi). */
export async function taoNhapChinhSachAction(input: unknown): Promise<KetQuaThaoTac> {
  const p = taoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congChinhSach();
  if (!cong.ok) return cong;
  if (!duocGhiChinhSach(cong.actor, v.centerId)) return { ok: false, error: lyDoKhongTao(v.centerId) };
  return dich(
    await taoNhap({
      actor: cong.actor,
      ten: cong.ten,
      phapNhanMa: v.phapNhanMa,
      phapNhanHopLe: cauHinhHoaDonChoMoiTruong()
        .phapNhan.filter((x) => x.bat)
        .map((x) => x.ma),
      centerId: v.centerId,
      hieuLucTu: v.hieuLucTu,
      hieuLucDen: v.hieuLucDen,
      noiDungTho: v.noiDung,
      lyDo: v.lyDo,
    }),
  );
}

/** NHAP → CHO_DUYET. */
export async function guiDuyetChinhSachAction(input: unknown): Promise<KetQuaThaoTac> {
  const p = guiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congChinhSach();
  if (!cong.ok) return cong;
  return dich(await guiDuyet({ actor: cong.actor, ten: cong.ten, id: p.data.id, lyDo: p.data.lyDo }));
}

/** CHO_DUYET → HIEU_LUC. Kèm băm mô phỏng người duyệt đã xem; server tự tính lại và so. */
export async function duyetChinhSachAction(input: unknown): Promise<KetQuaThaoTac> {
  const p = duyetSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congChinhSach();
  if (!cong.ok) return cong;
  if (!duocDuyetChinhSach(cong.actor)) return { ok: false, error: CHI_HOI_SO };
  return dich(await duyet({ actor: cong.actor, ten: cong.ten, id: p.data.id, lyDo: p.data.lyDo, hashMoPhongUi: p.data.hashMoPhong }));
}

/** CHO_DUYET → TU_CHOI. */
export async function tuChoiChinhSachAction(input: unknown): Promise<KetQuaThaoTac> {
  const p = tuChoiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congChinhSach();
  if (!cong.ok) return cong;
  if (!duocDuyetChinhSach(cong.actor)) return { ok: false, error: CHI_HOI_SO };
  return dich(await tuChoi({ actor: cong.actor, ten: cong.ten, id: p.data.id, lyDo: p.data.lyDo }));
}

/** HIEU_LUC → HET_HIEU_LUC (đặt ngày kết thúc, không đụng nội dung). */
export async function hetHieuLucChinhSachAction(input: unknown): Promise<KetQuaThaoTac> {
  const p = ketThucSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congChinhSach();
  if (!cong.ok) return cong;
  if (!duocDuyetChinhSach(cong.actor)) return { ok: false, error: CHI_HOI_SO };
  return dich(await hetHieuLuc({ actor: cong.actor, ten: cong.ten, id: p.data.id, ngayKetThuc: p.data.ngayKetThuc, lyDo: p.data.lyDo }));
}
