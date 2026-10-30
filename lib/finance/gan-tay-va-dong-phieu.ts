import "server-only";
// lib/finance/gan-tay-va-dong-phieu.ts — GẮN TAY MỘT GIAO DỊCH + ĐÓNG PHIẾU GỘP/PHIẾU THẺ NẾU ĐỢT ĐÃ ĐỦ TIỀN. Đường PRODUCTION của màn "Biến động số dư". CHẠM TIỀN.
//
// #663: gắn tay đủ tiền mà phiếu gộp ở lại OPEN, phiếu thẻ ở lại CHO_QUET, không có việc sau chốt. `ganTienTheoCon` (ghi-tien-don.ts) không thể import
// hàm đóng phiếu (vòng phụ thuộc — xem chú thích `SauKhiGanTay`), nên chỗ ghép nằm ở ĐÂY: truyền `dongPhieuGopKhiHetViecTrongTx` làm việc SAU KHI GHI, chạy
// TRONG chính transaction + khoá đơn của phép gắn (rollback tiền ⇒ không có phiếu đóng / sự kiện nào).
//
// ⚠️ Mọi nơi GỌI `ganTienTheoCon` ở mã production phải đi qua hàm này — gọi hàm trần là quay về lỗi #663 mà không lỗi biên dịch nào báo. Lưới `[DPW-04]` canh.
import { ganTienTheoCon, type NguoiGan } from "@/lib/finance/ghi-tien-don";
import type { AuditActor } from "@/lib/audit/audit-log";
import type { DongChia } from "@/lib/finance/chia-tien-theo-con";
import { dongPhieuGopKhiHetViecTrongTx } from "@/lib/finance/dong-phieu-khi-het-viec-db";

export function ganTienTheoConVaDongPhieu(input: {
  bankTransactionId: string;
  orderId: string;
  dong: readonly DongChia[];
  actor: AuditActor;
  /** BẮT BUỘC (luật 7) — xem `NguoiGan` ở `ghi-tien-don.ts`. */
  nguoiGan: NguoiGan;
}) {
  return ganTienTheoCon(input, {
    sauKhiGhi: async (tx, x) => {
      await dongPhieuGopKhiHetViecTrongTx(tx, { orderId: x.orderId, lyDo: "DU_TIEN", actor: x.actor, giaoDich: x.giaoDich });
    },
  });
}
