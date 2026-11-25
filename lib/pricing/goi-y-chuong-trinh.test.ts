// @vitest-environment node
/**
 * `goi-y-chuong-trinh.ts` — bảng giảm của SR.QD.233 biểu diễn bằng DỮ LIỆU (chương trình có điều kiện) phải cho ĐÚNG từng đồng như hằng
 * `CHINH_SACH_PL02`. Đáp án đối chiếu là oracle độc lập (`tinh-gia-theo-moc.oracle.ts`, sinh bằng Fraction) — KHÔNG phải chính mã tính giá.
 *
 * Đợt thiết kế: file này CHƯA được nối vào đâu (xem `[GYC-PIN]`). Ma trận test tối thiểu của chủ dự án:
 *   12/24/36/48 [CTG-01] · nhiều con nhiều khoá + thứ tự con [CTG-02/03] · đổi chính sách giữa hai lần mua [CTG-04] ·
 *   ngày tạo đơn ≠ ngày tiền về [CTG-05] · tránh giảm trùng, đơn legacy [CTG-06] · cờ tắt = chưa nối [GYC-PIN].
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORACLE_GIA } from "./tinh-gia-theo-moc.oracle";
import { taoBaoGiaDong } from "./bao-gia-dong";
import {
  LoiGoiY,
  dungSnapshotV2,
  duocGoiYChoDong,
  goiYChuongTrinh,
  khopDieuKien,
  moHinhCuaSnapshot,
  giaiThichGia,
  phatHienDoiChinhSach,
  soSanhXacNhan,
  xetLaiKhiTienVe,
  type DieuKienGiam,
  type NguCanhGoiY,
  type UngVienGiam,
} from "./goi-y-chuong-trinh";

const TRONG: DieuKienGiam = { soBuoi: [], thuTuCon: null, thuTuSanPham48: null };
const ct = (id: string, nhom: UngVienGiam["nhom"], phanTram: number, dk: Partial<DieuKienGiam> = {}, phienBan = "v1"): UngVienGiam => ({
  id,
  ma: id.toUpperCase(),
  maVanBan: "SR.QD.233",
  ten: `Chương trình ${id}`,
  nhom,
  phanTram,
  dieuKien: { ...TRONG, ...dk },
  phienBan,
});

/** SR.QD.233 Điều 3 viết thành DỮ LIỆU: Bảng A (24, 36), Bảng B (48: sản phẩm 1 / 2+), anh chị em (con 2 / 3+). Bảng A 12 buổi = 0% ⇒ không có chương trình. */
const A24 = ct("a24", "BASE", 5, { soBuoi: [24] });
const A36 = ct("a36", "BASE", 10, { soBuoi: [36] });
const B1 = ct("b1", "BASE", 15, { soBuoi: [48], thuTuSanPham48: { tu: 1, den: 1 } });
const B2 = ct("b2", "BASE", 25, { soBuoi: [48], thuTuSanPham48: { tu: 2, den: null } });
const AE2 = ct("ae2", "ADD_ON", 10, { thuTuCon: { tu: 2, den: 2 } });
const AE3 = ct("ae3", "ADD_ON", 15, { thuTuCon: { tu: 3, den: null } });
const PL02 = [A24, A36, B1, B2, AE2, AE3];
const TRAN = 25;

const ctx = (soBuoi: number, thuTuCon: number, niemYet: number, thuTuSanPham48: number | null = null): NguCanhGoiY => ({
  soBuoi,
  thuTuCon,
  thuTuSanPham48,
  niemYet,
});

describe("[CTG-01] bảng giảm viết bằng dữ liệu ≡ oracle độc lập (100 dòng: 5 giá × 12/24/36/48 × thứ tự con × thứ tự sản phẩm)", () => {
  it("[CTG-01a] oracle có đủ dòng — không rỗng thì mới đo được gì", () => {
    expect(ORACLE_GIA.length).toBe(100);
  });
  it("[CTG-01b] mỗi dòng oracle: % áp dụng, cờ cắt trần, thành tiền khớp từng đồng; Σ thành phần = tổng giảm = niêm yết − thành tiền", () => {
    for (const [gia48, soBuoi, thuTuCon, thuTuSp48, niemYet, pct, biCat, thanhTien] of ORACLE_GIA) {
      // Dòng KHÔNG mua đủ 48 buổi không có thứ tự sản phẩm 48 (Đ3.2): truyền null.
      const r = goiYChuongTrinh(ctx(soBuoi, thuTuCon, niemYet, soBuoi === 48 ? thuTuSp48 : null), PL02, TRAN);
      const nhan = { gia48, soBuoi, thuTuCon, thuTuSp48 };
      expect({ ...nhan, pct: r.phanTramApDung }).toEqual({ ...nhan, pct });
      expect({ ...nhan, biCat: r.biCatTran }).toEqual({ ...nhan, biCat });
      expect({ ...nhan, thanhTien: r.thanhTien }).toEqual({ ...nhan, thanhTien });
      expect(r.thanhPhan.reduce((s, t) => s + t.soTien, 0)).toBe(r.giamGia);
      expect(r.niemYet - r.giamGia).toBe(r.thanhTien);
    }
  });
  it("[CTG-01c] 12 buổi con thứ nhất: KHÔNG có chương trình nào ⇒ giá = niêm yết (Bảng A 0%)", () => {
    const r = goiYChuongTrinh(ctx(12, 1, 2_640_000), PL02, TRAN);
    expect(r.thanhPhan).toEqual([]);
    expect(r.thanhTien).toBe(2_640_000);
    expect(r.phanTramApDung).toBe(0);
  });
});

