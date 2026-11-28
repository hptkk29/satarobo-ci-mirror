// @vitest-environment node
/**
 * [NUM-*] Câu NHẬP SỐ (P6) — đường dây từ soạn đến chấm, phần THUẦN / DB giả. Phần Postgres thật: tests/elearning/cau-so-db.test.ts.
 *
 * Lớp lỗi cần canh (xem comment đầu `question-content-map.ts`): bên GHI nội dung và bên ĐỌC lệch khuôn mà TypeScript không nối được (`contentJson: Json`).
 */
import { describe, expect, it, vi } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { contentQuestionSchema } from "@/lib/assignments/question-content-db";
import { cauSoSchema } from "./cham-so";
import { chamLuotThi } from "./exam-close-pure";
import { chamMotCau, duocVaoDe } from "./exam-grading";
import { nhanDapAnSo } from "./exam-result-view";
import { dungNoiDungCauHoi } from "./question-content-map";
import { taoCauHoiSchema } from "./question-bank";

vi.mock("server-only", () => ({}));
const { dungLuotDangLam } = await import("./exam-view");

const SO = { id: "n1", type: "numeric", question: "Hoa hồng bao nhiêu đồng?", answer: 120000, tolerance: 0, unit: "đ", hint: "Nhân 4%" };

describe("[NUM-01] mở loại NUMERIC, các loại P6 khác vẫn đóng", () => {
  it("NUMERIC vào đề được", () => expect(duocVaoDe("NUMERIC")).toBe(true));
  it("🔴 CLASSIFY · IMAGE_HOTSPOT · PRODUCT · BLOCK_SEQUENCE (và 4 loại cũ chưa mở) vẫn bị từ chối", () => {
    for (const t of ["CLASSIFY", "IMAGE_HOTSPOT", "PRODUCT", "BLOCK_SEQUENCE", "FILL_BLANK", "MATCHING", "ORDERING", "CASE"]) expect(duocVaoDe(t), t).toBe(false);
  });
});

describe("[NUM-02] chamMotCau — câu nhập số", () => {
  const cau = cauSoSchema.parse(SO);
  const cham = (traLoiSo: string | null, cauSo: typeof cau | null = cau) => chamMotCau({ type: "NUMERIC", cau: null, chon: [], diemToiDa: 2, cauSo, traLoiSo });
  it("đúng ⇒ trọn điểm; sai ⇒ 0; cả hai do MÁY chấm", () => {
    expect(cham("120000")).toEqual({ cham: "MAY", dung: true, diem: 2 });
    expect(cham("120.000,5")).toEqual({ cham: "MAY", dung: false, diem: 0 }); // không đoán dấu nghìn ⇒ không đọc được ⇒ sai
    expect(cham("119999")).toEqual({ cham: "MAY", dung: false, diem: 0 });
  });
  it("dấu phẩy và dấu chấm thập phân cùng giá trị", () => {
    const c = cauSoSchema.parse({ ...SO, answer: 60.5, tolerance: 0 });
    expect(cham("60,5", c)).toMatchObject({ dung: true });
    expect(cham("60.5", c)).toMatchObject({ dung: true });
  });
  it("sai số ±: trong sai số đúng, ngoài sai số sai (biên bao gồm)", () => {
    const c = cauSoSchema.parse({ ...SO, answer: 60, tolerance: 1 });
    expect(cham("61", c)).toMatchObject({ dung: true });
    expect(cham("61,01", c)).toMatchObject({ dung: false });
  });
  it("🔴 bỏ trống ⇒ 0 điểm do MÁY chấm (không rơi vào hàng đợi chấm tay)", () => {
    expect(cham(null)).toEqual({ cham: "MAY", dung: false, diem: 0 });
    expect(cham("   ")).toEqual({ cham: "MAY", dung: false, diem: 0 });
  });
  it("🔴 nội dung câu hỏng khuôn ⇒ TAY (không biến bản ghi bẩn thành 0 điểm của người học)", () => {
    expect(cham("120000", null)).toEqual({ cham: "TAY" });
  });
});

describe("[NUM-03] bên GHI → bên ĐỌC (writer-to-reader)", () => {
  const ghi = () => dungNoiDungCauHoi({ questionId: "n1", type: "NUMERIC", stem: SO.question, so: { answer: 120000, tolerance: 0, unit: "đ", hint: "Nhân 4%" } });
  it("đầu ra của writer parse được bằng khuôn RIÊNG và KHÔNG parse bằng hợp đồng dùng chung", () => {
    expect(cauSoSchema.safeParse(ghi()).success).toBe(true);
    expect(contentQuestionSchema.safeParse(ghi()).success).toBe(false);
  });
  it("🔴 thiếu `so` ⇒ ném (không ghi nội dung hỏng); loại LẠ ⇒ ném (không rơi im lặng vào `single` đúng-đáp-án-đầu)", () => {
    expect(() => dungNoiDungCauHoi({ questionId: "x", type: "NUMERIC", stem: "?" })).toThrow();
    expect(() => dungNoiDungCauHoi({ questionId: "x", type: "CLASSIFY", stem: "?" })).toThrow();
  });
  it("loại cũ không đổi", () => {
    expect(dungNoiDungCauHoi({ questionId: "s", type: "SINGLE", stem: "Q?", choices: [{ text: "a", isCorrect: false }, { text: "b", isCorrect: true }] })).toMatchObject({ type: "single", correctIndex: 1 });
  });
});

