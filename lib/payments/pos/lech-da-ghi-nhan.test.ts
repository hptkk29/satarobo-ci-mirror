// [POS3-06..08] — GĐ3 POS: luật LỆCH trên dòng đã ghi nhận + cột kết toán "trống thì giữ" + cộng kết
// quả lô (docs/pos-gd3-thiet-ke.md §2, §5, §8). THUẦN — chạy trong `pnpm test:unit`.
//
// Mã TRƯỚC bản vá (`nhap-lo-pos.ts`, nhánh ĐÃ KHOÁ): `maHachToan: d.maHachToan, phiGiaoDich:
// d.phiGiaoDich, trangThaiHoanHuy: d.trangThaiHoanHuy` — ô TRỐNG trong file XOÁ giá trị đã có (nhập
// lại file ngày đầu sau file ngày sau ⇒ mất Mã hạch toán, mất tín hiệu hủy mà provider đọc); lệch số
// tiền / trạng thái bị bỏ qua IM LẶNG.
import { describe, expect, it } from "vitest";
import { cotKetToanCapNhat, demGiaoDichLech, gomLechTheoGiaoDich, lechDaGhiNhan, type LechDong } from "./lech-da-ghi-nhan";
import { KET_QUA_RONG, congKetQua, tongLuotSauLo, type KetQuaLoPos, type KetQuaNhapLo } from "./ket-qua-lo";
import { huyDaKetLuanTrenDong, LY_DO_HUY_TOAN_PHAN } from "./phan-loai-pos";

