import "server-only";
// lib/entitlements/hich.ts — CÚ HÍCH "XÉT CẤP QUYỀN HỌC" CHO MỌI ĐƯỜNG TIỀN / BƯỚC CHUYỂN ĐỔI. Vỏ KHÔNG BAO GIỜ NÉM.
//
// Đây là chỗ DUY NHẤT gọi `xetCapQuyenHocChoDon` (lưới `[QHC-W7]`). Mỗi đường tiền chỉ thêm MỘT lời gọi vỏ này SAU commit:
//   · `allocateToOrder` (webhook đời cũ + đối soát tay) · action gắn/tách/chuyển/gỡ tiền theo con · `convertLeadV2` ·
//     `chuyenDoiDonAction` · hai handler sự kiện (`su-kien.ts`).
//
// ── VÌ SAO KHÔNG NÉM ────────────────────────────────────────────────────────────────────────────────────────────────
//   Tiền đã vào sổ thì lỗi quyền học KHÔNG được làm webhook trả 500 (cổng thanh toán sẽ gửi lại), không được làm action báo
//   thất bại cho khoản đã ghi, và không được làm hỏng bước Chuyển đổi đã commit. Hàm xét tự tính lại mọi thứ dưới khoá đơn
//   nên lần hích kế tiếp (hoặc cron đối soát, PR sau) cấp bù được.
//
// ── XẾP LỚP (PR xếp lớp → buổi bắt đầu) ──────────────────────────────────────────────────────────────────────────────────
//   Sau khi cấp quyền, `xetXepLopChoDon` chốt bài bắt đầu / bài bỏ qua / nhu cầu học vượt cho quyền học AWAITING_PLACEMENT đã có ghi danh. Đây là
//   chỗ DUY NHẤT gọi nó (lưới `[XL-W*]`). Nguồn chiều ngược KHÔNG xếp lớp. Xem docs/thu-hoc-phi-pham-vi/XEP-LOP.md.
//
// ── CỜ TẮT = KHÔNG LÀM GÌ ──────────────────────────────────────────────────────────────────────────────────────────
//   `xetCapQuyenHocChoDon` dừng trước mọi phép ghi khi đơn không có dấu SCOPE hoặc cờ `billing.scopePurchaseEnabled` của cơ sở
//   TẮT. Chi phí còn lại: 1–3 câu ĐỌC (đơn → OrgUnit → cài đặt có cache 300 s). Vỏ này không ghi gì, không phát sự kiện.
//
// `now` BẮT BUỘC (luật 7 + luật 19): chỗ gọi truyền đồng hồ, test truyền ngày tuyệt đối.
import { db } from "@/lib/db";
import { laDonPhamVi } from "@/lib/orders/pham-vi/doc-dong";
import { xetCapQuyenHocChoDon, type CheDoXetCap, type KetQuaCapTuDon, type NguonCapQuyenHoc } from "./cap-tu-don";
import { xetXepLopChoDon, type KetQuaXepLopTuDon } from "./xep-lop-tu-don";

/** Nguồn CHIỀU NGƯỢC (tiền bị đảo / huỷ / hoàn / dừng học): xét cấp quyền để ĐÁNH DẤU, và tuyệt đối KHÔNG chốt phạm vi bài cho quyền học nào ở lượt này. */
const NGUON_CHIEU_NGUOC: ReadonlySet<NguonCapQuyenHoc> = new Set(["TIEN_BI_TU_CHOI", "TIEN_BI_HOAN", "DON_BI_LOAI", "DUNG_HOC"]);

/**
 * Xét MỘT đơn: (1) cấp quyền học, (2) rồi chốt phạm vi bài cho quyền học đã có ghi danh. Hai bước là HAI transaction riêng, mỗi bước
 * bọc try riêng — bước 1 hỏng không được chặn bước 2 chạy cho quyền học đã cấp từ trước, và bước 2 hỏng không được lật lại bước 1 đã commit.
 * Mọi lỗi bị nuốt và ghi log.
 */
