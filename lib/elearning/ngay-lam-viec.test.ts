// @vitest-environment node
/**
 * NGÀY LÀM VIỆC — nguồn sự thật duy nhất của module.
 *
 * Sai ở đây không làm hỏng dữ liệu, nhưng nó làm người ta TRỄ HẠN VÌ CÁCH TÍNH.
 * Đó là loại lỗi khó cãi nhất: con số trên màn hình đúng theo mã, và người bị tính
 * hạn không có cách nào chứng minh mình không chậm.
 */
import { describe, it, expect } from "vitest";
import { congNgayLamViec, demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";
import {
  SLA_GRADE_DAYS,
  NSM_MAX_DUE_DAYS,
  CANH_BAO_TUOI_CHO_NGAY_LAM,
} from "@/lib/elearning/metrics/constants";

// 2026-08-24 là thứ Hai (UTC). Cả tệp neo vào mốc đó cho dễ đọc.
const T2 = new Date("2026-08-24T09:00:00.000Z");
const T6 = new Date("2026-08-28T16:00:00.000Z"); // thứ Sáu
const THU = (d: Date) =>
  ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d.getUTCDay()]!;

describe("cộng ngày làm việc", () => {
  it("giữa tuần thì cộng thẳng", () => {
    expect(THU(congNgayLamViec(T2, 3))).toBe("T5");
  });

  it("🔴 vắt qua CUỐI TUẦN thì nhảy qua, không đếm T7/CN", () => {
    // Đây là cả lý do tệp này tồn tại: cộng 3 ngày LỊCH từ chiều thứ Sáu ra Chủ
    // nhật — một hạn rơi vào ngày không ai đi làm.
    // T6 28/8 + 3 ngày làm = T2 31/8 (1) · T3 1/9 (2) · T4 2/9 (3).
    const h = congNgayLamViec(T6, 3);
    expect(THU(h)).toBe("T4");
    expect(h.toISOString().slice(0, 10)).toBe("2026-09-02");
  });

  it("đếm từ ngày KẾ TIẾP, không tính chính ngày mốc", () => {
    // Nộp 16h thứ Sáu với hạn 1 ngày làm việc thì hạn là thứ Hai, không phải chiều
    // thứ Sáu đó — người chấm không có nổi một giờ nào.
    expect(THU(congNgayLamViec(T6, 1))).toBe("T2");
  });

  it("giữ nguyên GIỜ trong ngày", () => {
    // Hạ giờ về 00:00 là ăn bớt của người ta gần trọn một ngày làm việc.
    expect(congNgayLamViec(T2, 2).toISOString().slice(11)).toBe("09:00:00.000Z");
  });

  it("0 hoặc số âm ⇒ trả về chính mốc, không lùi ngược", () => {
    for (const n of [0, -1, -100]) {
      expect(congNgayLamViec(T2, n).getTime(), String(n)).toBe(T2.getTime());
    }
  });

  it("KHÔNG sửa đối tượng truyền vào", () => {
    const moc = new Date(T2.getTime());
    congNgayLamViec(moc, 5);
    expect(moc.getTime()).toBe(T2.getTime());
  });

  it("mốc rơi vào THỨ BẢY vẫn ra hạn ngày làm việc", () => {
    const t7 = new Date("2026-08-29T09:00:00.000Z");
    expect(THU(congNgayLamViec(t7, 1))).toBe("T2");
  });
});

describe("đếm ngày làm việc đã trôi qua", () => {
  it("đối xứng với phép cộng — cùng một thước", () => {
    // Phép BÙ khi chấm trễ lùi hạn người nộp đúng bằng số ngày chờ. Đo bằng hai
    // thước khác nhau thì bù thiếu hoặc bù thừa mỗi lần vắt qua cuối tuần.
    for (const n of [1, 3, 5, 10]) {
      for (const moc of [T2, T6]) {
        expect(demNgayLamViec(moc, congNgayLamViec(moc, n)), `${n}`).toBe(n);
      }
    }
  });

  it("chưa tới hạn ⇒ 0, không ra số âm", () => {
    expect(demNgayLamViec(T6, T2)).toBe(0);
    expect(demNgayLamViec(T2, T2)).toBe(0);
  });

  it("cuối tuần trôi qua KHÔNG tính là ngày chờ", () => {
    // Người chấm không nợ ai hai ngày nghỉ.
    const t2Sau = new Date("2026-08-31T16:00:00.000Z");
    expect(demNgayLamViec(T6, t2Sau)).toBe(1);
  });
});

describe("hằng SLA — đóng băng, và ràng buộc lẫn nhau", () => {
  it("SLA chấm = 3 ngày làm việc", () => {
    expect(SLA_GRADE_DAYS).toBe(3);
  });

  it("🔴 SLA chấm phải NHỎ HƠN HẲN cửa sổ hạn của người học", () => {
    // Nếu không thì SLA và `dueAtOriginal` mâu thuẫn ngay từ định nghĩa: hệ thống
    // hứa chấm trong một khoảng dài bằng nửa thời gian người học có để làm xong.
    // Đây là ràng buộc mà tài liệu viết bằng câu chữ; ở đây nó có người đối chiếu.
    // Đo ở ca TỆ NHẤT — nộp thứ Sáu, hạn vắt qua cuối tuần. Đo ở ca đẹp (thứ Hai)
    // ra 3 ngày lịch và ràng buộc trông thoải mái hơn thực tế.
    const xauNhat = Math.max(
      ...[0, 1, 2, 3, 4, 5, 6].map((lech) => {
        const moc = new Date(T2.getTime() + lech * 86_400_000);
        return Math.round(
          (congNgayLamViec(moc, SLA_GRADE_DAYS).getTime() - moc.getTime()) /
            86_400_000,
        );
      }),
    );
    expect(xauNhat).toBe(5);
    // Còn lại 9 ngày cho người học sửa và nộp lại — ngưỡng đạt 80/100 nên có nộp lại.
    expect(xauNhat).toBeLessThan(NSM_MAX_DUE_DAYS - xauNhat);
  });

  it("ngưỡng cảnh báo tồn đọng = 2× SLA, suy ra chứ không gõ lại", () => {
    expect(CANH_BAO_TUOI_CHO_NGAY_LAM).toBe(SLA_GRADE_DAYS * 2);
  });
});
