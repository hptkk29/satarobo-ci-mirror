// @vitest-environment node
/**
 * EL-14 — chấm bài thi.
 *
 * Đây là chỗ một con số sai đi thẳng vào hồ sơ nhân sự. Nên bộ test đi theo hai
 * câu, và câu thứ nhất nặng hơn:
 *  1. Có chấm SAI người làm ĐÚNG không? (0 điểm cho người trả lời đúng, hoặc chốt
 *     trượt cho người chưa ai chấm bài)
 *  2. Có cho qua người làm sai không?
 */
import { describe, it, expect } from "vitest";
import {
  chamMotCau,
  tinhDiemLuot,
  soLuotChoPhep,
  conChoCooldown,
  hetGio,
  duocXemDapAn,
  chamMayDuoc,
  duocVaoDe,
  LOAI_CHAM_MAY,
  LOAI_CHAM_TAY,
  LOAI_CHUA_MO,
  AN_HAN_GIAY,
} from "@/lib/elearning/exam-grading";
import type { CauHoiCue } from "@/lib/elearning/lesson-cue";

const single: CauHoiCue = {
  id: "q1",
  type: "single",
  question: "Bước nào làm trước?",
  options: ["A", "B", "C"],
  correctIndex: 1,
};
const multiple: CauHoiCue = {
  id: "q2",
  type: "multiple",
  question: "Chọn các bước bắt buộc",
  options: ["A", "B", "C", "D"],
  correctIndices: [0, 2],
};

const cham = (o: Partial<Parameters<typeof chamMotCau>[0]> = {}) =>
  chamMotCau({ type: "SINGLE", cau: single, chon: [1], diemToiDa: 5, ...o });

// ── 1. Phân loại chấm máy / chấm tay ───────────────────────────────────────

describe("loại nào chấm được bằng máy", () => {
  it("đúng ba loại, không nhiều hơn", () => {
    // `isAutoGraded()` của repo trả `true` cho 6/8 loại nhưng repo KHÔNG có mã
    // chấm cho `FILL_BLANK`/`MATCHING`/`ORDERING`. Tin nó là cho điểm 0 người làm
    // đúng, trên một bài thi tính vào hồ sơ nhân sự.
    expect([...LOAI_CHAM_MAY]).toEqual(["SINGLE", "MULTIPLE", "TRUE_FALSE"]);
    for (const t of LOAI_CHUA_MO) expect(chamMayDuoc(t), t).toBe(false);
  });

  it("🔴 `SHORT_ANSWER` KHÔNG chấm máy", () => {
    // Repo có chỗ chấm nó bằng so chuỗi bằng-nhau-tuyệt-đối: "5" với "5.0" ra 0
    // điểm, "PCCC" với "pccc " ra 0 điểm. Chấm-máy giả dạng chấm-đúng.
    expect(chamMayDuoc("SHORT_ANSWER")).toBe(false);
    expect(cham({ type: "SHORT_ANSWER" })).toEqual({ cham: "TAY" });
  });

  it("loại CHƯA MỞ không được vào đề", () => {
    for (const t of LOAI_CHUA_MO) expect(duocVaoDe(t), t).toBe(false);
    for (const t of [...LOAI_CHAM_MAY, ...LOAI_CHAM_TAY]) {
      expect(duocVaoDe(t), t).toBe(true);
    }
  });
});

// ── 2. Chấm một câu ────────────────────────────────────────────────────────