describe("[CTG-02] ba ví dụ của SR.QD.233 + thứ tự con (mỗi dòng độc lập)", () => {
  it("Ví dụ 1 (chỉ Bảng A): 5.016.000 / 6.912.000 / 2.652.000", () => {
    expect(goiYChuongTrinh(ctx(24, 1, 5_280_000), PL02, TRAN).thanhTien).toBe(5_016_000);
    expect(goiYChuongTrinh(ctx(36, 2, 8_640_000), PL02, TRAN).thanhTien).toBe(6_912_000);
    expect(goiYChuongTrinh(ctx(12, 3, 3_120_000), PL02, TRAN).thanhTien).toBe(2_652_000);
  });
  it("Ví dụ 2 (có gói 48): sản phẩm 48 thứ nhất 11.424.000; con thứ hai mua 24 buổi 6.120.000", () => {
    expect(goiYChuongTrinh(ctx(48, 1, 13_440_000, 1), PL02, TRAN).thanhTien).toBe(11_424_000);
    expect(goiYChuongTrinh(ctx(24, 2, 7_200_000), PL02, TRAN).thanhTien).toBe(6_120_000);
  });
  it("Ví dụ 3 (trần 25%): nền 25% + con thứ ba 15% = 40% ⇒ 25%; khoản cộng thêm bị cắt về 0 và đánh dấu; Σ = 3.600.000", () => {
    const r = goiYChuongTrinh(ctx(48, 3, 14_400_000, 2), PL02, TRAN);
    expect(r.tongPhanTramDanhNghia).toBe(40);
    expect(r.phanTramApDung).toBe(25);
    expect(r.biCatTran).toBe(true);
    expect(r.thanhTien).toBe(10_800_000);
    expect(r.thanhPhan.map((t) => [t.id, t.soTien, t.biCat])).toEqual([
      ["b2", 3_600_000, false],
      ["ae3", 0, true],
    ]);
  });
});

describe("[CTG-03] nhiều con nhiều khoá: gợi ý của dòng nào chỉ phụ thuộc DÒNG ĐÓ", () => {
  const dong = [
    { nhan: "Sata3 con1 24", c: ctx(24, 1, 5_280_000), tt: 5_016_000 },
    { nhan: "Sata4 con2 36", c: ctx(36, 2, 8_640_000), tt: 6_912_000 },
    { nhan: "Sata5 con3 48 sp1", c: ctx(48, 3, 12_480_000, 1), tt: 9_360_000 },
    { nhan: "Sata6 con2 48 sp2", c: ctx(48, 2, 13_440_000, 2), tt: 10_080_000 },
  ];
  it("tính thuận và tính ngược thứ tự cho CÙNG kết quả từng dòng (không rò trạng thái giữa các dòng)", () => {
    const thuan = dong.map((d) => goiYChuongTrinh(d.c, PL02, TRAN));
    const nguoc = [...dong].reverse().map((d) => goiYChuongTrinh(d.c, PL02, TRAN)).reverse();
    expect(nguoc).toEqual(thuan);
    expect(thuan.map((r) => r.thanhTien)).toEqual(dong.map((d) => d.tt));
  });
  it("thứ tự con đổi ⇒ chỉ dòng đó đổi: đảo con 2 ↔ con 1 ở dòng Sata4 36 buổi đổi 6.912.000 → 7.776.000, các dòng khác nguyên", () => {
    expect(goiYChuongTrinh(ctx(36, 1, 8_640_000), PL02, TRAN).thanhTien).toBe(7_776_000);
    expect(goiYChuongTrinh(ctx(24, 1, 5_280_000), PL02, TRAN).thanhTien).toBe(5_016_000);
  });
});

