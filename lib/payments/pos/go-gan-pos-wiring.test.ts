// [GGP-W*] — LƯỚI GHIM MÃ NGUỒN: gỡ gắn giao dịch thẻ đã bị hủy/hoàn. THUẦN.
//
// Hành vi trên Postgres thật: `tests/finance/pos-no-so-tien.test.ts` (`[PNS-10..14]`). Lưới này
// ghim DÂY NỐI mà test hành vi chỉ chạm khi đúng ca thẻ bị hủy: `goGanTheoCon` (đường gỡ gắn
// CHUNG của mọi nguồn tiền) gọi đúng MỘT helper POS trong transaction của nó, và KHÔNG tự viết
// luật thẻ inline. Mã TRƯỚC bản vá: không có lời gọi nào — giao dịch thẻ đã hủy về UNMATCHED đủ
// số gộp.
//
// Bóc chú thích TRƯỚC khi so (chú thích giải thích bản vá chứa đúng các chuỗi đang tìm), đếm SỐ
// LẦN khớp, không chỉ "có/không".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}
const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;
function than(src: string, ten: string): string {
  const dau = src.indexOf(`function ${ten}(`);
  if (dau === -1) return "";
  const sau = src.indexOf("\nexport ", dau + 1);
  return src.slice(dau, sau === -1 ? undefined : sau);
}

const GHI = doc("lib/finance/ghi-tien-don.ts");
const GO = than(GHI, "goGanTheoCon");
const HELPER = doc("lib/payments/pos/go-gan-pos.ts");
const DONG = doc("lib/payments/pos/dong-canh-bao-pos.ts");

describe("[GGP-W] dây nối gỡ gắn ↔ thẻ POS", () => {
  it("[GGP-W1] goGanTheoCon gọi giaoDichPosSauGoGanTrongTx ĐÚNG MỘT lần, bằng `tx`, SAU câu ghi UNMATCHED", () => {
    expect(GO, "không tách được thân goGanTheoCon").not.toBe("");
    expect(dem(GHI, /\bgiaoDichPosSauGoGanTrongTx\s*\(/), "số lời gọi trong cả tệp").toBe(1);
    expect(dem(GO, /\bgiaoDichPosSauGoGanTrongTx\(tx,/), "lời gọi nằm trong goGanTheoCon, với tx").toBe(1);
    const ghiUnmatched = GO.indexOf('status: "UNMATCHED", unmatchedNote: ghiChuGo');
    const goi = GO.indexOf("giaoDichPosSauGoGanTrongTx(tx,");
    expect(ghiUnmatched, "câu ghi UNMATCHED mang đúng ghi chú truyền cho helper").toBeGreaterThan(-1);
    expect(goi, "helper chạy SAU câu ghi UNMATCHED (nó đổi UNMATCHED → IGNORED có điều kiện)").toBeGreaterThan(ghiUnmatched);
    const khoi = GO.slice(goi, GO.indexOf("});", goi) + 3);
    expect(khoi).toMatch(/bankTransactionId: txn\.id,/);
    expect(khoi).toMatch(/provider: txn\.provider,/);
    expect(khoi).toMatch(/ghiChuGoGan: ghiChuGo,/);
  });

  it("[GGP-W2] đường gỡ gắn CHUNG không viết luật thẻ inline", () => {
    for (const re of [/posCardTransaction/, /PROVIDER_THE_POS/, /"CARD_POS"/, /tinHieuHuyCuaGoc/, /laHuyToanPhanVoiGoc/]) {
      expect(dem(GHI, re), `${re.source} xuất hiện trong ghi-tien-don.ts`).toBe(0);
    }
  });

  it("[GGP-W3] luật 'toàn phần hay một phần' ở MỘT chỗ — lượt đóng cảnh báo và lượt gỡ gắn cùng hỏi tinHieuHuyCuaGoc", () => {
    for (const [ten, ma] of [
      ["go-gan-pos.ts", HELPER],
      ["dong-canh-bao-pos.ts", DONG],
    ] as const) {
      expect(dem(ma, /\btinHieuHuyCuaGoc\(/), `${ten} hỏi tinHieuHuyCuaGoc`).toBe(1);
      // Tự phân loại lại tại chỗ là bản luật thứ hai — đúng thứ làm "gỡ rồi đóng" ≠ "đóng rồi gỡ".
      expect(dem(ma, /\blaHuyToanPhanVoiGoc\(/), `${ten} tự so toàn phần`).toBe(0);
      expect(dem(ma, /\btinHieuHoanHuy\(/), `${ten} tự đọc cột Hoàn/Hủy`).toBe(0);
    }
  });

  it("[GGP-W5] Q-M (30/09/2026): helper nói ra NGUỒN từ provider — đường gỡ gắn chung chỉ chuyển tiếp", () => {
    // Luật Q-M ("gỡ gắn thẻ luôn ĐÓNG phiếu") đọc nguồn; nguồn sai chiều là thẻ mở lại phiếu (hoặc SePay
    // bị đóng oan). Kiểu `SauGoGanPos.nguon` BẮT BUỘC nên mọi nhánh phải mang nó — lưới ghim phép ánh xạ.
    expect(dem(HELPER, /const nguon: NguonTienGoGan = input\.provider === PROVIDER_THE_POS \? "THE_POS" : "CHUYEN_KHOAN";/)).toBe(1);
    expect(dem(HELPER, /ghiChu: input\.ghiChuGoGan, nguon \}/), "nhánh giữ nguyên").toBe(1);
    expect(dem(HELPER, /tinHieu: "HUY_TOAN_PHAN", ghiChu, nguon \}/)).toBe(1);
    expect(dem(HELPER, /tinHieu: "HOAN_MOT_PHAN", ghiChu, nguon \}/)).toBe(1);
  });

  it("[GGP-W4] helper đổi IGNORED CÓ ĐIỀU KIỆN và NÉM khi đổi ≠ 1 dòng (luật rollback)", () => {
    expect(HELPER).toMatch(/where: \{ id: input\.bankTransactionId, status: "UNMATCHED" \},\s*data: \{ status: "IGNORED"/);
    expect(HELPER).toMatch(/if \(ra\.count !== 1\) \{\s*throw new Error\(/);
    // Không phải giao dịch thẻ ⇒ không câu tra nào (SePay đi qua đây mỗi lượt gỡ).
    expect(HELPER).toMatch(/if \(input\.provider !== PROVIDER_THE_POS\) return giuNguyen;/);
  });
});
