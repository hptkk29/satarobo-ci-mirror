// @vitest-environment node
// [P11-*] Bộ nạp dữ liệu nghiệm thu gói 10 hạng mục cổng PH (12/11/2026): CHỈ THÊM · id cố định · nối đúng lối workflow đã có.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emailUatTatCa } from "./00-tai-khoan";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[P11] 09-portal-1211.ts", () => {
  const s = doc("prisma/seed-uat/09-portal-1211.ts");

  it("[P11-01] CHỈ THÊM: không có câu xoá / SQL thô nào (luật 1 của bộ seed UAT)", () => {
    expect(s).not.toMatch(/\.delete\s*\(/);
    expect(s).not.toMatch(/\.deleteMany\s*\(/);
    expect(s).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("[P11-02] mọi id tự đặt mang tiền tố `uat-p11-` (phân biệt được với dữ liệu người thật)", () => {
    const dung = s.match(/uid\("p11"/g) ?? [];
    expect(dung.length).toBeGreaterThanOrEqual(8);
    // không có id nào tự gõ bằng chuỗi cứng khác tiền tố
    expect(s).not.toMatch(/[{,]\s*id:\s*"(?!uat-p11-|asc")/);
  });

  it("[P11-03] đi qua `db` của _common (client có ghi kép orgUnitId), không tự `new PrismaClient`", () => {
    expect(s).not.toMatch(/new PrismaClient/);
    expect(s).toContain('from "./_common"');
  });

  it("[P11-04] mỗi mục chạy độc lập trong try/catch và lỗi làm tiến trình thoát mã 1 (không im lặng)", () => {
    expect(s).toContain("async function muc(");
    expect(s).toMatch(/ctx\.loi\.push\(/);
    const r = doc("prisma/seed-uat/chay-nghiem-thu-gop.ts");
    expect(r).toContain("seedPortal1211({ ghi: GHI })");
    expect(r).toMatch(/process\.exitCode = 1/);
  });

  it("[P11-05] phủ đủ các nhóm dữ liệu: ảnh duyệt + chờ duyệt · lượt bù · bài tập video · đơn trước/sau mốc 01/11 · khuyến mãi", () => {
    for (const k of ["mucAnhDaDuyet", "mucAnhChoDuyet", "mucHocBu", "mucBaiTapVideo", "mucDonHang", "mucKhuyenMai", "mucDongY"]) expect(s).toContain(k);
    expect(s).toContain("requireVideo: true");
    expect(s).toContain("2026-10-05");
    expect(s).toContain("2026-11-05");
  });

  it("[P11-06] KHÔNG tự ghi đồng ý Quy định đào tạo (để uat.phuhuynh1 thấy cổng chặn lần đầu)", () => {
    expect(s).not.toContain("sitePolicyAcceptance");
  });

  it("[P11-07] tài khoản uat.phuhuynh1 nằm trong danh sách tạo-thiếu", () => {
    expect(emailUatTatCa()).toContain("uat.phuhuynh1@satarobo.vn");
  });
});
