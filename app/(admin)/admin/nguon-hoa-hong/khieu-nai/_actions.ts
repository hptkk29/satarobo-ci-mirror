"use server";
// Server Action của tab Khiếu nại (PR11). MỎNG có chủ đích: auth → quyền → cờ → điều phối (`lib/hoa-hong/khieu-nai-hanh-dong`) → làm mới trang.
// Mọi luật nghiệp vụ (đích hợp lệ, người duyệt ≠ người khiếu nại, đồ thị trạng thái, ghi sổ cùng giao dịch) nằm ở service — action không viết lại.
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY ĐẦU hàm, trước khi chạm bất cứ thứ gì):
//   1. auth()  2. assertPermission(<KEY>)  3. cờ engine  4. resolveActor  5. gọi điều phối.
// KEY là hằng của `khieu-nai-ma.ts` — MỘT nguồn với nút ở màn (luật 12: nút vẽ bằng quyền A mà action hỏi quyền B là lời hứa suông; lưới `[NHH-DSP-W*]`).
//   · Gửi khiếu nại: `commission:view-self` (05 §1.2 — không có key riêng; điều kiện sở hữu/quan hệ kiểm ở service).
//   · Nhận · giao lại · quyết · đóng: `commission_disputes:review`.
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { hanhDongDong, hanhDongNhan, hanhDongQuyet, hanhDongTao, type KetQuaHanhDong } from "@/lib/hoa-hong/khieu-nai-hanh-dong";
import { KEY_DUYET_KHIEU_NAI, KEY_TAO_KHIEU_NAI } from "@/lib/hoa-hong/khieu-nai-ma";

const CHUA_DANG_NHAP = "Chưa đăng nhập.";
const CO_TAT = "Tính năng hoa hồng theo nguồn đang tắt — chưa xử lý được khiếu nại.";

type Loi = { ok: false; loi: []; chung: string };
const tuChoi = (chung: string): Loi => ({ ok: false, loi: [], chung });

function lamMoi() {
  revalidatePath("/nguon-hoa-hong/khieu-nai");
}

export async function taoKhieuNaiAction(dauVao: unknown): Promise<KetQuaHanhDong<{ disputeId: string }> | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission(KEY_TAO_KHIEU_NAI);
  } catch {
    return tuChoi(`Bạn không có quyền gửi khiếu nại hoa hồng (${KEY_TAO_KHIEU_NAI}).`);
  }
  if (!(await laEngineHoaHongBat())) return tuChoi(CO_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await hanhDongTao({ actor, nguoi: { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id }, dauVao });
  if (r.ok) lamMoi();
  return r;
}

export async function nhanKhieuNaiAction(vao: { disputeId: string; nguoiNhanId?: string | null }): Promise<KetQuaHanhDong<{ disputeId: string; nguoiXuLyId: string }> | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission(KEY_DUYET_KHIEU_NAI);
  } catch {
    return tuChoi(`Bạn không có quyền xử lý khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}).`);
  }
  if (!(await laEngineHoaHongBat())) return tuChoi(CO_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await hanhDongNhan({
    actor,
    nguoi: { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id },
    disputeId: vao.disputeId,
    nguoiNhanId: vao.nguoiNhanId ?? null,
    now: new Date(),
  });
  if (r.ok) lamMoi();
  return r;
}

export async function quyetDinhKhieuNaiAction(vao: { disputeId: string; dauVao: unknown }): Promise<KetQuaHanhDong<{ disputeId: string; loai: string }> | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission(KEY_DUYET_KHIEU_NAI);
  } catch {
    return tuChoi(`Bạn không có quyền quyết định khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}).`);
  }
  if (!(await laEngineHoaHongBat())) return tuChoi(CO_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await hanhDongQuyet({
    actor,
    nguoi: { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id },
    disputeId: vao.disputeId,
    dauVao: vao.dauVao,
    now: new Date(),
  });
  if (r.ok) lamMoi();
  return r;
}

export async function dongKhieuNaiAction(vao: { disputeId: string }): Promise<KetQuaHanhDong<{ disputeId: string }> | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi(CHUA_DANG_NHAP);
  try {
    await assertPermission(KEY_DUYET_KHIEU_NAI);
  } catch {
    return tuChoi(`Bạn không có quyền đóng khiếu nại hoa hồng (${KEY_DUYET_KHIEU_NAI}).`);
  }
  if (!(await laEngineHoaHongBat())) return tuChoi(CO_TAT);
  const actor = await resolveActor(session.user.id);
  const r = await hanhDongDong({
    actor,
    nguoi: { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id },
    disputeId: vao.disputeId,
    now: new Date(),
  });
  if (r.ok) lamMoi();
  return r;
}
