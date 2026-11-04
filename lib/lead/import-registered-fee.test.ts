// Luật chủ dự án chốt 04/08 cho file "Danh sách đăng ký" của Sale:
//  · tuổi = lớp + 5 (lớp 1 = 6 tuổi)
//  · cột Học phí là SỐ ĐÃ ĐÓNG; không có ghi chú 50% ⇒ đã đóng đủ, công nợ 0
// Đây là chỗ đụng tiền của 102 hồ sơ thật nên khoá bằng test, không tin mắt.
import { describe, it, expect } from "vitest";
import {
  ageFromGrade,
  parseTuitionAmount,
  feeModeFromNote,
  paidAmountFromNote,
  parseRegisteredSheets,
  discountFromNote,
  payIn2FromNoteTag,
  PAID_NOTE_TAG,
  DISCOUNT_NOTE_TAG,
  DISCOUNT_REASON_TAG,
  PAY2_NOTE_TAG,
  dueDate2FromNote,
  DUE2_NOTE_TAG,
  parentDisplayName,
  isPlaceholderParentName,
  contactFromLeadNote,
  planStudentSync,
  CROSS_SHEET_FEE_WARNING,
} from "./import-registered";

// Chủ dự án chốt 05/08: file không ghi tên PH → điền "Phụ huynh của <tên con>".
// Rất nhiều dòng thật chỉ có SĐT; để trống thì CRM đầy lead không tên.
describe("parentDisplayName", () => {
  const ch = (...names: string[]) => names.map((fullName) => ({ fullName }));

  it("có tên thật → giữ nguyên, không đụng vào", () => {
    expect(parentDisplayName("Lisa Dương Hà", ch("HOÀNG VĨNH KHANG"), "0905")).toBe("Lisa Dương Hà");
  });

  it("không tên + 1 con → 'Phụ huynh của <con>'", () => {
    expect(parentDisplayName(null, ch("VÕ NGUYÊN KHANG"), "84914324318")).toBe(
      "Phụ huynh của VÕ NGUYÊN KHANG",
    );
  });

  it("không tên + 2 con → nêu đủ cả hai", () => {
    expect(parentDisplayName("", ch("Đoàn Thanh Tra", "Nguyễn Phạm Gia Huy"), "0937")).toBe(
      "Phụ huynh của Đoàn Thanh Tra và Nguyễn Phạm Gia Huy",
    );
  });

  it("không tên + ≥3 con → rút gọn cho khỏi dài", () => {
    expect(parentDisplayName(null, ch("A", "B", "C"), "0937")).toBe("Phụ huynh của A và 2 em khác");
  });

  it("tên chỉ có khoảng trắng → coi như trống", () => {
    expect(parentDisplayName("   ", ch("Bé A"), "0937")).toBe("Phụ huynh của Bé A");
  });

  it("không cả tên con → lấy SĐT làm mốc, không trả chuỗi cụt", () => {
    expect(parentDisplayName(null, [], "84905285992")).toBe("Phụ huynh của 84905285992");
  });
});

// Chủ dự án chốt 05/08: thông tin nhập vào phải GỘP với lead + học viên đang có.
describe("isPlaceholderParentName", () => {
  it("tên hệ thống tự điền (cả dạng cũ) → nhận ra được", () => {
    expect(isPlaceholderParentName("Phụ huynh của BÉ A")).toBe(true);
    expect(isPlaceholderParentName("PH của BÉ A (chưa rõ tên)")).toBe(true); // dạng trước 05/08
  });

  it("tên người thật → KHÔNG coi là tự điền (để không bị đè)", () => {
    expect(isPlaceholderParentName("Lisa Dương Hà")).toBe(false);
    expect(isPlaceholderParentName("Hồ Đắc Phúc")).toBe(false);
    expect(isPlaceholderParentName(null)).toBe(false);
  });

  it("tên thật lỡ chứa chữ 'phụ huynh' ở giữa → vẫn là tên thật", () => {
    expect(isPlaceholderParentName("Chị Lan phụ huynh của bé Bo")).toBe(false);
  });

  it("dạng cũ được nhận ra để chuẩn hoá về dạng mới", () => {
    // Ca thật thấy trên DB sau lượt nhập 05/08: lead từ import trước mang tên
    // "PH của THÁI THIÊN KHÁNH (chưa rõ tên)" nằm lẫn với "Phụ huynh của …".
    const cu = "PH của THÁI THIÊN KHÁNH (chưa rõ tên)";
    expect(isPlaceholderParentName(cu)).toBe(true);
    expect(parentDisplayName(null, [{ fullName: "THÁI THIÊN KHÁNH" }], "0968")).toBe(
      "Phụ huynh của THÁI THIÊN KHÁNH",
    );
  });
});

