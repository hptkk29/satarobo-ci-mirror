// Task #07 Việc 1 — unit test parser + planner import danh sách "khách ĐÃ ĐĂNG KÝ".
//
// Fixture TỰ TẠO mô phỏng đúng cấu trúc file thật (KHÔNG commit file thật — PII):
// - 3 sheet theo tháng; sheet Tháng 6 TÍCH LŨY data Tháng 5 (dedupe cross-sheet).
// - Tháng 5: header ở ROW 2 (17 cột, không có Nguồn/Ghi chú/Đã xuất hoá đơn).
// - Tháng 6/7: header ở ROW 1, thêm cột + cột trống chen giữa.
// - Data bẩn thật: SĐT trailing space / number mất số 0 đầu; học phí lẫn number
//   + chuỗi "4.640.000đ" (+ typo "1.000.0000Đ"); mã HV "CS1.HV0032" thiếu dấu chấm;
//   CCCD PH có chỗ ghi chữ; ~dòng STT đánh số sẵn nhưng trống.
import { describe, it, expect } from "vitest";
import {
  parseRegisteredSheets,
  planRegisteredImport,
  splitMergesByScope,
  type LeadMergePlan,
  matchSalesUser,
  buildCourseKeyMap,
  normalizeRegisteredPhone,
  normalizeStudentCode,
  extractCenterCode,
  formatExcelDate,
  normalizeVi,
  IMPORT_NOTE_MARKER,
  type SheetAoA,
  type PlanContext,
} from "./import-registered";

const HDR_T5 = [
  "STT", "Ngày", "MÃ HỌC VIÊN", "Họ và Tên học viên", "Lớp", "Số điện thoại",
  "Khoá học đăng ký", "Học phí", "Cơ sở", "Tình trạng", "Sales",
  "Hoá đơn học phí", "Ngân hàng", "CCCD Học viên", "Tên Phụ Huynh",
  "CCCD Phụ Huynh", "Địa chỉ",
];
const HDR_T6 = [
  "STT", "Ngày", "MÃ HỌC VIÊN", "Họ và Tên học viên", "Lớp", "Số điện thoại",
  "Nguồn", "Khoá học đăng ký", "Học phí", "Cơ sở", "Tình trạng", "Sales",
  "Ghi chú", "Hoá đơn đóng học phí", null, "Ngân hàng", "CCCD Học viên",
  "Tên Phụ Huynh", "CCCD Phụ Huynh", "Địa chỉ", "Đã xuất hoá đơn",
];

