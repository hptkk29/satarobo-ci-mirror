import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  SHIFT_CATALOG,
  SHIFT_CODES,
  catalogByCode,
  plannedMinutes,
  validateSegments,
  toMinutes,
  LEAVE_TYPE_CATALOG,
} from "./catalog";

// Kế hoạch v3.3 §1.2 — giờ kế hoạch tính từ Sheet (CS tính cả nghỉ giữa giờ; CT = 7h15,
// KHÔNG phải 7h30 như lib/work-schedule.test.ts cũ khoá).
const PLANNED_MIN: Record<string, number> = {
  S: 225, C: 225, T: 225, SC: 450, ST: 450, CT: 435, SCT: 660,
  CG: 375, CS: 420, CCT: 465, CGD: 495, HC: 450, "12": 450, "21": 450, "2C": 450,
  NG: 450, D1: 0, D2: 0, LD: 0, X: 0, P: 0,
};

describe("SHIFT_CATALOG — 21 mã theo tab DANH MỤC CA", () => {
  it("đúng 21 mã, đúng thứ tự dòng trên Sheet, không trùng", () => {
    expect(SHIFT_CODES).toEqual([
      "CG", "CS", "CCT", "CGD", "D1", "D2", "HC", "12", "21", "2C",
      "S", "C", "T", "SC", "ST", "CT", "SCT", "LD", "NG", "X", "P",
    ]);
    expect(new Set(SHIFT_CODES).size).toBe(21);
  });

  it.each(Object.entries(PLANNED_MIN))("giờ kế hoạch %s = %i phút", (code, minutes) => {
    expect(plannedMinutes(catalogByCode(code)!)).toBe(minutes);
  });

  // ⚠️ ĐẢO 09/09/2026. Luật cũ (K-01 theo Sheet) là "mọi mã làm việc = 1 công". Chủ dự án
  // chốt bảng mới: MỘT NGÀY làm việc = 1 công, nhưng buổi LẺ = 0,5 và sáng+chiều+tối =
  // 1,5. Mẫu số hệ số công giữ nguyên 24 (không đụng SR.QD.231).
  // Nguồn sự thật: `docs/cham-cong/BANG-MA-CA-CHOT.md`. Ca đối chiếu ở cuối file này.
  it("bảng chốt 09/09: buổi lẻ 0,5 · ngày 1 · sáng+chiều+tối 1,5 · X/P 0", () => {
    const chot: Record<string, number> = {
      S: 0.5, C: 0.5, T: 0.5,
      SCT: 1.5,
      X: 0, P: 0,
    };
    for (const e of SHIFT_CATALOG) {
      expect(e.dayCredit, e.code).toBe(chot[e.code] ?? 1);
    }
  });

  it("segments của 21 mã đều hợp lệ (tăng dần, không qua đêm, PAID_BREAK kẹp giữa 2 WORK)", () => {
    for (const e of SHIFT_CATALOG) expect(validateSegments(e.segments), e.code).toEqual([]);
  });

  it("CS: nghỉ giữa giờ 16:30–17:00 là PAID_BREAK và TÍNH vào giờ kế hoạch", () => {
    const cs = catalogByCode("CS")!;
    expect(cs.segments.map((s) => s.kind)).toEqual(["WORK", "PAID_BREAK", "WORK"]);
    expect(plannedMinutes(cs)).toBe(420);
  });

  it("nơi làm: HC theo phân công, 12/21 đổi cơ sở giữa ngày, 2C mọi cơ sở, NG ngoài, LD bất kỳ, D1/D2 cố định", () => {
    expect(catalogByCode("HC")!.defaultPlace).toBe("ASSIGNED");
    expect(catalogByCode("12")!.segments.map((s) => s.place)).toEqual(["CENTER:CS1", "CENTER:CS2"]);
    expect(catalogByCode("21")!.segments.map((s) => s.place)).toEqual(["CENTER:CS2", "CENTER:CS1"]);
    expect(catalogByCode("2C")!.defaultPlace).toBe("ANY_CENTER");
    expect(catalogByCode("NG")!.defaultPlace).toBe("OFFSITE");
    expect(catalogByCode("LD")!.defaultPlace).toBe("ANYWHERE");
    expect(catalogByCode("D1")!.defaultPlace).toBe("CENTER:CS1");
    expect(catalogByCode("D2")!.defaultPlace).toBe("CENTER:CS2");
  });

  // 🔴 `NG` RỜI khỏi nhóm OPTIONAL ngày 15/09/2026 (phần A) — đảo chốt cũ, không phải sót.
  //
  // Cũ: "công tác ngoài thì 1 công, không cần lượt nào". Nay: đi công tác vẫn phải bấm
  // Check in / Check out (hai nút ở màn "Của tôi", hiện khi `placeMode === "OFFSITE"`),
  // và ngày đó kỳ vọng ĐÚNG MỘT cặp quét.
  //
  // `LD` `D1` `D2` GIỮ OPTIONAL: `LD` là ca linh động không khung giờ, `D1`/`D2` là NHÃN
  // NƠI LÀM chứ không phải ca có giờ — không có gì để quét vào/ra.
  it("chế độ chấm: LD/D1/D2 OPTIONAL, X/P NONE, còn lại (kể cả NG) REQUIRED", () => {
    for (const e of SHIFT_CATALOG) {
      const expected = ["LD", "D1", "D2"].includes(e.code)
        ? "OPTIONAL"
        : ["X", "P"].includes(e.code)
          ? "NONE"
          : "REQUIRED";
      expect(e.attendanceMode, e.code).toBe(expected);
    }
    expect(catalogByCode("P")!.isLeave).toBe(true);
    expect(catalogByCode("LD")!.nominalMinutes).toBeNull(); // T-03: 1 công, 0 giờ
    expect(catalogByCode("NG")!.nominalMinutes).toBe(450);
    // Ba vế của cú đảo phải khớp nhau — thiếu một vế là cấu hình vô nghĩa (xem bảng chốt).
    expect(catalogByCode("NG")!.attendanceMode).toBe("REQUIRED");
    expect(catalogByCode("NG")!.soCapQuetKyVong).toBe(1);
    expect(catalogByCode("NG")!.defaultPlace).toBe("OFFSITE");
  });

  it("cột hiển thị chép đúng chữ Sheet cho vài mã tiêu biểu", () => {
    const cg = catalogByCode("CG")!;
    expect([cg.amStart, cg.amEnd, cg.pmStart, cg.pmEnd]).toEqual(["09:00", "11:30", "14:00", "17:45"]);
    const t = catalogByCode("T")!;
    expect([t.amStart, t.pmStart, t.pmEnd]).toEqual([undefined, "17:15", "21:00"]);
  });
});

