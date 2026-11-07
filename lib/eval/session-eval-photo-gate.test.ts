// F-04 — ảnh đính trong PHIẾU ĐÁNH GIÁ BUỔI HỌC (SESSION_EVAL, câu loại PHOTO) phải
// đi qua ĐÚNG cái cổng duyệt mà ảnh lớp đang đi. Trước bản vá, giáo viên bấm Lưu phiếu
// là ảnh hiện thẳng ở cổng phụ huynh (/portal/nhan-xet) — không ai duyệt, không ai biết.
//
// Bộ test này khoá 3 mảnh THUẦN của cổng; phần chạm DB (ghi bản sao vào hàng duyệt,
// đọc trạng thái) chỉ là dây nối mỏng quanh chúng.
import { describe, it, expect } from "vitest";
import {
  applyEvalPhotoGate,
  blockedEvalPhotoUrls,
  collectEvalPhotoUrls,
  type MirrorRow,
} from "@/lib/eval/session-eval-photo-gate";
import type { QuestionType } from "@/lib/eval/schema";

const QUESTIONS = [
  { id: "q1", type: "STAR_RATING" as QuestionType },
  { id: "q2", type: "PHOTO" as QuestionType },
  { id: "q3", type: "TEXTBOX" as QuestionType },
  { id: "q4", type: "PHOTO" as QuestionType },
];

describe("[F-04] collectEvalPhotoUrls — nhặt đúng ảnh của phiếu nhận xét", () => {
  it("chỉ lấy valueOptions của câu PHOTO, bỏ RADIO/CHECKBOX cùng dùng valueOptions", () => {
    const urls = collectEvalPhotoUrls(
      [
        { id: "qc", type: "CHECKBOX" as QuestionType },
        { id: "q2", type: "PHOTO" as QuestionType },
      ],
      [
        { questionId: "qc", valueOptions: ["Lắp ráp", "Lập trình"] },
        { questionId: "q2", valueOptions: ["class-media/a.jpg"] },
      ],
    );
    expect(urls).toEqual(["class-media/a.jpg"]);
  });

  it("khử trùng URL trùng nhau giữa nhiều câu / nhiều học viên", () => {
    const urls = collectEvalPhotoUrls(QUESTIONS, [
      { questionId: "q2", valueOptions: ["a.jpg", "b.jpg"] },
      { questionId: "q4", valueOptions: ["b.jpg", "c.jpg"] },
    ]);
    expect(urls).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("bỏ chuỗi rỗng / khoảng trắng và đáp án không có ảnh", () => {
    const urls = collectEvalPhotoUrls(QUESTIONS, [
      { questionId: "q2", valueOptions: ["", "   ", "a.jpg"] },
      { questionId: "q4", valueOptions: null },
      { questionId: "q1", valueOptions: null },
    ]);
    expect(urls).toEqual(["a.jpg"]);
  });

  it("bỏ đáp án của câu hỏi đã xoá (không khớp câu nào)", () => {
    expect(collectEvalPhotoUrls(QUESTIONS, [{ questionId: "ghost", valueOptions: ["x.jpg"] }])).toEqual(
      [],
    );
  });
});

describe("[F-04] blockedEvalPhotoUrls — ảnh nào KHÔNG được tới phụ huynh", () => {
  const rows = (list: MirrorRow[]) => blockedEvalPhotoUrls(list);

  it("PENDING = đang chờ QLCS duyệt → CHẶN", () => {
    expect(rows([{ fileUrl: "a.jpg", status: "PENDING" }]).has("a.jpg")).toBe(true);
  });

  it("REJECTED = QLCS đã từ chối → CHẶN", () => {
    expect(rows([{ fileUrl: "a.jpg", status: "REJECTED" }]).has("a.jpg")).toBe(true);
  });

  it("DRAFT = còn trong kho, chưa gửi duyệt → CHẶN", () => {
    expect(rows([{ fileUrl: "a.jpg", status: "DRAFT" }]).has("a.jpg")).toBe(true);
  });

  it("APPROVED → cho qua", () => {
    expect(rows([{ fileUrl: "a.jpg", status: "APPROVED" }]).has("a.jpg")).toBe(false);
  });

  it("cùng một file có nhiều bản ghi, chỉ cần MỘT bản APPROVED là cho qua", () => {
    const blocked = rows([
      { fileUrl: "a.jpg", status: "PENDING" },
      { fileUrl: "a.jpg", status: "APPROVED" },
    ]);
    expect(blocked.has("a.jpg")).toBe(false);
  });

  it("ảnh KHÔNG có bản ghi nào trong hàng duyệt = ảnh cũ trước ngày vá → giữ nguyên hiển thị", () => {
    // Điều khoản chuyển tiếp cố ý: ảnh phụ huynh đang xem không được biến mất khi
    // bản vá lên. Ảnh MỚI luôn được ghi bản sao vào hàng duyệt trong CÙNG transaction
    // với phiếu, nên "không có bản ghi" chỉ có thể là ảnh lưu trước bản vá.
    const blocked = rows([{ fileUrl: "khac.jpg", status: "PENDING" }]);
    expect(blocked.has("cu.jpg")).toBe(false);
  });
});

describe("[F-04] applyEvalPhotoGate — lọc ảnh khỏi phiếu trước khi trả phụ huynh", () => {
  const photoAnswer = (id: string, photos: string[] | null) => ({
    questionId: id,
    type: "PHOTO" as QuestionType,
    photos,
    text: null,
  });

  it("bỏ đúng ảnh bị chặn, giữ ảnh đã duyệt trong cùng một câu", () => {
    const out = applyEvalPhotoGate(
      [photoAnswer("q2", ["ok.jpg", "cho.jpg"])],
      new Set(["cho.jpg"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.photos).toEqual(["ok.jpg"]);
  });

  it("chặn hết ảnh → bỏ hẳn câu, không để lại ô ảnh trống ở cổng phụ huynh", () => {
    expect(applyEvalPhotoGate([photoAnswer("q2", ["a.jpg"])], new Set(["a.jpg"]))).toEqual([]);
  });

  it("không đụng câu không phải PHOTO", () => {
    const text = { questionId: "q3", type: "TEXTBOX" as QuestionType, photos: null, text: "tốt" };
    expect(applyEvalPhotoGate([text], new Set(["a.jpg"]))).toEqual([text]);
  });

  it("không có ảnh nào bị chặn → trả về nguyên trạng", () => {
    const list = [photoAnswer("q2", ["a.jpg", "b.jpg"])];
    expect(applyEvalPhotoGate(list, new Set())).toEqual(list);
  });
});
