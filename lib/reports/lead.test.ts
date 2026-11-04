// R7-17 — Báo cáo Lead (THUẦN, không cần DB). Pure fixtures + assert từng chỉ số.
import { describe, it, expect } from "vitest";
import {
  buildLeadReport,
  buildFunnel,
  buildFunnelReached,
  ledgerCoverage,
  funnelConversionRates,
  countByStatus,
  groupBySource,
  groupByCenter,
  groupByCommissionSource,
  groupByDropStage,
  groupByMonth,
  groupByWeek,
  leadSummary,
  monthKeyVN,
  type LeadReportRecord,
  type LeadLedgerRow,
} from "@/lib/reports/lead";

const d = (s: string) => new Date(s);

// Fixture: 10 lead phủ nhiều status / nguồn / cơ sở / tháng.
const records: LeadReportRecord[] = [
  { status: "MOI", source: "facebook", centerId: "c1", commissionSource: "MARKETING_ADMIN", createdAt: d("2026-05-02T03:00:00Z") },
  { status: "MOI", source: "facebook", centerId: "c1", commissionSource: "MARKETING_ADMIN", createdAt: d("2026-05-10T03:00:00Z") },
  { status: "DA_LIEN_HE", source: "zalo", centerId: "c1", commissionSource: "SALE_SELF", createdAt: d("2026-05-15T03:00:00Z") },
  { status: "DANG_TU_VAN", source: "zalo", centerId: "c2", commissionSource: "SALE_SELF", createdAt: d("2026-06-01T03:00:00Z") },
  { status: "DA_HEN_HOC_THU", source: "facebook", centerId: "c2", commissionSource: "REFERRAL", createdAt: d("2026-06-03T03:00:00Z") },
  { status: "DA_HOC_THU", source: "facebook", centerId: "c2", commissionSource: "REFERRAL", createdAt: d("2026-06-05T03:00:00Z") },
  { status: "CHO_QUYET_DINH", source: null, centerId: "c2", commissionSource: null, createdAt: d("2026-06-06T03:00:00Z") },
  { status: "DA_DANG_KY", source: "facebook", centerId: "c1", commissionSource: "MARKETING_ADMIN", createdAt: d("2026-06-07T03:00:00Z"), convertedAt: d("2026-06-08T03:00:00Z") },
  { status: "DA_DANG_KY", source: "zalo", centerId: "c2", commissionSource: "SALE_SELF", createdAt: d("2026-06-08T03:00:00Z"), convertedAt: d("2026-06-09T03:00:00Z") },
  { status: "DA_MAT", source: "zalo", centerId: "c1", commissionSource: "SALE_SELF", createdAt: d("2026-06-09T03:00:00Z") },
];

describe("[R7-17] monthKeyVN", () => {
  it("đổi sang giờ VN (UTC+7) trước khi lấy YYYY-MM", () => {
    // 2026-05-31T18:00:00Z = 2026-06-01 01:00 giờ VN → tháng 06.
    expect(monthKeyVN(d("2026-05-31T18:00:00Z"))).toBe("2026-06");
    expect(monthKeyVN(d("2026-05-02T03:00:00Z"))).toBe("2026-05");
  });
});

describe("[#10] groupByWeek — phễu lead theo tuần", () => {
  const now = d("2026-07-08T00:00:00Z");
  it("bucket 7 ngày, đếm tổng + chuyển đổi (REGISTERED/ENROLLED); ngoài cửa sổ → bỏ", () => {
    const recs: LeadReportRecord[] = [
      { status: "MOI", source: null, centerId: null, commissionSource: null, createdAt: d("2026-07-07T00:00:00Z") }, // tuần cuối (idx7)
      { status: "DA_DANG_KY", source: null, centerId: null, commissionSource: null, createdAt: d("2026-07-06T00:00:00Z") }, // idx7, converted
      { status: "MOI", source: null, centerId: null, commissionSource: null, createdAt: d("2026-06-30T00:00:00Z") }, // idx6
      { status: "DA_DANG_KY", source: null, centerId: null, commissionSource: null, createdAt: d("2026-05-01T00:00:00Z") }, // ngoài 8 tuần → bỏ
    ];
    const w = groupByWeek(recs, 8, now);
    expect(w).toHaveLength(8);
    expect(w.reduce((s, x) => s + x.total, 0)).toBe(3); // 3 trong cửa sổ, ENROLLED cũ bị loại
    expect(w[7]).toMatchObject({ total: 2, converted: 1 });
    expect(w[6]).toMatchObject({ total: 1, converted: 0 });
  });

  it("mảng rỗng → vẫn đủ N bucket số 0", () => {
    const w = groupByWeek([], 8, now);
    expect(w).toHaveLength(8);
    expect(w.every((x) => x.total === 0 && x.converted === 0)).toBe(true);
  });
});