describe("[CTG-07] điều kiện chương trình", () => {
  it("điều kiện trống khớp mọi dòng; số buổi liệt kê khớp đúng các số đó", () => {
    expect(khopDieuKien(TRONG, ctx(7, 1, 1000))).toBe(true);
    expect(khopDieuKien({ ...TRONG, soBuoi: [24, 36] }, ctx(36, 1, 1000))).toBe(true);
    expect(khopDieuKien({ ...TRONG, soBuoi: [24, 36] }, ctx(12, 1, 1000))).toBe(false);
  });
  it("khoảng thứ tự TÍNH CẢ hai đầu; den = null là 'trở đi'", () => {
    const hai = { ...TRONG, thuTuCon: { tu: 2, den: 2 } };
    const batDau3 = { ...TRONG, thuTuCon: { tu: 3, den: null } };
    expect([1, 2, 3].map((n) => khopDieuKien(hai, ctx(24, n, 1000)))).toEqual([false, true, false]);
    expect([2, 3, 9].map((n) => khopDieuKien(batDau3, ctx(24, n, 1000)))).toEqual([false, true, true]);
  });
  it("điều kiện thứ tự sản phẩm 48 mà dòng KHÔNG mua đủ 48 (null) ⇒ không khớp (fail-closed)", () => {
    expect(khopDieuKien({ ...TRONG, thuTuSanPham48: { tu: 1, den: 1 } }, ctx(24, 1, 1000, null))).toBe(false);
    expect(khopDieuKien({ ...TRONG, thuTuSanPham48: { tu: 1, den: 1 } }, ctx(48, 1, 1000, 1))).toBe(true);
  });
  it("một mức NỀN duy nhất — mức cao nhất; hoà giữ thứ tự đầu vào; mức thua được báo trong loaiTru; cộng thêm cộng đủ", () => {
    const thap = ct("thap", "BASE", 5);
    const cao = ct("cao", "BASE", 12);
    const bang = ct("bang", "BASE", 12);
    const them1 = ct("them1", "ADD_ON", 3);
    const them2 = ct("them2", "ADD_ON", 4);
    const r = goiYChuongTrinh(ctx(24, 1, 1_000_000), [thap, cao, bang, them1, them2], null);
    expect(r.thanhPhan.map((t) => t.id)).toEqual(["cao", "them1", "them2"]);
    expect(r.loaiTru.map((l) => l.id).sort()).toEqual(["bang", "thap"]);
    expect(r.tongPhanTramDanhNghia).toBe(19);
    expect(r.biCatTran).toBe(false); // không trần
    expect(r.thanhTien).toBe(810_000);
  });
});

describe("[CTG-08] không làm tròn, đầu vào rác bị chặn", () => {
  const lap = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e instanceof LoiGoiY ? e.ma : `LẠ:${String(e)}`;
    }
    return "KHÔNG NÉM";
  };
  it("giảm không ra số nguyên đồng ⇒ PRICE_NOT_INTEGER (không cắt cụt, không làm tròn)", () => {
    expect(lap(() => goiYChuongTrinh(ctx(24, 1, 1_000_005), [A24], TRAN))).toBe("PRICE_NOT_INTEGER");
  });
  it("chương trình / ngữ cảnh hỏng bị từ chối", () => {
    for (const p of [0, 101, 5.5]) expect(lap(() => goiYChuongTrinh(ctx(24, 1, 1000), [ct("x", "BASE", p)], TRAN))).toBe("UNG_VIEN_KHONG_HOP_LE");
    expect(lap(() => goiYChuongTrinh(ctx(24, 1, 1000), [ct("x", "ADD_ON", 5, { thuTuCon: { tu: 3, den: 2 } })], TRAN))).toBe("UNG_VIEN_KHONG_HOP_LE");
    expect(lap(() => goiYChuongTrinh(ctx(0, 1, 1000), [], TRAN))).toBe("NGU_CANH_KHONG_HOP_LE");
    expect(lap(() => goiYChuongTrinh(ctx(24, 0, 1000), [], TRAN))).toBe("NGU_CANH_KHONG_HOP_LE");
    expect(lap(() => goiYChuongTrinh(ctx(24, 1, 1000), [], 0))).toBe("NGU_CANH_KHONG_HOP_LE");
  });
});

describe("[CTG-04] đổi chính sách giữa hai lần mua: snapshot lần 1 KHÔNG đổi", () => {
  const goiLan1 = () => {
    const a24 = ct("a24", "BASE", 5, { soBuoi: [24] }, "2026-09-01#aaa");
    const kq = goiYChuongTrinh(ctx(24, 1, 5_280_000), [a24], TRAN);
    return { a24, kq, snap: dungSnapshotV2({ gia48: 10_560_000, nguonGia48: "Course.price", ctx: ctx(24, 1, 5_280_000), ketQua: kq, moc: "ORDER_CREATED", ngayXet: new Date("2026-09-10T03:00:00Z"), goiYLuc: new Date("2026-09-10T03:00:05Z") }) };
  };
  it("lần 2 dùng phiên bản mới (8% + thêm cộng thêm 10% cho con 2): số tiền đổi, lần 1 giữ nguyên", () => {
    const l1 = goiLan1();
    const a24b = ct("a24", "BASE", 8, { soBuoi: [24] }, "2026-10-01#bbb");
    const l2 = goiYChuongTrinh(ctx(24, 2, 5_280_000), [a24b, AE2], TRAN);
    expect(l1.kq.thanhTien).toBe(5_016_000); // 5%
    expect(l2.thanhTien).toBe(4_329_600); // 8% + 10% = 18%
    expect(l1.snap.thanhTien).toBe(5_016_000);
  });
  it("sửa chương trình gốc SAU KHI chụp (văn bản sửa tại chỗ) không làm đổi snapshot; snapshot đóng băng", () => {
    const l1 = goiLan1();
    (l1.a24 as { phanTram: number }).phanTram = 99;
    (l1.kq.thanhPhan[0] as { phanTram: number }).phanTram = 99;
    expect(l1.snap.thanhPhan[0]!.phanTram).toBe(5);
    expect(l1.snap.thanhPhan[0]!.phienBan).toBe("2026-09-01#aaa");
    expect(Object.isFrozen(l1.snap)).toBe(true);
    expect(Object.isFrozen(l1.snap.thanhPhan)).toBe(true);
    expect(Object.isFrozen(l1.snap.thanhPhan[0]!)).toBe(true);
  });
  it("snapshot mang đủ căn cứ để đối soát / hoàn tiền: phiên bản, điều kiện khớp, số tiền, mốc ngày, người xác nhận", () => {
    const kq = goiYChuongTrinh(ctx(24, 1, 5_280_000), [A24], TRAN);
    const s = dungSnapshotV2({
      gia48: 10_560_000,
      nguonGia48: "Course.price",
      ctx: ctx(24, 1, 5_280_000),
      ketQua: kq,
      moc: "PAYMENT_RECEIVED",
      ngayXet: new Date("2026-10-02T00:00:00Z"),
      goiYLuc: new Date("2026-10-01T00:00:00Z"),
      nguoiXacNhan: "u-sale-1",
      xacNhanLuc: new Date("2026-10-01T00:05:00Z"),
    });
    expect(s).toMatchObject({
      schemaVersion: 2,
      moHinh: "NIEM_YET_CONG_GIAM_DONG",
      niemYet: 5_280_000,
      giamGia: 264_000,
      thanhTien: 5_016_000,
      moc: "PAYMENT_RECEIVED",
      ngayXet: "2026-10-02T00:00:00.000Z",
      nguoiXacNhan: "u-sale-1",
      xacNhanLuc: "2026-10-01T00:05:00.000Z",
    });
    expect(s.thanhPhan[0]).toMatchObject({ id: "a24", maVanBan: "SR.QD.233", phanTram: 5, soTien: 264_000, dieuKienKhop: { soBuoi: 24, thuTuCon: 1, thuTuSanPham48: null } });
  });
});

