// lib/crm/commission-cutover-gate.ts — CỔNG CUTOVER của đường hoa hồng CŨ (`CommissionStatement` / `CommissionLine`).
//
// Nguồn: docs/source-commission/05 "Quy tắc cutover chính thức" (CUT-3), §2.2c; 04 §3.2.
//
// Từ kỳ `hoaHong.kyCutover` trở đi, sổ hoa hồng thuộc engine MỚI (`lib/hoa-hong`). Kỳ cũ CHỈ ĐỌC: đường cũ không được chốt, duyệt, mở lại,
// tạo bảng kê "ma" hay ghi dòng GV Trial vào một tháng đã thuộc sổ mới — nếu không, hai engine cùng trả MỘT khoản tiền.
//
// MỘT hàm trả lời "tháng này thuộc sổ mới không" — `docThangThuocSoMoi` (`lib/hoa-hong/cutover.ts`, bọc hàm thuần `thangThuocSoMoi`):
//   `k ≥ mốc` HOẶC tháng k đã có ít nhất một dòng sổ MỚI (vế hai giữ đúng cả khi ai đó lách được cổng đặt mốc bằng SQL tay).
// Cổng đọc mốc THẲNG từ DB (không qua `getSetting`, cache 300 giây) trong chính client được truyền vào — transaction thì thấy mốc trong transaction.
//
// ⚠️ Cổng đặt ở tầng `lib`, KHÔNG ở action: `approveStatement` hôm nay không có cổng nào, `ensureCommissionStatement` còn được gọi từ
// `prisma/seed-uat-giaovien.ts` và `convertLeadV2` độc lập với chỗ ghi dòng. Action chỉ là MỘT trong nhiều đường gọi.
import type { Prisma, PrismaClient } from "@prisma/client";

import { docMocCutover, docThangThuocSoMoi } from "@/lib/hoa-hong/cutover";

import { CommissionStmtError } from "./commission-stmt-error";

export const MA_LOI_THANG_THUOC_SO_MOI = "PERIOD_IN_NEW_LEDGER";

/**
 * Từ chối thao tác của đường cũ trên tháng `period` nếu tháng đó đã thuộc sổ MỚI. Ném `CommissionStmtError` (mã `PERIOD_IN_NEW_LEDGER`).
 * PHẢI đứng TRƯỚC phép ghi đầu tiên của hàm gọi nó (lưới `[NHH-W1]`).
 */
export async function chanThangThuocSoMoi(client: PrismaClient | Prisma.TransactionClient, period: string, thaoTac: string): Promise<void> {
  if (await docThangThuocSoMoi(client, period)) {
    throw new CommissionStmtError(
      MA_LOI_THANG_THUOC_SO_MOI,
      `Kỳ ${period} đã chuyển sang sổ hoa hồng mới — không ${thaoTac} bằng đường cũ. Dùng màn Nguồn & hoa hồng.`,
    );
  }
}

/**
 * Mở lại bảng kê ĐÃ DUYỆT: từ chối MỌI kỳ khi đã đặt mốc cutover (≠ null). Lý do: engine mới ghi `LATE_ARRIVAL` cho bút toán mà bảng kê đã duyệt
 * CHƯA TỪNG chứa (04 §3.1); mở lại rồi để engine cũ chốt lại sẽ nuốt đúng bút toán đó ⇒ trả hai lần. Mốc `null` ⇒ như hôm nay.
 */
export async function chanMoLaiKyCu(client: PrismaClient | Prisma.TransactionClient, period: string): Promise<void> {
  const moc = await docMocCutover(client);
  if (moc !== null) {
    throw new CommissionStmtError(
      "REOPEN_AFTER_CUTOVER",
      `Đã đặt mốc chuyển sang sổ hoa hồng mới (${moc}) — không mở lại bảng kê kỳ ${period}. Khoản phát sinh sau khi duyệt được ghi bằng dòng điều chỉnh ở sổ mới.`,
    );
  }
}
