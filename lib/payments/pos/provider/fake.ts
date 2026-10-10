// lib/payments/pos/provider/fake.ts — provider GIẢ cho test (GĐ1 POS). THUẦN.
//
// ⚠️ CHỈ TEST. Lưới `[POS1-W5]` (lib/payments/pos/pos-gd1-wiring.test.ts) đỏ khi một tệp chạy thật
// import tệp này — provider giả lọt vào đường thật là nút "Kiểm tra" trả kết quả bịa.
import type { IntentDeKiem, PosCheckResult, PosProvider } from "./kieu";

/** Trả kết quả theo HÀNG của từng phiếu POS; hết hàng ⇒ NOT_FOUND. */
export class FakePosProvider implements PosProvider {
  readonly ten = "FAKE" as const;
  readonly nguonDuLieu = "FAKE" as const;
  /** Nhật ký các lượt hỏi — test đọc để khẳng định `now` được truyền đúng. */
  readonly daHoi: { intentId: string; now: Date }[] = [];
  private readonly hang = new Map<string, PosCheckResult[]>();

  constructor(kichBan?: ReadonlyMap<string, readonly PosCheckResult[]>) {
    for (const [id, kq] of kichBan ?? []) this.hang.set(id, [...kq]);
  }

  /** Xếp thêm kết quả cho một phiếu (lần hỏi kế tiếp lấy cái đầu). */
  datKetQua(intentId: string, ...kq: PosCheckResult[]): void {
    this.hang.set(intentId, [...(this.hang.get(intentId) ?? []), ...kq]);
  }

  async checkStatus(intent: IntentDeKiem, now: Date): Promise<PosCheckResult> {
    this.daHoi.push({ intentId: intent.id, now });
    const h = this.hang.get(intent.id);
    return h?.shift() ?? { kind: "NOT_FOUND" };
  }
}