describe("[CTG-05] ngày tạo đơn ≠ ngày tiền về: chỉ BÁO lệch, không đổi số tiền", () => {
  const snapLucTaoDon = () =>
    dungSnapshotV2({
      gia48: 10_560_000,
      nguonGia48: "Course.price",
      ctx: ctx(24, 2, 5_280_000),
      ketQua: goiYChuongTrinh(ctx(24, 2, 5_280_000), [ct("a24", "BASE", 5, { soBuoi: [24] }, "v1"), AE2], TRAN),
      moc: "ORDER_CREATED",
      ngayXet: new Date("2026-12-30T03:00:00Z"),
      goiYLuc: new Date("2026-12-30T03:00:00Z"),
    });
  it("cùng chính sách ⇒ không lệch", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [ct("a24", "BASE", 5, { soBuoi: [24] }, "v1"), AE2], TRAN);
    expect(phatHienDoiChinhSach(snapLucTaoDon(), xet)).toEqual({ khac: false, lyDo: [], chenhLechGiamGia: 0 });
  });
  it("tiền về sau khi % đổi (5% → 3%) ⇒ lệch PHAN_TRAM, chênh lệch âm (khách phải đóng NHIỀU hơn)", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [ct("a24", "BASE", 3, { soBuoi: [24] }, "v2"), AE2], TRAN);
    const so = phatHienDoiChinhSach(snapLucTaoDon(), xet);
    expect(so.khac).toBe(true);
    expect(so.lyDo).toContain("PHAN_TRAM");
    expect(so.chenhLechGiamGia).toBe(-105_600); // 2% của 5.280.000
  });
  it("chỉ đổi PHIÊN BẢN văn bản (cùng %) ⇒ vẫn báo, lý do PHIEN_BAN, chênh lệch 0", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [ct("a24", "BASE", 5, { soBuoi: [24] }, "v2-sua-chu"), AE2], TRAN);
    const so = phatHienDoiChinhSach(snapLucTaoDon(), xet);
    expect(so).toEqual({ khac: true, lyDo: ["PHIEN_BAN"], chenhLechGiamGia: 0 });
  });
  it("chương trình biến mất / thêm mới (hết hiệu lực trước ngày tiền về) ⇒ THANH_PHAN", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [AE2], TRAN);
    const so = phatHienDoiChinhSach(snapLucTaoDon(), xet);
    expect(so.lyDo).toContain("THANH_PHAN");
    expect(so.chenhLechGiamGia).toBe(-264_000);
  });
});

