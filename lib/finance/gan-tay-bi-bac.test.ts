// [GTB-U1..U6] — VIỆC 6 · MỤC 1: cổng "sale không gắn tay được giao dịch kế toán đã BÁC cho chính đơn đó" ở `ganTienTheoCon`. THUẦN (không Postgres).
//
// Vì sao có một bộ KHÔNG cần DB bên cạnh `tests/finance/pos-ban-tay-bi-bac.test.ts`: bộ DB chỉ chạy ở job `test:finance-db`; job `Unit tests` của CI KHÔNG dựng
// Postgres nên bộ đó SKIP ở đó. Cổng này là luật tiền ⇒ phải có ít nhất một khoá chạy ở MỌI lượt `test:unit`. Ở đây `db` / `docSoTheoCon` được thay bằng bản giả,
// còn `ganTienTheoCon` là MÃ THẬT: ca nào đỏ thì đỏ vì cổng, không vì giả lập.
//
// `tx` giả là một Proxy: chỉ có các thứ cổng cần (khoá thô × 2 · đọc giao dịch · đọc đơn). Chạm BẤT KỲ thứ gì khác — đặc biệt phép GHI — là ném lỗi nêu rõ tên,
// nên "cổng đứng TRƯỚC phép ghi đầu tiên" được đo bằng chính việc `tx` giả không bị chạm tới cái gì ngoài những thứ ấy.
//
// Mẫu: mọi ca "bị chặn" đi cặp một ca "được" (luật 11); ca nào cũng đã được CẤY lỗi (xem docs/pos-hai-nut-khai-may.md, bảng cấy Việc 6 mục 1).
import { beforeEach, describe, expect, it, vi } from "vitest";

type TxnGia = { id: string; amount: number; status: "UNMATCHED" | "MATCHED" | "IGNORED"; centerId: string | null; provider: string; providerTxnId: string; transferredAt: Date | null };

