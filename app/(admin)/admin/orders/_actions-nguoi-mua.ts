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
import { coSoNguoiMuaDuoc, docCauHinhNguoiMua, laHubNguoiMuaBatChoCoSo } from "@/lib/finance/hoa-don/feature";
import { xuatLienDon } from "@/lib/finance/hoa-don/xuat-lien/chay-xuat-lien";
import { xemTruocXuatLien, type XemTruocXuatLien } from "@/lib/finance/hoa-don/xuat-lien";
import { duocXuLyYeuCau, type DauVaoO } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
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

// ── XUẤT LIỀN (BGĐ đổi yêu cầu 09/11/2026) ─────────────────────────────────────────────────────────────────────
// Phụ huynh có yêu cầu hoá đơn và CẦN LIỀN: Sale xem hộp đối chiếu (`xemTruocXuatLienAction`) rồi bấm xác nhận (`xuatLienAction`). Phụ huynh không cần liền thì KHÔNG bấm — lần thu đi cùng lô 23h30.
// Quyền: KHÔNG đẻ quyền mới — cùng `duocXuLyYeuCau` với tạo / huỷ mã QR (kế toán, hoặc Sale có `payments:record` ∧ `orders:view-pii` TẠI cơ sở của đơn). Mọi cổng tiền (khoản phải đã được KẾ TOÁN xác nhận —
// Sale không xác nhận tiền được), cổng pháp nhân, hạn mức ký tự động nằm ở bước phát hành chung, không nới ở đây.

async function batDauXuatLien(orderId: string) {
  const b = await batDau(orderId);
  if (!b.ok) return b;
  const centerId = b.order.centerId!;
  if (!duocXuLyYeuCau(b.actor, centerId)) return { ok: false as const, loi: { ok: false, error: "Bạn không có quyền xuất hoá đơn cho đơn của cơ sở này" } satisfies Loi };
  // Cùng phạm vi với lô cuối ngày / luồng người mua: cơ sở ngoài thí điểm Hub không xuất liền (một cơ sở không được có đường phát hành mà đường kia chưa bật).
  if (!(await coSoNguoiMuaDuoc()).includes(centerId)) return { ok: false as const, loi: { ok: false, error: CHUA_BAT, ma: "CHUA_BAT" } satisfies Loi };
  return { ...b, centerId };
}

/** Hộp đối chiếu của «Xuất liền»: người mua + từng lần thu + học viên + email nhận + dấu để máy chủ so lại lúc bấm. */
export async function xemTruocXuatLienAction(orderId: string): Promise<XemTruocXuatLien> {
  const b = await batDauXuatLien(orderId);
  if (!b.ok) return { ok: false, error: b.loi.error };
  return xemTruocXuatLien({ orderId, centerId: b.centerId });
}

export type KetQuaXuatLienAction =
  | { ok: true; daXuat: number; dangPhatHanh: number; guiNgay: boolean; mili: number; ghiChu: string[] }
  | { ok: false; error: string; ma?: string };

/**
 * Bấm «Xuất hoá đơn ngay». `dauVan` = dấu của hộp Sale đang xem; máy chủ dựng lại xem trước và so — lệch (phụ huynh vừa gửi lại, kế toán vừa đổi khoản) ⇒ từ chối, Sale mở lại hộp.
 * Trả `mili` (thời gian xử lý ở máy chủ) để Sale biết nhanh hay chậm; `guiNgay = false` nghĩa là thư để nhịp cron kế tiếp gửi (không mất).
 */
export async function xuatLienAction(orderId: string, dauVan: string): Promise<KetQuaXuatLienAction> {
  const b = await batDauXuatLien(orderId);
  if (!b.ok) return { ok: false, error: b.loi.error, ma: b.loi.ma };
  if (typeof dauVan !== "string" || dauVan.length === 0 || dauVan.length > 4000) return { ok: false, error: "Thiếu dấu đối chiếu — mở lại hộp xác nhận" };
  const xt = await xemTruocXuatLien({ orderId, centerId: b.centerId });
  if (!xt.ok) return { ok: false, error: xt.error };
  if (xt.dauVan !== dauVan) return { ok: false, error: "Thông tin vừa thay đổi (phụ huynh gửi lại, hoặc khoản thu đổi) — mở lại hộp xác nhận để đối chiếu lại", ma: "DA_DOI" };

  const r = await xuatLienDon({ orderId, centerId: b.centerId, nguoiBam: b.nguoi, now: new Date() });
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/payments/hoa-don");
  if (r.taoDuoc === 0) {
    const lyDo = r.dong.find((d) => d.lyDo)?.lyDo ?? r.lyDo[0];
    return { ok: false, error: lyDo ? `Chưa xuất được: ${lyDo}` : "Chưa xuất được hoá đơn — xem lý do ở màn Hoá đơn điện tử", ma: "KHONG_XUAT_DUOC" };
  }
  return {
    ok: true,
    daXuat: r.daXuat,
    dangPhatHanh: r.dangPhatHanh,
    guiNgay: r.guiNgay,
    mili: r.mili,
    ghiChu: r.dong.filter((d) => d.ketQua !== "DA_XUAT" && d.lyDo).map((d) => String(d.lyDo)),
  };
}