describe("[CTG-06] tránh giảm trùng: mô hình nhận biết bằng DỮ LIỆU của snapshot", () => {
  const v1Thuc = taoBaoGiaDong({ gia48: 11_520_000, soBuoi: 24, thuTuCon: 1, cheDoMocNgay: "ORDER_CREATED", ngay: { taoDon: new Date("2026-10-13T03:00:00Z") } }).pricingSnapshot;
  const v2 = dungSnapshotV2({
    gia48: 11_520_000,
    nguonGia48: "Course.price",
    ctx: ctx(24, 1, 5_760_000),
    ketQua: goiYChuongTrinh(ctx(24, 1, 5_760_000), PL02, TRAN),
    moc: "ORDER_CREATED",
    ngayXet: new Date("2026-10-13T03:00:00Z"),
    goiYLuc: new Date("2026-10-13T03:00:00Z"),
  });
  it("snapshot v1 THẬT (do `taoBaoGiaDong` sinh, không có schemaVersion) ⇒ V1 ⇒ KHÔNG gợi ý", () => {
    expect("schemaVersion" in v1Thuc).toBe(false);
    expect(moHinhCuaSnapshot(v1Thuc)).toBe("V1_GIA_DA_GIAM");
    // unitPrice của dòng v1 là số SAU giảm (5.760.000 − 5% = 5.472.000)
    expect(duocGoiYChoDong({ laDongPhamVi: true, snapshot: v1Thuc, soKhoanGiamGhiSan: 0, unitPrice: 5_472_000 })).toEqual({ duoc: false, lyDo: "SNAPSHOT_V1_GIA_DA_GIAM" });
  });
  it("snapshot v2 ⇒ V2, gợi ý được; chưa có snapshot và chưa có khoản giảm (dòng mới) ⇒ KHONG_CO, gợi ý được", () => {
    expect(moHinhCuaSnapshot(v2)).toBe("V2_NIEM_YET_CONG_GIAM_DONG");
    expect(duocGoiYChoDong({ laDongPhamVi: true, snapshot: v2, soKhoanGiamGhiSan: 0, unitPrice: 5_760_000 })).toEqual({ duoc: true });
    for (const x of [null, undefined]) {
      expect(moHinhCuaSnapshot(x)).toBe("KHONG_CO");
      expect(duocGoiYChoDong({ laDongPhamVi: true, snapshot: x, soKhoanGiamGhiSan: 0, unitPrice: 5_760_000 })).toEqual({ duoc: true });
    }
  });
  it("fail-closed: phiên bản lạ / thiếu / sai kiểu ⇒ coi là ĐÃ giảm (V1), không gợi ý", () => {
    for (const x of [{}, { schemaVersion: 3, moHinh: "NIEM_YET_CONG_GIAM_DONG" }, { schemaVersion: "2", moHinh: "NIEM_YET_CONG_GIAM_DONG" }, { schemaVersion: 2 }, { schemaVersion: 2, moHinh: "KHAC" }, "x", 7]) {
      expect(moHinhCuaSnapshot(x)).toBe("V1_GIA_DA_GIAM");
      expect(duocGoiYChoDong({ laDongPhamVi: true, snapshot: x, soKhoanGiamGhiSan: 0, unitPrice: 5_760_000 })).toEqual({ duoc: false, lyDo: "SNAPSHOT_V1_GIA_DA_GIAM" });
    }
  });
});

describe("[CTG-11] cổng trước khi gợi ý: đơn cũ mang giá đã giảm không bị giảm lần hai", () => {
  const v1Thuc = taoBaoGiaDong({ gia48: 11_520_000, soBuoi: 24, thuTuCon: 1, cheDoMocNgay: "ORDER_CREATED", ngay: { taoDon: new Date("2026-10-13T03:00:00Z") } }).pricingSnapshot;
  const v2 = () =>
    dungSnapshotV2({
      gia48: 11_520_000,
      nguonGia48: "Course.price",
      ctx: ctx(24, 1, 5_760_000),
      ketQua: goiYChuongTrinh(ctx(24, 1, 5_760_000), PL02, TRAN),
      moc: "ORDER_CREATED",
      ngayXet: new Date("2026-10-13T03:00:00Z"),
      goiYLuc: new Date("2026-10-13T03:00:00Z"),
    });
  const dong = (o: Partial<Parameters<typeof duocGoiYChoDong>[0]>) => duocGoiYChoDong({ laDongPhamVi: true, snapshot: null, soKhoanGiamGhiSan: 0, unitPrice: 5_760_000, ...o });

  it("dòng KHÔNG phải phạm vi ⇒ không bao giờ gợi ý, dù snapshot v2 hợp lệ", () => {
    expect(dong({ laDongPhamVi: false, snapshot: v2() })).toEqual({ duoc: false, lyDo: "KHONG_PHAI_DONG_PHAM_VI" });
  });
  it("dòng cũ CHƯA có snapshot nhưng đã mang khoản giảm tay / mã ⇒ không gợi ý (đã giảm rồi)", () => {
    expect(dong({ soKhoanGiamGhiSan: 1, unitPrice: 5_472_000 })).toEqual({ duoc: false, lyDo: "DONG_DA_CO_KHOAN_GIAM" });
    expect(dong({ soKhoanGiamGhiSan: 0 })).toEqual({ duoc: true });
  });
  it("dòng v1 có kèm thêm khoản giảm tay (không xảy ra hôm nay, máy chủ từ chối) ⇒ vẫn không gợi ý, lý do v1 đứng trước", () => {
    expect(dong({ snapshot: v1Thuc, soKhoanGiamGhiSan: 2, unitPrice: 5_472_000 })).toEqual({ duoc: false, lyDo: "SNAPSHOT_V1_GIA_DA_GIAM" });
  });
  it("dòng v2: unitPrice phải ĐÚNG là niêm yết — nếu đã bị ghi thành số sau giảm thì từ chối (không cộng lần hai)", () => {
    expect(dong({ snapshot: v2(), unitPrice: 5_760_000 })).toEqual({ duoc: true });
    expect(dong({ snapshot: v2(), unitPrice: 5_472_000 })).toEqual({ duoc: false, lyDo: "SNAPSHOT_V2_KHONG_NHAT_QUAN" });
  });
  it("dòng v2 bị sửa tay trong JSON (Σ thành phần ≠ tổng giảm, thành tiền sai, thiếu trường) ⇒ từ chối", () => {
    const goc = JSON.parse(JSON.stringify(v2()));
    const hong = [
      { ...goc, giamGia: goc.giamGia + 1 },
      { ...goc, thanhTien: goc.thanhTien + 1 },
      // giamGia và thanhTien còn khớp nhau, nhưng một thành phần bị sửa số tiền ⇒ Σ thành phần ≠ tổng giảm (chỉ phép kiểm Σ bắt được)
      { ...goc, thanhPhan: goc.thanhPhan.map((p: { soTien: number }, i: number) => (i === 0 ? { ...p, soTien: p.soTien + 1 } : p)) },
      { ...goc, thanhPhan: [{ soTien: "x" }] },
      { ...goc, thanhPhan: null },
      { ...goc, niemYet: "5760000" },
    ];
    for (const s of hong) expect(dong({ snapshot: s })).toEqual({ duoc: false, lyDo: "SNAPSHOT_V2_KHONG_NHAT_QUAN" });
  });
});