describe("contactFromLeadNote", () => {
  const note = "[Import ĐK Excel] Sales: Lộc · CCCD PH: 048188002983 · Địa chỉ: 368/85 Hoàng Diệu";

  it("đọc lại được CCCD và địa chỉ import đã ghi vào note", () => {
    expect(contactFromLeadNote(note)).toEqual({
      cccd: "048188002983",
      address: "368/85 Hoàng Diệu",
    });
  });

  it("cắt đúng ở dấu phân cách, không nuốt sang mảnh sau", () => {
    const n = "[Import ĐK Excel] CCCD PH: 123 · Địa chỉ: Số 1 Lê Lợi · Ghi chú: abc";
    expect(contactFromLeadNote(n).address).toBe("Số 1 Lê Lợi");
  });

  it("note không có 2 trường đó → null, không trả chuỗi rỗng", () => {
    expect(contactFromLeadNote("[Import ĐK Excel] Sales: Lộc")).toEqual({
      cccd: null,
      address: null,
    });
    expect(contactFromLeadNote(null)).toEqual({ cccd: null, address: null });
  });

  it("giữ nguyên giá trị chữ (file thật có ô ghi 'không xin được thông tin')", () => {
    expect(contactFromLeadNote("CCCD PH: không xin được thông tin").cccd).toBe(
      "không xin được thông tin",
    );
  });
});

// Chốt 05/08: import lại thì hồ sơ HỌC VIÊN đã có cũng được đắp thêm thông tin.
describe("planStudentSync", () => {
  const trong = {
    id: "s1",
    parentName: null,
    parentPhone: null,
    parentNationalId: null,
    address: null,
  };
  const info = {
    parentName: "Lisa Dương Hà",
    parentPhone: "84905167198",
    cccd: "048188002983",
    address: "368/85 Hoàng Diệu",
  };
  const pii = { canWritePii: true };

  it("hồ sơ trống → đắp đủ 4 trường", () => {
    expect(planStudentSync(trong, info, pii)).toEqual({
      parentName: "Lisa Dương Hà",
      parentPhone: "84905167198",
      parentNationalId: "048188002983",
      address: "368/85 Hoàng Diệu",
    });
  });

  it("hồ sơ đã có dữ liệu người nhập tay → KHÔNG ghi đè bất cứ gì", () => {
    const day = {
      id: "s1",
      parentName: "Chị Hà (đã sửa tay)",
      parentPhone: "84900000000",
      parentNationalId: "111",
      address: "Địa chỉ đã sửa",
    };
    expect(planStudentSync(day, info, pii)).toEqual({});
  });

  it("tên PH đang là tên tự điền → CHO tên thật thay thế", () => {
    const s = { ...trong, parentName: "Phụ huynh của HOÀNG VĨNH KHANG" };
    expect(planStudentSync(s, info, pii).parentName).toBe("Lisa Dương Hà");
  });

  it("KHÔNG có quyền xem PII → tuyệt đối không ghi CCCD, các trường khác vẫn đắp", () => {
    const set = planStudentSync(trong, info, { canWritePii: false });
    expect(set.parentNationalId).toBeUndefined();
    expect(set.address).toBe("368/85 Hoàng Diệu");
  });

  it("file không có thông tin → không sinh update rỗng", () => {
    expect(
      planStudentSync(trong, { parentName: null, parentPhone: null, cccd: null, address: null }, pii),
    ).toEqual({});
  });

  it("giá trị chỉ có khoảng trắng → coi như không có", () => {
    expect(planStudentSync(trong, { parentName: "  ", parentPhone: "", cccd: " ", address: null }, pii)).toEqual({});
  });
});

