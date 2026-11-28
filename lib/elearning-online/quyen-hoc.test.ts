// @vitest-environment node
/** [ONL-QH-*] Luật quyền học Online: cấp · gia hạn · mua lại · thu hồi · cổng truy cập. `now` luôn truyền tường minh. */
import { describe, expect, it } from "vitest";
import { coQuyenHocLucNay, kiemTraTruyCapNoiDung, quyetDinhCap, quyetDinhThuHoi, trangThaiHieuLuc, type QuyenHienCo } from "./quyen-hoc";
import { congThangLich } from "./thoi-han";
import { vnParts } from "@/lib/time/vn";

const vn = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 5, 0, 0)); // 12:00 VN
const ngayVn = (d: Date | null) => {
  if (!d) return null;
  const p = vnParts(d);
  return `${p.day}/${p.month + 1}/${p.year}`;
};
const NOW = vn(2026, 11, 19);
const KY12 = { loai: "THANG", soThang: 12 } as const;
const conHan = (hetHan: Date | null, anchorDay = 19): QuyenHienCo => ({ trangThai: "ACTIVE", hetHan, anchorDay });

describe("[ONL-QH-01] trạng thái hiệu lực (suy từ hạn, không lưu)", () => {
  it("CON_HAN · SAP_HET_HAN (≤30 ngày) · HET_HAN · THU_HOI · trọn đời", () => {
    expect(trangThaiHieuLuc(conHan(vn(2027, 11, 19)), NOW)).toBe("CON_HAN");
    expect(trangThaiHieuLuc(conHan(vn(2026, 12, 10)), NOW)).toBe("SAP_HET_HAN");
    expect(trangThaiHieuLuc(conHan(vn(2026, 11, 18)), NOW)).toBe("HET_HAN");
    expect(trangThaiHieuLuc({ trangThai: "REVOKED", hetHan: vn(2030, 1, 1) }, NOW)).toBe("THU_HOI");
    expect(trangThaiHieuLuc(conHan(null), NOW)).toBe("CON_HAN");
  });
  it("biên: hạn = đúng now ⇒ HẾT HẠN; hạn = now + 1ms ⇒ còn", () => {
    expect(trangThaiHieuLuc(conHan(new Date(NOW.getTime())), NOW)).toBe("HET_HAN");
    expect(trangThaiHieuLuc(conHan(new Date(NOW.getTime() + 1)), NOW)).toBe("SAP_HET_HAN");
  });
  it("coQuyenHocLucNay: chỉ CON_HAN/SAP_HET_HAN; thiếu quyền/thu hồi/hết hạn ⇒ false", () => {
    expect(coQuyenHocLucNay(conHan(vn(2027, 1, 1)), NOW)).toBe(true);
    expect(coQuyenHocLucNay(null, NOW)).toBe(false);
    expect(coQuyenHocLucNay({ trangThai: "REVOKED", hetHan: null }, NOW)).toBe(false);
    expect(coQuyenHocLucNay(conHan(vn(2026, 1, 1)), NOW)).toBe(false);
  });
});

