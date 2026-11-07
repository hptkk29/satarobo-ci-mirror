"use server";

// Server Actions của khối «Thông tin người mua trên hoá đơn qua mã QR» ở màn đơn hàng (Invoice Hub S11). Cờ `hoaDon.hubNguoiMua` + cơ sở thí điểm TẮT ⇒ mọi action từ chối như «chưa bật».
//
// Quyền: KHÔNG đẻ quyền mới — dịch vụ (`yeu-cau-nguoi-mua*-db.ts`) tự thu hẹp theo `payments:confirm` hoặc (`payments:record` ∧ `orders:view-pii`) TẠI cơ sở của đơn. Ở đây chỉ: đăng nhập,
// đọc cơ sở của đơn qua `scopedDb`, hỏi cờ THEO CƠ SỞ đó, rồi gọi dịch vụ. Token thô chỉ có trong kết quả của `taoYeuCauNguoiMuaAction` (một lần), không log, không lưu.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { getAuditActor } from "@/lib/audit/log";
import { gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { dungQrSvg, svgThanhDataUri } from "@/lib/affiliate/qr-link";
import { scopedDb } from "@/lib/db-scope";
import { docCauHinhNguoiMua, laHubNguoiMuaBatChoCoSo } from "@/lib/finance/hoa-don/feature";
import { type DauVaoO } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
import { ghepMaLienKet } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-token";
import { huyYeuCau, nhapThayBoiSale, taoYeuCau } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";
import { apDungYeuCauVaoDon } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung-db";

const CHUA_BAT = "Tính năng thu thập thông tin người mua chưa được bật cho cơ sở này." as const;
const DUONG_LIEN_KET = "/thong-tin-hoa-don" as const;

type Loi = { ok: false; error: string; ma?: string; loiTheoO?: Partial<Record<string, string>> };
type TaoOk = { ok: true; id: string; lienKet: string; qr: string; hetHanLuc: string };

async function batDau(orderId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, loi: { ok: false, error: "Chưa đăng nhập" } satisfies Loi };
  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({ where: { id: orderId }, select: { id: true, centerId: true } });
  if (!order?.centerId) return { ok: false as const, loi: { ok: false, error: "Không tìm thấy đơn hàng" } satisfies Loi };
  if (!(await laHubNguoiMuaBatChoCoSo(order.centerId))) return { ok: false as const, loi: { ok: false, error: CHUA_BAT, ma: "CHUA_BAT" } satisfies Loi };
  const { actorName } = getAuditActor(session);
  return { ok: true as const, actor, nguoi: { id: session.user.id, name: actorName }, order };
}

/** Tạo mã QR mới. Có yêu cầu đang mở ⇒ dùng `capLaiYeuCauNguoiMuaAction`. Token thô + ảnh QR chỉ có trong kết quả này. */
export async function taoYeuCauNguoiMuaAction(orderId: string): Promise<TaoOk | Loi> {
  const b = await batDau(orderId);
  if (!b.ok) return b.loi;
  const goc = gocCongKhai(process.env);
  if (!goc) return { ok: false as const, error: "Chưa cấu hình gốc địa chỉ công khai (AFFILIATE_PUBLIC_ORIGIN) cho môi trường này — không dựng được mã QR." };
  const cfg = await docCauHinhNguoiMua();
  const r = await taoYeuCau({ actor: b.actor, nguoi: b.nguoi, orderId, phamVi: "DON", ttlPhut: cfg.ttlPhut, now: new Date() });
  if (!r.ok) return { ok: false as const, error: r.error, ma: r.ma };
  const lienKet = `${goc}${DUONG_LIEN_KET}/${ghepMaLienKet(r.id, r.token)}`;
  const qr = svgThanhDataUri(await dungQrSvg(lienKet));
  revalidatePath(`/orders/${orderId}`);
  return { ok: true as const, id: r.id, lienKet, qr, hetHanLuc: r.hetHanLuc.toISOString() };
}

/** Cấp lại: thu hồi yêu cầu đang mở rồi tạo mã mới (dữ liệu đã nhập của yêu cầu cũ KHÔNG được chép sang — nhân viên nhập lại hoặc phụ huynh điền lại). */
export async function capLaiYeuCauNguoiMuaAction(orderId: string, yeuCauCuId: string): Promise<TaoOk | Loi> {
  const b = await batDau(orderId);
  if (!b.ok) return b.loi;
  const h = await huyYeuCau({ actor: b.actor, nguoi: b.nguoi, id: yeuCauCuId, lyDo: "Cấp lại mã QR mới", now: new Date() });
  if (!h.ok) return { ok: false as const, error: h.error, ma: h.ma };
  return await taoYeuCauNguoiMuaAction(orderId);
}

export async function huyYeuCauNguoiMuaAction(orderId: string, yeuCauId: string, lyDo: string) {
  const b = await batDau(orderId);
  if (!b.ok) return b.loi;
  const h = await huyYeuCau({ actor: b.actor, nguoi: b.nguoi, id: yeuCauId, lyDo, now: new Date() });
  if (!h.ok) return { ok: false as const, error: h.error, ma: h.ma };
  revalidatePath(`/orders/${orderId}`);
  return { ok: true as const };
}

/**
 * Nhân viên (Sale / kế toán) nhập thay phụ huynh. Chỉ ghi ô phụ huynh CHƯA điền (luật hợp nhất theo ô).
 * ⚠️ [02/11/2026] KHÔNG còn nút nào gọi action này: «Nhập thay phụ huynh» nay mở hộp thoại «Người mua trên hoá đơn» (MỘT đường ghi dữ liệu người mua, có đồng bộ hồ sơ). Giữ lại vì còn test và
 * còn là cổng kiểm của dịch vụ `nhapThayBoiSale`; ứng viên GỠ ở lượt dọn sau (xoá cả hai cùng lúc, kèm ca DB `[YCM-DB-06]`).
 */
export async function nhapThayYeuCauNguoiMuaAction(orderId: string, yeuCauId: string, du: DauVaoO): Promise<{ ok: true; oXungDot: string[] } | Loi> {
  const b = await batDau(orderId);
  if (!b.ok) return b.loi;
  const r = await nhapThayBoiSale({ actor: b.actor, nguoi: b.nguoi, id: yeuCauId, du, now: new Date() });
  if (!r.ok) return { ok: false as const, error: r.error, ma: r.ma, loiTheoO: r.loiTheoO };
  revalidatePath(`/orders/${orderId}`);
  return { ok: true as const, oXungDot: r.oXungDot };
}

/** Áp dụng thông tin đã đủ vào đơn (xác nhận + ghi đơn một giao dịch). `ghiDe` chỉ bật khi nhân viên đã thấy cảnh báo «đơn đã được sửa». */
export async function apDungYeuCauNguoiMuaAction(orderId: string, yeuCauId: string, ghiDe: boolean) {
  const b = await batDau(orderId);
  if (!b.ok) return b.loi;
  const r = await apDungYeuCauVaoDon({ actor: b.actor, nguoi: b.nguoi, id: yeuCauId, khiDonDaDoi: ghiDe ? "GHI_DE" : "TU_CHOI", now: new Date() });
  if (!r.ok) return { ok: false as const, error: r.error, ma: r.ma };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/payments/hoa-don");
  return { ok: true as const, hoaDonConHieuLuc: r.hoaDonConHieuLuc };
}