describe("[R7-17] leadSummary", () => {
  it("tổng / chốt / tỷ lệ / hoạt động / thất bại", () => {
    const s = leadSummary(records);
    expect(s.total).toBe(10);
    expect(s.converted).toBe(2); // ENROLLED + REGISTERED
    expect(s.conversionRate).toBeCloseTo(0.2);
    expect(s.lost).toBe(1); // LOST
    expect(s.active).toBe(7); // 10 - 2 - 1
  });

  it("mảng rỗng → toàn số 0, không lỗi", () => {
    expect(leadSummary([])).toEqual({ total: 0, converted: 0, conversionRate: 0, active: 0, lost: 0 });
  });
});

describe("[R7-17] buildFunnel cumulative", () => {
  it("đếm lead đã chạm tới ít nhất mỗi bước; LOST không tính", () => {
    const f = buildFunnel(records);
    // GĐ5 — phễu còn 7 bậc (trước là 8): bậc "đã phân công" biến mất vì ASSIGNED gộp
    // vào MOI, việc phân công nay đọc ở `Lead.assignedToId` chứ không phải một bậc phễu.
    expect(f).toHaveLength(7);
    // 9 lead trong phễu (loại 1 lead DA_MAT, rank -1). Bậc đầu = mọi lead rank>=0.
    expect(f[0]).toMatchObject({ status: "MOI", count: 9 });
    // rank>=1: trừ 2 lead đang ở MOI → 7.
    expect(f[1]).toMatchObject({ status: "DA_LIEN_HE", count: 7 });
    expect(f[2]).toMatchObject({ status: "DANG_TU_VAN", count: 6 });
    expect(f[3]).toMatchObject({ status: "DA_HEN_HOC_THU", count: 5 });
    expect(f[4]).toMatchObject({ status: "DA_HOC_THU", count: 4 });
    expect(f[5]).toMatchObject({ status: "CHO_QUYET_DINH", count: 3 });
    // Bậc chốt gộp cả "đã đăng ký" lẫn "đã ghi danh" cũ → 2.
    expect(f[6]).toMatchObject({ status: "DA_DANG_KY", count: 2 });
  });
});

describe("[R7-17] funnelConversionRates", () => {
  it("tỷ lệ chuyển từng bước = count[i+1]/count[i]", () => {
    const rates = funnelConversionRates(buildFunnel(records));
    // 7 bậc ⇒ 6 khoảng chuyển.
    expect(rates).toHaveLength(6);
    expect(rates[0]).toMatchObject({ rate: 7 / 9 }); // Mới → Đã liên hệ
    expect(rates[5]).toMatchObject({ rate: 2 / 3 }); // Chờ quyết định → Đã đăng ký
  });

  it("chia 0 an toàn khi bước trước = 0", () => {
    const rates = funnelConversionRates(buildFunnel([]));
    expect(rates.every((r) => r.rate === 0)).toBe(true);
  });
});

describe("[R7-17] countByStatus", () => {
  it("đếm theo status hiện tại, sắp xếp giảm dần", () => {
    const counts = countByStatus(records);
    const map = Object.fromEntries(counts.map((c) => [c.status, c.count]));
    // GĐ5 — fixture nay có 2 lead ở MOI (một cái vốn là ASSIGNED) và 2 ở DA_DANG_KY
    // (một cái vốn là REGISTERED). Tổng vẫn 10.
    expect(map.MOI).toBe(2);
    expect(map.DA_MAT).toBe(1);
    expect(map.DA_DANG_KY).toBe(2);
    expect(counts.reduce((a, c) => a + c.count, 0)).toBe(10);
  });
});

describe("[R7-17] groupBySource", () => {
  it("nhóm theo nguồn + số chốt + tỷ lệ; null → Không rõ", () => {
    const g = groupBySource(records);
    const fb = g.find((x) => x.key === "facebook")!;
    expect(fb.total).toBe(5); // NEW, ASSIGNED, TRIAL_SCHEDULED, TRIAL_ATTENDED, ENROLLED
    expect(fb.converted).toBe(1); // chỉ ENROLLED
    const unknown = g.find((x) => x.label === "Không rõ");
    expect(unknown?.total).toBe(1); // AWAITING_DECISION source null
  });
});

describe("[R7-17] groupByCenter", () => {
  it("nhóm theo cơ sở + map tên", () => {
    const g = groupByCenter(records, { c1: "CS1", c2: "CS2" });
    const c1 = g.find((x) => x.key === "c1")!;
    const c2 = g.find((x) => x.key === "c2")!;
    expect(c1.total).toBe(5); // 5 lead ở c1
    expect(c2.total).toBe(5); // 5 lead ở c2
    expect(c1.label).toBe("CS1");
    expect(c2.converted).toBe(1); // REGISTERED ở c2
  });
});