function fixture(): SheetAoA[] {
  return [
    {
      name: "Tháng 52026",
      rows: [
        Array(17).fill(null), // row 1 trống — header thật ở row 2
        HDR_T5,
        // 2 con cùng 1 SĐT (1 PH nhiều con) — thiếu tên PH ở sheet này.
        [1, null, "CS2.HV.0001", "HV MỘT", "Lớp 7", "0905000001", "Combo luyện thi", 3986000, "CS2: Hoàng Diệu", "Đã thanh toán", "Liên", null, "MB", "048000000000", null, null, null],
        [2, null, "CS2.HV.0002", "HV HAI", "Lớp 5", "0905000001", "Sata 4", 8640000, "CS2: Hoàng Diệu", "Đã thanh toán", "Liên", null, "MB", null, null, null, null],
        // SĐT trailing space.
        [3, null, "CS1.HV.0001", "HV BA", "Lớp 3", "0915000002 ", "Sata 4", 8640000, "CS1: N.Hữu Thọ", "Đã thanh toán", "Vân", null, "MB", null, "PH Ba", "048000000003", "Địa chỉ Ba"],
        // SĐT sai → lỗi.
        [4, null, "CS1.HV.0002", "HV LỖI", "Lớp 3", "12345", "Sata 1", 1440000, "CS1: N.Hữu Thọ", "Đã thanh toán", "Toại", null, null, null, null, null, null],
        // Dòng STT đánh số sẵn nhưng trống → bỏ qua.
        [5, null, "", null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ],
    },
    {
      name: "Tháng 62026",
      rows: [
        HDR_T6,
        // LẶP lại data Tháng 5 (tích lũy) — nhưng BỔ SUNG tên PH + Nguồn + ngày (serial 45292 = 01/01/2024).
        [1, 45292, "CS2.HV.0001", "HV MỘT", "Lớp 7", "0905000001", "Form", "Combo luyện thi", 3986000, "CS2: Hoàng Diệu", "Đã thanh toán", "Liên", null, "MB", null, "MB", null, "PH MỘT HAI", "048000000001", "Địa chỉ Một", "R"],
        [2, null, "CS2.HV.0002", "HV HAI", "Lớp 5", "0905000001", "Ads", "Sata 4", 8640000, "CS2: Hoàng Diệu", "Đã thanh toán", "Liên", "cash đã đưa", null, null, null, null, "PH MỘT HAI", "048000000001", null, null],
        // Record mới: mã HV thiếu dấu chấm + học phí chuỗi + CCCD PH ghi chữ.
        [3, null, "CS1.HV0032", "HV BỐN", "Lớp 3", "0905000004", "Website", "Sata 4", "4.640.000đ", "CS1: N.Hữu Thọ", "Đã thanh toán", "Nhật Hạ", "cuối tháng full phí", null, null, null, null, null, "không xin được thông tin", null, null],
      ],
    },
    {
      name: "Tháng 72026",
      rows: [
        HDR_T6,
        // SĐT bị Excel lưu number → mất số 0 đầu; cơ sở trống → suy từ mã HV; học phí typo giữ nguyên.
        [1, null, "CS2.HV.0031", "HV NĂM", "Lớp 6", 938000005, "Organic", "Sata 4", "1.000.0000Đ", null, "Đã thanh toán", "My", null, null, null, "MB", null, "PH Năm", "048000000005", "Địa chỉ Năm", "R"],
        // ~dòng trống đánh số sẵn.
        [2, null, "", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        [3, null, "", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        [4, null, "", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ],
    },
  ];
}

describe("helpers", () => {
  it("normalizeRegisteredPhone — trailing space / +84 / number mất số 0 đầu", () => {
    expect(normalizeRegisteredPhone("0915942357 ")).toBe("84915942357");
    expect(normalizeRegisteredPhone("+84 905 000 001")).toBe("84905000001");
    expect(normalizeRegisteredPhone(938000005)).toBe("84938000005");
  });

  it("normalizeStudentCode — vá thiếu dấu chấm, format lạ giữ raw", () => {
    expect(normalizeStudentCode("CS1.HV.0031")).toBe("CS1.HV.0031");
    expect(normalizeStudentCode("CS1.HV0032")).toBe("CS1.HV.0032");
    expect(normalizeStudentCode("cs2.hv.0001")).toBe("CS2.HV.0001");
    expect(normalizeStudentCode("ABC-123")).toBe("ABC-123");
    expect(normalizeStudentCode("")).toBeNull();
  });

  it("extractCenterCode — từ cột Cơ sở, fallback mã HV", () => {
    expect(extractCenterCode("CS2: Hoàng Diệu", null)).toBe("CS2");
    expect(extractCenterCode("cs1: N.Hữu Thọ", null)).toBe("CS1");
    expect(extractCenterCode(null, "CS1.HV.0031")).toBe("CS1");
    expect(extractCenterCode(null, null)).toBeNull();
  });

  it("formatExcelDate — serial làm tròn về ngày (45292 = 01/01/2024)", () => {
    expect(formatExcelDate(45292)).toBe("01/01/2024");
    expect(formatExcelDate(45291.999)).toBe("01/01/2024");
    expect(formatExcelDate("05/06/2026")).toBe("05/06/2026");
    expect(formatExcelDate(null)).toBeNull();
  });

  it("matchSalesUser — tên ngắn khớp ĐUÔI tên đầy đủ, duy nhất mới nhận", () => {
    const users = [
      { id: "u1", name: "Nguyễn Thị Liên", roles: ["SALES_CSM"] },
      { id: "u2", name: "Trần Nhật Hạ", roles: ["SALES_CSM"] },
      { id: "u3", name: "Lê Văn Toại", roles: ["CENTER_MANAGER"] },
      { id: "u4", name: "Phạm Mỹ Vân", roles: ["SALES_CSM"] },
      { id: "u5", name: "Hoàng Thảo Vân", roles: ["SALES_CSM"] },
    ];
    expect(matchSalesUser("Liên", users)?.id).toBe("u1");
    expect(matchSalesUser("Nhật Hạ", users)?.id).toBe("u2");
    expect(matchSalesUser("toại", users)?.id).toBe("u3");
    expect(matchSalesUser("Vân", users)).toBeNull(); // mơ hồ (2 user cùng role sale) → null
    expect(matchSalesUser("Diệu", users)).toBeNull(); // không có → null
  });

  it("matchSalesUser — mơ hồ nhưng chỉ 1 user role bán hàng → tie-break theo role", () => {
    const users = [
      { id: "u-teacher", name: "Đoàn Thị Mỹ Diệu", roles: ["TEACHER"] },
      { id: "u-sales", name: "Huỳnh Thị Diệu", roles: ["SALES_CSM"] },
      { id: "u-hr", name: "Trần Thị Thúy Liên", roles: ["HR"] },
      { id: "u-cm", name: "Lê Thị Phương Liên", roles: ["CENTER_MANAGER"] },
    ];
    expect(matchSalesUser("Diệu", users)?.id).toBe("u-sales"); // TEACHER bị loại
    expect(matchSalesUser("Liên", users)?.id).toBe("u-cm"); // HR bị loại, CM bán được
  });
});

describe("parseRegisteredSheets — fixture mô phỏng file thật", () => {
  const parsed = parseRegisteredSheets(fixture());

  it("detect header ở row 2 (Tháng 5) và row 1 (Tháng 6/7), đếm đúng", () => {
    // Tháng 5: 5 dòng data (2+2 hợp lệ? → 4 dòng có nội dung: 3 hợp lệ + 1 lỗi + 1 trống)
    // Tháng 6: 3 dòng; Tháng 7: 4 dòng (1 thật + 3 trống).
    expect(parsed.totalDataRows).toBe(5 + 3 + 4);
    expect(parsed.skippedEmpty).toBe(1 + 0 + 3);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ sheet: "Tháng 52026", row: 6 });
    expect(parsed.errors[0].reason).toContain("SĐT không hợp lệ");
    // hợp lệ: T5 = 3, T6 = 3, T7 = 1.
    expect(parsed.validRows).toBe(7);
  });

  it("dedupe cross-sheet: sheet Tháng 6 lặp Tháng 5 → gộp, đắp field trống", () => {
    expect(parsed.mergedDuplicateRows).toBe(2); // HV MỘT + HV HAI lặp lại ở T6
    const p1 = parsed.parents.find((p) => p.phone === "84905000001");
    expect(p1).toBeDefined();
    // Tên PH thiếu ở T5, bổ sung từ T6.
    expect(p1?.parentName).toBe("PH MỘT HAI");
    expect(p1?.parentCccd).toBe("048000000001");
    expect(p1?.source).toBe("Form");
    // Ngày từ serial number → dd/mm/yyyy.
    const child1 = p1?.children.find((c) => c.fullName === "HV MỘT");
    expect(child1?.dateRegistered).toBe("01/01/2024");
    expect(child1?.sources).toHaveLength(2); // xuất hiện ở 2 sheet
  });

  it("1 PH nhiều con: cùng SĐT + khác tên → 1 parent 2 children", () => {
    const p1 = parsed.parents.find((p) => p.phone === "84905000001");
    expect(p1?.children.map((c) => c.fullName).sort()).toEqual(["HV HAI", "HV MỘT"]);
    // Tổng: 0905000001 (2 con), 0915000002 (HV BA), 0905000004 (HV BỐN), 0938000005 (HV NĂM).
    expect(parsed.parents).toHaveLength(4);
  });

  it("data bẩn: mã HV vá dấu chấm, học phí giữ NGUYÊN chuỗi (kể cả typo), CCCD PH ghi chữ giữ raw", () => {
    const p4 = parsed.parents.find((p) => p.phone === "84905000004");
    expect(p4?.children[0].studentCodeOld).toBe("CS1.HV.0032");
    expect(p4?.children[0].tuitionRaw).toBe("4.640.000đ");
    expect(p4?.parentCccd).toBe("không xin được thông tin");
    const p5 = parsed.parents.find((p) => p.phone === "84938000005");
    expect(p5?.children[0].tuitionRaw).toBe("1.000.0000Đ"); // KHÔNG tự sửa tiền
    expect(p5?.children[0].centerCode).toBe("CS2"); // suy từ mã HV khi cột Cơ sở trống
    const p1 = parsed.parents.find((p) => p.phone === "84905000001");
    expect(p1?.children[0].tuitionRaw).toBe("3986000"); // number → chuỗi số nguyên
  });

  it("CCCD Học viên KHÔNG được import (không xuất hiện bất kỳ đâu trong output)", () => {
    // T5 row đầu có CCCD Học viên "048000000000" — parser phải bỏ.
    expect(JSON.stringify(parsed)).not.toContain("048000000000");
  });
});

describe("planRegisteredImport — create/merge + idempotent", () => {
  const parsed = parseRegisteredSheets(fixture());
  const baseCtx = (): PlanContext => ({
    centerByCode: new Map([
      ["CS1", "co-so-nguyen-huu-tho"],
      ["CS2", "co-so-hoang-dieu"],
    ]),
    orgUnitByCode: new Map([
      ["CS1", "org-cs1"],
      ["CS2", "org-cs2"],
    ]),
    courseByKey: new Map([
      [normalizeVi("Sata 4"), "course-sata4"],
      [normalizeVi("Combo luyện thi"), "course-combo"],
    ]),
    salesUsers: [
      { id: "u-lien", name: "Nguyễn Thị Liên", roles: ["SALES_CSM"] },
      { id: "u-nhatha", name: "Trần Nhật Hạ", roles: ["SALES_CSM"] },
    ],
    existingByPhone: new Map(),
  });

  it("buildCourseKeyMap — khớp 'Sata 4' (file) với slug 'sata4' / tên 'Sata4 — …' (DB)", () => {
    const map = buildCourseKeyMap([
      { id: "c-sata4", name: "Sata4 — Bứt Phá Giới Hạn", slug: "sata4" },
      { id: "c-combo", name: "Combo — Full Lộ Trình Luyện Thi", slug: "combo-luyen-thi" },
    ]);
    const ctx = baseCtx();
    ctx.courseByKey = map;
    const plan = planRegisteredImport(parsed, ctx);
    expect(plan.unmatchedCourses).toEqual([]); // "Sata 4"/"Combo luyện thi" đều khớp qua compactKey
    const c1 = plan.creates.find((c) => c.phone === "84905000001");
    expect(c1?.children.map((ch) => ch.interestedCourseId).sort()).toEqual([
      "c-combo",
      "c-sata4",
    ]);
  });

  it("tạo mới: map center/course/sales; thiếu tên PH → fallback rõ ràng", () => {
    const plan = planRegisteredImport(parsed, baseCtx());
    expect(plan.creates).toHaveLength(4);
    expect(plan.merges).toHaveLength(0);

    const c1 = plan.creates.find((c) => c.phone === "84905000001");
    expect(c1?.parentName).toBe("PH MỘT HAI");
    expect(c1?.centerId).toBe("co-so-hoang-dieu");
    expect(c1?.orgUnitId).toBe("org-cs2");
    expect(c1?.assignedToId).toBe("u-lien");
    expect(c1?.children).toHaveLength(2);
    // 2 con 2 khoá khác nhau → KHÔNG set courseId ở lead, chỉ ở từng con.
    expect(c1?.courseId).toBeNull();
    expect(c1?.children.map((ch) => ch.interestedCourseId).sort()).toEqual([
      "course-combo",
      "course-sata4",
    ]);
    // Note có cấu trúc: marker + CCCD PH + mã HV cũ trong note con.
    expect(c1?.note).toContain(IMPORT_NOTE_MARKER);
    expect(c1?.note).toContain("CCCD PH: 048000000001");
    expect(c1?.children[0].note).toContain("Mã HV cũ: CS2.HV.0001");
    expect(c1?.children[0].note).toContain("Tình trạng TT: Đã thanh toán");

    // Sales "Vân"/"My" không khớp → assignee trống + tên giữ trong note.
    const p3 = plan.creates.find((c) => c.phone === "84915000002");
    expect(p3?.assignedToId).toBeNull();
    expect(p3?.note).toContain("Sales: Vân");
    expect(plan.unmatchedSales.sort()).toEqual(["My", "Vân"]);
  });

  it("gộp lead có sẵn: đắp field trống, nâng status → REGISTERED, thêm con thiếu", () => {
    const ctx = baseCtx();
    ctx.existingByPhone.set("84905000001", {
      id: "lead-1",
      parentName: "PH Cũ",
      phone: "84905000001",
      status: "DANG_TU_VAN",
      note: "Ghi chú cũ",
      centerId: null,
      orgUnitId: null,
      courseId: null,
      assignedToId: "u-khac", // đã có Sale → KHÔNG ghi đè
      children: [
        { id: "child-1", fullName: "hv một", gradeLevel: null, ageYears: null, note: null, interestedCourseId: null, interestedCenterId: null },
      ],
    });
    const plan = planRegisteredImport(parsed, ctx);
    const m = plan.merges.find((x) => x.phone === "84905000001");
    expect(m?.changed).toBe(true);
    expect(m?.set.status).toBe("DA_DANG_KY");
    expect(m?.set.centerId).toBe("co-so-hoang-dieu");
    expect(m?.set.assignedToId).toBeUndefined(); // giữ Sale cũ (câu 34: giữ record cũ)
    expect(m?.noteAppend).toContain(IMPORT_NOTE_MARKER);
    // "hv một" đã có (so tên bỏ dấu/hoa thường) → chỉ tạo con còn thiếu "HV HAI".
    expect(m?.newChildren.map((c) => c.fullName)).toEqual(["HV HAI"]);
    // Con đã có được đắp field trống (lớp + khoá + note).
    expect(m?.childUpdates).toHaveLength(1);
    expect(m?.childUpdates[0].set.gradeLevel).toBe("Lớp 7");
  });

  it("idempotent: import lại (record đã mang đủ data + note import) → changed=false", () => {
    const ctx = baseCtx();
    const first = planRegisteredImport(parsed, ctx);
    const c1 = first.creates.find((c) => c.phone === "84905000001");
    if (!c1) throw new Error("missing create plan");
    // Mô phỏng DB sau lần import 1: lead đã tồn tại đúng như create plan.
    ctx.existingByPhone.set("84905000001", {
      id: "lead-1",
      parentName: c1.parentName,
      phone: c1.phone,
      status: "DA_DANG_KY",
      note: c1.note,
      centerId: c1.centerId,
      orgUnitId: c1.orgUnitId,
      courseId: c1.courseId,
      assignedToId: c1.assignedToId,
      children: c1.children.map((ch, i) => ({
        id: `child-${i}`,
        fullName: ch.fullName,
        gradeLevel: ch.gradeLevel,
        ageYears: ch.ageYears, // record cũ đã mang đủ data → gồm cả tuổi
        note: ch.note,
        interestedCourseId: ch.interestedCourseId,
        interestedCenterId: ch.interestedCenterId,
      })),
    });
    const second = planRegisteredImport(parsed, ctx);
    const m = second.merges.find((x) => x.phone === "84905000001");
    expect(m?.changed).toBe(false); // 0 record mới, 0 note lặp
    expect(m?.newChildren).toHaveLength(0);
    expect(m?.noteAppend).toBeNull();
    expect(m?.childUpdates).toHaveLength(0);
  });

  it("ENROLLED/DUPLICATE không bị hạ/nâng status", () => {
    const ctx = baseCtx();
    ctx.existingByPhone.set("84905000004", {
      id: "lead-4",
      parentName: "PH Bốn",
      phone: "84905000004",
      status: "DA_DANG_KY",
      note: null,
      centerId: "co-so-nguyen-huu-tho",
      orgUnitId: "org-cs1",
      courseId: "course-sata4",
      assignedToId: null,
      children: [],
    });
    const plan = planRegisteredImport(parsed, ctx);
    const m = plan.merges.find((x) => x.phone === "84905000004");
    expect(m?.set.status).toBeUndefined();
  });

  it("cơ sở/khoá không khớp DB → báo trong unmatched, không chặn import", () => {
    const ctx = baseCtx();
    ctx.centerByCode.delete("CS2");
    ctx.orgUnitByCode.delete("CS2");
    ctx.courseByKey.delete(normalizeVi("Sata 4"));
    const plan = planRegisteredImport(parsed, ctx);
    expect(plan.unmatchedCenters).toEqual(["CS2"]);
    expect(plan.unmatchedCourses).toEqual(["Sata 4"]);
    expect(plan.creates).toHaveLength(4); // vẫn tạo, thông tin raw nằm trong note
  });
});

// ─── Câu 34 — chặn gộp cross-center (user chốt 09/07/2026) ────────────────────
describe("splitMergesByScope — SĐT trùng lead cơ sở khác thì KHÔNG gộp", () => {
  const merge = (phone: string): LeadMergePlan => ({
    leadId: `lead-${phone}`,
    phone,
    parentName: `PH ${phone}`,
    set: {},
    newChildren: [],
    childUpdates: [],
    noteAppend: null,
    changed: true,
  });
  const inScopeCs1 = (centerId: string) => centerId === "CS1";

  it("lead cũ cùng cơ sở → cho gộp", () => {
    const r = splitMergesByScope([merge("0900000001")], new Map([["0900000001", "CS1"]]), inScopeCs1);
    expect(r.allowed).toHaveLength(1);
    expect(r.rejectedPhones).toEqual([]);
  });

  it("lead cũ thuộc cơ sở KHÁC → chặn, chỉ trả SĐT", () => {
    const r = splitMergesByScope([merge("0900000002")], new Map([["0900000002", "CS2"]]), inScopeCs1);
    expect(r.allowed).toEqual([]);
    expect(r.rejectedPhones).toEqual(["0900000002"]);
  });

  it("lead untagged (centerId null) → vẫn gộp, chưa thuộc cơ sở nào", () => {
    const r = splitMergesByScope([merge("0900000003")], new Map([["0900000003", null]]), inScopeCs1);
    expect(r.allowed).toHaveLength(1);
    expect(r.rejectedPhones).toEqual([]);
  });

  it("không tìm thấy lead cũ → không chặn (planner sẽ xử lý như tạo mới)", () => {
    const r = splitMergesByScope([merge("0900000004")], new Map(), inScopeCs1);
    expect(r.allowed).toHaveLength(1);
  });

  it("trộn nhiều dòng: chỉ dòng cơ sở khác bị loại", () => {
    const r = splitMergesByScope(
      [merge("0900000001"), merge("0900000002"), merge("0900000003")],
      new Map([
        ["0900000001", "CS1"],
        ["0900000002", "CS2"],
        ["0900000003", null],
      ]),
      inScopeCs1,
    );
    expect(r.allowed.map((m) => m.phone)).toEqual(["0900000001", "0900000003"]);
    expect(r.rejectedPhones).toEqual(["0900000002"]);
  });
});
