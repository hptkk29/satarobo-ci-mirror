// @vitest-environment node
/**
 * Bài video phát bằng YouTube — phát hiện người học TUA.
 *
 * Trình phát nhúng của YouTube không bắn `seeking`, nên chặn tua (và đo đúng đoạn nào
 * đã xem) dựa hết vào hàm này. Hai chiều sai đều tai hại:
 *  · bỏ sót một cú tua tới ⇒ rào chặn tua ở client không chạy;
 *  · báo nhầm khi chỉ là tải đệm / timer chậm ⇒ kéo người đang học thật về chỗ cũ.
 */
import { describe, it, expect } from "vitest";
import {
  phatHienNhay,
  DUNG_SAI_TIEN_GIAY,
  DUNG_SAI_LUI_GIAY,
} from "@/lib/elearning/youtube-nhay";

const co = (o: Partial<Parameters<typeof phatHienNhay>[0]>) =>
  phatHienNhay({
    truoc: 10,
    truocMs: 0,
    nay: 10.5,
    nayMs: 500,
    tocDo: 1,
    dangPhat: true,
    ...o,
  });

describe("[YTN-01] phát bình thường KHÔNG phải là tua", () => {
  it("vị trí đi đúng tốc độ thực", () => {
    expect(co({})).toBeNull();
  });

  it("tốc độ 1.5x: lẽ ra đi nhanh gấp rưỡi", () => {
    expect(co({ tocDo: 1.5, nay: 10.75 })).toBeNull();
  });

  it("timer bị trình duyệt trì hoãn (hỏi sau 3 giây) vẫn không báo", () => {
    expect(co({ nayMs: 3000, nay: 13 })).toBeNull();
  });

  it("đang tải đệm: vị trí đứng yên ⇒ không báo (không phải tua lùi)", () => {
    expect(co({ nayMs: 5000, nay: 10 })).toBeNull();
  });
});

describe("[YTN-02] tua TỚI", () => {
  it("nhảy xa hơn lẽ ra ⇒ TIEN", () => {
    expect(co({ nay: 300 })).toBe("TIEN");
  });

  it("đang TẠM DỪNG mà vị trí nhảy ⇒ TIEN (kéo thanh tua lúc dừng)", () => {
    expect(co({ dangPhat: false, nay: 60, nayMs: 2000 })).toBe("TIEN");
  });

  it("ngưỡng: vượt dung sai một chút thì báo, đúng bằng dung sai thì không", () => {
    expect(co({ nay: 10.5 + DUNG_SAI_TIEN_GIAY + 0.01 })).toBe("TIEN");
    expect(co({ nay: 10.5 + DUNG_SAI_TIEN_GIAY })).toBeNull();
  });

  it("tốc độ ĐƯỢC TÍNH vào lẽ ra — tốc độ cao không bị báo nhầm", () => {
    // Nếu hàm quên nhân tốc độ, 2x trong 2 giây (nhảy 4 giây) sẽ bị coi là tua.
    expect(co({ tocDo: 2, nayMs: 2000, nay: 14 })).toBeNull();
  });
});

describe("[YTN-03] tua LÙI", () => {
  it("lùi quá dung sai ⇒ LUI", () => {
    expect(co({ nay: 10 - DUNG_SAI_LUI_GIAY - 0.01 })).toBe("LUI");
  });

  it("lùi ít hơn dung sai ⇒ không báo", () => {
    expect(co({ nay: 10 - DUNG_SAI_LUI_GIAY + 0.01, nayMs: 100 })).toBeNull();
  });
});

describe("[YTN-04] đang dừng thì vị trí không được tự chạy", () => {
  it("tạm dừng, vị trí đứng yên ⇒ không báo dù qua nhiều giây", () => {
    expect(co({ dangPhat: false, nayMs: 60_000, nay: 10 })).toBeNull();
  });

  it("tạm dừng mà vị trí TIẾN như thể vẫn phát ⇒ đó là tua", () => {
    // Nếu hàm bỏ cờ `dangPhat`, 60 giây trôi qua sẽ "giải thích" mức nhảy này và nó lọt.
    expect(co({ dangPhat: false, nayMs: 60_000, nay: 70 })).toBe("TIEN");
  });
});
