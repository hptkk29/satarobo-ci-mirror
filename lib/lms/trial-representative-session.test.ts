/**
 * Khoá bằng test cái luật đã làm giáo viên không thấy suất Trial nào (sự cố 04/09/2026).
 *
 * Lỗi gốc không nằm ở hàm này mà ở chỗ bảng lọc `scheduledSessionId: { in: [...] }` —
 * `in` không bao giờ khớp null, trong khi mọi ghi danh tạo qua giao diện admin đều mang
 * null từ 28/08. Hàm này là mảnh vá: suy một buổi để dòng có ngày giờ mà xếp bảng.
 *
 * Ba luật phải giữ, mỗi luật đã từng là một cách vá sai:
 *  1. Ưu tiên buổi CHƯA qua — vá bằng "buổi đầu tiên của lớp" đẩy dòng xuống "Đã Trial".
 *  2. Hết buổi tương lai thì lấy buổi CUỐI đã qua — việc còn lại là nhập phiếu.
 *  3. Không có buổi nào ⇒ null ⇒ bên gọi BỎ dòng. In dòng trống ngày là dựng lại đúng
 *     khối "Chưa xếp buổi" mà chủ dự án đã cho gỡ 26/08.
 */
import { describe, it, expect } from "vitest";
import { chonBuoiDaiDien } from "./trial-representative-session";

/** UTC 00:00 của ngày VN — đúng quy ước cột `@db.Date`. */
function ngay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
const HOM_NAY = ngay("2026-09-04").getTime();

const buoi = (id: string, iso: string, startTime = "09:00") => ({
  id,
  date: ngay(iso),
  startTime,
});

describe("chonBuoiDaiDien", () => {
  it("có buổi chưa qua → lấy buổi GẦN NHẤT chưa qua", () => {
    const ds = [buoi("b3", "2026-09-10"), buoi("b1", "2026-08-30"), buoi("b2", "2026-09-06")];
    expect(chonBuoiDaiDien(ds, HOM_NAY)?.id).toBe("b2");
  });

  it("buổi ĐÚNG hôm nay vẫn tính là chưa qua", () => {
    // Cột `@db.Date` là UTC 00:00, `today` cũng vậy ⇒ so >= là đúng. Dùng > thì suất
    // Trial dạy chiều nay biến khỏi bảng "sắp Trial" ngay từ sáng.
    const ds = [buoi("hom-qua", "2026-09-03"), buoi("hom-nay", "2026-09-04")];
    expect(chonBuoiDaiDien(ds, HOM_NAY)?.id).toBe("hom-nay");
  });

  it("cùng ngày → lấy buổi có giờ bắt đầu sớm hơn", () => {
    const ds = [buoi("chieu", "2026-09-06", "14:00"), buoi("sang", "2026-09-06", "08:30")];
    expect(chonBuoiDaiDien(ds, HOM_NAY)?.id).toBe("sang");
  });

  it("chỉ còn buổi đã qua → lấy buổi CUỐI đã qua, không phải buổi đầu", () => {
    const ds = [buoi("b1", "2026-08-20"), buoi("b3", "2026-09-02"), buoi("b2", "2026-08-28")];
    expect(chonBuoiDaiDien(ds, HOM_NAY)?.id).toBe("b3");
  });

  it("cùng ngày trong quá khứ → lấy buổi muộn hơn trong ngày", () => {
    const ds = [buoi("sang", "2026-09-02", "08:30"), buoi("chieu", "2026-09-02", "14:00")];
    expect(chonBuoiDaiDien(ds, HOM_NAY)?.id).toBe("chieu");
  });

  it("không có buổi nào → null (bên gọi BỎ dòng, KHÔNG in dòng trống ngày)", () => {
    expect(chonBuoiDaiDien([], HOM_NAY)).toBeNull();
  });

  it("KHÔNG phụ thuộc thứ tự mảng đầu vào", () => {
    // Nếu hàm ăn theo thứ tự thì đổi `orderBy` của câu truy vấn là đổi thầm kết quả —
    // đúng kiểu bug im lặng mà file này sinh ra để chặn.
    const ds = [buoi("a", "2026-09-06"), buoi("b", "2026-09-08"), buoi("c", "2026-08-30")];
    const xuoi = chonBuoiDaiDien(ds, HOM_NAY)?.id;
    const nguoc = chonBuoiDaiDien([...ds].reverse(), HOM_NAY)?.id;
    expect(xuoi).toBe("a");
    expect(nguoc).toBe(xuoi);
  });

  it("giữ nguyên kiểu đầu vào — bên gọi còn cần endTime/status/tên lớp", () => {
    // Trả về `BuoiUngVien` trần thì `toRow` mất endTime và phải tra lại lần hai.
    const ds = [{ ...buoi("b1", "2026-09-06"), endTime: "10:30", status: "SCHEDULED" as const }];
    const ra = chonBuoiDaiDien(ds, HOM_NAY);
    expect(ra?.endTime).toBe("10:30");
    expect(ra?.status).toBe("SCHEDULED");
  });
});