describe("[R7-17] groupByCommissionSource", () => {
  it("nhóm theo nguồn hoa hồng + nhãn VI", () => {
    const g = groupByCommissionSource(records);
    const sale = g.find((x) => x.key === "SALE_SELF")!;
    expect(sale.label).toBe("Sale tự khai thác");
    expect(sale.total).toBe(4); // CONTACTED, CONSULTING, REGISTERED, LOST
    expect(sale.converted).toBe(1); // REGISTERED
  });
});

describe("[R7-17] groupByMonth", () => {
  it("nhóm theo tháng VN, tăng dần", () => {
    const g = groupByMonth(records);
    expect(g.map((x) => x.month)).toEqual(["2026-05", "2026-06"]);
    expect(g[0].total).toBe(3); // 3 lead tháng 5
    expect(g[1].total).toBe(7); // 7 lead tháng 6
    expect(g[1].converted).toBe(2); // ENROLLED + REGISTERED tháng 6
  });
});

describe("[R7-17] buildLeadReport tổng hợp", () => {
  it("gộp đủ các nhóm; rỗng → không lỗi", () => {
    const r = buildLeadReport(records, { c1: "CS1", c2: "CS2" });
    expect(r.summary.total).toBe(10);
    expect(r.funnel).toHaveLength(7); // GĐ5 — 7 bậc, xem [R7-17] buildFunnel cumulative
    expect(r.byCenter).toHaveLength(2);
    const empty = buildLeadReport([]);
    expect(empty.summary.total).toBe(0);
    expect(empty.funnel.every((f) => f.count === 0)).toBe(true);
    expect(empty.byMonth).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// groupByDropStage — người đọc đầu tiên của Lead.droppedAtStage; lý do đọc ở Lead.lostNote.
// ─────────────────────────────────────────────────────────────────────────────
describe("groupByDropStage — lead rụng ở bậc nào, vì sao", () => {
  const rec = (
    droppedAtStage: string | null,
    lostNote: string | null,
  ): LeadReportRecord => ({
    status: droppedAtStage ? "DA_MAT" : "MOI",
    source: null,
    centerId: null,
    commissionSource: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    convertedAt: null,
    droppedAtStage,
    lostNote,
  });

  it("bỏ qua lead CÒN trong phễu (droppedAtStage null)", () => {
    expect(groupByDropStage([rec(null, null), rec(null, "gì đó")])).toEqual([]);
  });

  it("gom theo bậc và xếp bậc rụng nhiều nhất lên đầu", () => {
    const r = groupByDropStage([
      rec("DANG_TU_VAN", "học phí cao"),
      rec("DANG_TU_VAN", "học phí cao"),
      rec("DA_HOC_THU", "con không thích"),
    ]);
    expect(r.map((x) => [x.stage, x.count])).toEqual([
      ["DANG_TU_VAN", 2],
      ["DA_HOC_THU", 1],
    ]);
  });

  it("gộp lý do trùng và đếm đúng số lần", () => {
    const r = groupByDropStage([
      rec("DANG_TU_VAN", "học phí cao"),
      rec("DANG_TU_VAN", "học phí cao"),
      rec("DANG_TU_VAN", "xa nhà"),
    ]);
    expect(r[0].topReasons).toEqual([
      { reason: "học phí cao", count: 2 },
      { reason: "xa nhà", count: 1 },
    ]);
  });

  it("giữ tối đa 5 lý do — bảng báo cáo không phải nơi đổ hết dữ liệu thô", () => {
    const r = groupByDropStage(
      Array.from({ length: 8 }, (_, i) => rec("DA_MAT", `lý do ${i}`)),
    );
    expect(r[0].topReasons).toHaveLength(5);
  });

  it("lead rụng KHÔNG có lý do đếm riêng, không lẫn vào topReasons", () => {
    // Đây là lead rụng TRƯỚC ngày bật ép nhập lý do — khác hẳn "bỏ trống".
    const r = groupByDropStage([
      rec("DA_MAT", null),
      rec("DA_MAT", "   "), // khoảng trắng không phải lý do
      rec("DA_MAT", "đã chọn nơi khác"),
    ]);
    expect(r[0].missingReason).toBe(2);
    expect(r[0].topReasons).toEqual([{ reason: "đã chọn nơi khác", count: 1 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildFunnelReached — phễu "ĐÃ TỪNG TỚI", đọc từ sổ `LeadStatusHistory` (GĐ1).
//
// Bệnh mà nó chữa: `buildFunnel` đếm bằng trạng thái HIỆN TẠI, nên lead từng lên tới
// "Đã học thử" rồi rớt (`DA_MAT`, rank -1) biến mất khỏi MỌI bậc — kể cả những bậc nó
// đã thật sự đi qua. Nặng hơn con số phễu là mẫu số: `funnelConversionRates` mất luôn
// phần rụng ⇒ tỷ lệ chuyển đổi bị thổi lên và trông rất đẹp.
describe("[GĐ1] buildFunnelReached — lead đã rụng vẫn phải đếm ở bậc nó từng đi qua", () => {
  it("lead rớt nhưng sổ ghi từng tới DA_HOC_THU → đếm tới bậc 4, không quá", () => {
    const recs: LeadReportRecord[] = [
      { id: "l1", status: "DA_MAT", source: null, centerId: "c1", commissionSource: null, createdAt: d("2026-08-26T03:00:00Z") },
    ];
    const so: LeadLedgerRow[] = [
      { leadId: "l1", toStatus: "DA_LIEN_HE" },
      { leadId: "l1", toStatus: "DA_HOC_THU" },
      { leadId: "l1", toStatus: "DA_MAT" },
    ];
    const f = buildFunnelReached(recs, so);
    expect(f.map((x) => x.count)).toEqual([1, 1, 1, 1, 1, 0, 0]);
    // Đối chứng: cách cũ vứt lead này khỏi mọi bậc.
    expect(buildFunnel(recs).map((x) => x.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("lead KHÔNG có dòng sổ nào → rơi về trạng thái hiện tại, không hồi quy", () => {
    // Sổ CỐ Ý không backfill (migration 20260825120000), nên toàn bộ lead trước 25/08
    // đi đường này. Kết quả phải TRÙNG KHÍT cách tính cũ, nếu không là đổi số báo cáo
    // của quá khứ mà không ai yêu cầu.
    expect(buildFunnelReached(records, []).map((x) => x.count)).toEqual(
      buildFunnel(records).map((x) => x.count),
    );
  });

  it("sổ ghi bậc THẤP hơn trạng thái hiện tại → lấy bậc cao nhất, không tụt", () => {
    const recs: LeadReportRecord[] = [
      { id: "l1", status: "DA_DANG_KY", source: null, centerId: null, commissionSource: null, createdAt: d("2026-08-26T03:00:00Z") },
    ];
    const f = buildFunnelReached(recs, [{ leadId: "l1", toStatus: "DA_LIEN_HE" }]);
    expect(f.map((x) => x.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("bất biến: mỗi bậc KHÔNG BAO GIỜ nhỏ hơn cách đếm cũ", () => {
    // "Đã từng tới" là tập cha của "đang ở". Bậc nào tụt xuống nghĩa là hàm đã đánh
    // rơi lead — lớp lỗi nguy hiểm nhất ở đây vì biểu đồ vẫn vẽ ra số trông bình thường.
    const recs: LeadReportRecord[] = records.map((r, i) => ({ ...r, id: `l${i}` }));
    const so: LeadLedgerRow[] = [
      { leadId: "l9", toStatus: "DA_HEN_HOC_THU" },
      { leadId: "l0", toStatus: "MOI" },
    ];
    const moi = buildFunnelReached(recs, so).map((x) => x.count);
    const cu = buildFunnel(recs).map((x) => x.count);
    moi.forEach((n, i) => expect(n, `bậc ${i}`).toBeGreaterThanOrEqual(cu[i]));
  });

  it("dòng sổ mang status lạ (enum đổi tên) bị bỏ qua, KHÔNG kéo lead tụt bậc", () => {
    const recs: LeadReportRecord[] = [
      { id: "l1", status: "DA_HOC_THU", source: null, centerId: null, commissionSource: null, createdAt: d("2026-08-26T03:00:00Z") },
    ];
    const f = buildFunnelReached(recs, [{ leadId: "l1", toStatus: "TRIAL_ATTENDED_CU" }]);
    expect(f.map((x) => x.count)).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });

  it("ledgerCoverage đếm được bao nhiêu lead có sổ — số để ghi chú thích mốc 25/08", () => {
    const recs: LeadReportRecord[] = [
      { id: "l1", status: "MOI", source: null, centerId: null, commissionSource: null, createdAt: d("2026-08-26T03:00:00Z") },
      { id: "l2", status: "MOI", source: null, centerId: null, commissionSource: null, createdAt: d("2026-08-26T03:00:00Z") },
      { status: "MOI", source: null, centerId: null, commissionSource: null, createdAt: d("2026-05-01T03:00:00Z") },
    ];
    expect(ledgerCoverage(recs, [{ leadId: "l1", toStatus: "DA_LIEN_HE" }])).toEqual({
      coSo: 1,
      khongCoSo: 2,
    });
  });
});
