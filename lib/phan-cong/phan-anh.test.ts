// [PA-*] Luật phản ánh ô công Parttime (GĐ6, chốt 4, 5, 8). Thuần — `homNay` truyền tay (luật 19).
import { describe, expect, it } from "vitest";
import { lyDoKhongDuyetDuoc, lyDoKhongGuiDuoc } from "./phan-anh";

const gui = (x: Partial<Parameters<typeof lyDoKhongGuiDuoc>[0]> = {}) =>
  lyDoKhongGuiDuoc({ ngay: "2026-11-18", homNay: "2026-11-20", trangThaiKy: "OPEN", lyDo: "Quên quét ra", coViec: true, tuKyLuatMoi: "2026-11", ...x });
const duyet = (x: Partial<Parameters<typeof lyDoKhongDuyetDuoc>[0]> = {}) =>
  lyDoKhongDuyetDuoc({ status: "CHO_DUYET", nguoiDuyet: "ql", nguoiGui: "gv", periodKey: "2026-11", trangThaiKy: "OPEN", duyet: true, ghiChu: null, tuKyLuatMoi: "2026-11", ...x });

describe("[PA] gửi phản ánh", () => {
  it("[PA-01] cờ kỳ CẢ HAI vế: kỳ 2026-10 ⇒ chặn (luồng cũ); kỳ 2026-11 ⇒ qua", () => {
    expect(gui({ ngay: "2026-10-20", homNay: "2026-10-25" })).toMatch(/luồng xác nhận cũ/);
    expect(gui()).toBeNull();
  });
  it("[PA-02] kỳ đã chốt ⇒ hết hạn (chốt 4); ngày chưa tới ⇒ chặn; không có việc ⇒ chặn; lý do quá ngắn ⇒ chặn", () => {
    expect(gui({ trangThaiKy: "LOCKED" })).toMatch(/hết hạn/);
    expect(gui({ ngay: "2026-11-21" })).toMatch(/chưa tới/);
    expect(gui({ coViec: false })).toMatch(/không có việc/);
    expect(gui({ lyDo: " ab " })).toMatch(/lý do/);
  });
});

describe("[PA] duyệt phản ánh", () => {
  it("[PA-03] tự duyệt ⇒ chặn; người khác ⇒ qua (đối chứng)", () => {
    expect(duyet({ nguoiDuyet: "gv" })).toMatch(/tự duyệt/);
    expect(duyet()).toBeNull();
  });
  it("[PA-04] không duyệt phải có lý do ≥ 10 ký tự; đã xử lý / kỳ chốt / kỳ cũ ⇒ chặn", () => {
    expect(duyet({ duyet: false, ghiChu: "ngắn" })).toMatch(/ghi lý do/);
    expect(duyet({ duyet: false, ghiChu: "Camera cho thấy về lúc 16:00" })).toBeNull();
    expect(duyet({ status: "DA_DUYET" })).toMatch(/không còn chờ/);
    expect(duyet({ trangThaiKy: "LOCKED" })).toMatch(/đã chốt/);
    expect(duyet({ periodKey: "2026-10" })).toMatch(/luồng xác nhận cũ/);
  });
});