// Bug 04/08: regex viết `\d` trong template literal → bị nuốt thành `d{4}-d{2}-d{2}`,
// không bao giờ khớp ngày, nên hạn đợt 2 luôn đọc ra null mà không báo lỗi gì.
describe("dueDate2FromNote", () => {
  it("đọc được hạn đợt 2 đã ghi trong note", () => {
    expect(dueDate2FromNote(`abc ${DUE2_NOTE_TAG}2026-09-15 def`)).toBe("2026-09-15");
  });

  it("note không có tag → null", () => {
    expect(dueDate2FromNote("ghi chú bình thường")).toBeNull();
    expect(dueDate2FromNote(null)).toBeNull();
  });

  it("tag có nhưng ngày sai định dạng → null, không trả rác", () => {
    expect(dueDate2FromNote(`${DUE2_NOTE_TAG}15/09/2026`)).toBeNull();
  });
});

/** Dựng lại note giống buildChildNote (hàm đó không export) để kiểm vòng ghi→đọc. */
function buildChildNoteForTest(c: {
  paidAmount: number | null;
  discountKind: "AMOUNT" | "PERCENT" | null;
  discountValue: number | null;
  discountReason: string | null;
  payIn2: boolean;
}): string {
  const parts: string[] = [];
  if (c.paidAmount !== null) parts.push(`${PAID_NOTE_TAG}${c.paidAmount}`);
  if (c.discountKind && c.discountValue !== null) {
    parts.push(`${DISCOUNT_NOTE_TAG}${c.discountValue}${c.discountKind === "PERCENT" ? "%" : "đ"}`);
  }
  if (c.discountReason) parts.push(`${DISCOUNT_REASON_TAG}${c.discountReason}`);
  if (c.payIn2) parts.push(PAY2_NOTE_TAG);
  return `[Import ĐK Excel] ${parts.join(" · ")}`;
}

describe("ageFromGrade — lớp văn hoá → tuổi", () => {
  it("lớp 1 = 6 tuổi, lớp 9 = 14 tuổi", () => {
    expect(ageFromGrade("Lớp 1")).toBe(6);
    expect(ageFromGrade("Lớp 4")).toBe(9);
    expect(ageFromGrade("Lớp 9")).toBe(14);
  });

  it("chịu được cách ghi khác nhau", () => {
    expect(ageFromGrade("lop 3")).toBe(8);
    expect(ageFromGrade("3")).toBe(8);
  });

  it("KHÔNG đoán bừa khi trống hoặc vô lý", () => {
    expect(ageFromGrade(null)).toBeNull();
    expect(ageFromGrade("")).toBeNull();
    expect(ageFromGrade("mẫu giáo")).toBeNull();
    expect(ageFromGrade("Lớp 13")).toBeNull();
  });
});

describe("parseTuitionAmount — đọc số tiền từ chuỗi Sale gõ tay", () => {
  it("đúng các dạng có thật trong file", () => {
    expect(parseTuitionAmount("4,640,000vnd")).toBe(4_640_000);
    expect(parseTuitionAmount("1,000,000 vnd")).toBe(1_000_000);
    expect(parseTuitionAmount("3.986.000")).toBe(3_986_000);
    expect(parseTuitionAmount("8640000")).toBe(8_640_000);
    expect(parseTuitionAmount("4.640.000đ")).toBe(4_640_000);
  });

  it("thà TRỐNG còn hơn ghi sai số tiền", () => {
    expect(parseTuitionAmount(null)).toBeNull();
    expect(parseTuitionAmount("")).toBeNull();
    expect(parseTuitionAmount("chưa đóng")).toBeNull();
    expect(parseTuitionAmount("4tr + 2tr")).toBeNull();
    expect(parseTuitionAmount("0")).toBeNull();
  });
});

