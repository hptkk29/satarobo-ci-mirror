// @vitest-environment node
/**
 * F-05 — phần thuần của việc đóng lượt thi: chấm, hạn chót, biên chờ.
 */
import { describe, expect, it } from "vitest";
import {
  BIEN_MARGIN,
  docTuoiToiDaNgay,
  canDongLuot,
  chamLuotThi,
  docMarginPhut,
  hanChotLuot,
} from "@/lib/elearning/exam-close-pure";
import { AN_HAN_GIAY, hetGio } from "@/lib/elearning/exam-grading";

const T = new Date("2026-10-24T08:00:00.000Z");
const phut = (n: number) => new Date(T.getTime() + n * 60_000);

const CAU = (id: string, correctIndex: number) => ({
  id,
  points: 2,
  question: {
    type: "SINGLE",
    contentJson: { id: `q-${id}`, type: "single", question: "?", options: ["A", "B"], correctIndex },
  },
});

describe("[EAC-01] chamLuotThi — một nguồn chấm", () => {
  it("đúng/sai theo đáp án DB; bỏ trống = 0; không đụng câu trả lời", () => {
    const traLoi = [
      { id: "a1", examQuestionId: "e1", selectedChoiceIds: ["1"] },
      { id: "a2", examQuestionId: "e2", selectedChoiceIds: ["0"] },
    ];
    const truoc = JSON.stringify(traLoi);
    const r = chamLuotThi({ cacCau: [CAU("e1", 1), CAU("e2", 1), CAU("e3", 0)], traLoi, passScore: 3 });
    expect(r.tong.totalScore).toBe(2); // e1 đúng (2), e2 sai, e3 bỏ trống
    expect(r.tong.passed).toBe(false);
    expect(r.tong.choChamTay).toBe(false);
    expect(JSON.stringify(traLoi)).toBe(truoc);
  });

  it("đạt khi đủ ngưỡng", () => {
    const r = chamLuotThi({
      cacCau: [CAU("e1", 1)],
      traLoi: [{ id: "a1", examQuestionId: "e1", selectedChoiceIds: ["1"] }],
      passScore: 2,
    });
    expect(r.tong.passed).toBe(true);
  });

  it("có câu chấm tay ⇒ choChamTay, điểm/kết quả null (chưa ai chấm ≠ 0)", () => {
    const r = chamLuotThi({
      cacCau: [CAU("e1", 1), { id: "e2", points: 5, question: { type: "ESSAY", contentJson: {} } }],
      traLoi: [{ id: "a1", examQuestionId: "e1", selectedChoiceIds: ["1"] }],
      passScore: 3,
    });
    expect(r.tong.choChamTay).toBe(true);
    expect(r.tong.totalScore).toBeNull();
    expect(r.tong.passed).toBeNull();
  });

  it("không có câu trả lời nào ⇒ vẫn chấm được (0 điểm, trượt) — không ném", () => {
    const r = chamLuotThi({ cacCau: [CAU("e1", 1)], traLoi: [], passScore: 1 });
    expect(r.tong.totalScore).toBe(0);
    expect(r.tong.passed).toBe(false);
  });
});

describe("[EAC-02] hạn chót + biên chờ", () => {
  it("hanChotLuot = startedAt + durationMin, KHÔNG gồm ân hạn", () => {
    expect(hanChotLuot({ startedAt: T, durationMin: 30 }).getTime()).toBe(phut(30).getTime());
  });

  it("không đóng trong ân hạn + biên chờ; đóng ngay sau (biên là `>`)", () => {
    const i = { startedAt: T, durationMin: 30, marginPhut: 15 };
    const bien = phut(30 + 15).getTime() + AN_HAN_GIAY * 1000;
    expect(canDongLuot({ ...i, now: new Date(bien) })).toBe(false);
    expect(canDongLuot({ ...i, now: new Date(bien + 1) })).toBe(true);
    expect(canDongLuot({ ...i, now: phut(10) })).toBe(false); // đang làm bài
  });

  it("LUÔN đi sau cổng từ chối lưu câu: khi hệ thống được đóng thì `hetGio` đã true (tập câu đã đóng băng)", () => {
    for (const margin of [5, 15, 1440]) {
      const i = { startedAt: T, durationMin: 20 };
      const bien = hanChotLuot(i).getTime() + (AN_HAN_GIAY + margin * 60) * 1000 + 1;
      expect(canDongLuot({ ...i, now: new Date(bien), marginPhut: margin })).toBe(true);
      expect(hetGio({ ...i, now: new Date(bien) })).toBe(true);
    }
  });
});

describe("[EAC-03] docMarginPhut — sai ⇒ null (từ chối), không đoán", () => {
  it("không đặt / rỗng ⇒ 15", () => {
    expect(docMarginPhut(undefined)).toBe(15);
    expect(docMarginPhut("  ")).toBe(15);
  });
  it("hợp lệ 5–1440", () => {
    expect(docMarginPhut("5")).toBe(5);
    expect(docMarginPhut(" 30 ")).toBe(30);
    expect(docMarginPhut("1440")).toBe(1440);
  });
  it("ngoài biên hoặc không phải số nguyên ⇒ null", () => {
    for (const x of ["4", "1441", "0", "-5", "1.5", "abc", "5m", "1e3"]) expect(docMarginPhut(x), x).toBeNull();
  });
  it("tên biến khớp tài liệu", () => {
    expect(BIEN_MARGIN).toBe("ELEARNING_EXAM_AUTO_CLOSE_MARGIN_MIN");
  });
});

describe("[EAC-04] docTuoiToiDaNgay — đòn bẩy cho lượt tồn đọng cũ", () => {
  it("không đặt ⇒ undefined (không giới hạn)", () => {
    expect(docTuoiToiDaNgay(undefined)).toBeUndefined();
    expect(docTuoiToiDaNgay("  ")).toBeUndefined();
  });
  it("hợp lệ 1–3650", () => {
    expect(docTuoiToiDaNgay("1")).toBe(1);
    expect(docTuoiToiDaNgay(" 30 ")).toBe(30);
    expect(docTuoiToiDaNgay("3650")).toBe(3650);
  });
  it("sai ⇒ null (từ chối)", () => {
    for (const x of ["0", "3651", "-1", "1.5", "abc", "7d"]) expect(docTuoiToiDaNgay(x), x).toBeNull();
  });
});
