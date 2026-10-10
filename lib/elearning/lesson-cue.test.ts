// @vitest-environment node
/**
 * EL-12b — câu hỏi chèn giữa video.
 *
 * Cơ chế này CHẶN video. Nên bộ test đi theo hai câu hỏi, và câu thứ hai nặng hơn:
 *  1. Nó có chặn đúng thứ phải chặn không?
 *  2. Nó có KHOÁ CỨNG người học thật không? — cue chặn mà không ai gỡ được là
 *     người học không đi tiếp được, và bài đó có hạn chót cứng.
 */
import { describe, it, expect } from "vitest";
import {
  chamCue,
  chonCueDeHoi,
  cueInlineSchema,
  locCauHoiChoNguoiHoc,
  docSoCue,
  daXongCue,
  idCue,
  cueIdTu,
  laCauChamDuoc,
  quyetDinhCue,
  LOAI_CUE,
  SO_CUE_RONG,
  type CauHoiCue,
  type SoCue,
} from "@/lib/elearning/lesson-cue";

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
const bool: CauHoiCue = {
  id: "q3",
  type: "boolean",
  question: "Có bắt buộc đeo găng không?",
  correct: true,
};

// ── 1. Chấm ─────────────────────────────────────────────────────────────────

describe("chấm câu một-đáp-án", () => {
  it("đúng chỉ số ⇒ đúng", () => {
    expect(chamCue(single, "1")).toBe(true);
  });
  it("sai chỉ số ⇒ sai", () => {
    expect(chamCue(single, "0")).toBe(false);
  });
  it("khoảng trắng thừa vẫn nhận", () => {
    expect(chamCue(single, " 1 ")).toBe(true);
  });
  it("rác / rỗng / thiếu ⇒ SAI, không ném", () => {
    // Ném ở đây là biến một đáp án bẩn thành lỗi 500 giữa lúc người ta đang học.
    for (const x of ["", "  ", "abc", "1.5", null, undefined]) {
      expect(chamCue(single, x), String(x)).toBe(false);
    }
  });
});

describe("chấm câu đúng/sai", () => {
  it("khớp thì đúng, ngược thì sai", () => {
    expect(chamCue(bool, "true")).toBe(true);
    expect(chamCue(bool, "false")).toBe(false);
    expect(chamCue({ ...bool, correct: false }, "false")).toBe(true);
  });
  it("chuỗi lạ tính là SAI, không tính là false", () => {
    // `"xyz" === "true"` là false, nên câu có đáp án đúng `false` sẽ được chấm
    // ĐÚNG cho một đáp án vô nghĩa nếu viết ẩu.
    expect(chamCue({ ...bool, correct: false }, "xyz")).toBe(false);
  });
});

describe("chấm câu nhiều-đáp-án", () => {
  it("chọn đủ và đúng ⇒ đúng, bất kể thứ tự bấm", () => {
    expect(chamCue(multiple, "0,2")).toBe(true);
    expect(chamCue(multiple, "2,0")).toBe(true);
    expect(chamCue(multiple, " 2 , 0 ")).toBe(true);
  });

  it("🔴 chọn THIẾU ⇒ SAI", () => {
    // Thiếu vế "đủ số lượng" thì chọn đại một ý đúng cũng được tính đúng — và câu
    // 4 lựa chọn trở thành câu ai bấm bừa cũng qua.
    expect(chamCue(multiple, "0")).toBe(false);
    expect(chamCue(multiple, "2")).toBe(false);
  });

  it("🔴 gửi TRÙNG một chỉ số không lách được", () => {
    // Không khử trùng thì `"0,0"` có độ dài 2 và khớp câu có hai đáp án đúng
    // `[0,1]` — tức chọn một ý rồi gửi lặp lại là qua được câu hỏi mà không biết
    // ý thứ hai là gì.
    expect(chamCue(multiple, "0,0")).toBe(false);
    expect(chamCue(multiple, "2,2")).toBe(false);
    // Nhưng lặp một ý ĐÃ nằm trong tập đúng thì vẫn đúng: tập chọn vẫn là {0,2}.
    // Tính chất phải giữ là "lặp không thay được ý còn thiếu", không phải "cấm lặp".
    expect(chamCue(multiple, "0,2,2")).toBe(true);
  });

  it("chọn THỪA ⇒ sai", () => {
    expect(chamCue(multiple, "0,1,2")).toBe(false);
  });

  it("chọn đúng số lượng nhưng sai ý ⇒ sai", () => {
    expect(chamCue(multiple, "1,3")).toBe(false);
  });
});