describe("feeModeFromNote — 50% hay đóng đủ", () => {
  it("ghi chú nhắc 50% → HALF (còn nợ)", () => {
    expect(feeModeFromNote("Đóng 50% ngày 15/6")).toBe("HALF");
    expect(feeModeFromNote("Đợt 1 50% ngày 8/6")).toBe("HALF");
    expect(feeModeFromNote("50% Hphi, -300 phí giới thiệu")).toBe("HALF");
  });

  it("không nhắc 50% → FULL, KỂ CẢ khi có giảm giá % khác", () => {
    // Luật: giảm theo % vẫn tính là đã đóng đủ — số trong cột đã là số sau giảm.
    expect(feeModeFromNote("-40% học phí con quý đối tác")).toBe("FULL");
    expect(feeModeFromNote("đã trừ 10% theo chương trình anh em")).toBe("FULL");
    expect(feeModeFromNote(null)).toBe("FULL");
    expect(feeModeFromNote("cuối tháng full phí")).toBe("FULL");
  });
});

describe("paidAmountFromNote — đọc ngược để điền sẵn ô 'đã đóng'", () => {
  it("đọc đúng số đã ghi", () => {
    expect(paidAmountFromNote(`[Import ĐK Excel] Khoá ĐK: Sata 4 · ${PAID_NOTE_TAG}8640000`)).toBe(
      8_640_000,
    );
  });

  it("note không có nhãn → null (không điền bừa)", () => {
    expect(paidAmountFromNote("[Import ĐK Excel] Khoá ĐK: Sata 4")).toBeNull();
    expect(paidAmountFromNote(null)).toBeNull();
  });
});

describe("sửa tay ở màn xem thử — giá trị đè phải kéo theo mọi suy diễn", () => {
  const sheet = (rows: (string | null)[][]) => [{ name: "T8", rows }];
  const HEAD = [
    "Ngày", "Họ và Tên học viên", "Lớp", "Số điện thoại",
    "Khoá học đăng ký", "Học phí", "Cơ sở", "Tên Phụ Huynh", "Ghi chú",
  ];
  const ROW = [
    "1/8/26", "BÉ A", "", "0905000111", "", "", "CS1: N.Hữu Thọ", "", "",
  ];

  it("chưa sửa → cảnh báo thiếu Lớp / Khoá / Học phí; tên PH thì TỰ ĐIỀN chứ không báo thiếu", () => {
    const p = parseRegisteredSheets(sheet([HEAD, ROW]));
    const c = p.parents[0]!.children[0]!;
    expect(c.ageYears).toBeNull();
    expect(c.paidAmount).toBeNull();
    expect(c.warnings.join(" | ")).toContain("thiếu Lớp");
    expect(c.warnings.join(" | ")).toContain("thiếu Khoá học đăng ký");
    // 05/08 — không còn coi là "thiếu": hệ thống điền "Phụ huynh của <tên con>".
    expect(c.warnings.join(" | ")).toContain("tên PH tự điền");
    expect(c.warnings.join(" | ")).not.toContain("thiếu Tên Phụ Huynh");
  });

  it("sửa Lớp + Học phí + Tên PH → tuổi/tiền tính lại VÀ cảnh báo tự hết", () => {
    const p = parseRegisteredSheets(sheet([HEAD, ROW]), [
      {
        sheet: "T8",
        row: 2, // dòng Excel của ROW (header ở dòng 1)
        values: { grade: "Lớp 4", tuition: "8,640,000vnd", parentName: "Chị B", course: "Sata 4" },
      },
    ]);
    const c = p.parents[0]!.children[0]!;
    expect(c.ageYears).toBe(9);
    expect(c.paidAmount).toBe(8_640_000);
    expect(c.feeMode).toBe("FULL");
    expect(p.parents[0]!.parentName).toBe("Chị B");
    for (const gone of ["thiếu Lớp", "thiếu Học phí", "tên PH tự điền", "thiếu Khoá"]) {
      expect(c.warnings.join(" | ")).not.toContain(gone);
    }
  });

  it("sửa Ghi chú thành '50%' → chuyển sang HALF (còn nợ)", () => {
    const p = parseRegisteredSheets(sheet([HEAD, ROW]), [
      { sheet: "T8", row: 2, values: { tuition: "4,320,000vnd", note: "Đóng 50% học phí" } },
    ]);
    expect(p.parents[0]!.children[0]!.feeMode).toBe("HALF");
  });

  it("override dòng KHÁC không ảnh hưởng dòng này", () => {
    const p = parseRegisteredSheets(sheet([HEAD, ROW]), [
      { sheet: "T8", row: 99, values: { grade: "Lớp 9" } },
    ]);
    expect(p.parents[0]!.children[0]!.ageYears).toBeNull();
  });
});

