import { describe, expect, it } from "vitest";
import type { ContentQuestion } from "@/lib/assignments/question-content";
import { chamBai, chamCau, kiemDapAn, toCauHoiHocVien, xaoTheoHat, type DapAn } from "./lam-bai";

const single: ContentQuestion = { id: "q1", type: "single", question: "1-2=", options: ["3", "4", "5", "2"], correctIndex: 1 };
const multiple: ContentQuestion = { id: "q2", type: "multiple", question: "3*X=9", options: ["3", "2", "1", "căn 9"], correctIndices: [0, 3] };
const boolean: ContentQuestion = { id: "q3", type: "boolean", question: "1+1=2?", correct: true };
const fill: ContentQuestion = { id: "q4", type: "fill", question: "Robot có ______ bánh và ______ cảm biến", answers: ["2", "Ba"] };
const matching: ContentQuestion = {
  id: "q5",
  type: "matching",
  question: "Ghép",
  pairs: [
    { left: "A", right: "một" },
    { left: "B", right: "hai" },
    { left: "C", right: "ba" },
  ],
};
const ordering: ContentQuestion = { id: "q6", type: "ordering", question: "Xếp", items: ["1", "2", "3", "4"] };
const essay: ContentQuestion = { id: "q7", type: "essay", question: "Kể về robot", sampleAnswer: "đáp án mẫu bí mật" };
const video: ContentQuestion = { id: "q8", type: "video", question: "Quay video" };

const TAT_CA = [single, multiple, boolean, fill, matching, ordering, essay, video];

describe("[LB-01] bản gửi học viên KHÔNG mang đáp án", () => {
  const CAM = ["correctIndex", "correctIndices", "correct", "answers", "sampleAnswer", "pairs", "items", "isCorrect"];
  it("không trường nào của đáp án đúng nằm trong bản gửi học viên (kể cả lồng bên trong)", () => {
    for (const q of TAT_CA) {
      const json = JSON.stringify(toCauHoiHocVien(q, null));
      for (const k of CAM) expect(json, `${q.type} lộ "${k}"`).not.toContain(`"${k}"`);
    }
    expect(JSON.stringify(toCauHoiHocVien(essay, null))).not.toContain("đáp án mẫu bí mật");
  });
  it("ghép cặp và sắp xếp đã bị xáo — thứ tự trả về không phải thứ tự đúng", () => {
    const m = toCauHoiHocVien(matching, null);
    const o = toCauHoiHocVien(ordering, null);
    expect(m.type === "matching" && m.phai).not.toEqual(["một", "hai", "ba"]);
    expect(m.type === "matching" && [...m.phai].sort()).toEqual(["ba", "hai", "một"].sort());
    expect(o.type === "ordering" && o.muc).not.toEqual(["1", "2", "3", "4"]);
    expect(o.type === "ordering" && [...o.muc].sort()).toEqual(["1", "2", "3", "4"]);
  });
  it("xáo ổn định theo hạt giống và không bao giờ ra đúng thứ tự gốc", () => {
    const goc = ["a", "b", "c", "d", "e"];
    expect(xaoTheoHat(goc, "x")).toEqual(xaoTheoHat(goc, "x"));
    for (const hat of ["1", "2", "3", "q-abc", "q-xyz", "k"]) expect(xaoTheoHat(goc, hat)).not.toEqual(goc);
    expect(xaoTheoHat(["a", "b"], "bất kỳ")).toEqual(["b", "a"]);
    // Hai mục: một nửa số hạt giống sẽ xáo ra đúng thứ tự gốc nếu KHÔNG có bước xoay — quét 200 hạt để chắc chắn gặp.
    for (let i = 0; i < 200; i++) expect(xaoTheoHat(["a", "b"], `hat-${i}`), `hạt ${i}`).toEqual(["b", "a"]);
    for (let i = 0; i < 200; i++) expect(xaoTheoHat(["a", "b", "c"], `hat-${i}`), `hạt ${i}`).not.toEqual(["a", "b", "c"]);
  });
});