// ── 2. Không rò đáp án ──────────────────────────────────────────────────────

describe("🔴 phần gửi xuống người học KHÔNG mang đáp án", () => {
  it("câu một-đáp-án: không có `correctIndex`", () => {
    // Bơm cả cục `inlineJson` xuống là gửi kèm đáp án trong thân phản hồi. Không
    // ai thấy trên màn hình, nhưng nó nằm trong tab Network — và cơ chế chống học
    // đối phó bị vô hiệu bằng một cú F12.
    const s = JSON.stringify(locCauHoiChoNguoiHoc(single));
    expect(s).not.toContain("correctIndex");
    expect(s).toContain("Bước nào làm trước");
  });

  it("câu nhiều-đáp-án: không có `correctIndices`", () => {
    expect(JSON.stringify(locCauHoiChoNguoiHoc(multiple))).not.toContain("correctIndices");
  });

  it("câu đúng/sai: không lộ vế đúng, và có đủ hai lựa chọn", () => {
    const r = locCauHoiChoNguoiHoc(bool);
    expect(JSON.stringify(r)).not.toContain('"correct"');
    expect(r.luaChon.map((x) => x.ma)).toEqual(["true", "false"]);
  });

  it("mã lựa chọn KHỚP thứ tự chấm", () => {
    // Nhãn và mã lệch nhau thì người bấm đúng bị chấm sai, và không ai lần ra.
    const r = locCauHoiChoNguoiHoc(single);
    const maDung = r.luaChon[single.correctIndex]!.ma;
    expect(chamCue(single, maDung)).toBe(true);
  });
});

// ── 3. Chỉ nhận loại chấm được ─────────────────────────────────────────────

describe("🔴 chỉ nhận ba loại câu CHẤM ĐƯỢC", () => {
  it("ba loại hợp lệ đi qua", () => {
    for (const q of [single, multiple, bool]) {
      expect(cueInlineSchema.safeParse(q).success, q.type).toBe(true);
    }
  });

  it("loại KHÔNG ai chấm được bị từ chối ngay lúc soạn", () => {
    // `isAutoGraded()` của repo nói `fill`/`matching`/`ordering` chấm tự động
    // được, nhưng KHÔNG có một đoạn mã nào chấm chúng. Mà cue mặc định CHẶN video
    // ⇒ câu không ai chấm nổi = video khoá cứng vĩnh viễn, và người học không có
    // đường nào ngoài bỏ bài.
    const fill = {
      id: "q9",
      type: "fill",
      question: "Điền vào chỗ trống",
      answers: ["x"],
    };
    const r = cueInlineSchema.safeParse(fill);
    expect(r.success).toBe(false);
  });

  it("câu chấm tay (tự luận) bị từ chối", () => {
    const essay = { id: "q8", type: "essay", question: "Trình bày quy trình" };
    expect(cueInlineSchema.safeParse(essay).success).toBe(false);
  });

  it("`laCauChamDuoc` khớp đúng danh sách", () => {
    expect(LOAI_CUE.every((t) => laCauChamDuoc({ type: t } as never))).toBe(true);
    expect(laCauChamDuoc({ type: "essay" } as never)).toBe(false);
  });
});

// ── 4. Chọn cue để hỏi ──────────────────────────────────────────────────────

