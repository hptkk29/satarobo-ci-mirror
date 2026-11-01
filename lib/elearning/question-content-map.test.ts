// @vitest-environment node
/**
 * EL-14 — VÒNG TRÒN writer → reader.
 *
 * ⚠️ ĐÂY là phép kiểm đã THIẾU, và thiếu nó suýt cho một lỗi chặn đứng cả chuỗi đi
 * lên `test`.
 *
 * Kho câu hỏi ghi `TrnQuestion.contentJson`; đường thi đọc cột đó bằng
 * `cueInlineSchema`. Hai bên là hai tệp khác nhau, và `contentJson` khai `Json` —
 * nên TypeScript KHÔNG nối chúng, và không có gì bắt được khi chúng lệch nhau.
 *
 * Bộ test cũ dựng fixture TAY theo khuôn của reader, tức nó kiểm reader trên một
 * dữ liệu mà writer không bao giờ tạo ra. Test ở đây làm ngược lại: chạy ĐÚNG đầu
 * ra của writer qua ĐÚNG khuôn của reader, rồi chấm thử một đáp án đúng.
 */
import { describe, it, expect } from "vitest";
import { cueInlineSchema, laCauChamDuoc, chamCue, locCauHoiChoNguoiHoc } from "@/lib/elearning/lesson-cue";
import {
  dungNoiDungCauHoi,
  docLuaChonTuNoiDung,
  LOAI_NOI_DUNG,
} from "@/lib/elearning/question-content-map";
import { LOAI_CHAM_MAY, LOAI_CHAM_TAY } from "@/lib/elearning/exam-grading";
import {
  TRAN_NOI_DUNG_CAU,
  TRAN_LUA_CHON,
} from "@/lib/assignments/question-content-db";
import { taoCauHoiSchema } from "@/lib/elearning/question-bank";

const LUA_CHON = [
  { text: "Ngắt điện", isCorrect: false },
  { text: "Báo động rồi ngắt điện", isCorrect: true },
  { text: "Chạy ra ngoài", isCorrect: false },
];

const ghi = (type: string, choices = LUA_CHON) =>
  dungNoiDungCauHoi({
    questionId: "q-abc",
    type,
    stem: "Gặp cháy tủ điện thì làm gì trước?",
    choices,
  });

describe("🔴 đầu ra của WRITER phải qua được khuôn của READER", () => {
  it("mọi loại CHẤM MÁY đều parse được", () => {
    for (const t of LOAI_CHAM_MAY) {
      const r = cueInlineSchema.safeParse(ghi(t));
      expect(r.success, `${t}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`).toBe(
        true,
      );
    }
  });

  it("và `laCauChamDuoc` nhận chúng", () => {
    for (const t of LOAI_CHAM_MAY) {
      const r = cueInlineSchema.safeParse(ghi(t));
      expect(r.success && laCauChamDuoc(r.data), t).toBe(true);
    }
  });

  it("🔴 chấm một ĐÁP ÁN ĐÚNG ra ĐÚNG — vòng tròn khép kín", () => {
    // Đây là phép kiểm thật sự: dữ liệu đi từ tay người soạn, qua writer, qua
    // reader, qua bộ lọc gửi xuống người học, rồi quay lại bộ chấm.
    for (const t of LOAI_CHAM_MAY) {
      const r = cueInlineSchema.safeParse(ghi(t));
      expect(r.success, t).toBe(true);
      if (!r.success || !laCauChamDuoc(r.data)) continue;

      const loc = locCauHoiChoNguoiHoc(r.data);
      // Mã của ô người soạn đánh dấu đúng.
      const maDung = loc.luaChon[1]!.ma;
      expect(chamCue(r.data, maDung), t).toBe(true);
      // Và một ô SAI phải ra sai.
      expect(chamCue(r.data, loc.luaChon[0]!.ma), t).toBe(false);
    }
  });

  it("câu NHIỀU đáp án: chấm đúng khi chọn đủ tập", () => {
    const ds = [
      { text: "A", isCorrect: true },
      { text: "B", isCorrect: false },
      { text: "C", isCorrect: true },
    ];
    const r = cueInlineSchema.safeParse(ghi("MULTIPLE", ds));
    expect(r.success).toBe(true);
    if (!r.success || !laCauChamDuoc(r.data)) return;
    expect(chamCue(r.data, "0,2")).toBe(true);
    expect(chamCue(r.data, "0")).toBe(false);
  });
});

describe("🔴 `TRUE_FALSE` dịch sang `single`, không sang `boolean`", () => {
  it("khuôn ra là `single`, mã lựa chọn là CHỈ SỐ", () => {
    // Khuôn `boolean` sinh mã chuỗi `"true"`/`"false"`, mà đường lưu câu trả lời
    // chỉ nhận chỉ số — câu Đúng/Sai sẽ không gửi được đáp án. Bug đó chưa nổ chỉ
    // vì `contentJson` chưa bao giờ parse được; sửa khuôn mà không sửa chỗ này là
    // đánh thức nó.
    const q = ghi("TRUE_FALSE", [
      { text: "Đúng", isCorrect: false },
      { text: "Sai", isCorrect: true },
    ]);
    expect(q.type).toBe("single");
    const r = cueInlineSchema.safeParse(q);
    expect(r.success).toBe(true);
    if (!r.success || !laCauChamDuoc(r.data)) return;
    for (const lc of locCauHoiChoNguoiHoc(r.data).luaChon) {
      expect(Number.isInteger(Number(lc.ma)), lc.ma).toBe(true);
    }
    expect(chamCue(r.data, "1")).toBe(true);
  });

  it("cột `type` của DB vẫn giữ `TRUE_FALSE` cho báo cáo", () => {
    // Chỉ KHUÔN NỘI DUNG đổi; loại của bản ghi không đổi.
    expect(LOAI_NOI_DUNG.TRUE_FALSE).toBe("single");
    expect(LOAI_NOI_DUNG.SINGLE).toBe("single");
    expect(LOAI_NOI_DUNG.MULTIPLE).toBe("multiple");
  });
});