describe("validateSegments / toMinutes", () => {
  it("bắt qua đêm, chồng nhau, PAID_BREAK lạc chỗ", () => {
    expect(validateSegments([{ start: "21:00", end: "01:00", kind: "WORK" }])[0]?.message).toMatch(/qua đêm/);
    expect(
      validateSegments([
        { start: "08:00", end: "12:00", kind: "WORK" },
        { start: "11:00", end: "13:00", kind: "WORK" },
      ])[0]?.message,
    ).toMatch(/chồng/);
    expect(validateSegments([{ start: "16:30", end: "17:00", kind: "PAID_BREAK" }])[0]?.message).toMatch(
      /giữa hai đoạn/,
    );
    expect(validateSegments([{ start: "8h", end: "12:00", kind: "WORK" }])[0]?.message).toMatch(/không hợp lệ/);
  });
  it("toMinutes", () => {
    expect(toMinutes("07:45")).toBe(465);
    expect(() => toMinutes("25:00")).toThrow();
  });
});

describe("LEAVE_TYPE_CATALOG — K-06 theo MISA", () => {
  it("8 loại, tỷ lệ lương và trần ngày/năm như MISA", () => {
    expect(LEAVE_TYPE_CATALOG).toHaveLength(8);
    const by = Object.fromEntries(LEAVE_TYPE_CATALOG.map((l) => [l.code, l]));
    expect(by.KHONG_LUONG).toMatchObject({ paidRatio: 0, maxDaysPerYear: 10 });
    expect(by.KET_HON).toMatchObject({ paidRatio: 1, maxDaysPerYear: 7 });
    expect(by.THAI_SAN).toMatchObject({ paidRatio: 0, maxDaysPerYear: 180 });
    expect(by.NGHI_BU.countsAsWorked).toBe(true);
    expect(LEAVE_TYPE_CATALOG.some((l) => /thứ 2/i.test(l.name))).toBe(false); // loại giả "Thứ 2" của MISA không mang sang
  });
});