describe("chọn cue theo KHOẢNG VỪA XEM", () => {
  const cues = [
    { id: "c1", atSec: 30, blocking: true },
    { id: "c2", atSec: 60, blocking: true },
    { id: "c3", atSec: 90, blocking: true },
  ];
  const chon = (tuSec: number, denSec: number, so: SoCue = SO_CUE_RONG) =>
    chonCueDeHoi({ cues, tuSec, denSec, so });

  it("mốc nằm trong khoảng ⇒ bung", () => {
    expect(chon(25, 35)?.id).toBe("c1");
  });

  it("mốc NGOÀI khoảng ⇒ không bung", () => {
    expect(chon(0, 20)).toBeNull();
    expect(chon(35, 50)).toBeNull();
  });

  it("nhiều mốc trong một khoảng ⇒ lấy mốc SỚM NHẤT", () => {
    // Lấy cái muộn nhất là nhảy qua đầu người học một câu họ chưa từng thấy.
    expect(chon(0, 100)?.id).toBe("c1");
  });

  it("🔴 mốc ngay RANH GIỚI không bị hỏi hai lần", () => {
    // Khoảng nhịp trước kết ở đúng giây 30. Đóng cả hai đầu thì cue ở giây 30 bung
    // lại ở mỗi nhịp, và người học bị hỏi cùng một câu liên tục.
    expect(chon(20, 30)?.id).toBe("c1");
    expect(chon(30, 40)).toBeNull();
  });

  it("cue ĐÃ XONG thì không hỏi lại", () => {
    const so: SoCue = { v: 1, treo: null, xong: [{ cueId: "c1", dung: true }] };
    expect(chon(0, 100, so)?.id).toBe("c2");
  });

  it("trả lời SAI vẫn tính là xong — không hỏi lại vô hạn", () => {
    // Người trả lời sai đã được cho trả lời lại tại chỗ. Hỏi lại ở nhịp sau nữa là
    // họ không bao giờ đi qua được giây đó.
    const so: SoCue = { v: 1, treo: null, xong: [{ cueId: "c1", dung: false }] };
    expect(chon(0, 100, so)?.id).toBe("c2");
  });

  it("khoảng LÙI hoặc rỗng ⇒ không bung gì", () => {
    // Tua lùi rồi xem lại không được biến thành một tràng câu hỏi.
    expect(chon(100, 50)).toBeNull();
    expect(chon(60, 60)).toBeNull();
  });

  it("bài KHÔNG có cue ⇒ null, không ném", () => {
    expect(chonCueDeHoi({ cues: [], tuSec: 0, denSec: 100, so: SO_CUE_RONG })).toBeNull();
  });
});

// ── 5. Id thách thức ────────────────────────────────────────────────────────

describe("🔴 id thách thức phân biệt được LOẠI", () => {
  it("cue mang tiền tố riêng", () => {
    expect(idCue("abc")).toBe("cue-abc");
    expect(cueIdTu("cue-abc")).toBe("abc");
  });

  it("id của cơ chế TẬP TRUNG không lọt vào đường cue", () => {
    // Hai loại thách thức đi chung một đường trả lời. Không kiểm tiền tố thì câu
    // trả lời của loại này được ghi nhận cho loại kia, và không cách nào phát hiện
    // vì cả hai đều hợp lệ về cú pháp.
    expect(cueIdTu("attn-1787000000000")).toBeNull();
  });

  it("id rác ⇒ null", () => {
    for (const x of ["", "cue-", "xyz", null, undefined]) {
      expect(cueIdTu(x), String(x)).toBeNull();
    }
  });
});

// ── 6. Sổ trả lời ───────────────────────────────────────────────────────────

describe("sổ trả lời cue", () => {
  it("sổ hợp lệ đọc được", () => {
    const so = docSoCue({ v: 1, treo: null, xong: [{ cueId: "c1", dung: true }] });
    expect(daXongCue(so, "c1")).toBe(true);
  });

  it("🔴 sổ HỎNG ⇒ sổ rỗng, KHÔNG ném", () => {
    // Một bản ghi JSON sai khuôn không được phép chặn người học xem tiếp. Hỏi lại
    // một câu là phiền; ném lỗi giữa lúc học là hỏng.
    for (const x of [null, undefined, 42, "rac", { v: 99 }, { xong: "khong-phai-mang" }]) {
      const so = docSoCue(x);
      expect(so.xong, JSON.stringify(x)).toEqual([]);
    }
  });

  it("sổ có bằng chứng TÁCH khỏi chi tiết hành vi", () => {
    // Đường cắt này để cron dọn 90 ngày xoá được `hanhVi` mà không đụng `xong` —
    // `xong` là lý do một người được ghi "đã hoàn thành" một bài bắt buộc.
    const so = docSoCue({
      v: 1,
      treo: null,
      xong: [{ cueId: "c1", dung: true }],
      hanhVi: [{ cueId: "c1", askedAt: "x", answeredAt: "y", soLanSai: 2 }],
    });
    expect(so.xong).toHaveLength(1);
    expect(so.hanhVi).toHaveLength(1);
    // Xoá `hanhVi` không làm hỏng sổ.
    expect(docSoCue({ ...so, hanhVi: [] }).xong).toHaveLength(1);
  });
});

