/**
 * Đọc `data.rejected[]` của `POST /api/pos-agent/transactions` (hợp đồng 1.1 §4.4 + §7.2).
 *
 * 1.1 thêm mã `FIELD_TOO_LONG` + trường tuỳ chọn `rejected[].field` (= tên khoá §6.1 ĐẦU TIÊN vượt trần): máy chủ từ
 * chối DÒNG thay vì 400 cả lô. Extension đúng hợp đồng làm vừa trần trước khi gửi nên gặp mã này = extension LỆCH
 * hợp đồng ⇒ `/status ERROR FIELD_TOO_LONG` MỘT lần (ca tích hợp [EXT-BDP-34/34b]); mã khác: không cần làm gì.
 *
 * Dữ liệu từ máy chủ là dữ liệu NGOÀI service worker: chỉ nhận đúng hình dạng; `field` chỉ giữ khi là MỘT khoá của
 * whitelist §6.1 (không đưa chuỗi tuỳ ý của máy chủ vào kho / huy hiệu / trang Options).
 */
import { describe, expect, it } from "vitest";
import { docTuChoi, truongQuaDai } from "../src/lib/than-api";
import { HOP_DONG } from "./ho-tro/hop-dong";

/** Khối JSON `data` mẫu của §4.4 — đọc THẲNG từ hợp đồng (hình dạng hai phía cùng neo một nguồn). */
function dataMauHopDong(): unknown {
  const s = HOP_DONG.slice(HOP_DONG.indexOf("### 4.4"), HOP_DONG.indexOf("## 5."));
  const m = /```json\n([\s\S]*?)\n```/.exec(s);
  if (!m) throw new Error("không thấy khối JSON mẫu của §4.4");
  return JSON.parse(m[1]);
}

describe("[EXT-TA] rejected[] của /transactions (hợp đồng 1.1)", () => {
  it("[EXT-TA-01] khối `data` mẫu của hợp đồng §4.4 ⇒ hai dòng từ chối đúng thứ tự; `field` CHỈ ở FIELD_TOO_LONG; trường lệch = store_code", () => {
    const ds = docTuChoi(dataMauHopDong());
    expect(ds).toEqual([
      { index: 3, transactionId: "TXN…", code: "MERCHANT_MISMATCH", field: null },
      { index: 4, transactionId: "TXN…", code: "FIELD_TOO_LONG", field: "store_code" },
    ]);
    expect(truongQuaDai(ds)).toEqual(["store_code"]);
    // `errors[]` (PROCESSING_ERROR) KHÔNG phải từ chối dòng — không lẫn vào
    expect(ds.map((t) => t.code)).not.toContain("PROCESSING_ERROR");
  });

  it("[EXT-TA-02] dữ liệu lạ không làm hỏng gì: thiếu / sai kiểu ⇒ []; mục sai hình dạng bị bỏ; `field` ngoài whitelist hoặc ở mã khác ⇒ null; mã giao dịch > 64 ⇒ null; chỉ FIELD_TOO_LONG mới là 'trường lệch'", () => {
    for (const x of [null, undefined, 1, "x", [], {}, { rejected: null }, { rejected: "FIELD_TOO_LONG" }, { rejected: {} }]) {
      expect(docTuChoi(x)).toEqual([]);
    }
    const ds = docTuChoi({
      rejected: [
        null,
        "FIELD_TOO_LONG",
        { index: -1, code: "FIELD_TOO_LONG", field: "store_code" },
        { index: 1.5, code: "FIELD_TOO_LONG", field: "store_code" },
        { index: 2, code: "field_too_long", field: "store_code" },
        { index: 3, code: "Chuỗi tự do có dấu cách", field: "store_code" },
        { index: 4, transaction_id: "T".repeat(65), code: "FIELD_TOO_LONG", field: "sender_card_name" },
        { index: 5, transaction_id: 12345678, code: "FIELD_TOO_LONG", field: "<img src=x>" },
        { index: 6, transaction_id: "TXN20261007000206", code: "BAD_TIME", field: "transaction_time" },
        { index: 7, transaction_id: "TXN20261007000207", code: "FIELD_TOO_LONG", field: "terminal_code" },
        { index: 8, transaction_id: "TXN20261007000208", code: "FIELD_TOO_LONG", field: "terminal_code" },
        { index: 9, transaction_id: null, code: "FIELD_TOO_LONG" },
      ],
    });
    expect(ds).toEqual([
      { index: 4, transactionId: null, code: "FIELD_TOO_LONG", field: null },
      { index: 5, transactionId: null, code: "FIELD_TOO_LONG", field: null },
      { index: 6, transactionId: "TXN20261007000206", code: "BAD_TIME", field: null },
      { index: 7, transactionId: "TXN20261007000207", code: "FIELD_TOO_LONG", field: "terminal_code" },
      { index: 8, transactionId: "TXN20261007000208", code: "FIELD_TOO_LONG", field: "terminal_code" },
      { index: 9, transactionId: null, code: "FIELD_TOO_LONG", field: null },
    ]);
    // trường lệch: chỉ của FIELD_TOO_LONG, chỉ khoá whitelist, không trùng
    expect(truongQuaDai(ds)).toEqual(["terminal_code"]);
    // mã khác (vd MERCHANT_MISMATCH, BAD_TIME) — "không cần làm gì": không có trường lệch
    expect(truongQuaDai(docTuChoi({ rejected: [{ index: 0, code: "MERCHANT_MISMATCH" }, { index: 1, code: "BAD_TIME" }] }))).toEqual([]);
  });
});
