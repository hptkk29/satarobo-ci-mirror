// lib/bao-luu/day-noi.test.ts — LƯỚI GHIM DÂY NỐI của Phiên 1 bảo lưu.
//
// Phần hành vi của cron/`debt.ts` đã có test trên Postgres thật (`tests/finance/bao-luu-nhac-no.test.ts`).
// File này canh những chỗ KHÔNG có test hành vi, và quên gọi là KHÔNG ca nào đỏ:
//   · trang `/cong-no` + tệp xuất báo cáo (hai danh sách tuổi nợ đọc sổ cũ) — chạy trong RSC /
//     bộ nạp có `scopedDb`, không chỗ cấy lỗi;
//   · phép kiểm TRẦN trong `reserveStudentAction` — action giả lập auth/DB thì test nào cũng xanh.
//
// Luật 11: đếm trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng chuỗi đang tìm) và
// khẳng định SỐ LẦN khớp, không chỉ "có mặt".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function maThat(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");
}
const dem = (ma: string, re: RegExp) => ma.match(re)?.length ?? 0;

describe("[BL1-W] đầu ĐỌC sổ cũ (OrderInstallment) đều hỏi `locDonDangBaoLuu`", () => {
  it("[BL1-W1] lib/finance/debt.ts: hai hàm nhắc (đơn lẻ + đợt trả góp) — ĐÚNG 2 lời gọi", () => {
    expect(dem(maThat("lib/finance/debt.ts"), /locDonDangBaoLuu\(/g)).toBe(2);
  });

  it("[BL1-W2] cron debt-reminder — ĐÚNG 1 lời gọi, và đứng TRƯỚC vòng lặp gửi chuông/ZNS", () => {
    const ma = maThat("app/api/cron/debt-reminder/route.ts");
    expect(dem(ma, /locDonDangBaoLuu\(/g)).toBe(1);
    expect(ma.indexOf("locDonDangBaoLuu(")).toBeLessThan(ma.indexOf("for (const inst of candidates)"));
  });

  it("[BL1-W3] trang /cong-no — ĐÚNG 1 lời gọi, và đơn bảo lưu rơi vào nhóm 'none' (không phải nhóm quá hạn)", () => {
    const ma = maThat("app/(admin)/admin/cong-no/page.tsx");
    expect(dem(ma, /locDonDangBaoLuu\(/g)).toBe(1);
    expect(ma).toMatch(/donBaoLuu\.has\(o\.id\) \? "none"/);
  });

  it("[BL1-W4] tệp xuất báo cáo công nợ — ĐÚNG 1 lời gọi, cùng luật với màn /cong-no", () => {
    const ma = maThat("lib/export/bao-cao.ts");
    expect(dem(ma, /locDonDangBaoLuu\(/g)).toBe(1);
    expect(ma).toMatch(/donBaoLuu\.has\(d\.id\) \? "none"/);
  });
});

describe("[BL1-W] reserveStudentAction kiểm TRẦN trước khi tạo lượt", () => {
  const ma = maThat("app/(admin)/admin/students/_actions.ts");

  it("[BL1-W5] có ĐÚNG 1 lời gọi kiemTranBaoLuu và 1 lời gọi layTranBaoLuuThang", () => {
    expect(dem(ma, /kiemTranBaoLuu\(/g)).toBe(1);
    expect(dem(ma, /layTranBaoLuuThang\(/g)).toBe(1);
  });

  it("[BL1-W6] phép kiểm đứng TRƯỚC `studentReserve.create` — kiểm sau khi ghi là từ chối trong khi đã ghi", () => {
    const viTriKiem = ma.indexOf("kiemTranBaoLuu(");
    const viTriTao = ma.indexOf("studentReserve.create(");
    expect(viTriKiem).toBeGreaterThan(-1);
    expect(viTriTao).toBeGreaterThan(-1);
    expect(viTriKiem).toBeLessThan(viTriTao);
  });
});