const MA = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("[POS3-LECH] luật lệch trên dòng đã ghi nhận", () => {
  it("[POS3-06] chỉ so số tiền + trạng thái (chuẩn hoá); đúng một mục cho mỗi trường lệch", () => {
    const daGhi = { soTien: 3_168_000, trangThai: "Thành công" };
    expect(lechDaGhiNhan(MA, daGhi, { soTien: 3_168_000, trangThai: "Thành công" })).toEqual([]);

    expect(lechDaGhiNhan(MA, daGhi, { soTien: 3_168_001, trangThai: "Thành công" })).toEqual([
      { maGiaoDich: MA, truong: "soTien", daGhiNhan: "3.168.000", trongFile: "3.168.001" },
    ]);
    expect(lechDaGhiNhan(MA, daGhi, { soTien: 3_168_000, trangThai: "Thất bại" })).toEqual([
      { maGiaoDich: MA, truong: "trangThai", daGhiNhan: "Thành công", trongFile: "Thất bại" },
    ]);
    // Lệch CẢ HAI ⇒ hai mục, số tiền trước.
    expect(lechDaGhiNhan(MA, daGhi, { soTien: 1, trangThai: "Thất bại" }).map((l) => l.truong)).toEqual([
      "soTien",
      "trangThai",
    ]);

    // Khác hoa/thường + khoảng trắng, khác NFC/NFD ⇒ KHÔNG lệch (báo giả mỗi lần nhập là cảnh báo
    // người ta học cách bỏ qua).
    expect(lechDaGhiNhan(MA, daGhi, { soTien: 3_168_000, trangThai: " thành  CÔNG " })).toEqual([]);
    expect(lechDaGhiNhan(MA, daGhi, { soTien: 3_168_000, trangThai: "Thành công".normalize("NFD") })).toEqual([]);

    // Giao dịch không có trạng thái chữ (ca biên: chỉ có BankTransaction) ⇒ chỉ so số tiền.
    expect(lechDaGhiNhan(MA, { soTien: 2_000, trangThai: null }, { soTien: 2_000, trangThai: "Thất bại" })).toEqual([]);
    expect(lechDaGhiNhan(MA, { soTien: 2_000, trangThai: null }, { soTien: 1, trangThai: "Thành công" })).toEqual([
      { maGiaoDich: MA, truong: "soTien", daGhiNhan: "2.000", trongFile: "1" },
    ]);
  });

  it("[POS3-07] cột kết toán khi CẬP NHẬT dòng đã có: file có giá trị ⇒ ghi; file TRỐNG ⇒ KHÔNG CHẠM cột (khoá vắng mặt)", () => {
    // Rà đối kháng GĐ3 (#2): bản đầu trả lại giá trị CŨ của ảnh chụp đầu lô khi ô trống và ghi nó TƯỜNG
    // MINH ⇒ một lượt song song vừa ghi Mã hạch toán / "Hủy toàn phần" bị đè về giá trị cũ. Ô trống phải
    // là KHOÁ VẮNG MẶT để phép `update` không chạm cột đó (ca DB `[POS3-DB-11]`).
    const trongHet = { maHachToan: null, phiGiaoDich: null, trangThaiHoanHuy: null };
    expect(cotKetToanCapNhat(trongHet)).toEqual({});
    expect(Object.keys(cotKetToanCapNhat(trongHet))).toEqual([]);
    // Chuỗi chỉ có khoảng trắng cũng là ô trống (cùng nghĩa `coChu` của D7 / `tinHieuHoanHuy`).
    expect(Object.keys(cotKetToanCapNhat({ maHachToan: "  ", phiGiaoDich: null, trangThaiHoanHuy: " " }))).toEqual([]);
    // File có giá trị mới ⇒ ghi giá trị mới, cho cả ba cột.
    expect(
      cotKetToanCapNhat({ maHachToan: "HT002", phiGiaoDich: 1_200, trangThaiHoanHuy: "Hoàn toàn phần" }),
    ).toEqual({ maHachToan: "HT002", phiGiaoDich: 1_200, trangThaiHoanHuy: "Hoàn toàn phần" });
    // Từng cột độc lập.
    expect(cotKetToanCapNhat({ maHachToan: "HT009", phiGiaoDich: null, trangThaiHoanHuy: null })).toEqual({
      maHachToan: "HT009",
    });
    // Phí 0 là GIÁ TRỊ, không phải ô trống.
    expect(cotKetToanCapNhat({ maHachToan: null, phiGiaoDich: 0, trangThaiHoanHuy: null })).toEqual({ phiGiaoDich: 0 });
  });

  it("[POS3-08] congKetQua: cộng số, nối lỗi, nối lệch và KHỬ TRÙNG theo mã|trường (giữ bản sau)", () => {
    const lech = (ma: string, truong: LechDong["truong"], trongFile: string): LechDong => ({
      maGiaoDich: ma,
      truong,
      daGhiNhan: "x",
      trongFile,
    });
    const a: KetQuaLoPos = {
      moi: 1,
      capNhat: 2,
      tuKhop: 3,
      canXuLy: 4,
      boQua: 5,
      loi: [{ maGiaoDich: "M1", loi: "e1" }],
      lech: [lech("M1", "soTien", "1"), lech("M2", "trangThai", "Thất bại")],
    };
    const b: KetQuaLoPos = {
      moi: 10,
      capNhat: 20,
      tuKhop: 30,
      canXuLy: 40,
      boQua: 50,
      loi: [{ maGiaoDich: "M2", loi: "e2" }],
      lech: [lech("M1", "soTien", "9"), lech("M1", "trangThai", "Thất bại")],
    };
    const c = congKetQua(a, b);
    expect(c).toMatchObject({ moi: 11, capNhat: 22, tuKhop: 33, canXuLy: 44, boQua: 55 });
    expect(c.loi).toEqual([...a.loi, ...b.loi]);
    expect(c.lech.map((l) => `${l.maGiaoDich}|${l.truong}|${l.trongFile}`).sort()).toEqual([
      "M1|soTien|9",
      "M1|trangThai|Thất bại",
      "M2|trangThai|Thất bại",
    ]);
    // Phần tử trung hoà + không đổi đầu vào.
    expect(congKetQua(KET_QUA_RONG, a)).toEqual({ ...a, lech: a.lech });
    expect(KET_QUA_RONG).toEqual({ moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0, loi: [], lech: [] });
    expect(a.lech).toHaveLength(2);
  });
});

