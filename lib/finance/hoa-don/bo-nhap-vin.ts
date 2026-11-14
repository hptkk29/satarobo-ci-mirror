import "server-only";
import { writeAudit } from "@/lib/audit/audit-log";

// lib/finance/hoa-don/bo-nhap-vin.ts — «BỎ KHỎI NHÁP» (chủ dự án 11/11/2026): kế toán bấm nhầm «Gửi nháp» (vd lần thu cọc cần GỘP với lần thu khác) thì đưa dòng về «Chờ xuất».
//
// ⚠️ Đây là thao tác TRONG HỆ THỐNG, không phải xoá bản nháp trên VIN: cổng VIN chỉ có `luuNhap` / `taiXmlChuaKy` / `guiXmlDaKy`, không có lệnh xoá nháp. Bản nháp đã gửi vẫn nằm ở trang
// quản trị VIN (kế toán xoá ở đó); nó mang `refId` RIÊNG `nhap-<uuid>` nên KHÔNG chặn hoá đơn thật của lần thu này (xem gui-nhap-vin.ts).
// Thứ duy nhất ghi là MỘT dòng `AuditLog` (hành động `BO_NHAP_VIN`) — loader (`hang-cho.ts`) đọc nó cạnh `GUI_NHAP_VIN`: lần bỏ MỚI HƠN lần gửi ⇒ dòng không còn ở tab «Nháp & đang phát hành».
// Không tạo / sửa hoá đơn, không đụng khoản thu, không đụng sổ tiền.

export async function boDanhDauNhapVin(i: {
  nguoiBam: { id: string; name: string };
  orderId: string;
  centerId: string;
  lanThuKey: string;
  /** Lúc gửi nháp mới nhất bị bỏ (ISO) — chỉ để vết kiểm toán nói bỏ cái nào. */
  nhapGuiLuc: string;
}): Promise<void> {
  await writeAudit({
    actor: i.nguoiBam,
    module: "finance",
    entityType: "Order",
    entityId: i.orderId,
    action: "BO_NHAP_VIN",
    newValues: { lanThuKey: i.lanThuKey, nhapGuiLuc: i.nhapGuiLuc },
    orgUnitId: i.centerId,
  });
}