// ── ĐỐI CHIẾU VỚI CHÍNH VĂN BẢN CHỐT (09/09/2026) ───────────────────────────
//
// Vì sao cần: chủ dự án chỉnh `dayCredit` TAY trên prod (S/C/T → 0,5 · CT → 1 · SCT →
// 1,5) còn `SHIFT_CATALOG` giữ số cũ. Hai bên lệch mà KHÔNG có gì báo —
// `seedShiftTemplates` chỉ ghi đè khi `--force`, nên lệch cứ nằm đó cho tới ngày ai đó
// chạy force và xoá sạch chỉnh tay của cả năm.
//
// ⚠️ Ca ở trên đọc số từ hằng gõ NGAY TRONG file này. Sửa cả hai chỗ cùng lúc thì nó vẫn
// xanh. Ca dưới đây đọc THẲNG bảng markdown — nó là thứ duy nhất bắt được "sửa mã mà quên
// sửa bảng chốt", và ngược lại (luật 11: đừng để hai nguồn sự thật).
describe("SHIFT_CATALOG ↔ docs/cham-cong/BANG-MA-CA-CHOT.md", () => {
  const BANG = readFileSync(
    join(__dirname, "..", "..", "docs", "cham-cong", "BANG-MA-CA-CHOT.md"),
    "utf8",
  );

  it("mọi dayCredit ≠ 1 phải xuất hiện đúng số đó trong bảng chốt", () => {
    const daKiem: string[] = [];
    for (const e of SHIFT_CATALOG) {
      if (e.dayCredit === 1) continue;
      // Markdown viết số thập phân kiểu Việt: "0,5" · "1,5"
      const soVi = String(e.dayCredit).replace(".", ",");
      const dong = BANG.split(String.fromCharCode(10)).find(
        (l) => l.trim().startsWith("|") && l.includes(`\`${e.code}\``),
      );
      expect(dong, `bảng chốt phải có dòng cho mã ${e.code}`).toBeTruthy();
      expect(dong, `${e.code}: bảng chốt phải ghi ${soVi}`).toContain(soVi);
      daKiem.push(e.code);
    }
    // Anti-vacuity: nếu không mã nào ≠ 1 thì vòng trên rỗng và ca này chẳng kiểm gì.
    expect(daKiem.sort()).toEqual(["C", "P", "S", "SCT", "T", "X"]);
  });

  it("bảng chốt nêu rõ luật nền — 1 ngày = 1 công, mẫu số giữ 24", () => {
    // Câu này biến mất nghĩa là ai đó đảo quyết định mà không ghi lại.
    expect(BANG).toContain("Một ngày làm việc = 1 công");
    expect(BANG).toContain("giữ nguyên 24");
  });

  it("bảng chốt vẫn nêu rõ thứ CHƯA cắm được — đừng tưởng đã xong", () => {
    // `soCapQuetKyVong` đã cắm 15/09; `UNPAID_BREAK` thì chưa. Ca này canh vế CÒN LẠI.
    //
    // ⚠️ Bản đầu chỉ viết `expect(BANG).toContain("UNPAID_BREAK")` và lượt cấy "xoá dòng
    // trạng thái" ra XANH — vì chữ ấy còn xuất hiện ở đoạn giải thích phía trên. Khẳng
    // định phải neo vào ĐÚNG DÒNG TRẠNG THÁI (luật 11: neo chuỗi hẹp nhất).
    const dongTrangThai = BANG.split(String.fromCharCode(10)).find(
      (l) => l.trim().startsWith("|") && l.includes("UNPAID_BREAK") && l.includes("chưa có"),
    );
    expect(
      dongTrangThai,
      "bảng chốt phải còn dòng trạng thái ❌ cho UNPAID_BREAK — xoá nó nghĩa là đã cắm xong",
    ).toBeTruthy();
  });

  // ── Cặp quét kỳ vọng: MÃ ↔ BẢNG, từng mã một ──────────────────────────────
  //
  // Đây là cổng chủ dự án đặt ra khi chốt phần A: "Sửa cả SHIFT_CATALOG lẫn
  // docs/cham-cong/BANG-MA-CA-CHOT.md — ca test đối chiếu sẽ đỏ nếu chỉ sửa một bên, đó
  // là đúng ý đồ." Nó quan trọng ngay lúc này vì `NG` sắp đảo 0 → 1 ở phần A.
  it("soCapQuetKyVong của MỌI mã khớp cột 'Cặp quét' trong bảng chốt", () => {
    const dongCuaMa = (code: string) =>
      BANG.split(String.fromCharCode(10)).find(
        (l) => l.trim().startsWith("|") && l.includes("`" + code + "`"),
      );

    const daKiem: string[] = [];
    for (const e of SHIFT_CATALOG) {
      const dong = dongCuaMa(e.code);
      expect(dong, `bảng chốt phải có dòng cho mã ${e.code}`).toBeTruthy();
      // Cột cuối = "Cặp quét". Bỏ `**` rồi lấy SỐ ĐẦU TIÊN của ô đó — ô có thể mang thêm
      // lời giải thích ("**0** — không cần chấm").
      const o = dong!.split("|").filter((x) => x.trim() !== "");
      const cuoi = o[o.length - 1]!.replace(/\*/g, "").trim();
      const so = cuoi.match(/\d+/)?.[0];
      expect(so, `${e.code}: không đọc được số cặp quét từ "${cuoi}"`).toBeTruthy();
      expect(
        Number(so),
        `${e.code}: mã khai ${e.soCapQuetKyVong}, bảng chốt ghi ${so}`,
      ).toBe(e.soCapQuetKyVong);
      daKiem.push(e.code);
    }
    // Anti-vacuity: đủ 20 mã, và phải có ĐỦ CẢ BA giá trị — nếu bảng chỉ còn toàn số 1
    // thì vòng trên vẫn xanh mà chẳng phân biệt được gì.
    expect(daKiem.length).toBe(SHIFT_CATALOG.length);
    expect(new Set(SHIFT_CATALOG.map((e) => e.soCapQuetKyVong))).toEqual(new Set([0, 1, 2]));
  });
});