describe("loại chấm TAY", () => {
  it("dịch được, và CỐ Ý không qua khuôn cue", () => {
    // Câu tự luận không phải câu chấm máy — `cueInlineSchema` từ chối là đúng, và
    // đường đọc hiểu `null` là "hiện ô gõ chữ".
    for (const t of LOAI_CHAM_TAY) {
      const q = ghi(t, []);
      expect(q.question).toBeTruthy();
      expect(cueInlineSchema.safeParse(q).success, t).toBe(false);
    }
  });
});

describe("đọc ngược cho trình soạn", () => {
  it("vòng tròn writer → reader → trình soạn giữ nguyên đánh dấu", () => {
    // Hai chiều phải đi qua CÙNG một chỗ, nếu không chúng trôi khỏi nhau đúng như
    // lần vừa rồi.
    const q = ghi("SINGLE");
    expect(docLuaChonTuNoiDung(q)).toEqual(LUA_CHON);
  });

  it("câu nhiều đáp án giữ đủ các ô đúng", () => {
    const ds = [
      { text: "A", isCorrect: true },
      { text: "B", isCorrect: false },
      { text: "C", isCorrect: true },
    ];
    expect(docLuaChonTuNoiDung(ghi("MULTIPLE", ds))).toEqual(ds);
  });

  it("dữ liệu rác ⇒ mảng rỗng, không ném", () => {
    for (const x of [null, undefined, 42, "rac", {}, { options: "khong-phai-mang" }]) {
      expect(docLuaChonTuNoiDung(x), String(x)).toEqual([]);
    }
  });
});

describe("không đánh dấu ô nào ⇒ KHÔNG ra chỉ số âm", () => {
  it("rơi về ô đầu thay vì `-1`", () => {
    // Zod của kho câu hỏi đã chặn ca này, nhưng `-1` lọt xuống là câu KHÔNG AI trả
    // lời đúng được — im lặng, vĩnh viễn.
    const q = ghi("SINGLE", [
      { text: "A", isCorrect: false },
      { text: "B", isCorrect: false },
    ]);
    expect(q.type === "single" && q.correctIndex).toBe(0);
  });
});

describe("🔴 TRẦN ĐỘ DÀI của bên GHI không được rộng hơn bên ĐỌC", () => {
  // Đây là cách chuỗi đứt LẦN THỨ HAI, sau lần khuôn nội dung lệch nhau: kho câu
  // hỏi từng cho `stem` tới 4000 và mỗi lựa chọn tới 1000, trong khi khuôn ĐỌC cắt
  // ở 2000/500. Người soạn gõ một đề bài dài — hợp lệ theo màn soạn, không có gì
  // đỏ — là đẻ ra một câu mà đường thi KHÔNG parse nổi. Câu đó rơi vào nhánh "chờ
  // người chấm", kéo MỌI lượt của MỌI người trên đề đó treo lại.
  it("câu dài ĐÚNG BẰNG trần vẫn qua được khuôn đọc", () => {
    const q = dungNoiDungCauHoi({
      questionId: "q-dai",
      type: "SINGLE",
      stem: "x".repeat(TRAN_NOI_DUNG_CAU),
      choices: [
        { text: "a".repeat(TRAN_LUA_CHON), isCorrect: true },
        { text: "b", isCorrect: false },
      ],
    });
    const r = cueInlineSchema.safeParse(q);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues[0])).toBe(true);
  });

  it("và chính Zod của kho câu hỏi CHẶN ở đúng hai con số đó", () => {
    // Kiểm hai chiều: khuôn đọc nhận được tới trần, và khuôn ghi không cho vượt.
    const oke = taoCauHoiSchema.safeParse({
      bankPath: "/an-toan/",
      type: "SINGLE",
      stem: "x".repeat(TRAN_NOI_DUNG_CAU),
      choices: [
        { text: "a".repeat(TRAN_LUA_CHON), isCorrect: true },
        { text: "b", isCorrect: false },
      ],
    });
    expect(oke.success).toBe(true);

    for (const qua of [
      { stem: "x".repeat(TRAN_NOI_DUNG_CAU + 1), choices: undefined },
      { stem: "Câu hỏi", choices: TRAN_LUA_CHON + 1 },
    ]) {
      const r = taoCauHoiSchema.safeParse({
        bankPath: "/an-toan/",
        type: "SINGLE",
        stem: qua.stem,
        choices: [
          { text: "a".repeat(qua.choices ?? 1), isCorrect: true },
          { text: "b", isCorrect: false },
        ],
      });
      expect(r.success).toBe(false);
    }
  });
});