describe("chấm một câu", () => {
  it("đúng ⇒ đủ điểm; sai ⇒ 0", () => {
    expect(cham()).toEqual({ cham: "MAY", dung: true, diem: 5 });
    expect(cham({ chon: [0] })).toEqual({ cham: "MAY", dung: false, diem: 0 });
  });

  it("câu nhiều đáp án: thiếu một ý ⇒ sai", () => {
    expect(cham({ type: "MULTIPLE", cau: multiple, chon: [0] }).cham).toBe("MAY");
    const r = cham({ type: "MULTIPLE", cau: multiple, chon: [0] });
    expect(r.cham === "MAY" && r.dung).toBe(false);
    const r2 = cham({ type: "MULTIPLE", cau: multiple, chon: [2, 0] });
    expect(r2.cham === "MAY" && r2.dung).toBe(true);
  });

  it("🔴 nội dung câu HỎNG ⇒ chuyển người chấm, KHÔNG cho 0 điểm", () => {
    // Một bản ghi bẩn do người soạn để lại không được biến thành điểm 0 của người
    // học — họ không làm gì sai, và không có đường nào kháng nghị một con số máy.
    expect(cham({ cau: null })).toEqual({ cham: "TAY" });
  });

  it("câu chấm tay KHÔNG trả điểm 0", () => {
    // `{dung:false, diem:0}` và `{cham:"TAY"}` là hai thứ khác nhau: cái đầu đóng
    // sổ, cái sau vào hàng chờ.
    const r = cham({ type: "ESSAY" });
    expect(r).toEqual({ cham: "TAY" });
    expect("diem" in r).toBe(false);
  });
});

// ── 3. Tổng điểm cả lượt ───────────────────────────────────────────────────

describe("tổng điểm một lượt", () => {
  it("chấm đủ ⇒ cộng và so ngưỡng", () => {
    const r = tinhDiemLuot({ cacCau: [{ diem: 5 }, { diem: 3 }], passScore: 8 });
    expect(r.totalScore).toBe(8);
    expect(r.passed).toBe(true);
  });

  it("🔴 bằng ĐÚNG điểm đạt là ĐẠT", () => {
    // Viết `>` thay vì `>=` là dời ngưỡng lên một điểm so với con số người soạn đề
    // đặt — im lặng, và người trượt oan không có cách nào biết.
    expect(tinhDiemLuot({ cacCau: [{ diem: 8 }], passScore: 8 }).passed).toBe(true);
    expect(tinhDiemLuot({ cacCau: [{ diem: 7 }], passScore: 8 }).passed).toBe(false);
  });

  it("🔴 còn MỘT câu chưa chấm ⇒ điểm và kết quả đều `null`", () => {
    // Cộng tạm phần đã chấm rồi so ngưỡng là chốt TRƯỢT cho người mà bài tự luận
    // của họ chưa ai đọc — và con số đó lên báo cáo tuân thủ như một sự thật.
    const r = tinhDiemLuot({ cacCau: [{ diem: 5 }, { diem: null }], passScore: 3 });
    expect(r.totalScore).toBeNull();
    expect(r.passed).toBeNull();
    expect(r.choChamTay).toBe(true);
  });

  it("lượt rỗng ⇒ 0 điểm, không ném", () => {
    const r = tinhDiemLuot({ cacCau: [], passScore: 1 });
    expect(r.totalScore).toBe(0);
    expect(r.passed).toBe(false);
  });
});

// ── 4. Trần lượt thi ───────────────────────────────────────────────────────

describe("số lượt được phép", () => {
  it("mở khoá cho THÊM một lượt, không reset, không nhân đôi", () => {
    // Reset thì mất lịch sử; nhân đôi thì mỗi lần mở khoá nới theo cấp số nhân, và
    // `previousAttemptCount` mất ý nghĩa.
    expect(soLuotChoPhep({ maxAttempts: 3, soLanMoKhoa: 0 })).toBe(3);
    expect(soLuotChoPhep({ maxAttempts: 3, soLanMoKhoa: 1 })).toBe(4);
    expect(soLuotChoPhep({ maxAttempts: 3, soLanMoKhoa: 2 })).toBe(5);
  });

  it("số âm không làm trần âm", () => {
    expect(soLuotChoPhep({ maxAttempts: -5, soLanMoKhoa: -2 })).toBe(0);
  });
});

// ── 5. Thời gian chờ giữa hai lượt ─────────────────────────────────────────

