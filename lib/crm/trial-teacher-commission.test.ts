// Hoa hồng GV dạy Trial — phần THUẦN (kỳ + số tiền). Phần ghi DB có transaction nên
// nằm ở e2e; ở đây chốt hai thứ dễ sai âm thầm mà lại là tiền: mốc kỳ theo giờ VN và
// cách làm tròn.
import { describe, it, expect } from "vitest";
import {
  TRIAL_TEACHER_RATE,
  TRIAL_TEACHER_TIER,
  commissionPeriodVN,
  trialTeacherCommissionAmount,
} from "./trial-teacher-commission";
import { COMMISSION_TIERS, MAX_TOTAL_RATE, DEFAULT_RATES } from "./commission";

describe("tầng TRIAL_TEACHER — tính riêng, nhưng NẰM TRONG trần tổng", () => {
  it("không được lọt vào COMMISSION_TIERS — pool 4 tầng Sale tính trên doanh thu kỳ, tầng GV tính trên từng ghi danh", () => {
    expect(COMMISSION_TIERS).not.toContain(TRIAL_TEACHER_TIER as never);
  });

  // 27/08/2026 — trần nới 8% → 9% và thôi hardcode (`crm.commissionMaxTotalRate`).
  // Bất biến MỚI thay cho "Σ 4 tầng đúng bằng trần": Σ 4 tầng Sale CỘNG tầng GV phải
  // vừa khít trần mặc định. Đây là lý do con số 9% được chọn, không phải số tròn tuỳ ý.
  it("Σ 4 tầng Sale + tầng GV dạy Trial = trần mặc định 9%", () => {
    const tongSale = Object.values(DEFAULT_RATES).reduce((a, b) => a + b, 0);
    expect(tongSale).toBeCloseTo(0.08, 10);
    expect(tongSale + TRIAL_TEACHER_RATE).toBeCloseTo(MAX_TOTAL_RATE, 10);
  });

  it("tỉ lệ là 1%", () => {
    expect(TRIAL_TEACHER_RATE).toBe(0.01);
  });
});

describe("commissionPeriodVN — kỳ theo THÁNG DƯƠNG LỊCH VIỆT NAM", () => {
  it("giữa tháng thì hiển nhiên", () => {
    expect(commissionPeriodVN(new Date("2026-08-15T03:00:00Z"))).toBe("2026-08");
  });

  it("23:30 ngày 31/08 giờ VN vẫn thuộc kỳ 08 — dù UTC đã là 16:30 ngày 31", () => {
    // 2026-08-31 23:30 VN = 2026-08-31 16:30 UTC
    expect(commissionPeriodVN(new Date("2026-08-31T16:30:00Z"))).toBe("2026-08");
  });

  it("00:30 ngày 01/09 giờ VN thuộc kỳ 09 — dù UTC còn là 17:30 ngày 31/08", () => {
    // 2026-09-01 00:30 VN = 2026-08-31 17:30 UTC
    expect(commissionPeriodVN(new Date("2026-08-31T17:30:00Z"))).toBe("2026-09");
  });

  it("bắc cầu năm: 00:30 ngày 01/01/2027 giờ VN → 2027-01", () => {
    expect(commissionPeriodVN(new Date("2026-12-31T17:30:00Z"))).toBe("2027-01");
  });

  it("tháng 1 chữ số vẫn có số 0 đứng trước", () => {
    expect(commissionPeriodVN(new Date("2026-03-10T00:00:00Z"))).toBe("2026-03");
  });
});

describe("trialTeacherCommissionAmount", () => {
  it("1% học phí, làm tròn XUỐNG (không tự làm lợi cho ai)", () => {
    expect(trialTeacherCommissionAmount(7_920_000)).toBe(79_200);
    expect(trialTeacherCommissionAmount(1_485_000)).toBe(14_850);
    expect(trialTeacherCommissionAmount(999)).toBe(9); // 9,99 → 9
  });

  it("học bổng toàn phần / giá 0 / số rác → 0, không sinh dòng hoa hồng", () => {
    expect(trialTeacherCommissionAmount(0)).toBe(0);
    expect(trialTeacherCommissionAmount(-1_000_000)).toBe(0);
    expect(trialTeacherCommissionAmount(Number.NaN)).toBe(0);
  });
});

// ─── Chốt hai luật đắt tiền bằng cách đọc chính mã nguồn ──────────────────────
//
// Hai thứ dưới đây không test được bằng gọi hàm (đều cần DB), nhưng cả hai đều là lỗi
// TIỀN đã thực sự xảy ra ở bản đầu 25/08 và cả hai đều dễ bị vô hiệu hoá bởi một lần
// "dọn dẹp" vô ý. Kiểm trên nguồn là rẻ và bắt đúng lúc ai đó gỡ chúng ra.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "trial-teacher-commission.ts"), "utf8");
const CONVERT = readFileSync(join(__dirname, "convert-lead-v2.ts"), "utf8");

describe("luật cứng của tầng TRIAL_TEACHER", () => {
  it("chỉ trả hoa hồng khi con ĐÃ ĐIỂM DANH CÓ MẶT, không phải khi mới xếp lớp", () => {
    // Ghi danh trải nghiệm mang status ACTIVE ngay lúc Sale xếp con vào một buổi TƯƠNG
    // LAI. Lọc theo status là trả tiền cho giáo viên chưa dạy buổi nào.
    expect(SRC).toMatch(/trialAttendance\.findFirst/);
    expect(SRC).toMatch(/status:\s*"PRESENT"/);
    expect(SRC).not.toMatch(/status:\s*\{\s*not:\s*"WITHDRAWN"\s*\}/);
  });

  it("bảng kê của kỳ được dựng NGOÀI transaction convert", () => {
    // Prisma upsert trên model nhiều unique = đọc-rồi-ghi ⇒ hai lượt convert song song
    // vào lần đầu của tháng đâm P2002. Ném trong transaction là rollback CẢ lượt convert.
    expect(SRC).toMatch(/export async function ensureCommissionStatement/);
    // Trong transaction chỉ còn ghi DÒNG, không tạo bảng kê.
    const inRecord = SRC.slice(SRC.indexOf("export async function recordTrialTeacherCommission"));
    expect(inRecord).not.toMatch(/commissionStatement\.(upsert|create)/);
    // Và convert phải gọi ensure… TRƯỚC khi mở transaction.
    expect(CONVERT.indexOf("ensureCommissionStatement")).toBeLessThan(
      CONVERT.indexOf("db.$transaction"),
    );
  });

  it("đóng sổ trải nghiệm chỉ đụng ĐÚNG lớp đã học và chỉ dòng còn PENDING", () => {
    // Lọc trần theo leadChildId sẽ đè cả dòng "LOST" của lần thử trước, và bật nhãn
    // "+1% HH" cho giáo viên của lớp khác — người không nhận được đồng nào.
    const block = CONVERT.slice(
      CONVERT.indexOf("leadTrialHistory.updateMany"),
      CONVERT.indexOf("leadTrialHistory.updateMany") + 400,
    );
    expect(block).toMatch(/trialClassId: trial\.trialClassId/);
    expect(block).toMatch(/outcome: "PENDING"/);
  });
});
