// Ca [POS-W1] · [POS-W2] — LƯỚI GHIM MÃ NGUỒN cho `lib/payments/pos/nhap-lo-pos.ts`. THUẦN.
//
// Hai luật dạng "lời gọi này KHÔNG được có / phải truyền tham số kia" — test hành vi không
// chứng minh được vì chúng chỉ đỏ ở ca hiếm (mã giả ghép từ tên khách, đoán theo SĐT).
// Thiết kế: `docs/pos-the-smartpos.md` mục "Vì sao KHÔNG làm nguyên văn spec ban đầu".
//
// [POS-W1] Tầng POS KHÔNG gọi đường webhook / đường đoán:
//   `ingestPayosWebhook(` — khi `thuTheoPhieuGop` nhường, nó chạy tiếp đoán theo SĐT/thác nước
//   ⇒ trái luật "còn lại → CAN_XU_LY". `resolvePaymentTargetDetailed(` / `allocateToOrder(`
//   là hai khúc của chính đường đoán ấy. `docMemo(` quét cửa sổ trượt ⇒ mã giả.
//
// [POS-W2] Lời gọi `thuTheoPhieuGop({ … })` truyền `noiDung` là biến mã TOKEN (`ma`, do
//   `tachMaPos` tách qua `phanLoaiDongPos`), KHÔNG phải `d.dienGiai`. Mã TRƯỚC khi có luật
//   này (bản nháp bị loại) trông như: `noiDung: d.dienGiai,`.
//
// Bóc chú thích TRƯỚC khi so (chú thích giải thích luật chứa đúng các chuỗi đang cấm), và
// khẳng định SỐ LẦN khớp, không chỉ "có/không".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEP = "lib/payments/pos/nhap-lo-pos.ts";

function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}

const ma = bocChuThich(readFileSync(resolve(process.cwd(), TEP), "utf8"));

function dem(re: RegExp): number {
  return [...ma.matchAll(new RegExp(re.source, "g"))].length;
}

describe("[POS-W] dây nối của tầng nhập giao dịch thẻ", () => {
  it("[POS-W1] không gọi ingestPayosWebhook / resolvePaymentTargetDetailed / allocateToOrder / docMemo", () => {
    for (const ten of ["ingestPayosWebhook", "resolvePaymentTargetDetailed", "allocateToOrder", "docMemo"]) {
      expect(dem(new RegExp(`\\b${ten}\\s*\\(`)), `${ten}( xuất hiện trong ${TEP}`).toBe(0);
      // Cũng không import — import mà chưa gọi là nửa bước tới lỗi.
      expect(dem(new RegExp(`import[^;]*\\b${ten}\\b[^;]*;`)), `import ${ten}`).toBe(0);
    }
  });

  it("[POS-W2] thuTheoPhieuGop được gọi ĐÚNG MỘT lần, noiDung là token mã, không dienGiai", () => {
    const loiGoi = [...ma.matchAll(/\bthuTheoPhieuGop\s*\(\s*\{([^}]*)\}\s*\)/g)];
    expect(loiGoi, "số lời gọi thuTheoPhieuGop").toHaveLength(1);
    const thamSo = loiGoi[0]![1]!;
    expect(thamSo.match(/\bnoiDung\s*:\s*([^,\n]+)/)?.[1]?.trim(), "noiDung phải là biến token `ma`").toBe("ma");
    expect(thamSo, "không truyền ghi chú thô").not.toMatch(/dienGiai/);
    // Biến `ma` phải đến từ kết quả phân loại THU (token do `tachMaPos` tách), không tự dựng.
    expect(dem(/\bconst\s+ma\s*=\s*p\.ma\s*;/), "const ma = p.ma;").toBe(1);
    // ngayThu = giờ quẹt, không `new Date()` trần.
    expect(thamSo.match(/\bngayThu\s*:\s*([^,\n]+)/)?.[1]?.trim()).toBe("new Date(d.thoiGian)");
  });
});
