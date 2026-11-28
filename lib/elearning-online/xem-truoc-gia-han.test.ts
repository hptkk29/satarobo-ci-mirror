/**
 * [XTG-*] Xem trước gia hạn (QoGiaHan) — cùng `quyetDinhCap` với máy chủ: hạn mới hiển thị = hạn mới sẽ ghi. Ngày TUYỆT ĐỐI, `now` truyền vào (luật 19).
 */
import { describe, it, expect } from "vitest";
import { quyetDinhCap, xemTruocGiaHan } from "./quyen-hoc";

const NOW = new Date("2026-11-21T05:00:00.000Z");
const ky12 = { loai: "THANG" as const, soThang: 12 };

describe("[XTG-01] xem trước = quyết định thật", () => {
  it("còn hạn ⇒ cộng 12 tháng từ HẠN HIỆN TẠI; bằng đúng kết quả quyetDinhCap", () => {
    const quyen = { trangThai: "ACTIVE" as const, hetHan: new Date("2026-12-01T05:00:00.000Z"), anchorDay: 1 };
    const xt = xemTruocGiaHan({ now: NOW, quyen, ky: ky12 });
    const that = quyetDinhCap({ now: NOW, loai: "GIA_HAN", quyen, ky: ky12, choPhepGiaHan: true });
    expect(xt).toMatchObject({ ok: true, soThangCong: 12, hanhDong: "GIA_HAN" });
    expect(that.ok && xt.ok && that.hetHan?.getTime() === xt.hetHan?.getTime()).toBe(true);
    expect(xt.ok && xt.hetHan!.getTime()).toBeGreaterThan(new Date("2027-11-01T00:00:00Z").getTime());
  });
  it("đã hết hạn ⇒ mở lại từ HÔM NAY (không cộng bù); đã thu hồi ⇒ MO_LAI_SAU_THU_HOI", () => {
    const hetHan = xemTruocGiaHan({ now: NOW, quyen: { trangThai: "ACTIVE", hetHan: new Date("2026-01-01T00:00:00Z"), anchorDay: 1 }, ky: ky12 });
    expect(hetHan).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_HET_HAN" });
    expect(hetHan.ok && hetHan.hetHan!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(xemTruocGiaHan({ now: NOW, quyen: { trangThai: "REVOKED", hetHan: new Date("2027-01-01T00:00:00Z"), anchorDay: 1 }, ky: ky12 })).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_THU_HOI" });
  });
  it("ÂM: đang TRỌN ĐỜI ⇒ nói thẳng lý do, không hứa hạn; khoá chưa cấu hình kỳ hạn ⇒ lỗi (đối chứng dương ở hai ca trên)", () => {
    expect(xemTruocGiaHan({ now: NOW, quyen: { trangThai: "ACTIVE", hetHan: null, anchorDay: 1 }, ky: ky12 })).toEqual({ ok: false, thongBao: "Học viên đã có quyền học trọn đời khoá này — không mua/cấp trùng" });
    expect(xemTruocGiaHan({ now: NOW, quyen: { trangThai: "ACTIVE", hetHan: new Date("2027-01-01T00:00:00Z"), anchorDay: 1 }, ky: null })).toMatchObject({ ok: false });
  });
});
