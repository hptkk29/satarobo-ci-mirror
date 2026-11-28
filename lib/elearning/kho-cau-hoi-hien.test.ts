import { describe, expect, it } from "vitest";
import { demTheoTab, dungCayNhanh, locTheoTab, nhanNhanh, nhomCham, tiLeDungTheoCau } from "./kho-cau-hoi-hien";

describe("[KCH-01] nhóm chấm: máy / người / chưa mở", () => {
  it("SINGLE·MULTIPLE·TRUE_FALSE·NUMERIC = máy; SHORT_ANSWER·ESSAY = người; loại chưa mở = khác", () => {
    for (const t of ["SINGLE", "MULTIPLE", "TRUE_FALSE", "NUMERIC"]) expect(nhomCham(t), t).toBe("may");
    for (const t of ["SHORT_ANSWER", "ESSAY"]) expect(nhomCham(t), t).toBe("nguoi");
    for (const t of ["MATCHING", "FILL_BLANK", "CASE", "ORDERING", "PRODUCT", "CLASSIFY"]) expect(nhomCham(t), t).toBe("khac");
  });
  it("🔴 đếm tab: loại chưa mở chỉ nằm ở 'Mọi dạng' (không bị ép sang máy hay người); lọc tab khớp số đếm", () => {
    const ds = [{ type: "SINGLE" }, { type: "NUMERIC" }, { type: "ESSAY" }, { type: "MATCHING" }];
    expect(demTheoTab(ds)).toEqual({ "moi-dang": 4, "may-cham": 2, "nguoi-cham": 1 });
    expect(locTheoTab(ds, "moi-dang")).toHaveLength(4);
    expect(locTheoTab(ds, "may-cham").map((d) => d.type)).toEqual(["SINGLE", "NUMERIC"]);
    expect(locTheoTab(ds, "nguoi-cham").map((d) => d.type)).toEqual(["ESSAY"]);
  });
});

describe("[KCH-02] cây nhánh có đếm", () => {
  it("🔴 mọi tiền tố là một nút; đếm gồm cả nhánh con; cha đứng trước con; cấp thụt vào đúng", () => {
    const cay = dungCayNhanh(["/nv/an-toan/", "/nv/an-toan/dien/", "/nv/an-toan/dien/", "/nv/quy-che/", "/hv/robosim-1/"]);
    expect(cay.map((n) => `${n.path}:${n.dem}:${n.cap}`)).toEqual([
      "/hv/:1:0",
      "/hv/robosim-1/:1:1",
      "/nv/:4:0",
      "/nv/an-toan/:3:1",
      "/nv/an-toan/dien/:2:2",
      "/nv/quy-che/:1:1",
    ]);
    expect(cay.find((n) => n.path === "/nv/an-toan/")!.nhan).toBe("An toan");
  });
  it("đường dẫn sai dạng bị bỏ qua, danh sách rỗng ⇒ cây rỗng", () => {
    expect(dungCayNhanh(["khong-co-gach", "/HOA/", "//"])).toEqual([]);
    expect(dungCayNhanh([])).toEqual([]);
  });
  it("nhãn: viết hoa chữ đầu, bỏ gạch nối", () => {
    expect(nhanNhanh("an-toan-lao-dong")).toBe("An toan lao dong");
    expect(nhanNhanh("pin")).toBe("Pin");
  });
});

describe("[KCH-03] % đúng theo câu — ngưỡng 5 lượt như báo cáo Kết quả thi", () => {
  const eq = new Map([["e1", "q1"], ["e2", "q1"], ["e3", "q2"]]);
  const dap = (examQuestionId: string, isCorrect: boolean | null) => ({ examQuestionId, isCorrect });
  it("🔴 gộp một câu nằm trong NHIỀU đề; chưa chấm (null) không tính; dưới 5 lượt ⇒ tiLe null (không in 100% từ một người)", () => {
    const r = tiLeDungTheoCau(
      [dap("e1", true), dap("e1", true), dap("e1", false), dap("e2", true), dap("e2", false), dap("e1", null), dap("e3", true)],
      eq,
    );
    expect(r.get("q1")).toEqual({ soLuot: 5, soDung: 3, tiLe: 60 });
    expect(r.get("q2")).toEqual({ soLuot: 1, soDung: 1, tiLe: null });
  });
  it("câu trả lời của câu không còn trong bản đồ bị bỏ qua", () => {
    expect(tiLeDungTheoCau([dap("khong-ro", true)], eq).size).toBe(0);
  });
});
