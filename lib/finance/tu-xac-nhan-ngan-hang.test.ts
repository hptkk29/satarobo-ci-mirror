// [TXB-*] — LÕI THUẦN của «tự xác nhận khoản tiền đã về ngân hàng» (`tu-xac-nhan-ngan-hang.ts`). Không DB.
// (Tiền tố `TXB`, không phải `TXN`: `[TXN-*]` đã là của `tu-xac-nhan.test.ts` — cùng bài học trùng mã ca `[GTK]`.)
import { describe, expect, it } from "vitest";
import { lyDoBoQuaTuXacNhan, type UngVienTuXacNhan } from "./tu-xac-nhan-ngan-hang";
import { gatewayMarker, installmentMarker, maGiaoDichMarker } from "./payment-markers";
import { markerGanTay } from "./ghi-tien-don";

const base: UngVienTuXacNhan = { note: `Tiền về qua SEPAY FT1 ${gatewayMarker("sepay", "FT1")}`, enrollmentId: "enr-1", loaiDon: "COURSE", coSoBat: true };

describe("[TXB-00] lyDoBoQuaTuXacNhan — khoản nào được hệ thống tự xác nhận", () => {
  it("[TXB-00a] webhook + đã gắn ghi danh + cơ sở bật ⇒ XÁC NHẬN (null)", () => {
    expect(lyDoBoQuaTuXacNhan(base)).toBeNull();
  });

  it("[TXB-00b] giao dịch kế toán đã GẮN TAY cũng là bằng chứng ngân hàng ⇒ xác nhận", () => {
    expect(lyDoBoQuaTuXacNhan({ ...base, note: `Gắn tay ${markerGanTay("bt-1")}` })).toBeNull();
  });

  it.each([
    ["tiền mặt Sale tự khai", "khách đưa tiền mặt"],
    ["không ghi chú", null],
    ["mã giao dịch do NGƯỜI GÕ (chưa là bằng chứng)", maGiaoDichMarker("FT26000000000002")],
    ["khoản kế hoạch TỰ SINH, không phải tiền về", installmentMarker(1)],
    ["nhập lịch sử", "[backfill-import]"],
  ])("[TXB-00c] %s ⇒ KHÔNG tự xác nhận", (_ten, note) => {
    expect(lyDoBoQuaTuXacNhan({ ...base, note })).toBe("KHONG_BANG_CHUNG_NGAN_HANG");
  });

  it("[TXB-00d] đơn khoá học CHƯA gắn ghi danh ⇒ chờ (THIEU_GHI_DANH); không đoán hộ", () => {
    expect(lyDoBoQuaTuXacNhan({ ...base, enrollmentId: null })).toBe("THIEU_GHI_DANH");
  });

  it("[TXB-00e] đơn KIT / THI không có ghi danh ⇒ vẫn xác nhận được (chốt 29/09: `can-ghi-danh.ts`); loại đơn lạ / trống ⇒ fail-closed", () => {
    expect(lyDoBoQuaTuXacNhan({ ...base, enrollmentId: null, loaiDon: "PRODUCT" })).toBeNull();
    expect(lyDoBoQuaTuXacNhan({ ...base, enrollmentId: null, loaiDon: "EXAM" })).toBeNull();
    expect(lyDoBoQuaTuXacNhan({ ...base, enrollmentId: null, loaiDon: "COMBO" })).toBe("THIEU_GHI_DANH");
    expect(lyDoBoQuaTuXacNhan({ ...base, enrollmentId: null, loaiDon: null })).toBe("THIEU_GHI_DANH");
  });

  it("[TXB-00f] công tắc cơ sở TẮT thắng mọi điều kiện khác (hành vi cũ: không xác nhận gì)", () => {
    expect(lyDoBoQuaTuXacNhan({ ...base, coSoBat: false })).toBe("CO_SO_TAT");
    expect(lyDoBoQuaTuXacNhan({ ...base, coSoBat: false, note: null })).toBe("CO_SO_TAT");
  });
});