describe("[CTG-12] xét lại khi tiền về (QĐ-33): ghi nhận, KHÔNG đổi số tiền", () => {
  const HIEU_LUC = { tu: new Date("2026-09-01T00:00:00+07:00"), den: new Date("2027-01-01T00:00:00+07:00") };
  const A24c = ct("a24", "BASE", 5, { soBuoi: [24] }, "v1");
  const baoGia = (niemYet = 5_280_000) =>
    dungSnapshotV2({
      gia48: niemYet * 2,
      nguonGia48: "Course.price",
      ctx: ctx(24, 2, niemYet),
      ketQua: goiYChuongTrinh(ctx(24, 2, niemYet), [A24c, AE2], TRAN),
      moc: "ORDER_CREATED",
      ngayXet: new Date("2026-12-30T03:00:00Z"),
      goiYLuc: new Date("2026-12-30T03:00:00Z"),
    });
  const tienVe = new Date("2026-12-31T05:00:00Z");
  const luc = new Date("2027-01-02T01:00:00Z");

  it("snapshot mới dựng: chưa có lần xét lại nào", () => {
    expect(baoGia().cacLanXetLai).toEqual([]);
  });
  it("cùng chính sách ⇒ KHOP; mọi trường giá của snapshot y nguyên; snapshot gốc không bị sửa tại chỗ", () => {
    const s0 = baoGia();
    const truoc = JSON.stringify(s0);
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [A24c, AE2], TRAN);
    const s1 = xetLaiKhiTienVe(s0, { ngayTienVe: tienVe, xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: xet });
    expect(JSON.stringify(s0)).toBe(truoc);
    expect(s1.cacLanXetLai).toHaveLength(1);
    expect(s1.cacLanXetLai[0]).toMatchObject({ trangThai: "KHOP", lyDo: [], chenhLechGiamGia: 0, ngayTienVe: "2026-12-31T05:00:00.000Z" });
    expect({ ...s1, cacLanXetLai: [] }).toEqual({ ...s0, cacLanXetLai: [] });
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.cacLanXetLai)).toBe(true);
    expect(Object.isFrozen(s1.cacLanXetLai[0]!)).toBe(true);
  });
  it("tiền về sau khi % đổi ⇒ CHENH_LECH_CHINH_SACH, chênh lệch được ghi, giamGia/thanhTien của báo giá VẪN là số cũ", () => {
    const s0 = baoGia();
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [ct("a24", "BASE", 3, { soBuoi: [24] }, "v2"), AE2], TRAN);
    const s1 = xetLaiKhiTienVe(s0, { ngayTienVe: tienVe, xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: xet });
    expect(s1.cacLanXetLai[0]).toMatchObject({ trangThai: "CHENH_LECH_CHINH_SACH", chenhLechGiamGia: -105_600 });
    expect(s1.cacLanXetLai[0]!.lyDo).toContain("PHAN_TRAM");
    expect(s1.giamGia).toBe(s0.giamGia);
    expect(s1.thanhTien).toBe(s0.thanhTien);
    // chép GIÁ TRỊ thành phần lúc xét lại, đóng băng
    expect(s1.cacLanXetLai[0]!.thanhPhanXetLai.map((t) => t.phanTram)).toEqual([3, 10]);
    expect(Object.isFrozen(s1.cacLanXetLai[0]!.thanhPhanXetLai[0]!)).toBe(true);
  });
  it("giá niêm yết đổi giữa báo giá và tiền về (chương trình y nguyên) ⇒ lệch NIEM_YET, không lọt thành KHOP", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 6_000_000), [A24c, AE2], TRAN);
    const so = phatHienDoiChinhSach(baoGia(), xet);
    expect(so.khac).toBe(true);
    expect(so.lyDo).toEqual(["NIEM_YET"]);
    expect(so.chenhLechGiamGia).toBe(xet.giamGia - baoGia().giamGia);
  });
  it("30/12 tạo đơn, tiền về 02/01 (ngoài hiệu lực) ⇒ NGOAI_HIEU_LUC: không tự giữ giá cũ, không tự từ chối, không cần kết quả xét lại", () => {
    const s1 = xetLaiKhiTienVe(baoGia(), { ngayTienVe: new Date("2027-01-02T03:00:00+07:00"), xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: null });
    expect(s1.cacLanXetLai[0]).toEqual({
      ngayTienVe: "2027-01-01T20:00:00.000Z",
      xetLaiLuc: "2027-01-02T01:00:00.000Z",
      trangThai: "NGOAI_HIEU_LUC",
      lyDo: [],
      chenhLechGiamGia: null,
      thanhPhanXetLai: [],
    });
  });
  it("biên cửa sổ nửa mở: 00:00 ngày 01/01/2027 giờ VN là NGOÀI, 23:59:59 ngày 31/12 là TRONG; trước 01/09 là NGOÀI", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [A24c, AE2], TRAN);
    const lan = (d: string, k: typeof xet | null) => xetLaiKhiTienVe(baoGia(), { ngayTienVe: new Date(d), xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: k }).cacLanXetLai[0]!.trangThai;
    expect(lan("2027-01-01T00:00:00+07:00", null)).toBe("NGOAI_HIEU_LUC");
    expect(lan("2026-12-31T23:59:59+07:00", xet)).toBe("KHOP");
    expect(lan("2026-08-31T23:59:59+07:00", null)).toBe("NGOAI_HIEU_LUC");
    expect(lan("2026-09-01T00:00:00+07:00", xet)).toBe("KHOP");
  });
  it("tiền về nhiều ngày ⇒ MỖI lần xét ghi thêm một dòng (lịch sử chỉ thêm), lần trước không bị ghi đè", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [A24c, AE2], TRAN);
    const s1 = xetLaiKhiTienVe(baoGia(), { ngayTienVe: new Date("2026-12-29T05:00:00Z"), xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: xet });
    const s2 = xetLaiKhiTienVe(s1, { ngayTienVe: new Date("2026-12-31T05:00:00Z"), xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: xet });
    expect(s2.cacLanXetLai.map((l) => l.ngayTienVe)).toEqual(["2026-12-29T05:00:00.000Z", "2026-12-31T05:00:00.000Z"]);
    expect(s1.cacLanXetLai).toHaveLength(1);
  });
  it("đầu vào hỏng: ngày NaN ⇒ ném NGAY_KHONG_HOP_LE; còn trong hiệu lực mà thiếu kết quả xét lại ⇒ ném (không im lặng KHOP)", () => {
    const xet = goiYChuongTrinh(ctx(24, 2, 5_280_000), [A24c, AE2], TRAN);
    expect(() => xetLaiKhiTienVe(baoGia(), { ngayTienVe: new Date("x"), xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: xet })).toThrow(LoiGoiY);
    expect(() => xetLaiKhiTienVe(baoGia(), { ngayTienVe: tienVe, xetLaiLuc: new Date("x"), hieuLuc: HIEU_LUC, ketQuaXetLai: xet })).toThrow(LoiGoiY);
    expect(() => xetLaiKhiTienVe(baoGia(), { ngayTienVe: tienVe, xetLaiLuc: luc, hieuLuc: HIEU_LUC, ketQuaXetLai: null })).toThrow(LoiGoiY);
  });
});

