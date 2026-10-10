// @vitest-environment node
/**
 * EL-12b — điểm kiểm tra tập trung.
 *
 * Cơ chế này sai theo hai hướng, và hướng nào cũng tệ: hỏi quá ít thì nó không
 * chặn được gì, hỏi quá nhiều (hoặc ngưng ghi nhận quá sớm) thì nó phạt người
 * đang học thật. Các case dưới đây canh cả hai mép.
 */
import { describe, it, expect } from "vitest";
import {
  nenHoiTapTrung,
  tinhTrangThachThuc,
  traLoiHopLe,
  idThachThuc,
  CHU_KY_HOI_GIAY,
  HAN_TRA_LOI_GIAY,
} from "@/lib/elearning/attention-check";

const T0 = new Date("2026-08-25T10:00:00.000Z");
const sau = (giay: number) => new Date(T0.getTime() + giay * 1000);

describe("khi nào thì hỏi", () => {
  it("chưa đủ một chu kỳ ⇒ chưa hỏi", () => {
    expect(nenHoiTapTrung({ coveredSec: CHU_KY_HOI_GIAY - 1, daHoi: 0 })).toBe(false);
  });

  it("đủ một chu kỳ ⇒ hỏi", () => {
    expect(nenHoiTapTrung({ coveredSec: CHU_KY_HOI_GIAY, daHoi: 0 })).toBe(true);
  });

  it("hỏi rồi thì KHÔNG hỏi lại cho tới chu kỳ sau", () => {
    // Không có vế `daHoi` thì mỗi nhịp sau mốc đó đều sinh một câu hỏi mới —
    // người học bị hỏi liên tục vài giây một lần và bỏ bài.
    expect(nenHoiTapTrung({ coveredSec: CHU_KY_HOI_GIAY + 30, daHoi: 1 })).toBe(false);
    expect(nenHoiTapTrung({ coveredSec: CHU_KY_HOI_GIAY * 2, daHoi: 1 })).toBe(true);
  });

  it("nhịp nhảy vài giây một vẫn kích hoạt được", () => {
    // Bẫy: viết `coveredSec % chuKy === 0` thì gần như không bao giờ đúng, vì
    // mỗi nhịp cộng vài giây và hiếm khi rơi trúng bội số. Cơ chế sẽ im lặng
    // không bao giờ chạy — và không có gì báo.
    let daHoi = 0;
    // Cận phải VƯỢT mốc chu kỳ thứ hai: bước 7 giây dừng ở 476, chưa qua 480.
    for (let s = 0; s <= CHU_KY_HOI_GIAY * 2 + 10; s += 7) {
      if (nenHoiTapTrung({ coveredSec: s, daHoi })) daHoi += 1;
    }
    expect(daHoi).toBe(2);
  });

  it("chu kỳ 0 hoặc âm ⇒ tắt cơ chế, không chia cho 0", () => {
    expect(nenHoiTapTrung({ coveredSec: 9999, daHoi: 0, chuKyGiay: 0 })).toBe(false);
    expect(nenHoiTapTrung({ coveredSec: 9999, daHoi: 0, chuKyGiay: -5 })).toBe(false);
  });
});

describe("câu đang treo: ba tình trạng, KHÔNG phải hai", () => {
  it("chưa hỏi gì ⇒ KHONG_CO", () => {
    expect(tinhTrangThachThuc({ attnPendingAt: null, now: T0 })).toBe("KHONG_CO");
  });

  it("vừa hỏi xong ⇒ DANG_CHO, chưa phạt", () => {
    // Gộp DANG_CHO vào QUA_HAN là ngưng ghi nhận của người vừa được hỏi nửa giây
    // trước, lúc họ còn chưa đọc xong câu hỏi.
    expect(tinhTrangThachThuc({ attnPendingAt: T0, now: sau(1) })).toBe("DANG_CHO");
    expect(tinhTrangThachThuc({ attnPendingAt: T0, now: sau(HAN_TRA_LOI_GIAY) })).toBe(
      "DANG_CHO",
    );
  });

  it("quá hạn ⇒ QUA_HAN", () => {
    expect(
      tinhTrangThachThuc({ attnPendingAt: T0, now: sau(HAN_TRA_LOI_GIAY + 1) }),
    ).toBe("QUA_HAN");
  });
});

describe("trả lời là XÁC NHẬN CÓ MẶT", () => {
  it("đúng id câu đang treo ⇒ hợp lệ", () => {
    expect(traLoiHopLe({ traLoi: idThachThuc(T0), attnPendingAt: T0 })).toBe(true);
  });

  it("khoảng trắng thừa vẫn nhận", () => {
    expect(traLoiHopLe({ traLoi: ` ${idThachThuc(T0)} `, attnPendingAt: T0 })).toBe(true);
  });

  it("trả lời câu CŨ ⇒ không nhận", () => {
    // Nhịp cũ tới trễ mang theo đáp án của câu trước. Nhận nó là xoá câu đang
    // treo mà người học chưa hề thấy.
    expect(traLoiHopLe({ traLoi: idThachThuc(T0), attnPendingAt: sau(300) })).toBe(false);
  });

  it("đáp án rỗng / thiếu ⇒ không nhận", () => {
    for (const t of ["", "   ", null, undefined]) {
      expect(traLoiHopLe({ traLoi: t, attnPendingAt: T0 }), String(t)).toBe(false);
    }
  });

  it("không có câu nào treo thì mọi đáp án đều vô nghĩa", () => {
    expect(traLoiHopLe({ traLoi: "attn-123", attnPendingAt: null })).toBe(false);
  });
});