describe("thời gian chờ giữa hai lượt", () => {
  const T = new Date("2026-08-25T10:00:00.000Z");
  const sau = (gio: number) => new Date(T.getTime() + gio * 3_600_000);

  it("chưa thi lần nào ⇒ vào được ngay", () => {
    expect(conChoCooldown({ nopLanTruoc: null, cooldownHours: 24, now: T }).duoc).toBe(
      true,
    );
  });

  it("🔴 đúng biên 24 giờ là ĐƯỢC", () => {
    // Viết `>` thì người chờ tròn 24 giờ vẫn bị từ chối, và họ không hiểu vì sao
    // đồng hồ báo hết mà nút vẫn khoá.
    expect(conChoCooldown({ nopLanTruoc: T, cooldownHours: 24, now: sau(24) }).duoc).toBe(
      true,
    );
  });

  it("chưa đủ ⇒ nói còn bao nhiêu PHÚT, không nói suông", () => {
    const r = conChoCooldown({ nopLanTruoc: T, cooldownHours: 24, now: sau(23) });
    expect(r.duoc).toBe(false);
    if (r.duoc) return;
    expect(r.conLaiPhut).toBe(60);
  });

  it("cooldown 0 ⇒ không chờ", () => {
    expect(conChoCooldown({ nopLanTruoc: T, cooldownHours: 0, now: T }).duoc).toBe(true);
  });
});

// ── 6. Hết giờ làm bài ─────────────────────────────────────────────────────

describe("hết giờ làm bài", () => {
  const T = new Date("2026-08-25T10:00:00.000Z");
  const sauPhut = (p: number) => new Date(T.getTime() + p * 60_000);

  it("trong giờ ⇒ chưa hết", () => {
    expect(hetGio({ startedAt: T, durationMin: 30, now: sauPhut(29) })).toBe(false);
  });

  it("🔴 có ÂN HẠN — mạng chậm không được thành mất bài", () => {
    // Nộp đúng giây cuối mà đường truyền mất nửa phút thì bài vẫn phải được nhận.
    expect(hetGio({ startedAt: T, durationMin: 30, now: sauPhut(30) })).toBe(false);
    expect(
      hetGio({ startedAt: T, durationMin: 30, now: new Date(T.getTime() + 30 * 60_000 + AN_HAN_GIAY * 1000) }),
    ).toBe(false);
  });

  it("quá ân hạn ⇒ hết giờ", () => {
    expect(hetGio({ startedAt: T, durationMin: 30, now: sauPhut(32) })).toBe(true);
  });
});

// ── 7. Chính sách hiện đáp án ──────────────────────────────────────────────

describe("khi nào được xem đáp án", () => {
  it("`NEVER` ⇒ không bao giờ, kể cả khi đã hết lượt", () => {
    expect(
      duocXemDapAn({ policy: "NEVER", soLuotDaDung: 9, soLuotChoPhep: 3 }),
    ).toBe(false);
  });

  it("`AFTER_LAST_ATTEMPT` ⇒ chỉ khi đã hết lượt", () => {
    expect(
      duocXemDapAn({ policy: "AFTER_LAST_ATTEMPT", soLuotDaDung: 1, soLuotChoPhep: 3 }),
    ).toBe(false);
    expect(
      duocXemDapAn({ policy: "AFTER_LAST_ATTEMPT", soLuotDaDung: 3, soLuotChoPhep: 3 }),
    ).toBe(true);
  });

  it("`AFTER_EACH_ATTEMPT` ⇒ luôn được", () => {
    expect(
      duocXemDapAn({ policy: "AFTER_EACH_ATTEMPT", soLuotDaDung: 1, soLuotChoPhep: 3 }),
    ).toBe(true);
  });

  it("🔴 giá trị LẠ ⇒ chọn phía CHẶT", () => {
    // Đây là đường lộ đề. Đoán sai theo hướng dễ dãi thì cả ngân hàng câu hỏi mất
    // giá trị, và không lấy lại được.
    for (const p of ["", "LUNG_TUNG", "after_last_attempt"]) {
      expect(duocXemDapAn({ policy: p, soLuotDaDung: 9, soLuotChoPhep: 1 }), p).toBe(
        false,
      );
    }
  });
});
