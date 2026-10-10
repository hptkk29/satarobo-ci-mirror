// @vitest-environment node
/**
 * [NHH-POL-10-UI-*] — LUẬT HIỂN THỊ của bước "Thử tính" (THUẦN): định dạng · nút "Chạy thử" · độ cũ · cảnh báo · hộp thoại kích hoạt.
 *
 * Điều canh: giao diện không được NÓI DỐI — nút chỉ vẽ khi có quyền, tắt khi chưa đủ điều kiện (mỗi trường hợp một câu), kết quả CŨ không
 * bao giờ được dùng làm "tác động", và không có "0đ" giả cho thứ không tính được.
 */
import { describe, expect, it } from "vitest";

import type { KetQuaMoPhong } from "./mo-phong";
import {
  canhBaoCuaKetQua,
  dinhDangChenh,
  dinhDangChenhTiLe,
  dinhDangTiLe,
  dinhDangTranPhanTram,
  nhanGioChay,
  nhanKhoang,
  quyetDinhNutThuTinh,
  tomTatTacDong,
  tuoiKetQua,
  type TrangThaiThuTinh,
} from "./mo-phong-ui";
import { dinhDangDong } from "./vi-sao";

/** Kết quả tối thiểu hợp lệ; từng ca ghi đè phần mình cần. */
function kq(p: Partial<KetQuaMoPhong> = {}): KetQuaMoPhong {
  return {
    soKhoanTinhDuoc: 3,
    coSo: 12_000_000,
    hoaHong: { hienTai: 960_000, deXuat: 840_000, chenh: -120_000 },
    tiLeHieuDung: { hienTai: 0.08, deXuat: 0.07 },
    phanRa: { vai: [], nguon: [], donVi: [], loai: [] },
    tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 0, danhSach: [] }, biCat: false },
    chongLan: { hienTai: 0, deXuat: 0 },
    chuaTinh: { soKhoan: 0, theoLyDo: [] },
    thieuNguoi: { hienTai: [], deXuat: [] },
    soNguoiAnhHuong: 2,
    khoang: { tuNgay: "2026-07-01", denNgay: "2026-09-30" },
    soKhoanTrongKhoang: 3,
    cat: null,
    ngoai: { soKhoanHoan: 0, tienHoan: 0, soKhoanKhongPhaiHocPhi: 0, soKhoanChuyenNoiBo: 0 },
    phamVi: { soCoSo: null },
    ...p,
  };
}

const xong = (k: KetQuaMoPhong, capNhat = "2026-10-08T03:00:00.000Z"): TrangThaiThuTinh => ({ kieu: "xong", ketQua: k, phienBanCapNhatLuc: capNhat, chayLuc: "2026-10-08T14:30:00.000Z" });