describe("[NUM-04] schema soạn câu hỏi", () => {
  const base = { bankPath: "/an-toan/", type: "NUMERIC", stem: "Hoa hồng bao nhiêu đồng?", so: { dapAn: "120000", saiSo: "0" } };
  const loi = (x: unknown) => {
    const r = taoCauHoiSchema.safeParse(x);
    return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
  };
  it("hợp lệ: đáp án + sai số (rỗng = 0) + đơn vị + gợi ý", () => {
    expect(loi(base)).toBeNull();
    expect(loi({ ...base, so: { dapAn: "60,5", saiSo: "", donVi: "cm", goiY: "Đo lại" } })).toBeNull();
  });
  it("🔴 từng lỗi nói đúng Ô: đáp án không đọc được · sai số âm · thiếu `so` · có lựa chọn · đơn vị quá dài", () => {
    expect(loi({ ...base, so: { dapAn: "1.000,5", saiSo: "0" } })).toMatch(/so\.dapAn: Đáp án:/);
    expect(loi({ ...base, so: { dapAn: "abc", saiSo: "0" } })).toMatch(/so\.dapAn/);
    expect(loi({ ...base, so: { dapAn: "5", saiSo: "-1" } })).toMatch(/so\.saiSo: Sai số không được âm/);
    expect(loi({ ...base, so: undefined })).toMatch(/so: Câu nhập số phải có/);
    expect(loi({ ...base, choices: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] })).toMatch(/choices: Câu nhập số không có lựa chọn/);
    expect(loi({ ...base, so: { dapAn: "5", saiSo: "0", donVi: "x".repeat(21) } })).toMatch(/Đơn vị tối đa 20/);
  });
  it("loại KHÁC không được mang `so`; loại P6 chưa mở vẫn bị từ chối", () => {
    expect(loi({ bankPath: "/an-toan/", type: "TRUE_FALSE", stem: "Đúng hay sai?", choices: [{ text: "Đúng", isCorrect: true }, { text: "Sai", isCorrect: false }], so: { dapAn: "1", saiSo: "0" } })).toMatch(/Chỉ câu nhập số/);
    expect(loi({ ...base, type: "CLASSIFY" })).toMatch(/chưa dùng được trong đề thi/);
  });
});

describe("[NUM-05] chấm cả lượt (chamLuotThi) — textAnswer là câu trả lời", () => {
  const de = (id: string, content: unknown) => ({ id, points: 1, question: { type: "NUMERIC", contentJson: content } });
  it("câu đúng / sai / bỏ trống / hỏng khuôn; hỏng khuôn ⇒ chờ người (totalScore null)", () => {
    const r = chamLuotThi({
      cacCau: [de("a", SO), de("b", SO), de("c", SO)],
      traLoi: [
        { id: "1", examQuestionId: "a", selectedChoiceIds: [], textAnswer: "120000" },
        { id: "2", examQuestionId: "b", selectedChoiceIds: [], textAnswer: "5" },
      ],
      passScore: 1,
    });
    expect(r.ketCau.map((k) => (k.kq.cham === "MAY" ? [k.kq.dung, k.kq.diem] : "TAY"))).toEqual([[true, 1], [false, 0], [false, 0]]);
    expect(r.tong).toMatchObject({ totalScore: 1, passed: true, choChamTay: false });
    const hong = chamLuotThi({ cacCau: [de("a", { type: "numeric" })], traLoi: [], passScore: 1 });
    expect(hong.tong).toMatchObject({ totalScore: null, choChamTay: true });
  });
});

describe("[NUM-06] người học KHÔNG nhận đáp án/sai số/gợi ý", () => {
  function dbGia() {
    return {
      trnExamQuestion: { findMany: async () => [{ id: "eq1", points: 1, question: { stem: SO.question, type: "NUMERIC", contentJson: SO } }] },
      trnExamAnswer: { findMany: async () => [{ examQuestionId: "eq1", selectedChoiceIds: [], textAnswer: "60,5" }] },
    } as unknown as ScopedDb;
  }
  it("🔴 payload chứa đơn vị + chuỗi đã lưu, và KHÔNG chứa đáp án (120000), sai số, gợi ý", async () => {
    const l = await dungLuotDangLam(dbGia(), { id: "d", durationMin: 10, shuffleQuestions: false, shuffleChoices: false }, { id: "lt", startedAt: new Date() });
    const s = JSON.stringify(l);
    expect(l.cacCau[0]).toMatchObject({ type: "NUMERIC", donVi: "đ", textAnswer: "60,5", luaChon: [] });
    for (const bi of ["120000", "tolerance", "Nhân 4%", "answer"]) expect(s, bi).not.toContain(bi);
  });
});

describe("[NUM-07] nhãn đáp án đúng ở màn xem lại", () => {
  it("dấu phẩy thập phân, đơn vị, sai số chỉ khi > 0", () => {
    expect(nhanDapAnSo({ answer: 60.5, tolerance: 1, unit: "cm" })).toBe("60,5 cm (± 1)");
    expect(nhanDapAnSo({ answer: 120000, tolerance: 0, unit: "đ" })).toBe("120000 đ");
    expect(nhanDapAnSo({ answer: 3, tolerance: 0 })).toBe("3");
  });
});
