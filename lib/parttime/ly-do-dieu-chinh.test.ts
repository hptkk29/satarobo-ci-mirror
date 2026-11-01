// [DCH-*] — lý do điều chỉnh phân công: chỉ từ nguồn đã ghi thật, không bịa (PR7 lưới phân công GV).
import { describe, expect, it } from "vitest";
import { KHONG_CO_LICH_SU, lyDoHienThi, tomTatDieuChinh, tuChuyenDoi, tuDonTu, tuNhatKyTruc, tuSuaBuoi } from "./ly-do-dieu-chinh";

describe("[DCH] lý do điều chỉnh", () => {
  it("[DCH-01] sửa buổi đã qua: lý do + người sửa + trước/sau, nói rõ là sửa trực tiếp", () => {
    const d = tuSuaBuoi({ id: "a1", luc: "2026-10-30T10:00:00.000Z", nguoiSua: "QLCS A", truong: "THUC_DAY", tu: "GV X", den: "GV Y", lyDo: "GV Y dạy thay thực tế" });
    expect(d).toMatchObject({ nguon: "SUA_BUOI_DA_QUA", nguoiYeuCau: "QLCS A", truocSau: "Người thực dạy: GV X → GV Y", maThamChieu: "a1" });
    expect(d.nguoiDuyet).toMatch(/trực tiếp/);
    expect(lyDoHienThi(d)).toBe("GV Y dạy thay thực tế");
  });
  it("[DCH-02] đơn từ: người gửi ≠ người duyệt, lúc duyệt, mã đơn; đơn chưa duyệt ghi rõ trạng thái", () => {
    expect(tuDonTu({ id: "w1", loai: "Dạy thay", lyDo: "ốm", nguoiGui: "GV X", nguoiDuyet: "QLCS A", lucDuyet: "2026-10-29T01:00:00.000Z", trangThai: "APPROVED" })).toMatchObject({
      nguon: "DON_TU",
      nguoiYeuCau: "GV X",
      nguoiDuyet: "QLCS A",
      truocSau: "Dạy thay",
      maThamChieu: "w1",
    });
    expect(tuDonTu({ id: "w2", loai: "Dạy thay", lyDo: "x", nguoiGui: null, nguoiDuyet: null, lucDuyet: null, trangThai: "CANCELLED" }).truocSau).toBe("Dạy thay (đơn CANCELLED)");
  });
  it("[DCH-03] nhật ký trực: giữ trực / huỷ trực; hành động khác ⇒ bỏ qua", () => {
    const base = { id: "x", reason: "chỉ dạy bù", actorName: "QLCS", createdAt: "2026-11-01T00:00:00.000Z" };
    expect(tuNhatKyTruc({ ...base, action: "PT_DUTY_KEPT_WITH_MAKEUP" })?.nguon).toBe("GIU_TRUC");
    expect(tuNhatKyTruc({ ...base, action: "PT_DUTY_CANCELLED" })).toMatchObject({ nguon: "HUY_TRUC", lyDo: "chỉ dạy bù" });
    expect(tuNhatKyTruc({ ...base, action: "PT_DUTY_CREATED" })).toBeNull();
  });
  it("[DCH-04] phân công nhập lúc chuyển đổi ⇒ 'Không có dữ liệu lịch sử', KHÔNG tự viết lý do", () => {
    const d = tuChuyenDoi("pc1");
    expect(d.lyDo).toBeNull();
    expect(lyDoHienThi(d)).toBe(KHONG_CO_LICH_SU);
  });
  it("[DCH-05] nguồn có mà không ghi lý do ⇒ nói thẳng 'không ghi lý do' (không bịa); tóm tắt nối nhiều nguồn", () => {
    const d = tuNhatKyTruc({ id: "y", action: "PT_DUTY_KEPT_WITH_MAKEUP", reason: null, actorName: "QLCS", createdAt: "2026-11-01T00:00:00.000Z" })!;
    expect(lyDoHienThi(d)).toBe("Giữ trực khi có học bù — không ghi lý do");
    expect(tomTatDieuChinh([d, tuChuyenDoi("p")])).toBe(`Giữ trực khi có học bù: Giữ trực khi có học bù — không ghi lý do | Nhập lúc chuyển đổi: ${KHONG_CO_LICH_SU}`);
    expect(tomTatDieuChinh([])).toBe("");
  });
});