describe("[NHH-POL-10-UI-01] định dạng", () => {
  it("tiền: nghìn bằng dấu chấm, hậu tố đ; số âm dùng dấu trừ thật (−), không phải gạch nối", () => {
    expect(dinhDangDong(1_234_567)).toBe("1.234.567đ");
    expect(dinhDangDong(0)).toBe("0đ");
    expect(dinhDangDong(-2_000_000)).toBe("−2.000.000đ");
    expect(dinhDangDong(-2_000_000)).not.toContain("-");
  });

  it("chênh: có DẤU (+/−) khi khác 0; đúng 0 thì không dấu", () => {
    expect(dinhDangChenh(120_000)).toBe("+120.000đ");
    expect(dinhDangChenh(-120_000)).toBe("−120.000đ");
    expect(dinhDangChenh(0)).toBe("0đ");
  });

  it("tỉ lệ hiệu dụng: dấu phẩy thập phân, 2 chữ số; không có cơ sở ⇒ '—' (không phải 0%)", () => {
    expect(dinhDangTiLe(0.0853)).toBe("8,53%");
    expect(dinhDangTiLe(0.09)).toBe("9,00%");
    expect(dinhDangTiLe(0)).toBe("0,00%");
    expect(dinhDangTiLe(null)).toBe("—");
  });

  it("chênh tỉ lệ tính bằng ĐIỂM phần trăm, có dấu; thiếu một đầu ⇒ '—'", () => {
    expect(dinhDangChenhTiLe(0.08, 0.07)).toBe("−1,00 điểm %");
    expect(dinhDangChenhTiLe(0.08, 0.085)).toBe("+0,50 điểm %");
    expect(dinhDangChenhTiLe(0.08, 0.08)).toBe("0,00 điểm %");
    expect(dinhDangChenhTiLe(null, 0.08)).toBe("—");
  });

  it("trần: 0,09 ⇒ '9%'; 0,0925 ⇒ '9,25%' (đọc từ cấu hình, không viết hằng)", () => {
    expect(dinhDangTranPhanTram(0.09)).toBe("9%");
    expect(dinhDangTranPhanTram(0.0925)).toBe("9,25%");
    expect(dinhDangTranPhanTram(0.1)).toBe("10%");
  });

  it("khoảng: cùng năm gộp năm một lần; khác năm ghi đủ hai đầu", () => {
    expect(nhanKhoang({ tuNgay: "2026-07-01", denNgay: "2026-09-30" })).toBe("01/07 – 30/09/2026");
    expect(nhanKhoang({ tuNgay: "2025-11-01", denNgay: "2026-01-31" })).toBe("01/11/2025 – 31/01/2026");
  });

  it("giờ chạy: ISO UTC → giờ VN (UTC+7), qua nửa đêm đổi cả ngày", () => {
    expect(nhanGioChay("2026-10-08T14:30:00.000Z")).toBe("21:30 08/10/2026");
    expect(nhanGioChay("2026-10-08T18:00:00.000Z")).toBe("01:00 09/10/2026");
  });
});

describe("[NHH-POL-10-UI-02] nút 'Chạy thử' (luật 12: nút nói thật)", () => {
  const DU = { coQuyen: true, laBanNhap: true, daLuu: true, coThayDoiChuaLuu: false };

  it("không quyền ⇒ KHÔNG vẽ nút, nêu tên quyền", () => {
    const q = quyetDinhNutThuTinh({ ...DU, coQuyen: false });
    expect(q).toMatchObject({ ve: false, bamDuoc: false });
    expect(q.lyDo).toContain("commission_policies:manage");
  });

  it("không quyền thắng mọi lý do khác (không lộ trạng thái bản nháp cho người không có quyền)", () => {
    expect(quyetDinhNutThuTinh({ coQuyen: false, laBanNhap: false, daLuu: false, coThayDoiChuaLuu: true }).lyDo).toContain("commission_policies:manage");
  });

  it("phiên bản không còn là nháp ⇒ KHÔNG vẽ nút (thử tính dành cho bản nháp), lý do chỉ đường tạo phiên bản mới", () => {
    const q = quyetDinhNutThuTinh({ ...DU, laBanNhap: false });
    expect(q).toMatchObject({ ve: false, bamDuoc: false });
    expect(q.lyDo).toMatch(/tạo phiên bản mới/);
  });

  it("chưa lưu ⇒ nút TẮT + 'Lưu nháp trước'; sửa dở ⇒ nút TẮT + câu RIÊNG (hai câu khác nhau)", () => {
    const chuaLuu = quyetDinhNutThuTinh({ ...DU, daLuu: false });
    const suaDo = quyetDinhNutThuTinh({ ...DU, coThayDoiChuaLuu: true });
    expect(chuaLuu).toMatchObject({ ve: true, bamDuoc: false });
    expect(suaDo).toMatchObject({ ve: true, bamDuoc: false });
    expect(chuaLuu.lyDo).toMatch(/Lưu nháp trước/);
    expect(suaDo.lyDo).toMatch(/sửa sau lần lưu cuối/);
    expect(chuaLuu.lyDo).not.toBe(suaDo.lyDo);
  });

  it("đủ điều kiện ⇒ vẽ + bấm được + không lý do (đối chứng dương)", () => {
    expect(quyetDinhNutThuTinh(DU)).toEqual({ ve: true, bamDuoc: true, lyDo: null });
  });
});