describe("[ONL-QH-02] cấp / mua / gia hạn", () => {
  it("chưa có quyền ⇒ TAO_MOI, hạn theo kỳ, nhớ neo", () => {
    const r = quyetDinhCap({ now: NOW, loai: "MUA", quyen: null, ky: KY12, choPhepGiaHan: false });
    expect(r).toMatchObject({ ok: true, hanhDong: "TAO_MOI", anchorDay: 19, thangDaCong: 12 });
    if (r.ok) expect(ngayVn(r.hetHan)).toBe("19/11/2027");
  });

  it("🔴 MUA khi còn hạn + khoá cho gia hạn ⇒ GIA_HAN cộng từ HẠN HIỆN TẠI; + đối chứng: khoá KHÔNG cho gia hạn ⇒ từ chối", () => {
    const q = conHan(congThangLich(vn(2026, 3, 2), 12), 2); // hết 02/03/2027
    const ok = quyetDinhCap({ now: NOW, loai: "MUA", quyen: q, ky: { loai: "THANG", soThang: 6 }, choPhepGiaHan: true });
    expect(ok).toMatchObject({ ok: true, hanhDong: "GIA_HAN", thangDaCong: 6 });
    if (ok.ok) expect(ngayVn(ok.hetHan)).toBe("2/9/2027");
    expect(quyetDinhCap({ now: NOW, loai: "MUA", quyen: q, ky: KY12, choPhepGiaHan: false })).toMatchObject({ ok: false, ma: "KHOA_KHONG_CHO_GIA_HAN" });
  });

  it("🔴 CAP_MIEN_PHI khi còn hạn: quản trị luôn được cộng thêm (không phụ thuộc 'cho gia hạn' của khoá)", () => {
    const q = conHan(vn(2027, 3, 2), 2);
    expect(quyetDinhCap({ now: NOW, loai: "CAP_MIEN_PHI", quyen: q, ky: KY12, choPhepGiaHan: false })).toMatchObject({ ok: true, hanhDong: "GIA_HAN" });
  });

  it("🔴 đang TRỌN ĐỜI ⇒ mua/cấp trùng bị từ chối (cả MUA lẫn CAP_MIEN_PHI); đối chứng: quyền có hạn thì không bị từ chối", () => {
    const vinhVien = conHan(null);
    for (const loai of ["MUA", "CAP_MIEN_PHI", "GIA_HAN"] as const) {
      expect(quyetDinhCap({ now: NOW, loai, quyen: vinhVien, ky: KY12, choPhepGiaHan: true }), loai).toMatchObject({ ok: false, ma: "DA_TRON_DOI" });
    }
    expect(quyetDinhCap({ now: NOW, loai: "MUA", quyen: conHan(vn(2027, 1, 1)), ky: KY12, choPhepGiaHan: true }).ok).toBe(true);
  });

  it("🔴 mua lại sau HẾT HẠN ⇒ mở lại từ NGÀY MUA (không cộng bù), giữ dòng quyền", () => {
    const het = conHan(vn(2025, 9, 2), 2);
    const r = quyetDinhCap({ now: NOW, loai: "MUA", quyen: het, ky: KY12, choPhepGiaHan: false });
    expect(r).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_HET_HAN", anchorDay: 19 });
    if (r.ok) expect(ngayVn(r.hetHan)).toBe("19/11/2027");
  });

  it("mua lại sau THU HỒI ⇒ MO_LAI_SAU_THU_HOI (kể cả khi hạn cũ còn dài) — hạn mới từ ngày mua", () => {
    const thuHoi: QuyenHienCo = { trangThai: "REVOKED", hetHan: vn(2030, 1, 1), anchorDay: 1 };
    const r = quyetDinhCap({ now: NOW, loai: "CAP_MIEN_PHI", quyen: thuHoi, ky: KY12, choPhepGiaHan: false });
    expect(r).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_THU_HOI" });
    if (r.ok) expect(ngayVn(r.hetHan)).toBe("19/11/2027");
  });

  it("GIA_HAN rõ ràng khi chưa có quyền ⇒ từ chối; khi đã hết hạn ⇒ vẫn mở lại từ now, gọi đúng tên", () => {
    expect(quyetDinhCap({ now: NOW, loai: "GIA_HAN", quyen: null, ky: KY12, choPhepGiaHan: true })).toMatchObject({ ok: false, ma: "CHUA_CO_QUYEN_DE_GIA_HAN" });
    expect(quyetDinhCap({ now: NOW, loai: "GIA_HAN", quyen: conHan(vn(2026, 1, 1)), ky: KY12, choPhepGiaHan: true })).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_HET_HAN" });
  });

  it("kỳ hạn TRỌN ĐỜI: cấp mới ⇒ hạn null; nâng từ có hạn lên trọn đời ⇒ null", () => {
    const moi = quyetDinhCap({ now: NOW, loai: "CAP_MIEN_PHI", quyen: null, ky: { loai: "TRON_DOI" }, choPhepGiaHan: false });
    expect(moi).toMatchObject({ ok: true, hanhDong: "TAO_MOI", hetHan: null, thangDaCong: null });
    const nang = quyetDinhCap({ now: NOW, loai: "CAP_MIEN_PHI", quyen: conHan(vn(2027, 3, 2), 2), ky: { loai: "TRON_DOI" }, choPhepGiaHan: false });
    expect(nang).toMatchObject({ ok: true, hanhDong: "GIA_HAN", hetHan: null });
  });

  it("thiếu kỳ hạn ⇒ từ chối rõ ràng, không đoán", () => {
    expect(quyetDinhCap({ now: NOW, loai: "MUA", quyen: null, ky: null, choPhepGiaHan: true })).toMatchObject({ ok: false, ma: "KY_HAN_THIEU" });
  });
});

describe("[ONL-QH-03] thu hồi", () => {
  it("chỉ thu hồi được quyền CÓ và CHƯA thu hồi", () => {
    expect(quyetDinhThuHoi(null)).toMatchObject({ ok: false, ma: "CHUA_CO_QUYEN" });
    expect(quyetDinhThuHoi({ trangThai: "REVOKED" })).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect(quyetDinhThuHoi({ trangThai: "ACTIVE" })).toEqual({ ok: true });
  });
});

describe("[ONL-QH-04] cổng truy cập nội dung", () => {
  const q = conHan(vn(2027, 11, 19));
  const vao = (o: Partial<Parameters<typeof kiemTraTruyCapNoiDung>[0]>) =>
    kiemTraTruyCapNoiDung({ now: NOW, quyen: q, chinhSachKhongXemLai: false, baiDaHoanThanh: false, ...o });

  it("🔴 có quyền còn hạn ⇒ vào được (đối chứng dương); thiếu quyền / thu hồi / hết hạn ⇒ chặn đúng mã", () => {
    expect(vao({})).toEqual({ ok: true });
    expect(vao({ quyen: null })).toEqual({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(vao({ quyen: { trangThai: "REVOKED", hetHan: null } })).toEqual({ ok: false, ma: "DA_THU_HOI" });
    expect(vao({ quyen: conHan(vn(2026, 1, 1)) })).toEqual({ ok: false, ma: "HET_HAN" });
  });

  it("🔴 'không cho xem lại bài đã qua': BẬT + bài đã xong ⇒ chặn; BẬT + bài chưa xong ⇒ vào; TẮT + bài đã xong ⇒ vào", () => {
    expect(vao({ chinhSachKhongXemLai: true, baiDaHoanThanh: true })).toEqual({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
    expect(vao({ chinhSachKhongXemLai: true, baiDaHoanThanh: false })).toEqual({ ok: true });
    expect(vao({ chinhSachKhongXemLai: false, baiDaHoanThanh: true })).toEqual({ ok: true });
  });

  it("thu hồi/hết hạn thắng chính sách xem lại (mã chặn là mã quyền, không phải mã xem lại)", () => {
    expect(vao({ quyen: { trangThai: "REVOKED", hetHan: null }, chinhSachKhongXemLai: true, baiDaHoanThanh: true })).toEqual({ ok: false, ma: "DA_THU_HOI" });
  });
});