describe("[POS3-RV] rà đối kháng GĐ3 — luật thuần", () => {
  it("[POS3-09] tongLuotSauLo: số Mới/Cập nhật/Tự khớp/Cần xử lý/Bỏ qua lấy từ SỐ ĐẾM CỦA LƯỢT; lỗi + lệch cộng dồn", () => {
    // Mã TRƯỚC bản vá: màn `tong = congKetQua(tong, r.ketQua)` ⇒ lô GỬI LẠI (trả lời lần đầu mất, server
    // đã đếm) cộng kết quả lần xử lý lại {moi 0, capNhat n, tuKhop 0} ⇒ panel lệch lịch sử import.
    const lech = (ma: string): LechDong => ({ maGiaoDich: ma, truong: "soTien", daGhiNhan: "1", trongFile: "2" });
    const tong: KetQuaLoPos = { moi: 4, capNhat: 0, tuKhop: 2, canXuLy: 0, boQua: 2, loi: [{ maGiaoDich: "M1", loi: "e1" }], lech: [lech("M1")] };
    const loGuiLai: KetQuaNhapLo = {
      moi: 0,
      capNhat: 4,
      tuKhop: 0,
      canXuLy: 0,
      boQua: 2,
      loi: [{ maGiaoDich: "M2", loi: "e2" }],
      lech: [lech("M2")],
      soDemLuot: { moi: 4, capNhat: 0, tuKhop: 2, canXuLy: 0, boQua: 2 },
    };
    const kq = tongLuotSauLo(tong, loGuiLai);
    expect(kq).toMatchObject({ moi: 4, capNhat: 0, tuKhop: 2, canXuLy: 0, boQua: 2 });
    expect(kq.loi.map((l) => l.maGiaoDich)).toEqual(["M1", "M2"]);
    expect(kq.lech.map((l) => l.maGiaoDich)).toEqual(["M1", "M2"]);
    expect(Object.keys(kq).sort()).toEqual(["boQua", "canXuLy", "capNhat", "lech", "loi", "moi", "tuKhop"]);
  });

  it("[POS3-10] huyDaKetLuanTrenDong: tín hiệu hủy ĐÃ LƯU trên chính dòng — đơn điệu khi nhập lại", () => {
    const dong = (o: Partial<Parameters<typeof huyDaKetLuanTrenDong>[0]>) => ({
      trangThaiHoanHuy: null,
      matchStatus: "TU_KHOP" as const,
      matchReason: null,
      bankTransactionId: null,
      ...o,
    });
    expect(huyDaKetLuanTrenDong(dong({ trangThaiHoanHuy: "Hủy toàn phần" }))).toBe("TOAN_PHAN");
    expect(huyDaKetLuanTrenDong(dong({ trangThaiHoanHuy: "Hoàn một phần" }))).toBe("MOT_PHAN");
    // Lượt trước KẾT LUẬN hủy toàn phần nhờ dòng Hủy đi kèm (cột của chính dòng trống, dòng Hủy chưa lưu).
    expect(
      huyDaKetLuanTrenDong(dong({ matchStatus: "BO_QUA", matchReason: LY_DO_HUY_TOAN_PHAN, bankTransactionId: null })),
    ).toBe("TOAN_PHAN");
    // Đối chứng: BO_QUA vì lý do KHÁC (thất bại…) không phải tín hiệu hủy; BO_QUA có giao dịch đã khoá sẵn.
    expect(huyDaKetLuanTrenDong(dong({ matchStatus: "BO_QUA", matchReason: "Giao dịch không thành công" }))).toBe("TRONG");
    expect(
      huyDaKetLuanTrenDong(dong({ matchStatus: "BO_QUA", matchReason: LY_DO_HUY_TOAN_PHAN, bankTransactionId: "bt_1" })),
    ).toBe("TRONG");
    expect(huyDaKetLuanTrenDong(dong({}))).toBe("TRONG");
  });

  it("[POS3-11] gomLechTheoGiaoDich: MỘT mục mỗi giao dịch, các trường lệch nằm bên trong, giữ thứ tự xuất hiện", () => {
    const l = (ma: string, truong: LechDong["truong"]): LechDong => ({ maGiaoDich: ma, truong, daGhiNhan: "a", trongFile: "b" });
    const g = gomLechTheoGiaoDich([l("M1", "soTien"), l("M2", "trangThai"), l("M1", "trangThai")]);
    expect(g.map((x) => x.maGiaoDich)).toEqual(["M1", "M2"]);
    expect(g[0]!.muc.map((m) => m.truong)).toEqual(["soTien", "trangThai"]);
    expect(g).toHaveLength(demGiaoDichLech([l("M1", "soTien"), l("M2", "trangThai"), l("M1", "trangThai")]));
  });
});
