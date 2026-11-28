// @vitest-environment node
import { describe, expect, it } from "vitest";
import { kiemCauHoi, type CauHoiSnapshot } from "./cham-diem";
import { kiemDapAnNhap, GIOI_HAN_CHU } from "./nhap-dap-an";

/** Dựng câu qua ĐÚNG đường soạn rồi chụp thành snapshot (không gõ tay khuôn lưu). */
function dung(input: Record<string, unknown>): CauHoiSnapshot {
  const k = kiemCauHoi(input as never);
  if (!k.ok) throw new Error(k.thongBao);
  const type = input.type as CauHoiSnapshot["type"];
  const arr = Array.isArray(k.optionsJson);
  return { id: "q-" + type, type, stem: String(input.stem), options: arr ? (k.optionsJson as never) : [], ...(arr ? {} : { cauHinh: k.optionsJson as Record<string, unknown> }), key: k.answerKeyJson, points: 1, explanation: "BI-MAT" };
}
const SB = { cols: 4, rows: 3, start: { c: 0, r: 0, dir: "E" }, goal: { c: 3, r: 0 }, walls: [], blocks: ["fwd", "right", "repeat"], maxBlocks: 4 };
const Q = {
  SINGLE: dung({ type: "SINGLE_CHOICE", stem: "s", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: "a" }),
  MULTI: dung({ type: "MULTIPLE_CHOICE", stem: "m", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], correct: ["a"] }),
  TF: dung({ type: "TRUE_FALSE", stem: "t", correct: true }),
  SHORT: dung({ type: "SHORT_TEXT", stem: "x", accepted: ["a"] }),
  ESSAY: dung({ type: "ESSAY", stem: "e" }),
  FILL: dung({ type: "FILL_BLANK", stem: "Đi [[3]] bước [[dừng]]", cauHinh: {} }),
  MATCH: dung({ type: "MATCHING", stem: "m", cauHinh: { pairs: [{ left: "L1", right: "R1" }, { left: "L2", right: "R2" }] } }),
  ORDER: dung({ type: "ORDERING", stem: "o", cauHinh: { items: ["một", "hai", "ba"] } }),
  CLASS: dung({ type: "CLASSIFY", stem: "c", cauHinh: { groups: [{ name: "G1", cards: ["t1"] }, { name: "G2", cards: ["t2"] }] } }),
  HOT: dung({ type: "IMAGE_HOTSPOT", stem: "h", cauHinh: { image: { imageUrl: "https://x.test/a.png", width: 800, height: 600 }, regions: [{ shape: "rect", x: 1, y: 1, w: 10, h: 10 }] } }),
  NUM: dung({ type: "NUMERIC", stem: "n", cauHinh: { answer: 5 } }),
  PROD: dung({ type: "PRODUCT", stem: "p", cauHinh: { accept: ["VIDEO"], maxMb: 10 } }),
  BLOCK: dung({ type: "BLOCK_SEQUENCE", stem: "b", cauHinh: SB }),
};

describe("[NDA-01] kiểm đáp án nháp theo từng dạng (13 dạng): nhận đúng hình dạng, từ chối mọi thứ lạ", () => {
  it.each([
    ["SINGLE", "a", "zzz"], ["SINGLE", "b", 1],
    ["MULTI", ["a", "c"], ["a", "a"]], ["MULTI", [], ["a", "zzz"]],
    ["TF", false, "true"],
    ["SHORT", "gì đó", "x".repeat(GIOI_HAN_CHU.ngan + 1)],
    ["ESSAY", "bài dài", 5],
    ["FILL", ["3", ""], ["3"]],
    ["MATCH", { l1: "r2" }, { l9: "r1" }],
    ["ORDER", ["s3", "s1"], ["s1", "s1"]],
    ["CLASS", { c1: "g2" }, { c1: "g9" }],
    ["HOT", { x: 5, y: 5 }, { x: 900, y: 5 }],
    ["NUM", "5,5", {}],
    ["PROD", "sub_1", "../x"],
    ["BLOCK", [{ b: "repeat", n: 2, body: [{ b: "fwd" }] }], [{ b: "hack" }]],
  ] as const)("%s: nhận %j, từ chối %j", (ten, tot, xau) => {
    const q = Q[ten];
    expect(kiemDapAnNhap(q, tot)).toMatchObject({ ok: true });
    expect(kiemDapAnNhap(q, xau)).toMatchObject({ ok: false });
  });
  it("trường lạ/siêu dữ liệu chấm bị từ chối (đối tượng thừa khoá, khối lệnh thừa khoá)", () => {
    expect(kiemDapAnNhap(Q.HOT, { x: 1, y: 1, correct: true })).toMatchObject({ ok: false });
    expect(kiemDapAnNhap(Q.BLOCK, [{ b: "fwd", correct: true }])).toMatchObject({ ok: false });
    expect(kiemDapAnNhap(Q.MATCH, { l1: "r1", points: "999" })).toMatchObject({ ok: false });
    expect(kiemDapAnNhap(Q.SINGLE, { value: "a" })).toMatchObject({ ok: false });
    expect(kiemDapAnNhap(Q.NUM, { value: 5 })).toMatchObject({ ok: false });
  });
  it("khối lệnh vượt số khối cho phép bị từ chối; dạng chưa biết ⇒ từ chối (fail-closed), không rơi im lặng", () => {
    expect(kiemDapAnNhap(Q.BLOCK, Array.from({ length: 5 }, () => ({ b: "fwd" })))).toMatchObject({ ok: false });
    expect(kiemDapAnNhap({ ...Q.SINGLE, type: "DANG_MOI_CHUA_CO" as never }, "a")).toMatchObject({ ok: false });
  });
  it("giá trị trả về là bản đã kiểm (không bao giờ chứa đáp án của người soạn)", () => {
    const r = kiemDapAnNhap(Q.MATCH, { l1: "r1" });
    expect(JSON.stringify(r)).not.toContain("BI-MAT");
    expect(r).toEqual({ ok: true, value: { l1: "r1" } });
  });
});
