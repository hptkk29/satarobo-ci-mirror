import "server-only";
// lib/payments/pos/provider/tcb-file.ts — provider ĐỌC DỮ LIỆU ĐÃ IMPORT (GĐ1 POS). CHỈ ĐỌC.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §2.3. Nguồn là bảng `PosCardTransaction` do Kế toán HO import
// từ file "Danh sách giao dịch V2" — KHÔNG ghi gì (lưới `[POS1-W1]`).
//
// GĐ4 (07/10/2026): thân DỜI sang `provider/doc-du-lieu.ts` (`docKetQuaDaDongBo`, chế độ FILE — hành vi
// byte-cho-byte GĐ1) để provider máy đồng bộ (`provider/tcb-agent.ts`) dùng CHUNG phép đọc trên CÙNG bảng.
// Năm luật cố ý (không lọc cơ sở · `tachMaPos` · loại giao dịch của phiếu khác · bỏ lần quẹt đã hủy · chỉ
// "Thất bại" là FAILED) ghi ở đầu tệp đó. Lớp này giữ lại cho test GĐ1/GĐ2 và đường tiêm tay.
import { CUA_SO_LUI_MS, docKetQuaDaDongBo } from "./doc-du-lieu";
import type { IntentDeKiem, PosCheckResult, PosProvider } from "./kieu";

export { CUA_SO_LUI_MS };

export class TcbFileImportProvider implements PosProvider {
  readonly ten = "TCB_FILE" as const;
  readonly nguonDuLieu = "SMARTPOS" as const;

  async checkStatus(intent: IntentDeKiem, now: Date): Promise<PosCheckResult> {
    return docKetQuaDaDongBo(intent, now, { cheDo: "FILE" });
  }
}