describe("[CTG-13] Sale xác nhận từng dòng: so tập xác nhận với gợi ý, CHỈ liệt kê chỗ khác", () => {
  const goiY = () => goiYChuongTrinh(ctx(24, 2, 5_280_000), PL02, TRAN); // a24 + ae2
  it("trùng khít ⇒ khớp, không có gì khác (thứ tự gửi lên không quan trọng)", () => {
    expect(soSanhXacNhan(goiY(), ["ae2", "a24"])).toEqual({ khop: true, boBot: [], themVao: [], lap: [] });
  });
  it("Sale bỏ bớt một gợi ý ⇒ boBot", () => {
    expect(soSanhXacNhan(goiY(), ["a24"])).toEqual({ khop: false, boBot: ["ae2"], themVao: [], lap: [] });
    expect(soSanhXacNhan(goiY(), []).boBot).toEqual(["a24", "ae2"]);
  });
  it("Sale thêm mã máy chủ không gợi ý ⇒ themVao", () => {
    expect(soSanhXacNhan(goiY(), ["a24", "ae2", "b2"])).toEqual({ khop: false, boBot: [], themVao: ["b2"], lap: [] });
  });
  it("gửi LẶP một mã ⇒ lap, không khớp (không để một mã bị trừ hai lần)", () => {
    expect(soSanhXacNhan(goiY(), ["a24", "ae2", "ae2"])).toEqual({ khop: false, boBot: [], themVao: [], lap: ["ae2"] });
  });
  it("dòng không có gợi ý nào: xác nhận rỗng là khớp; có mã bất kỳ là themVao", () => {
    const rong = goiYChuongTrinh(ctx(12, 1, 2_640_000), PL02, TRAN);
    expect(soSanhXacNhan(rong, []).khop).toBe(true);
    expect(soSanhXacNhan(rong, ["a24"]).themVao).toEqual(["a24"]);
  });
  it("gợi ý bị cắt về 0 đồng vì trần VẪN là một thành phần phải xác nhận", () => {
    const g = goiYChuongTrinh(ctx(48, 2, 12_000_000, 2), PL02, TRAN); // b2 25% + ae2 10% ⇒ ae2 bị cắt về 0
    expect(g.thanhPhan.map((t) => [t.id, t.soTien])).toEqual([["b2", 3_000_000], ["ae2", 0]]);
    expect(soSanhXacNhan(g, ["b2"]).boBot).toEqual(["ae2"]);
  });
});

