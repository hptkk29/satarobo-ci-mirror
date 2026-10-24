// lib/payments/pos/provider/tcb-api.ts — provider API Techcombank: CHỖ ĐỂ SẴN (GĐ1 POS). THUẦN.
//
// GĐ1 chưa được cấp API ⇒ mọi lượt hỏi trả PROVIDER_ERROR `CHUA_CAP_API` (thiết kế §2.4) — câu cho
// sale: "Lỗi kết nối hệ thống thanh toán (mã CHUA_CAP_API — chưa được cấp API) — đã báo admin".
// `chonPosProvider()` KHÔNG trả provider này ở GĐ1 (T12) — chỉ test với tới.
import type { IntentDeKiem, PosCheckResult, PosProvider } from "./kieu";

export class TcbApiProvider implements PosProvider {
  readonly ten = "TCB_API" as const;
  readonly nguonDuLieu = "TCB_API" as const;

  async checkStatus(_intent: IntentDeKiem, _now: Date): Promise<PosCheckResult> {
    return { kind: "PROVIDER_ERROR", reasonCode: "CHUA_CAP_API" };
  }
}
