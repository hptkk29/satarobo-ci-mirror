/** [NHH-UI-TN-09] — `thoatLike`: ký tự đại diện LIKE bị thoát. (Ca DB thật là [NHH-UI-TN-08].) */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({}) }));

import { thoatLike } from "./tim-nguoi-gioi-thieu";

const BS = String.fromCharCode(92); // một dấu gạch chéo ngược

describe("[NHH-UI-TN-09] thoatLike", () => {
  it("thoát % _ và dấu gạch chéo ngược; chữ thường giữ nguyên", () => {
    expect(thoatLike("%")).toBe(`${BS}%`);
    expect(thoatLike("a_b")).toBe(`a${BS}_b`);
    expect(thoatLike(BS)).toBe(`${BS}${BS}`);
    expect(thoatLike("Lê Văn Tìm")).toBe("Lê Văn Tìm");
  });
  it("thoát cả chuỗi, mỗi ký tự một lần (không thoát đôi)", () => {
    expect(thoatLike("%%__")).toBe(`${BS}%${BS}%${BS}_${BS}_`);
  });
});