describe("trả 2 đợt + giảm giá nhập ở màn xem thử", () => {
  const HEAD = [
    "Ngày", "Họ và Tên học viên", "Lớp", "Số điện thoại",
    "Khoá học đăng ký", "Học phí", "Cơ sở", "Tên Phụ Huynh", "Ghi chú",
  ];
  const mk = (note: string, over?: Record<string, string>) =>
    parseRegisteredSheets(
      [{ name: "T8", rows: [HEAD, ["1/8/26", "BÉ A", "Lớp 4", "0905000111", "Sata 4", "4,320,000vnd", "CS1: N.Hữu Thọ", "Chị B", note]] }],
      over ? [{ sheet: "T8", row: 2, values: over }] : [],
    ).parents[0]!.children[0]!;

  it("ghi chú nhắc 50% hoặc '2 đợt' → TỰ TICK trả 2 đợt", () => {
    expect(mk("Đóng 50% học phí ngày 15/6").payIn2).toBe(true);
    expect(mk("Khách xin đóng 2 đợt").payIn2).toBe(true);
    expect(mk("Đợt 1 ngày 8/6").payIn2).toBe(true);
  });

  it("ghi chú thường → KHÔNG tick", () => {
    expect(mk("cuối tháng full phí").payIn2).toBe(false);
    expect(mk("").payIn2).toBe(false);
  });

  it("người nhập bỏ tick tay → thắng suy đoán từ ghi chú", () => {
    expect(mk("Đóng 50% học phí", { payIn2: "0" }).payIn2).toBe(false);
    expect(mk("full phí", { payIn2: "1" }).payIn2).toBe(true);
  });

  it("giảm theo % kẹp trần 100, theo số tiền giữ nguyên", () => {
    expect(mk("", { discountKind: "PERCENT", discountValue: "10" }).discountValue).toBe(10);
    expect(mk("", { discountKind: "PERCENT", discountValue: "999" }).discountValue).toBe(100);
    expect(mk("", { discountKind: "AMOUNT", discountValue: "500,000" }).discountValue).toBe(500_000);
  });

  it("giảm giá KHÔNG giải trình → cảnh báo (cùng luật màn tạo đơn)", () => {
    const c = mk("", { discountKind: "AMOUNT", discountValue: "500000" });
    expect(c.warnings.join(" | ")).toContain("CHƯA giải trình");
    const ok = mk("", {
      discountKind: "AMOUNT", discountValue: "500000", discountReason: "Con quý đối tác",
    });
    expect(ok.warnings.join(" | ")).not.toContain("CHƯA giải trình");
  });

  it("quyết định tiền được ghi vào note để bước chốt đọc lại", () => {
    const c = mk("Đóng 50%", {
      discountKind: "PERCENT", discountValue: "10", discountReason: "CT anh em",
    });
    const note = buildChildNoteForTest(c);
    expect(discountFromNote(note)).toEqual({ kind: "PERCENT", value: 10 });
    expect(payIn2FromNoteTag(note)).toBe(true);
    expect(paidAmountFromNote(note)).toBe(4_320_000);
  });
});