// ── 7. Quyết định cho một nhịp ─────────────────────────────────────────────

describe("quyết định cue cho một nhịp", () => {
  const day = (id: string, atSec: number, o: Record<string, unknown> = {}) => ({
    id,
    atSec,
    blocking: true,
    inlineJson: single,
    ...o,
  });
  const NOW = new Date("2026-08-25T10:00:00.000Z");
  const qd = (i: Record<string, unknown>) =>
    quyetDinhCue({
      cues: [day("c1", 30)],
      so: SO_CUE_RONG,
      tuSec: 0,
      denSec: 100,
      traLoi: null,
      now: NOW,
      ...i,
    } as never);

  it("chạm mốc ⇒ HỎI, và cắt tại đúng mốc", () => {
    const r = qd({});
    expect(r.loai).toBe("HOI");
    if (r.loai !== "HOI") return;
    // Cắt ở mốc, không ở cuối khoảng: video dừng tại đó.
    expect(r.catDen).toBe(30);
    expect(r.so.treo?.cueId).toBe("c1");
  });

  it("không chạm mốc nào ⇒ ĐI TIẾP, sổ không đổi", () => {
    const r = qd({ tuSec: 40, denSec: 50 });
    expect(r.loai).toBe("DI_TIEP");
    if (r.loai !== "DI_TIEP") return;
    // `null` = không có gì phải ghi. Trả sổ mới mỗi nhịp là một lượt ghi DB thừa
    // cho mỗi người đang xem, mỗi 15 giây.
    expect(r.so).toBeNull();
  });

  it("🔴 cue THỨ HAI trong cùng nhịp không bị bỏ qua", () => {
    // Hai mốc gần nhau (màn soạn chỉ cấm trùng GIÂY). Trả lời đúng cái thứ nhất
    // rồi đi tiếp là bỏ luôn cái thứ hai — mốc đã trôi qua, không nhịp nào chạm
    // lại, và bài vẫn được chấm hoàn thành.
    const r = quyetDinhCue({
      cues: [day("c1", 30), day("c2", 35)],
      so: {
        v: 1,
        treo: { cueId: "c1", hoiLuc: NOW.toISOString(), soLanSai: 0 },
        xong: [],
      },
      tuSec: 0,
      denSec: 100,
      traLoi: { id: "cue-c1", dapAn: "1" },
      now: NOW,
    });
    expect(r.loai).toBe("HOI");
    if (r.loai !== "HOI") return;
    expect(r.cueId).toBe("c2");
  });

  it("câu HỎNG không chặn, và không nuốt mốc sau nó", () => {
    const r = quyetDinhCue({
      cues: [day("c1", 30, { inlineJson: { type: "essay" } }), day("c2", 35)],
      so: SO_CUE_RONG,
      tuSec: 0,
      denSec: 100,
      traLoi: null,
      now: NOW,
    });
    expect(r.loai).toBe("HOI");
    if (r.loai !== "HOI") return;
    expect(r.cueId).toBe("c2");
  });

  it("bài KHÔNG có cue ⇒ đi tiếp ngay, không đụng sổ", () => {
    const r = qd({ cues: [] });
    expect(r.loai).toBe("DI_TIEP");
    if (r.loai !== "DI_TIEP") return;
    expect(r.so).toBeNull();
  });

  it("cue treo bị XOÁ ⇒ gỡ treo, không khoá vĩnh viễn", () => {
    const r = quyetDinhCue({
      cues: [],
      so: { v: 1, treo: { cueId: "da-xoa", hoiLuc: NOW.toISOString(), soLanSai: 0 }, xong: [] },
      tuSec: 0,
      denSec: 100,
      traLoi: null,
      now: NOW,
    });
    // Bài không còn cue nào ⇒ thoát ngay ở nhánh đầu.
    expect(r.loai).toBe("DI_TIEP");
  });
});
