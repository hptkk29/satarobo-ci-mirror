// lib/finance/kiem-trung-so-cu.test.ts — LƯỚI GHIM MÃ NGUỒN (mẫu ở CLAUDE.md).
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT CẦN KHOÁ: trước khi ghi sổ cũ (`Payment`) cho một giao dịch ngân hàng, HAI đường ghi
// cùng họ marker `[auto:<provider>:<txn>]` — `allocateToOrder` (payos-ingest.ts) và
// `thuTheoPhieuGop` (phieu-gop.ts) — hỏi "đã ghi chưa" bằng MỘT hàm: `conDongThuGiuTien`.
//
// VÌ SAO (vá 28/09/2026): bản cũ ở cả hai nơi là
//     tx.payment.findFirst({ where: { orderId, deletedAt: null, note: { contains: marker } } })
// — coi dòng đã bị gỡ gắn ĐẢO là "đã ghi". Gỡ gắn rồi gắn lại CÙNG đơn ⇒ bỏ qua ghi sổ ⇒
// phân bổ nói đã thu, `Payment` nói 0. Hành vi đo bằng Postgres thật ở
// `tests/finance/go-gan-gan-lai.test.ts` ([GGL-01..04]).
//
// VÌ SAO VẪN CẦN LƯỚI VĂN BẢN khi đã có ca DB:
//  · đường phiếu gộp KHÔNG bấm lại được sau gỡ gắn (phiếu vẫn PAID ⇒ `PHIEU_KHONG_MO` trước
//    khi tới phép kiểm) ⇒ không ca hành vi nào chạm được phép kiểm của nó. Chép lại bản cũ
//    ở đó thì mọi ca DB vẫn xanh — chỉ lưới này đỏ;
//  · job `Unit tests` của CI không có Postgres; lưới này chạy ở đó.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://` — dùng
// `process.cwd()`. Xem CLAUDE.md mục "LƯỚI GHIM MÃ NGUỒN".
const HAI_DUONG = ["lib/payments/payos-ingest.ts", "lib/finance/phieu-gop.ts"] as const;

/** Mã đã BỎ dòng chú thích — chú thích giải thích bản vá nhắc đúng chuỗi đang cấm (luật 11). */
function maKhongChuThich(duongDan: string): string {
  return readFileSync(resolve(process.cwd(), duongDan), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d))
    .join("\n");
}

describe("[KTS] phép kiểm trùng sổ cũ đi qua MỘT hàm", () => {
  for (const duongDan of HAI_DUONG) {
    it(`[KTS-W1] ${duongDan}: gọi conDongThuGiuTien ĐÚNG 1 lần, không còn bản kiểm cũ`, () => {
      const ma = maKhongChuThich(duongDan);

      const goi = ma.match(/\bconDongThuGiuTien\(tx,/g) ?? [];
      expect(goi, `${duongDan} phải hỏi "đã ghi sổ cũ chưa" qua conDongThuGiuTien`).toHaveLength(1);

      // Mã TRƯỚC bản vá: `note: { contains: marker }` ngay trong `where` của một
      // `tx.payment.findFirst`. Còn chuỗi này là còn một phép kiểm trùng viết tại chỗ.
      const cu = ma.match(/note:\s*\{\s*contains:\s*marker\s*\}/g) ?? [];
      expect(cu, `${duongDan} còn phép kiểm trùng theo marker viết tại chỗ`).toHaveLength(0);
    });
  }
});
