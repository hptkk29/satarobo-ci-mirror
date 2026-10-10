import { describe, expect, it } from "vitest";
import { daysOfMonth, planMonthFromPatterns, warnNoWeeklyRest, type ExistingCell, type PatternRow } from "./generate";

const FROM = new Date(Date.UTC(2000, 0, 1));

/**
 * "Hôm nay" cho 5 ca CŨ của file này — chọn 31/08/2026, tức TRƯỚC ngày đầu T09/2026.
 *
 * Cả tháng được test do đó nằm ở TƯƠNG LAI, nên vế chặn `≤ hôm nay` không đụng ca nào và
 * 5 ca cũ giữ NGUYÊN ý định ban đầu. Ranh giới `≤ hôm nay` có khối `describe` riêng ở cuối
 * file, với mốc nằm GIỮA tháng.
 *
 * ⚠️ Cố định, không `new Date()` — luật 19.
 */
const TRUOC_THANG = new Date(Date.UTC(2026, 7, 31));
const pat = (userId: string, unit: string, codes: Record<number, string>): PatternRow[] =>
  Object.entries(codes).map(([wd, templateCode]) => ({ userId, unit, weekday: Number(wd), templateCode, effectiveFrom: FROM, effectiveTo: null }));

// Mr Phúc theo Sheet: CS1 = X D2 CG D2 CG D2 CCT (T2..CN) · CS2 = X CG D1 CG D1 CCT D1
const phucCs1 = pat("phuc", "CS1", { 1: "X", 2: "D2", 3: "CG", 4: "D2", 5: "CG", 6: "D2", 0: "CCT" });
const phucCs2 = pat("phuc", "CS2", { 1: "X", 2: "CG", 3: "D1", 4: "CG", 5: "D1", 6: "CCT", 0: "D1" });

describe("planMonthFromPatterns — T09/2026", () => {
  it("30 ngày, Mr Phúc: Thứ Ba (1/9) = CG tại CS2, Thứ Tư (2/9) = CG tại CS1, CN (6/9) = CCT tại CS1", () => {
    expect(daysOfMonth(2026, 9)).toHaveLength(30);
    const cells = planMonthFromPatterns({ homNay: TRUOC_THANG, year: 2026, month1: 9, patterns: [...phucCs1, ...phucCs2], existing: [] });
    expect(cells).toHaveLength(30);
    const by = (d: number) => cells.find((c) => c.workDate.getUTCDate() === d)!;
    expect(by(1)).toMatchObject({ code: "CG", unit: "CS2", action: "CREATE", sourceCells: { CS1: "D2", CS2: "CG" } });
    expect(by(2)).toMatchObject({ code: "CG", unit: "CS1", sourceCells: { CS1: "CG", CS2: "D1" } });
    expect(by(6)).toMatchObject({ code: "CCT", unit: "CS1" });
    expect(by(7)).toMatchObject({ code: "X", unit: "CS1" }); // Thứ Hai nghỉ
  });

  it("ô đã có nguồn MANUAL/SWAP/LEAVE/IMPORT không bị đè; PATTERN cũ khác mã thì REPLACE; giống thì KEEP", () => {
    const existing: ExistingCell[] = [
      { userId: "phuc", workDate: new Date(Date.UTC(2026, 8, 1)), templateCode: "X", centerUnit: "CS1", source: "MANUAL" },
      { userId: "phuc", workDate: new Date(Date.UTC(2026, 8, 2)), templateCode: "S", centerUnit: "CS1", source: "PATTERN" },
      { userId: "phuc", workDate: new Date(Date.UTC(2026, 8, 3)), templateCode: "CG", centerUnit: "CS2", source: "PATTERN" },
    ];
    const cells = planMonthFromPatterns({ homNay: TRUOC_THANG, year: 2026, month1: 9, patterns: [...phucCs1, ...phucCs2], existing });
    const by = (d: number) => cells.find((c) => c.workDate.getUTCDate() === d)!;
    expect(by(1).action).toBe("SKIP_PROTECTED");
    expect(by(2)).toMatchObject({ action: "REPLACE", code: "CG" });
    expect(by(3)).toMatchObject({ action: "KEEP", code: "CG" });
  });

  it("pattern có effectiveTo trước ngày → bỏ; ô cũ PATTERN mà pattern mới trống → CLEAR", () => {
    const p = pat("a", "CS1", { 2: "S" }).map((x) => ({ ...x, effectiveTo: new Date(Date.UTC(2026, 8, 10)) }));
    const existing: ExistingCell[] = [{ userId: "a", workDate: new Date(Date.UTC(2026, 8, 15)), templateCode: "S", centerUnit: "CS1", source: "PATTERN" }];
    const cells = planMonthFromPatterns({ homNay: TRUOC_THANG, year: 2026, month1: 9, patterns: p, existing });
    expect(cells.find((c) => c.workDate.getUTCDate() === 8)?.action).toBe("CREATE"); // Thứ Ba 8/9 ≤ 10/9
    expect(cells.find((c) => c.workDate.getUTCDate() === 15)?.action).toBe("CLEAR"); // 15/9 > effectiveTo
    expect(cells.find((c) => c.workDate.getUTCDate() === 22)).toBeUndefined();
  });

  it("onlyUserIds lọc người", () => {
    const cells = planMonthFromPatterns({ homNay: TRUOC_THANG, year: 2026, month1: 9, patterns: [...phucCs1, ...pat("b", "CS1", { 2: "S" })], existing: [], onlyUserIds: ["b"] });
    expect(new Set(cells.map((c) => c.userId))).toEqual(new Set(["b"]));
  });
});