describe("CƠ SỞ — tuyệt đối không được lệch", () => {
  const HEAD = ["Họ và Tên học viên", "Số điện thoại", "MÃ HỌC VIÊN", "Cơ sở"];
  const parse = (row: (string | null)[], over?: Record<string, string>) =>
    parseRegisteredSheets(
      [{ name: "T8", rows: [HEAD, row] }],
      over ? [{ sheet: "T8", row: 2, values: over }] : [],
    ).parents[0]!;

  it("cột Cơ sở THẮNG mã học viên khi hai bên lệch", () => {
    // Ca thật trong file: HOÀNG VĨNH KHANG mã CS1 nhưng cột Cơ sở ghi CS2.
    expect(parse(["BÉ A", "0905000111", "CS1.HV.0007", "CS2: Hoàng Diệu"]).centerCode).toBe("CS2");
  });

  it("cột Cơ sở trống → lấy từ tiền tố mã học viên", () => {
    expect(parse(["BÉ A", "0905000111", "CS1.HV.0031", ""]).centerCode).toBe("CS1");
  });

  it("không suy được cơ sở → để NULL, không đoán bừa", () => {
    expect(parse(["BÉ A", "0905000111", "", ""]).centerCode).toBeNull();
  });

  it("sửa tay cơ sở ở màn xem thử thì theo đúng giá trị đã sửa", () => {
    expect(parse(["BÉ A", "0905000111", "CS1.HV.0031", ""], { center: "CS2" }).centerCode).toBe("CS2");
  });
});

// Chốt 05/08: cùng học viên xuất hiện ở nhiều sheet.
// Đo file thật: 16/19 ca có tiền GIỐNG NHAU (danh sách mang sang tháng sau) — cộng
// dồn là thổi khống 73.752.000đ. Chỉ ca tiền KHÁC nhau mới là đóng nhiều đợt.
describe("gộp cross-sheet — học phí", () => {
  const HEAD = [
    "Ngày", "Họ và Tên học viên", "Lớp", "Số điện thoại",
    "Khoá học đăng ký", "Học phí", "Cơ sở", "Tên Phụ Huynh", "Ghi chú",
  ];
  const dong = (tien: string) =>
    ["1/8/26", "BÉ A", "Lớp 4", "0905000111", "Sata 4", tien, "CS1: N.Hữu Thọ", "Chị B", ""];
  const hai = (t1: string, t2: string) =>
    parseRegisteredSheets([
      { name: "Tháng 7", rows: [HEAD, dong(t1)] },
      { name: "Tháng 8", rows: [HEAD, dong(t2)] },
    ]).parents[0]!.children[0]!;

  it("tiền GIỐNG nhau → gộp im lặng, KHÔNG cộng dồn, KHÔNG cảnh báo", () => {
    const c = hai("4.640.000", "4.640.000");
    expect(c.sources).toHaveLength(2);
    expect(c.paidAmount).toBe(4_640_000); // KHÔNG phải 9.280.000
    expect(c.warnings.join(" | ")).not.toContain(CROSS_SHEET_FEE_WARNING);
  });

  it("tiền KHÁC nhau → nêu cảnh báo kèm TỔNG gợi ý, vẫn không tự cộng", () => {
    const c = hai("4.320.000", "3.600.000");
    expect(c.paidAmount).toBe(4_320_000); // giữ nguyên, người nhập quyết
    const w = c.warnings.find((x) => x.includes(CROSS_SHEET_FEE_WARNING))!;
    expect(w).toBeDefined();
    expect(w).toContain("4.320.000");
    expect(w).toContain("3.600.000");
    expect(w).toContain("7.920.000"); // tổng gợi ý = đúng giá niêm yết Sata3
    expect(w).toContain("Tháng 7");
    expect(w).toContain("Tháng 8");
  });

  it("một bên chưa đọc được số tiền → không cảnh báo bừa", () => {
    expect(hai("4.320.000", "chưa đóng").warnings.join(" | ")).not.toContain(CROSS_SHEET_FEE_WARNING);
  });
});