describe("[NHH-POL-10-UI-03] độ cũ của kết quả", () => {
  const luu = { updatedAt: "2026-10-08T03:00:00.000Z" };
  it("cùng mốc bản đã lưu và không sửa dở ⇒ 'moi'", () => {
    expect(tuoiKetQua({ phienBanCapNhatLuc: luu.updatedAt }, luu, false)).toBe("moi");
  });
  it("bản nháp đã lưu lại (mốc khác) ⇒ 'cu'", () => {
    expect(tuoiKetQua({ phienBanCapNhatLuc: "2026-10-08T02:00:00.000Z" }, luu, false)).toBe("cu");
  });
  it("đang sửa dở ⇒ 'cu' dù mốc khớp; chưa lưu ⇒ 'cu'", () => {
    expect(tuoiKetQua({ phienBanCapNhatLuc: luu.updatedAt }, luu, true)).toBe("cu");
    expect(tuoiKetQua({ phienBanCapNhatLuc: luu.updatedAt }, null, false)).toBe("cu");
  });
});

describe("[NHH-POL-10-UI-04] cảnh báo bắt buộc phải thấy", () => {
  it("không gì bất thường ⇒ không cảnh báo (đối chứng: không báo động giả)", () => {
    expect(canhBaoCuaKetQua(kq())).toEqual([]);
  });

  it("vượt trần dưới đề xuất ⇒ mức 'loi', nêu SỐ KHOẢN và TRẦN đọc từ kết quả, nói rõ 'không tự cắt' và 'đã tính 0đ'", () => {
    const c = canhBaoCuaKetQua(kq({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 4, danhSach: [] }, biCat: false } }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ ma: "VUOT_TRAN_DE_XUAT", mucDo: "loi" });
    expect(c[0]!.noiDung).toContain("4 khoản");
    expect(c[0]!.noiDung).toContain("9%");
    expect(c[0]!.noiDung).toMatch(/không tự cắt/);
    expect(c[0]!.noiDung).toMatch(/0đ/);
    // trần khác ⇒ chữ khác (không hằng 9%)
    const c10 = canhBaoCuaKetQua(kq({ tran: { gioiHan: 0.1, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 1, danhSach: [] }, biCat: false } }));
    expect(c10[0]!.noiDung).toContain("10%");
    expect(c10[0]!.noiDung).not.toContain("9%");
  });

  it("vượt trần ở chính sách ĐANG chạy ⇒ mức 'luu-y' riêng (lỗi cấu hình có sẵn, không phải do bản đề xuất)", () => {
    const c = canhBaoCuaKetQua(kq({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 2, danhSach: [] }, deXuat: { soKhoan: 0, danhSach: [] }, biCat: false } }));
    expect(c.map((x) => [x.ma, x.mucDo])).toEqual([["VUOT_TRAN_HIEN_TAI", "luu-y"]]);
  });

  it("chồng lấn quy tắc ⇒ cảnh báo 'loi' nêu cả hai đầu", () => {
    const c = canhBaoCuaKetQua(kq({ chongLan: { hienTai: 1, deXuat: 5 } }));
    expect(c[0]).toMatchObject({ ma: "CHONG_LAN", mucDo: "loi" });
    expect(c[0]!.noiDung).toContain("5 khoản (đề xuất)");
    expect(c[0]!.noiDung).toContain("1 khoản (hiện tại)");
  });

  it("CẮT ⇒ nói số khoản đã xét, mốc ngày và số khoản CHƯA xét — không cắt im lặng", () => {
    const c = canhBaoCuaKetQua(kq({ cat: { tran: 1500, soKhoanChuaXet: 230, xetTuNgay: "2026-08-12" } }));
    expect(c[0]).toMatchObject({ ma: "CAT" });
    expect(c[0]!.noiDung).toContain("1.500");
    expect(c[0]!.noiDung).toContain("12/08/2026");
    expect(c[0]!.noiDung).toContain("230");
  });

  it("có khoản chưa thể tính ⇒ báo ngay đầu kết quả (người đọc không tưởng đã gồm)", () => {
    const c = canhBaoCuaKetQua(kq({ chuaTinh: { soKhoan: 7, theoLyDo: [] } }));
    expect(c[0]).toMatchObject({ ma: "CHUA_TINH", mucDo: "luu-y" });
    expect(c[0]!.noiDung).toContain("7 khoản chưa thể tính");
  });

  it("thứ tự quan trọng: vượt trần đề xuất đứng TRƯỚC cắt và chưa-tính", () => {
    const c = canhBaoCuaKetQua(
      kq({
        tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 1, danhSach: [] }, biCat: false },
        cat: { tran: 10, soKhoanChuaXet: 1, xetTuNgay: "2026-08-12" },
        chuaTinh: { soKhoan: 1, theoLyDo: [] },
      }),
    );
    expect(c.map((x) => x.ma)).toEqual(["VUOT_TRAN_DE_XUAT", "CAT", "CHUA_TINH"]);
  });
});