describe("[LB-02] chấm từng loại câu", () => {
  it("chọn 1 đáp án / đúng-sai", () => {
    expect(chamCau(single, { k: "single", i: 1 })).toEqual({ loai: "tu-dong", tiLe: 1 });
    expect(chamCau(single, { k: "single", i: 0 })).toEqual({ loai: "tu-dong", tiLe: 0 });
    expect(chamCau(single, null)).toEqual({ loai: "tu-dong", tiLe: 0 });
    expect(chamCau(boolean, { k: "boolean", v: true })).toEqual({ loai: "tu-dong", tiLe: 1 });
    expect(chamCau(boolean, { k: "boolean", v: false })).toEqual({ loai: "tu-dong", tiLe: 0 });
  });
  it("chọn nhiều: phải ĐÚNG TẬP — thiếu hay thừa đều 0, không phụ thuộc thứ tự chọn", () => {
    expect(chamCau(multiple, { k: "multiple", i: [3, 0] })).toEqual({ loai: "tu-dong", tiLe: 1 });
    expect(chamCau(multiple, { k: "multiple", i: [0] })).toEqual({ loai: "tu-dong", tiLe: 0 });
    expect(chamCau(multiple, { k: "multiple", i: [0, 1, 3] })).toEqual({ loai: "tu-dong", tiLe: 0 });
  });
  it("điền khuyết: tỉ lệ chỗ đúng; so lỏng hoa/thường và khoảng trắng", () => {
    expect(chamCau(fill, { k: "fill", t: ["2", "  ba "] })).toEqual({ loai: "tu-dong", tiLe: 1 });
    expect(chamCau(fill, { k: "fill", t: ["2", "bốn"] })).toEqual({ loai: "tu-dong", tiLe: 0.5 });
    expect(chamCau(fill, { k: "fill", t: [] })).toEqual({ loai: "tu-dong", tiLe: 0 });
  });
  it("ghép cặp: tỉ lệ cặp đúng theo vị trí bên trái", () => {
    expect(chamCau(matching, { k: "matching", r: ["một", "hai", "ba"] })).toEqual({ loai: "tu-dong", tiLe: 1 });
    const kq = chamCau(matching, { k: "matching", r: ["hai", "một", "ba"] });
    expect(kq.loai === "tu-dong" && kq.tiLe).toBeCloseTo(1 / 3);
  });
  it("sắp xếp: chỉ đúng khi ĐÚNG HẾT thứ tự", () => {
    expect(chamCau(ordering, { k: "ordering", o: ["1", "2", "3", "4"] })).toEqual({ loai: "tu-dong", tiLe: 1 });
    expect(chamCau(ordering, { k: "ordering", o: ["1", "3", "2", "4"] })).toEqual({ loai: "tu-dong", tiLe: 0 });
    expect(chamCau(ordering, { k: "ordering", o: ["1", "2", "3"] })).toEqual({ loai: "tu-dong", tiLe: 0 });
  });
  it("tự luận / trả lời ngắn / video là CHẤM TAY, không bao giờ có điểm tự động", () => {
    for (const q of [essay, video, { id: "s", type: "short", question: "?" } as ContentQuestion]) {
      expect(chamCau(q, { k: "text", t: "gì cũng được" })).toEqual({ loai: "cham-tay" });
    }
  });
});

describe("[LB-03] chấm cả bài theo thang điểm", () => {
  const dung: Record<string, DapAn> = {
    q1: { k: "single", i: 1 },
    q2: { k: "multiple", i: [0, 3] },
    q3: { k: "boolean", v: true },
    q4: { k: "fill", t: ["2", "ba"] },
    q5: { k: "matching", r: ["một", "hai", "ba"] },
    q6: { k: "ordering", o: ["1", "2", "3", "4"] },
  };
  const tho = (dap: Record<string, DapAn>) => TAT_CA.map((q) => ({ q, diemCau: null, dapAn: dap[q.id] ?? null }));

  it("làm đúng 6 câu tự chấm trong 8 câu (còn tự luận + video) ⇒ 7,5/10 tự động, còn chấm tay", () => {
    const r = chamBai(tho(dung), 10);
    expect(r.diemTuDong).toBe(7.5);
    expect(r.conChamTay).toBe(true);
    expect(r.cau.filter((c) => c.dung === null).map((c) => c.id)).toEqual(["q7", "q8"]);
  });
  it("bỏ trống hết ⇒ 0 điểm tự động", () => {
    expect(chamBai(tho({}), 10).diemTuDong).toBe(0);
  });
  it("điểm riêng của câu làm trọng số: câu 3 điểm nặng gấp 3 câu 1 điểm", () => {
    const r = chamBai(
      [
        { q: single, diemCau: 3, dapAn: { k: "single", i: 1 } },
        { q: boolean, diemCau: 1, dapAn: { k: "boolean", v: false } },
      ],
      10,
    );
    expect(r.diemTuDong).toBe(7.5);
    expect(r.conChamTay).toBe(false);
  });
});

describe("[LB-04] kiểm đáp án gửi lên (server coi input là thô)", () => {
  it("sai loại, chỉ số ngoài khoảng, trùng chỉ số, quá dài đều bị từ chối", () => {
    expect(kiemDapAn(single, { k: "multiple", i: [1] })).not.toBeNull();
    expect(kiemDapAn(single, { k: "single", i: 4 })).not.toBeNull();
    expect(kiemDapAn(single, { k: "single", i: -1 })).not.toBeNull();
    expect(kiemDapAn(multiple, { k: "multiple", i: [1, 1] })).not.toBeNull();
    expect(kiemDapAn(fill, { k: "fill", t: ["a", "b", "c"] })).not.toBeNull();
    expect(kiemDapAn(essay, { k: "text", t: "x".repeat(2001) })).not.toBeNull();
    expect(kiemDapAn(video, { k: "text", t: "x" })).not.toBeNull();
  });
  it("đáp án hợp lệ qua", () => {
    expect(kiemDapAn(single, { k: "single", i: 3 })).toBeNull();
    expect(kiemDapAn(multiple, { k: "multiple", i: [] })).toBeNull();
    expect(kiemDapAn(fill, { k: "fill", t: ["2"] })).toBeNull();
    expect(kiemDapAn(ordering, { k: "ordering", o: ["1", "2", "3", "4"] })).toBeNull();
  });
});
