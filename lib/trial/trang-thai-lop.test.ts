import { describe, it, expect } from "vitest";
import { trangThaiLop } from "./trang-thai-lop";

// Ngày tuyệt đối, không đọc đồng hồ (luật 19).
const HOM_NAY = "2026-09-23";

describe("[TTL] trạng thái hiển thị lớp trải nghiệm", () => {
  it("[TTL-01] lớp theo khung CHƯA diễn ra ⇒ Đang mở", () => {
    expect(trangThaiLop({ status: "OPEN", theoKhung: true, ngayLop: "2026-09-27", homNay: HOM_NAY })).toBe("DANG_MO");
  });
  it("[TTL-02] đúng NGÀY lớp ⇒ vẫn Đang mở (Sale còn điểm danh)", () => {
    expect(trangThaiLop({ status: "OPEN", theoKhung: true, ngayLop: HOM_NAY, homNay: HOM_NAY })).toBe("DANG_MO");
  });
  it("[TTL-03] ngày lớp đã qua ⇒ tự thành Đã đóng, dù cột status vẫn OPEN", () => {
    expect(trangThaiLop({ status: "OPEN", theoKhung: true, ngayLop: "2026-09-22", homNay: HOM_NAY })).toBe("DA_DONG");
    expect(trangThaiLop({ status: "RUNNING", theoKhung: true, ngayLop: "2026-09-01", homNay: HOM_NAY })).toBe("DA_DONG");
  });
  it("[TTL-04] đã huỷ thì luôn Đã huỷ, kể cả ngày đã qua", () => {
    expect(trangThaiLop({ status: "CANCELLED", theoKhung: true, ngayLop: "2026-09-01", homNay: HOM_NAY })).toBe("DA_HUY");
  });
  it("[TTL-05] lớp CŨ mang ngày cũ (trước 28/08) KHÔNG tự đóng — chỉ COMPLETED mới đóng", () => {
    expect(trangThaiLop({ status: "OPEN", theoKhung: false, ngayLop: "2026-08-11", homNay: HOM_NAY })).toBe("DANG_MO");
    expect(trangThaiLop({ status: "COMPLETED", theoKhung: false, ngayLop: null, homNay: HOM_NAY })).toBe("DA_DONG");
  });
});