describe("[NHH-POL-10-UI-05] 'Tác động ước tính' trong hộp thoại kích hoạt", () => {
  it("chưa chạy ⇒ nói thẳng 'chưa thử tính', KHÔNG có số nào", () => {
    const t = tomTatTacDong({ kieu: "chua" }, null);
    expect(t.kieu).toBe("chua-chay");
    expect(t.dong.join(" ")).toMatch(/Chưa thử tính/);
    expect(t.dong.join(" ")).not.toMatch(/\d{3}/);
  });

  it("đang chạy ⇒ 'đang thử tính', chưa phải kết quả", () => {
    expect(tomTatTacDong({ kieu: "dang-chay" }, null).dong[0]).toMatch(/Đang thử tính/);
  });

  it("lỗi ⇒ vẫn là 'chưa thử tính' (không có số)", () => {
    expect(tomTatTacDong({ kieu: "loi", chung: "x" }, null).kieu).toBe("chua-chay");
  });

  it("kết quả CŨ ⇒ KHÔNG dùng số cũ làm 'tác động' (không số tiền nào, bảo chạy lại)", () => {
    const t = tomTatTacDong(xong(kq()), "cu");
    expect(t.kieu).toBe("cu");
    expect(t.dong.join(" ")).toMatch(/chạy lại/);
    expect(t.dong.join(" ")).not.toContain("960.000");
    expect(t.dong.join(" ")).not.toContain("840.000");
  });

  it("kết quả MỚI ⇒ khoảng · hiện tại → đề xuất · chênh có dấu · số người; 'không ghi sổ'", () => {
    const t = tomTatTacDong(xong(kq()), "moi");
    expect(t.kieu).toBe("co");
    expect(t.dong[0]).toContain("01/07 – 30/09/2026");
    expect(t.dong[0]).toContain("960.000đ → 840.000đ");
    expect(t.dong[0]).toContain("−120.000đ");
    expect(t.dong[0]).toContain("2 người");
    expect(t.dong[0]).toMatch(/không ghi sổ/);
  });

  it("kết quả mới có vượt trần / cắt ⇒ thêm dòng riêng cho từng điều", () => {
    const t = tomTatTacDong(
      xong(kq({ tran: { gioiHan: 0.09, hienTai: { soKhoan: 0, danhSach: [] }, deXuat: { soKhoan: 3, danhSach: [] }, biCat: false }, cat: { tran: 5, soKhoanChuaXet: 1, xetTuNgay: "2026-08-12" } })),
      "moi",
    );
    expect(t.dong).toHaveLength(3);
    expect(t.dong[1]).toContain("3 khoản vượt trần 9%");
    expect(t.dong[2]).toMatch(/xét một phần/);
  });
});