export async function hichCapQuyenHocChoDon(orderId: string, nguon: NguonCapQuyenHoc, now: Date): Promise<void> {
  try {
    const kq = await xetCapQuyenHocCoKetQua(orderId, nguon, now, "CAP");
    if (kq.daCap.length > 0) console.info(`[quyen-hoc] ${nguon} đơn ${orderId}: cấp ${kq.daCap.length} quyền học`);
    if (kq.choChuyenDoi.length > 0) console.info(`[quyen-hoc] ${nguon} đơn ${orderId}: ${kq.choChuyenDoi.length} dòng chờ Chuyển đổi`);
  } catch (err) {
    console.error(`[quyen-hoc] ${nguon} đơn ${orderId}: không xét được quyền học`, err);
  }
  if (NGUON_CHIEU_NGUOC.has(nguon)) return;
  try {
    const kq = await xetXepLopCoKetQua(orderId, nguon, now);
    if (kq.daXep.length > 0) console.info(`[quyen-hoc] ${nguon} đơn ${orderId}: chốt phạm vi bài cho ${kq.daXep.length} quyền học`);
    if (kq.cho.length > 0) console.info(`[quyen-hoc] ${nguon} đơn ${orderId}: ${kq.cho.length} dòng chờ xếp lớp`);
  } catch (err) {
    console.error(`[quyen-hoc] ${nguon} đơn ${orderId}: không chốt được phạm vi bài`, err);
  }
}

/**
 * Xét MỌI đơn SCOPE của một lead — cho `convertLeadV2` (khoá theo lead, không theo đơn). Đơn không có dấu SCOPE bị bỏ ngay ở
 * đây (một câu đọc cho cả lead); hàm xét kiểm lại dấu + cờ từng đơn.
 */
export async function hichCapQuyenHocChoLead(leadId: string, nguon: NguonCapQuyenHoc, now: Date): Promise<void> {
  try {
    const don = await db.order.findMany({
      where: { leadId, deletedAt: null },
      select: { id: true, items: { select: { metadata: true } } },
    });
    for (const o of don) {
      if (laDonPhamVi(o.items)) await hichCapQuyenHocChoDon(o.id, nguon, now);
    }
  } catch (err) {
    console.error(`[quyen-hoc] ${nguon} lead ${leadId}: không xét được quyền học`, err);
  }
}

// ── HAI LỜI GỌI CÓ KẾT QUẢ, KHÔNG NUỐT LỖI (PR hàng đợi quyền học) ────────────────────────────────────────────────────
// Vỏ ở trên cố ý nuốt lỗi (webhook không được 500 vì quyền học) nên người gọi không thấy kết quả. Hai đường mới CẦN kết quả:
//   · cron `quyen-hoc-doi-soat` (chế độ "CHI_GHI_NHAN" — không bao giờ cấp) và nút "Thử cấp lại" ở hàng đợi (chế độ "CAP"; người bấm thấy lỗi);
//   · nút "Thử cấp lại" cũng chạy bước xếp lớp, để dòng CHO_XEP_LOP của chính dòng đơn đó được xét lại.
// Đây vẫn là NƠI DUY NHẤT gọi hai hàm xét (lưới `[QHC-W7]`, `[XL-W10]`) — vỏ ở trên cũng đi qua đây, nên chỉ có MỘT lời gọi mỗi hàm.
export function xetCapQuyenHocCoKetQua(orderId: string, nguon: NguonCapQuyenHoc, now: Date, cheDo: CheDoXetCap): Promise<KetQuaCapTuDon> {
  return xetCapQuyenHocChoDon(orderId, nguon, now, cheDo);
}

export function xetXepLopCoKetQua(orderId: string, nguon: NguonCapQuyenHoc, now: Date): Promise<KetQuaXepLopTuDon> {
  return xetXepLopChoDon(orderId, nguon, now);
}