const h = vi.hoisted(() => ({
  txn: null as unknown,
  don: null as unknown,
  chamVao: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const tx = new Proxy(
    {
      $executeRaw: async () => {
        h.chamVao.push("$executeRaw");
        return 1;
      },
      bankTransaction: {
        findUnique: async () => {
          h.chamVao.push("bankTransaction.findUnique");
          return h.txn;
        },
      },
      order: {
        findFirst: async () => {
          h.chamVao.push("order.findFirst");
          return h.don;
        },
      },
    } as Record<string, unknown>,
    {
      get(goc, ten) {
        if (typeof ten === "string" && !(ten in goc)) throw new Error(`[GTB-U] cổng chạm vào tx.${ten} — ngoài bốn thứ cổng được phép (hai khoá thô · đọc giao dịch · đọc đơn)`);
        return (goc as Record<string | symbol, unknown>)[ten];
      },
    },
  );
  return { db: { $transaction: async (cb: (t: unknown) => unknown) => cb(tx) } };
});
// `docSoTheoCon` đọc ba bảng — không phải thứ cổng này đo. Trả `so` rỗng: không đợt nào ⇒ nếu cổng cho qua thì `kiemChiaTheoCon` từ chối câu RIÊNG của nó.
vi.mock("@/lib/finance/debt", () => ({ docSoTheoCon: async () => ({ con: [], dotChuaGanCon: [] }) }));

import { CAU_GAN_TAY_DA_BI_BAC, ganTienTheoCon, type NguoiGan } from "@/lib/finance/ghi-tien-don";

const CAU_KIEM_CHIA = "Chưa nhập số tiền cho đợt nào";
const BT = "bt-x";
const DON = "don-a";
const ACTOR = { id: "u1", name: "Fixture" };

const txnGia = (p: Partial<TxnGia> = {}): TxnGia => ({
  id: BT,
  amount: 3_168_000,
  status: "UNMATCHED",
  centerId: "cs1",
  provider: "CARD_POS",
  providerTxnId: "T1",
  transferredAt: new Date("2026-10-07T09:58:00Z"),
  ...p,
});

beforeEach(() => {
  h.txn = txnGia();
  h.don = { id: DON, code: "ORD-A", centerId: "cs1" };
  h.chamVao = [];
});

/** Hàm đọc "đã bị bác theo đơn" giả — ghi lại mọi lời gọi. */
function docGia(biBac: string[]) {
  const goi: { tx: unknown; orderId: string }[] = [];
  const doc = vi.fn(async (tx: unknown, orderId: string) => {
    goi.push({ tx, orderId });
    return { soLan: biBac.length, giaoDich: new Set(biBac) as ReadonlySet<string> };
  });
  return { doc, goi };
}

const gan = (nguoiGan: NguoiGan) => ganTienTheoCon({ bankTransactionId: BT, orderId: DON, dong: [], actor: ACTOR, nguoiGan });

describe("[GTB-U] ganTienTheoCon — cổng giao dịch đã bị kế toán bác (MÃ THẬT, db giả)", () => {
  it("[GTB-U1] người KHÁC + giao dịch nằm trong tập 'đã bị bác theo đơn' ⇒ từ chối ĐÚNG câu; hàm đọc được hỏi MỘT lần với (tx, đơn của lời gọi); tx KHÔNG bị chạm ngoài ba thứ cổng cần", async () => {
    const { doc, goi } = docGia([BT]);
    const kq = await gan({ loai: "KHAC", docGiaoDichDaBiBac: doc });
    expect(kq).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
    expect(goi, "hỏi đúng một lần").toHaveLength(1);
    expect(goi[0]!.orderId, "theo ĐƠN của lời gọi").toBe(DON);
    expect(h.chamVao, "khoá đơn → khoá dòng giao dịch → đọc giao dịch → đọc đơn; không một phép ghi nào").toEqual([
      "$executeRaw",
      "$executeRaw",
      "bankTransaction.findUnique",
      "order.findFirst",
    ]);
  });

  it("[GTB-U2] ĐỐI CHỨNG: người KHÁC nhưng giao dịch KHÔNG nằm trong tập (đơn có vết bác của giao dịch KHÁC) ⇒ cổng cho qua — chỉ còn câu riêng của bước chia", async () => {
    const { doc } = docGia(["bt-khac"]);
    const kq = await gan({ loai: "KHAC", docGiaoDichDaBiBac: doc });
    expect(kq).toEqual({ ok: false, error: CAU_KIEM_CHIA });
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it("[GTB-U3] ĐỐI CHỨNG: KẾ TOÁN không mang hàm đọc nào ⇒ cổng không thể chặn; câu duy nhất là của bước chia", async () => {
    const kq = await gan({ loai: "KE_TOAN" });
    expect(kq).toEqual({ ok: false, error: CAU_KIEM_CHIA });
  });

  it("[GTB-U4] THỨ TỰ TỪ CHỐI nói thật: giao dịch đã MATCHED / IGNORED, đơn không nhận tiền ⇒ nghe câu CỦA CHÚNG, hàm đọc KHÔNG được hỏi", async () => {
    const { doc } = docGia([BT]);
    const nguoi: NguoiGan = { loai: "KHAC", docGiaoDichDaBiBac: doc };
    h.txn = txnGia({ status: "MATCHED" });
    expect(await gan(nguoi)).toEqual({ ok: false, error: "Giao dịch này đã được gắn rồi" });
    h.txn = txnGia({ status: "IGNORED" });
    expect(await gan(nguoi)).toEqual({ ok: false, error: "Giao dịch đang ở trạng thái Bỏ qua — kế toán phải mở lại trước" });
    h.txn = txnGia();
    h.don = null;
    expect(await gan(nguoi)).toEqual({ ok: false, error: "Đơn này không nhận tiền được (nháp / đã huỷ / đã hoàn / đã xoá)" });
    h.txn = null;
    h.don = { id: DON, code: "ORD-A", centerId: "cs1" };
    expect(await gan(nguoi)).toEqual({ ok: false, error: "Không tìm thấy giao dịch" });
    expect(doc, "cổng mới đứng SAU mọi từ chối về trạng thái giao dịch / đơn").not.toHaveBeenCalled();
    // ĐỐI CHỨNG: cùng người, cùng hàm đọc, giao dịch UNMATCHED + đơn nhận tiền ⇒ hàm đọc được hỏi và cổng chặn.
    h.txn = txnGia();
    expect(await gan(nguoi)).toEqual({ ok: false, error: CAU_GAN_TAY_DA_BI_BAC });
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it("[GTB-U5] hàm đọc NÉM ⇒ lượt gắn NÉM theo (rollback, không nuốt lỗi thành 'cho qua' — fail-closed)", async () => {
    const hong = vi.fn(async () => {
      throw new Error("đọc vết bác hỏng");
    });
    await expect(gan({ loai: "KHAC", docGiaoDichDaBiBac: hong })).rejects.toThrow("đọc vết bác hỏng");
  });

  it("[GTB-U6] câu từ chối NÓI THẬT và chỉ việc nên làm: có 'kế toán', 'từ chối', 'đơn này', 'không gắn được', mời nhờ kế toán xử lý; không hủy/huỷ, không mời quẹt hay gắn lại; dùng chữ TRÊN MÀN ('gắn'), không thuật ngữ nội bộ 'gắn tay' (clarify)", () => {
    expect(CAU_GAN_TAY_DA_BI_BAC).toMatch(/Kế toán đã từ chối giao dịch này cho đơn này/);
    expect(CAU_GAN_TAY_DA_BI_BAC).toMatch(/không gắn được/);
    expect(CAU_GAN_TAY_DA_BI_BAC).toMatch(/nhờ kế toán xử lý/);
    expect(CAU_GAN_TAY_DA_BI_BAC).not.toMatch(/hủy|huỷ|quẹt lại|thử lại/i);
    // `/impeccable clarify`: sale đọc nút "Gắn vào đơn" và các câu anh em ("đã được gắn rồi", "không gắn cho bé nào được") — "gắn tay" chỉ có trong tài liệu / mã.
    expect(CAU_GAN_TAY_DA_BI_BAC).not.toMatch(/gắn tay/i);
    expect(CAU_GAN_TAY_DA_BI_BAC.length, "một câu, không dài dòng").toBeLessThan(140);
  });
});