describe("warnNoWeeklyRest — Điều 111", () => {
  it("Ms Huệ LD cả T2 lẫn CN → 7 ngày liên tiếp không X/P → cảnh báo; Mr Phúc có X Thứ Hai → không", () => {
    const hue = pat("hue", "HO", { 1: "LD", 2: "HC", 3: "HC", 4: "HC", 5: "HC", 6: "HC", 0: "LD" });
    const cells = planMonthFromPatterns({ homNay: TRUOC_THANG, year: 2026, month1: 9, patterns: [...hue, ...phucCs1, ...phucCs2], existing: [] });
    const w = warnNoWeeklyRest(cells);
    expect(w.some((x) => x.userId === "hue")).toBe(true);
    expect(w.some((x) => x.userId === "phuc")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// Mục 6 (13/09/2026) — sửa khung ca rồi sinh lưới CHỈ được áp KỂ TỪ NGÀY MAI.
//
// Trước bản vá, `generate.ts` + `generate-db.ts` đọc đồng hồ 0 lần: khái niệm "hôm nay"
// KHÔNG TỒN TẠI trong cả đường đi, nên hành vi này phải thêm mới chứ không phải sửa.
// ═════════════════════════════════════════════════════════════════════════════════════
describe("planMonthFromPatterns — ranh giới HÔM NAY", () => {
  // 15/09/2026 là Thứ Ba. Khung: mọi ngày đều có mã (không có ô trống) để tách bạch
  // "không đụng vì quá khứ" với "không đụng vì trống".
  const GIUA_THANG = new Date(Date.UTC(2026, 8, 15));
  const ai = pat("ai", "CS1", { 0: "CCT", 1: "S", 2: "S", 3: "S", 4: "S", 5: "S", 6: "CCT" });

  /** Ô PATTERN cũ mã khác hẳn ⇒ nếu KHÔNG chặn thì chắc chắn ra REPLACE. */
  const oCu = (d: number): ExistingCell => ({
    userId: "ai",
    workDate: new Date(Date.UTC(2026, 8, d)),
    templateCode: "CG",
    centerUnit: "CS1",
    source: "PATTERN",
  });

  const ke = (existing: ExistingCell[]) =>
    planMonthFromPatterns({ homNay: GIUA_THANG, year: 2026, month1: 9, patterns: ai, existing });

  const oNgay = (cells: ReturnType<typeof ke>, d: number) =>
    cells.find((c) => c.workDate.getUTCDate() === d)!;

  // ── vế CHẶN ────────────────────────────────────────────────────────────────────────
  it("ngày HÔM QUA (14/9) KHÔNG bị đụng — SKIP_QUA_KHU, giữ nguyên mã cũ", () => {
    const c = oNgay(ke([oCu(14)]), 14);
    expect(c.action).toBe("SKIP_QUA_KHU");
    expect(c.code, "phải giữ mã ĐANG CÓ, không phải mã sắp xếp").toBe("CG");
  });

  it("ngày HÔM NAY (15/9) KHÔNG bị đụng — ranh giới là `≤ hôm nay`, không phải `< hôm nay`", () => {
    // Người ta sửa khung ca rồi bấm NGAY trong ngày, và hôm nay là ngày ĐANG có người quét.
    const c = oNgay(ke([oCu(15)]), 15);
    expect(c.action).toBe("SKIP_QUA_KHU");
    expect(c.code).toBe("CG");
  });

  it("ngày quá khứ CHƯA có ô nào ⇒ KHÔNG tạo mới (không đẻ ca cho ngày đã trôi qua)", () => {
    const cells = ke([]);
    for (const d of [1, 10, 14, 15]) {
      expect(cells.find((c) => c.workDate.getUTCDate() === d), `ngày ${d} không được có dòng nào`).toBeUndefined();
    }
  });

  it("ngày quá khứ có ô mà khung ca nay TRỐNG ⇒ vẫn KHÔNG xoá (không CLEAR quá khứ)", () => {
    const khongCoThu = pat("ai", "CS1", { 3: "S" }); // chỉ Thứ Tư có mã
    const cells = planMonthFromPatterns({
      homNay: GIUA_THANG, year: 2026, month1: 9, patterns: khongCoThu, existing: [oCu(14)],
    });
    expect(oNgay(cells, 14).action).toBe("SKIP_QUA_KHU");
    expect(cells.some((c) => c.action === "CLEAR" && c.workDate.getUTCDate() <= 15)).toBe(false);
  });

  // ── vế CHO QUA (luật 16) — thiếu vế này thì một bản vá chặn SẠCH cả tháng vẫn xanh ──
  it("NGÀY MAI (16/9) VẪN đổi đúng — REPLACE ô PATTERN cũ", () => {
    const c = oNgay(ke([oCu(16)]), 16);
    expect(c.action).toBe("REPLACE");
    expect(c.code).toBe("S");
  });

  it("ngày mai trở đi CHƯA có ô ⇒ VẪN tạo mới", () => {
    const cells = ke([]);
    expect(oNgay(cells, 16).action).toBe("CREATE");
    expect(oNgay(cells, 30).action).toBe("CREATE");
    // Và đúng 15 ngày được sinh (16..30) — không nhiều hơn, không ít hơn.
    expect(cells).toHaveLength(15);
    expect(Math.min(...cells.map((c) => c.workDate.getUTCDate()))).toBe(16);
  });

  it("ô PROTECTED ở ngày TƯƠNG LAI vẫn được giữ như cũ — bản vá không nuốt luật cũ", () => {
    const donDaDuyet: ExistingCell = {
      userId: "ai", workDate: new Date(Date.UTC(2026, 8, 20)),
      templateCode: "P", centerUnit: "CS1", source: "LEAVE",
    };
    expect(oNgay(ke([donDaDuyet]), 20).action).toBe("SKIP_PROTECTED");
  });

  it("ranh giới di chuyển theo `homNay` — cùng dữ liệu, mốc khác thì kết quả khác", () => {
    // Chứng minh `homNay` THẬT SỰ được tiêu thụ, không phải tham số trang trí.
    const som = planMonthFromPatterns({
      homNay: new Date(Date.UTC(2026, 8, 5)), year: 2026, month1: 9, patterns: ai, existing: [oCu(10)],
    });
    expect(som.find((c) => c.workDate.getUTCDate() === 10)!.action).toBe("REPLACE");
    const muon = planMonthFromPatterns({
      homNay: new Date(Date.UTC(2026, 8, 25)), year: 2026, month1: 9, patterns: ai, existing: [oCu(10)],
    });
    expect(muon.find((c) => c.workDate.getUTCDate() === 10)!.action).toBe("SKIP_QUA_KHU");
  });
});

describe("warnNoWeeklyRest — không cảnh báo về ngày lượt này không đụng tới", () => {
  it("chuỗi ngày SKIP_QUA_KHU không bị đếm vào chuỗi làm liên tiếp", () => {
    const qua = Array.from({ length: 10 }, (_, i) => ({
      userId: "ai",
      workDate: new Date(Date.UTC(2026, 8, i + 1)),
      code: "S",
      unit: "CS1",
      sourceCells: {},
      action: "SKIP_QUA_KHU" as const,
    }));
    expect(warnNoWeeklyRest(qua)).toEqual([]);
  });
});