describe("[CTG-14] giải thích giá cho Sale / người duyệt: đọc từ kết quả, không tự tính lại", () => {
  it("24 buổi, con thứ hai: nêu căn cứ, từng thành phần, tổng giảm và thành tiền đúng số", () => {
    const c = ctx(24, 2, 5_280_000);
    const dong = giaiThichGia(goiYChuongTrinh(c, PL02, TRAN), c);
    expect(dong).toEqual([
      "Căn cứ: 24 buổi, con thứ 2. Giá niêm yết 5.280.000đ.",
      "• Chương trình a24 (SR.QD.233) — 5%: −264.000đ.",
      "• Chương trình ae2 (SR.QD.233) — 10%: −528.000đ.",
      "Tổng giảm 792.000đ → thành tiền 4.488.000đ.",
    ]);
  });
  it("chạm trần: nói rõ thành phần bị cắt và tổng danh nghĩa vượt trần", () => {
    const c = ctx(48, 2, 12_000_000, 2);
    const dong = giaiThichGia(goiYChuongTrinh(c, PL02, TRAN), c);
    expect(dong).toContain("Căn cứ: 48 buổi, con thứ 2, sản phẩm gói 48 thứ 2. Giá niêm yết 12.000.000đ.");
    expect(dong).toContain("• Chương trình ae2 (SR.QD.233) — 10%: −0đ (bị cắt bớt vì chạm trần).");
    expect(dong).toContain("Tổng 35% vượt trần 25% nên chỉ giảm 25%.");
    expect(dong.at(-1)).toBe("Tổng giảm 3.000.000đ → thành tiền 9.000.000đ.");
  });
  it("không có trần (null) thì KHÔNG in câu về trần; không chương trình nào khớp thì nói giá = niêm yết", () => {
    const c = ctx(12, 1, 2_640_000);
    const dong = giaiThichGia(goiYChuongTrinh(c, PL02, null), c);
    expect(dong).toEqual(["Căn cứ: 12 buổi, con thứ 1. Giá niêm yết 2.640.000đ.", "Chưa có chương trình nào khớp dòng này — giá bằng niêm yết.", "Tổng giảm 0đ → thành tiền 2.640.000đ."]);
    expect(dong.join(" ")).not.toMatch(/trần/);
  });
  it("mức nền thua được giải thích là KHÔNG cộng (mỗi sản phẩm một mức nền)", () => {
    const c = ctx(24, 1, 1_000_000);
    const dong = giaiThichGia(goiYChuongTrinh(c, [ct("thap", "BASE", 5), ct("cao", "BASE", 12)], null), c);
    expect(dong).toContain("• Không cộng Chương trình thap (5%): đã áp mức nền cao hơn — mỗi sản phẩm chỉ một mức nền.");
  });
  it("số lớn: nhóm nghìn bằng dấu chấm, không phụ thuộc locale", () => {
    const c = ctx(24, 1, 5_280_000_000);
    expect(giaiThichGia(goiYChuongTrinh(c, [A24], null), c)[0]).toContain("5.280.000.000đ");
  });
});

describe("[GYC-PIN] chưa nối vào đường nào (cờ TẮT ⇒ đường cũ nguyên văn)", () => {
  const goc = process.cwd();
  const duyet = (dir: string, ra: string[]): string[] => {
    for (const t of readdirSync(dir)) {
      if (t === "node_modules" || t === ".next" || t.startsWith(".")) continue;
      const p = join(dir, t);
      if (statSync(p).isDirectory()) duyet(p, ra);
      else if (/\.(ts|tsx)$/.test(t) && !/(goi-y-chuong-trinh|de-xuat-doi-chuong-trinh(-db)?)\.(test\.)?ts$/.test(t)) ra.push(p);
    }
    return ra;
  };
  it("không tệp nguồn nào ở app/ · lib/ · components/ import goi-y-chuong-trinh (nối vào là đổi hành vi — phải sửa lưới này CÓ CHỦ ĐÍCH)", () => {
    const tep = ["app", "lib", "components"].flatMap((d) => duyet(resolve(goc, d), []));
    expect(tep.length).toBeGreaterThan(100); // lưới thật sự quét được cây
    const nhap = tep.filter((p) => /from\s+["'][^"']*goi-y-chuong-trinh["']/.test(readFileSync(p, "utf8")));
    expect(nhap.map((p) => p.replace(goc, ""))).toEqual([]);
  });
});
