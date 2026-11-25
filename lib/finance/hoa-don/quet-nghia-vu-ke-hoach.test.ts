// Ca [QNK-*] — BỘ LẬP KẾ HOẠCH của scanner bóng nghĩa vụ hoá đơn (Invoice Hub S8). THUẦN: nhận kết quả engine + báo cáo đối chiếu + dòng bảng chiếu
// đang có, trả KẾ HOẠCH ghi. Không DB, không đồng hồ thật (mọi mốc là tham số).
//
// Ba tính chất phải khoá:
//   1. IDEMPOTENT — áp kế hoạch rồi lập lại ⇒ không còn gì để tạo / sửa / mở thêm ([QNK-02], [QNK-12]).
//   2. KHÔNG SỬA nghĩa vụ đã gắn hoá đơn về số tiền / băm / loại (ERD: điều chỉnh = nghĩa vụ MỚI) ([QNK-04]).
//   3. Mọi ca "KHÔNG được" kèm đối chứng dương.
import { describe, expect, it } from "vitest";
import type { BaoCaoDoiChieu } from "./engine/doi-chieu-bong";
import { docKhoaNguon, type KetQuaPhanLoai, type LyDoChoQuyet, type NghiaVu } from "./engine/phan-loai-nghia-vu";
import {
  lapKeHoachDon,
  LOAI_NGOAI_LE_CUA_SCANNER,
  type DauVaoKeHoach,
  type HienCoNghiaVu,
  type KeHoachDon,
} from "./quet-nghia-vu-ke-hoach";

const NOW = new Date("2026-11-02T03:00:00Z");

const nv = (o: Partial<NghiaVu> & { khoa: string }): NghiaVu => ({
  nguon: docKhoaNguon(o.khoa)!,
  loai: "THU_TIEN",
  orderId: "od1",
  maDon: "ORD-261101-000001",
  centerId: "cs1",
  orderItemId: null,
  soTien: 8_976_000,
  trangThai: "CHO_XUAT",
  lyDoChoQuyet: null,
  hoaDonId: null,
  khoanGocId: null,
  sourceHash: `h-${o.khoa}`,
  ...o,
});

const engine = (...nghiaVu: NghiaVu[]): KetQuaPhanLoai => ({ nghiaVu, khongSinh: [], thieuCoSo: 0 });

const baoCaoKhop = (o: Partial<BaoCaoDoiChieu> = {}): BaoCaoDoiChieu => ({
  trungHoanToan: true,
  soKhop: 0,
  soKhoanHangCho: 0,
  soNghiaVuKhoanThu: 0,
  soNghiaVuTheoDong: 0,
  chenhLech: [],
  khacCoChuDich: [],
  canhBao: [],
  ...o,
});

const hienCo = (o: Partial<HienCoNghiaVu> & { nguonId: string }): HienCoNghiaVu => ({
  id: `row-${o.nguonId}`,
  nguonLoai: "PAYMENT",
  loai: "THU_TIEN",
  trangThai: "CHO_XUAT",
  lyDoCho: null,
  hoaDonId: null,
  orderItemId: null,
  sourceHash: `h-PAYMENT:${o.nguonId}`,
  soTienSnapshot: 8_976_000,
  phienBan: 1,
  centerId: "cs1",
  ...o,
});

const vao = (o: Partial<DauVaoKeHoach> = {}): DauVaoKeHoach => ({
  orderId: "od1",
  centerId: "cs1",
  cheDo: "THEO_KHOAN_THU",
  now: NOW,
  engine: engine(),
  baoCao: baoCaoKhop(),
  ngayThu: new Map([["p1", "2026-10-30"], ["p2", "2026-10-31"], ["p3", "2026-11-01"]]),
  khoanKhacCoSo: new Set<string>(),
  hienCo: [],
  ngoaiLeMo: [],
  ngoaiLeBoQua: new Set<string>(),
  ...o,
});

/** Áp kế hoạch lên trạng thái bộ nhớ — đúng những gì người chạy DB làm, để kiểm tính idempotent. */
function apDung(trang: HienCoNghiaVu[], kh: KeHoachDon): HienCoNghiaVu[] {
  const ra = trang.map((r) => ({ ...r }));
  for (const t of kh.tao) {
    ra.push({
      id: `row-${t.nguonId}`,
      nguonLoai: t.nguonLoai,
      nguonId: t.nguonId,
      loai: t.loai,
      trangThai: t.trangThai,
      lyDoCho: t.lyDoCho,
      hoaDonId: t.hoaDonId,
      orderItemId: t.orderItemId,
      sourceHash: t.sourceHash,
      soTienSnapshot: t.soTienSnapshot,
      phienBan: 1,
      centerId: t.centerId,
    });
  }
  for (const c of kh.capNhat) {
    const r = ra.find((x) => x.id === c.id)!;
    Object.assign(r, c.data, { phienBan: r.phienBan + 1 });
  }
  return ra;
}

const khongDoiGi = (kh: KeHoachDon) => {
  expect(kh.tao).toEqual([]);
  expect(kh.capNhat).toEqual([]);
  expect(kh.ngoaiLeTao).toEqual([]);
  expect(kh.ngoaiLeDong).toEqual([]);
};

describe("[QNK-01] tạo bảng chiếu từ kết quả engine", () => {
  it("nghĩa vụ mới ⇒ MỘT dòng tạo, mang cơ sở của ĐƠN, ngày thu theo lịch VN, số tiền ròng, băm của engine", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })) }));
    expect(kh.tao).toHaveLength(1);
    expect(kh.tao[0]).toMatchObject({
      khoa: "PAYMENT:p1",
      nguonLoai: "PAYMENT",
      nguonId: "p1",
      loai: "THU_TIEN",
      centerId: "cs1",
      orderId: "od1",
      trangThai: "CHO_XUAT",
      lyDoCho: null,
      ngayPhatSinh: "2026-10-30",
      soTienSnapshot: 8_976_000,
      sourceHash: "h-PAYMENT:p1",
      hoaDonId: null,
    });
    expect(kh.capNhat).toEqual([]);
    expect(kh.ngoaiLeTao).toEqual([]);
    expect(kh.giu).toEqual([]);
  });

  it("thiếu ngày thu của khoản ⇒ KHÔNG tạo dòng (không đoán), báo vào `khongTao`; đối chứng dương: có ngày thì tạo", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p9" })), ngayThu: new Map() }));
    expect(kh.tao).toEqual([]);
    expect(kh.khongTao).toEqual([{ khoa: "PAYMENT:p9", lyDo: "THIEU_NGAY_THU" }]);
    const dc = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })) }));
    expect(dc.tao).toHaveLength(1);
    expect(dc.khongTao).toEqual([]);
  });

  it("[QNK-01b] điều chỉnh giảm trỏ về khoản gốc bằng KHOÁ NGUỒN (người chạy DB đổi sang id sau khi tạo)", () => {
    const kh = lapKeHoachDon(
      vao({
        engine: engine(
          nv({ khoa: "PAYMENT:p1", trangThai: "DA_XUAT", hoaDonId: "hd1" }),
          nv({ khoa: "PAYMENT:p2", loai: "DIEU_CHINH_GIAM", soTien: 1_234_567, khoanGocId: "p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "DIEU_CHINH_CHUA_CHOT", hoaDonId: "hd1" }),
        ),
      }),
    );
    const dc = kh.tao.find((t) => t.nguonId === "p2")!;
    expect(dc.nghiaVuGocKhoa).toBe("PAYMENT:p1");
    expect(kh.tao.find((t) => t.nguonId === "p1")!.nghiaVuGocKhoa).toBeNull();
  });
});

describe("[QNK-02] IDEMPOTENT: áp kế hoạch rồi lập lại ⇒ không còn gì để làm", () => {
  it("lượt đầu tạo, lượt hai chỉ nhịp tim (giu), không tạo / sửa / mở / đóng gì", () => {
    const e = engine(nv({ khoa: "PAYMENT:p1" }), nv({ khoa: "PAYMENT:p2", soTien: 4_488_000, trangThai: "CHO_QUYET", lyDoChoQuyet: "TIEN_THUA", loai: "THU_TIEN" }));
    const v1 = vao({ engine: e });
    const k1 = lapKeHoachDon(v1);
    expect(k1.tao).toHaveLength(2);
    expect(k1.ngoaiLeTao.map((n) => n.loai)).toEqual(["TIEN_THUA"]);
    const sau = apDung([], k1);
    const moSau = k1.ngoaiLeTao.map((n, i) => ({ id: `nl-${i}`, dedupeKey: n.dedupeKey, trangThai: "MO" as const, loai: n.loai }));
    const k2 = lapKeHoachDon({ ...v1, hienCo: sau, ngoaiLeMo: moSau });
    khongDoiGi(k2);
    expect(k2.giu.sort()).toEqual(["row-p1", "row-p2"]);
  });

  it("lập kế hoạch hai lần trên CÙNG đầu vào ⇒ kết quả giống hệt (xác định, không phụ thuộc thứ tự)", () => {
    const a = nv({ khoa: "PAYMENT:p1" });
    const b = nv({ khoa: "PAYMENT:p2", trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" });
    const k1 = lapKeHoachDon(vao({ engine: engine(a, b) }));
    const k2 = lapKeHoachDon(vao({ engine: engine(b, a) }));
    expect(k2).toEqual(k1);
  });
});

describe("[QNK-03] đổi nguồn ⇒ cập nhật (khi CHƯA gắn hoá đơn)", () => {
  it("băm đổi ⇒ cập nhật đủ số tiền / băm / loại, kèm phienBanCu (khoá lạc quan)", () => {
    const cu = hienCo({ nguonId: "p1", soTienSnapshot: 8_976_000, phienBan: 3 });
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1", soTien: 4_488_000, sourceHash: "h-moi", loai: "THU_HOC_CU" })), hienCo: [cu] }),
    );
    expect(kh.tao).toEqual([]);
    expect(kh.capNhat).toEqual([
      { id: "row-p1", khoa: "PAYMENT:p1", phienBanCu: 3, data: { loai: "THU_HOC_CU", soTienSnapshot: 4_488_000, sourceHash: "h-moi" } },
    ]);
  });

  it("băm KHÔNG đổi, trạng thái KHÔNG đổi ⇒ không ghi gì, chỉ `giu` (đối chứng của ca trên)", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), hienCo: [hienCo({ nguonId: "p1" })] }));
    khongDoiGi(kh);
    expect(kh.giu).toEqual(["row-p1"]);
  });
});

describe("[QNK-04] nghĩa vụ ĐÃ GẮN hoá đơn: không sửa số tiền / băm / loại", () => {
  it("số ròng đổi sau khi xuất ⇒ giữ nguyên ảnh chụp (điều chỉnh là nghĩa vụ MỚI), không cập nhật", () => {
    const cu = hienCo({ nguonId: "p1", trangThai: "DA_XUAT", hoaDonId: "hd1", soTienSnapshot: 8_976_000 });
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "DA_XUAT", hoaDonId: "hd1", soTien: 7_741_433, sourceHash: "h-sau-hoan", loai: "THU_TIEN" })), hienCo: [cu] }),
    );
    khongDoiGi(kh);
    expect(kh.giu).toEqual(["row-p1"]);
  });

  it("ĐỐI CHỨNG: cùng thay đổi nhưng dòng CHƯA gắn hoá đơn ⇒ có cập nhật", () => {
    const cu = hienCo({ nguonId: "p1", soTienSnapshot: 8_976_000 });
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", soTien: 7_741_433, sourceHash: "h-sau-hoan" })), hienCo: [cu] }));
    expect(kh.capNhat).toHaveLength(1);
    expect(kh.capNhat[0]!.data).toMatchObject({ soTienSnapshot: 7_741_433, sourceHash: "h-sau-hoan" });
  });

  it("trạng thái vẫn được CHIẾU theo hoá đơn: DANG_XU_LY ⇒ DA_XUAT chỉ đổi trạng thái (+ hoaDonId), không đụng số tiền", () => {
    const cu = hienCo({ nguonId: "p1", trangThai: "DANG_XU_LY", hoaDonId: "hd1" });
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "DA_XUAT", hoaDonId: "hd1", soTien: 1, sourceHash: "h-khac" })), hienCo: [cu] }),
    );
    expect(kh.capNhat).toEqual([{ id: "row-p1", khoa: "PAYMENT:p1", phienBanCu: 1, data: { trangThai: "DA_XUAT" } }]);
  });

  it("hoá đơn bị THAY THẾ ⇒ khoản nhả: DA_XUAT(hd1) về CHO_XUAT, hoaDonId về null — đây là chiếu trạng thái chứ không sửa hoá đơn", () => {
    const cu = hienCo({ nguonId: "p1", trangThai: "DA_XUAT", hoaDonId: "hd1" });
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_XUAT", hoaDonId: null })), hienCo: [cu] }));
    expect(kh.capNhat).toHaveLength(1);
    expect(kh.capNhat[0]!.data).toMatchObject({ trangThai: "CHO_XUAT", hoaDonId: null });
  });
});

describe("[QNK-05] nguồn biến mất", () => {
  it("dòng CHƯA gắn hoá đơn (CHO_XUAT) mà engine không còn sinh ⇒ MAT_NGUON, KHÔNG ngoại lệ (khoản bị từ chối là chuyện bình thường)", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(), hienCo: [hienCo({ nguonId: "p1" })] }));
    expect(kh.capNhat).toEqual([{ id: "row-p1", khoa: "PAYMENT:p1", phienBanCu: 1, data: { trangThai: "MAT_NGUON", lyDoCho: "NGUON_MAT" } }]);
    expect(kh.ngoaiLeTao).toEqual([]);
  });

  it("dòng ĐÃ có hoá đơn mà nguồn mất ⇒ KHÔNG sửa dòng, MỞ ngoại lệ NGUON_MAT mức KHẨN", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(), hienCo: [hienCo({ nguonId: "p1", trangThai: "DA_XUAT", hoaDonId: "hd1" })] }));
    expect(kh.capNhat).toEqual([]);
    expect(kh.ngoaiLeTao).toEqual([
      expect.objectContaining({ loai: "NGUON_MAT", muc: "KHAN", centerId: "cs1", orderId: "od1", hoaDonId: "hd1", dedupeKey: "NGUON_MAT:PAYMENT:p1", nghiaVuKhoa: "PAYMENT:p1" }),
    ]);
  });

  it("đã MAT_NGUON từ trước ⇒ không ghi lại, không ngoại lệ (idempotent)", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(), hienCo: [hienCo({ nguonId: "p1", trangThai: "MAT_NGUON", lyDoCho: "NGUON_MAT" })] }));
    khongDoiGi(kh);
  });

  it("nguồn quay lại ⇒ dòng MAT_NGUON được cập nhật về trạng thái engine", () => {
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), hienCo: [hienCo({ nguonId: "p1", trangThai: "MAT_NGUON", lyDoCho: "NGUON_MAT" })] }),
    );
    expect(kh.capNhat).toHaveLength(1);
    expect(kh.capNhat[0]!.data).toMatchObject({ trangThai: "CHO_XUAT", lyDoCho: null });
  });

  it("chế độ THEO_KHOAN_THU: dòng BILLING:* không phải của scanner này ⇒ bỏ qua (đối chứng: THEO_KHOAN_THU_VA_DONG_DON thì xét)", () => {
    const billing = hienCo({ nguonId: "oi1", nguonLoai: "BILLING", sourceHash: "h-BILLING:oi1" });
    khongDoiGi(lapKeHoachDon(vao({ engine: engine(), hienCo: [billing] })));
    const kh = lapKeHoachDon(vao({ engine: engine(), hienCo: [billing], cheDo: "THEO_KHOAN_THU_VA_DONG_DON" }));
    expect(kh.capNhat).toHaveLength(1);
  });
});

describe("[QNK-06] ngoại lệ từ lý do chờ-quyết của engine", () => {
  const choQuyet = (lyDo: LyDoChoQuyet, o: Partial<NghiaVu> = {}) =>
    nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: lyDo, ...o });

  it.each([
    ["NGHI_TRUNG", "NGHI_TRUNG", "CAN_XU_LY"],
    ["TIEN_THUA", "TIEN_THUA", "CAN_XU_LY"],
    ["THU_TRUOC_CHO_QUYET", "COC_CHUA_PHAN_LOAI", "CAN_XU_LY"],
    ["LOAI_KHOAN_MO_HO", "LOAI_KHOAN_MO_HO", "CAN_XU_LY"],
  ] as const)("%s ⇒ ngoại lệ %s mức %s, dedupeKey = loại + khoá nguồn", (lyDo, loai, muc) => {
    const kh = lapKeHoachDon(vao({ engine: engine(choQuyet(lyDo)) }));
    expect(kh.ngoaiLeTao).toEqual([
      expect.objectContaining({ loai, muc, dedupeKey: `${loai}:PAYMENT:p1`, centerId: "cs1", orderId: "od1", nghiaVuKhoa: "PAYMENT:p1" }),
    ]);
    // Nghĩa vụ vẫn được ghi, và CHO_QUYET luôn mang lý do (CHECK của DB).
    expect(kh.tao[0]!.trangThai).toBe("CHO_QUYET");
    expect(kh.tao[0]!.lyDoCho).toBe(lyDo);
  });

  it("điều chỉnh giảm chưa chốt ⇒ HOAN_TIEN_SAU_XUAT mức KHẨN (hoá đơn khách đang giữ đã lệch)", () => {
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p2", loai: "DIEU_CHINH_GIAM", khoanGocId: "p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "DIEU_CHINH_CHUA_CHOT", hoaDonId: "hd1" })) }),
    );
    expect(kh.ngoaiLeTao).toEqual([expect.objectContaining({ loai: "HOAN_TIEN_SAU_XUAT", muc: "KHAN", hoaDonId: "hd1" })]);
  });

  it.each(["LAN_THU_THIEU", "DOT_DA_HUY", "DON_DA_HUY", "LAP_THEO_DONG_CHUA_CHOT"] as const)(
    "%s ⇒ KHÔNG ngoại lệ (đã có ngăn riêng ở hàng chờ; thêm ngoại lệ là nhắc đôi) — ĐỐI CHỨNG của bảng trên",
    (lyDo) => {
      const kh = lapKeHoachDon(vao({ engine: engine(choQuyet(lyDo)) }));
      expect(kh.ngoaiLeTao).toEqual([]);
      expect(kh.tao[0]!.lyDoCho).toBe(lyDo);
    },
  );

  it("CHO_XUAT / DA_XUAT / DANG_XU_LY / KHONG_XUAT ⇒ không ngoại lệ", () => {
    for (const trangThai of ["CHO_XUAT", "DA_XUAT", "DANG_XU_LY", "KHONG_XUAT"] as const) {
      expect(lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai })) })).ngoaiLeTao, trangThai).toEqual([]);
    }
  });
});

describe("[QNK-07] đối chiếu bóng ⇒ LECH_SHADOW", () => {
  it("mỗi dòng `chenhLech` thành MỘT ngoại lệ LECH_SHADOW (dedupeKey có đơn + loại lệch + khoá); `khacCoChuDich` thì KHÔNG", () => {
    const baoCao = baoCaoKhop({
      trungHoanToan: false,
      chenhLech: [
        { loai: "KHAC_SO_TIEN", khoa: "PAYMENT:p1", thongDiep: "Số tiền khác nhau" },
        { loai: "KHAC_THIEU_CO_SO", khoa: "THIEU_CO_SO", thongDiep: "lệch số thiếu cơ sở" },
      ],
      khacCoChuDich: [{ ma: "ENGINE_SIET_HON", khoa: "PAYMENT:p2", lyDo: "TIEN_THUA", thongDiep: "đã giải thích" }],
    });
    const kh = lapKeHoachDon(vao({ baoCao, engine: engine(nv({ khoa: "PAYMENT:p1" })) }));
    const ls = kh.ngoaiLeTao.filter((n) => n.loai === "LECH_SHADOW");
    expect(ls.map((n) => n.dedupeKey).sort()).toEqual(["LECH_SHADOW:od1:KHAC_SO_TIEN:PAYMENT:p1", "LECH_SHADOW:od1:KHAC_THIEU_CO_SO:THIEU_CO_SO"]);
    expect(ls.every((n) => n.muc === "CAN_XU_LY" && n.orderId === "od1" && n.centerId === "cs1")).toBe(true);
    expect(ls.find((n) => n.dedupeKey.endsWith("PAYMENT:p1"))!.nghiaVuKhoa).toBe("PAYMENT:p1");
    expect(ls.find((n) => n.dedupeKey.endsWith("THIEU_CO_SO"))!.nghiaVuKhoa).toBeNull();
  });

  it("trùng hoàn toàn ⇒ không LECH_SHADOW nào (đối chứng)", () => {
    expect(lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })) })).ngoaiLeTao).toEqual([]);
  });
});

describe("[QNK-08] KHOẢN THU KHÁC CƠ SỞ với đơn (ADR §2.1: scanner không đề xuất, không tự phát hành)", () => {
  it("CHO_XUAT + khoản thu ở cơ sở khác ⇒ ghi CHO_QUYET / KHOAN_KHAC_CO_SO + ngoại lệ PHAP_NHAN_KHAC_NOI_NHAN_TIEN", () => {
    const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), khoanKhacCoSo: new Set(["p1"]) }));
    expect(kh.tao[0]).toMatchObject({ trangThai: "CHO_QUYET", lyDoCho: "KHOAN_KHAC_CO_SO" });
    expect(kh.ngoaiLeTao).toEqual([
      expect.objectContaining({ loai: "PHAP_NHAN_KHAC_NOI_NHAN_TIEN", muc: "CAN_XU_LY", dedupeKey: "PHAP_NHAN_KHAC_NOI_NHAN_TIEN:PAYMENT:p1", nghiaVuKhoa: "PAYMENT:p1" }),
    ]);
  });

  it("ĐỐI CHỨNG: khoản CÙNG cơ sở không bị đổi; khoản đã DA_XUAT/DANG_XU_LY khác cơ sở không bị kéo về CHO_QUYET", () => {
    const cung = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), khoanKhacCoSo: new Set(["p2"]) }));
    expect(cung.tao[0]!.trangThai).toBe("CHO_XUAT");
    expect(cung.ngoaiLeTao).toEqual([]);
    for (const trangThai of ["DA_XUAT", "DANG_XU_LY"] as const) {
      const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai, hoaDonId: "hd1" })), khoanKhacCoSo: new Set(["p1"]) }));
      expect(kh.tao[0]!.trangThai, trangThai).toBe(trangThai);
    }
  });

  it("khoản khác cơ sở đã ở CHO_QUYET sẵn vì lý do khác ⇒ GIỮ lý do của engine nhưng vẫn mở ngoại lệ pháp nhân (hai việc khác nhau)", () => {
    const kh = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" })), khoanKhacCoSo: new Set(["p1"]) }),
    );
    expect(kh.tao[0]!.lyDoCho).toBe("NGHI_TRUNG");
    expect(kh.ngoaiLeTao.map((n) => n.loai).sort()).toEqual(["NGHI_TRUNG", "PHAP_NHAN_KHAC_NOI_NHAN_TIEN"]);
  });
});

describe("[QNK-09] chống trùng và tự đóng ngoại lệ", () => {
  const moNghiTrung = { id: "nl1", dedupeKey: "NGHI_TRUNG:PAYMENT:p1", trangThai: "MO" as const, loai: "NGHI_TRUNG" };

  it("ngoại lệ cùng dedupeKey đang MỞ ⇒ không mở thêm (đối chứng: chưa mở thì mở)", () => {
    const e = engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" }));
    const cu = [hienCo({ nguonId: "p1", trangThai: "CHO_QUYET", lyDoCho: "NGHI_TRUNG" })];
    expect(lapKeHoachDon(vao({ engine: e, hienCo: cu, ngoaiLeMo: [moNghiTrung] })).ngoaiLeTao).toEqual([]);
    expect(lapKeHoachDon(vao({ engine: e, hienCo: cu })).ngoaiLeTao).toHaveLength(1);
  });

  it("hết điều kiện ⇒ TỰ ĐÓNG ngoại lệ MO của scanner; đối chứng: còn điều kiện thì giữ", () => {
    const cu = [hienCo({ nguonId: "p1", trangThai: "CHO_QUYET", lyDoCho: "NGHI_TRUNG" })];
    const het = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), hienCo: cu, ngoaiLeMo: [moNghiTrung] }));
    expect(het.ngoaiLeDong).toEqual([{ id: "nl1" }]);
    const con = lapKeHoachDon(
      vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" })), hienCo: cu, ngoaiLeMo: [moNghiTrung] }),
    );
    expect(con.ngoaiLeDong).toEqual([]);
  });

  it("KHÔNG tự đóng ngoại lệ đang DANG_XU_LY (có người đang làm), và KHÔNG đụng loại không phải của scanner", () => {
    const e = engine(nv({ khoa: "PAYMENT:p1" }));
    const dangXuLy = { ...moNghiTrung, trangThai: "DANG_XU_LY" as const };
    expect(lapKeHoachDon(vao({ engine: e, ngoaiLeMo: [dangXuLy] })).ngoaiLeDong).toEqual([]);
    const khac = { id: "nl2", dedupeKey: "THIEU_NGUOI_MUA:ORDER:od1", trangThai: "MO" as const, loai: "THIEU_NGUOI_MUA" };
    expect(lapKeHoachDon(vao({ engine: e, ngoaiLeMo: [khac] })).ngoaiLeDong).toEqual([]);
    expect(LOAI_NGOAI_LE_CUA_SCANNER).not.toContain("THIEU_NGUOI_MUA");
  });

  it("CỔNG: loại nào scanner SINH RA thì scanner cũng được TỰ ĐÓNG — hai danh sách là MỘT", () => {
    const sinh = new Set<string>();
    const lyDos: LyDoChoQuyet[] = ["NGHI_TRUNG", "TIEN_THUA", "THU_TRUOC_CHO_QUYET", "LOAI_KHOAN_MO_HO", "DIEU_CHINH_CHUA_CHOT"];
    for (const lyDo of lyDos) {
      const kh = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: lyDo })) }));
      for (const n of kh.ngoaiLeTao) sinh.add(n.loai);
    }
    sinh.add(lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), khoanKhacCoSo: new Set(["p1"]) })).ngoaiLeTao[0]!.loai);
    sinh.add(lapKeHoachDon(vao({ engine: engine(), hienCo: [hienCo({ nguonId: "p1", trangThai: "DA_XUAT", hoaDonId: "hd1" })] })).ngoaiLeTao[0]!.loai);
    sinh.add(lapKeHoachDon(vao({ baoCao: baoCaoKhop({ trungHoanToan: false, chenhLech: [{ loai: "KHAC_SO_TIEN", khoa: "PAYMENT:p1", thongDiep: "x" }] }) })).ngoaiLeTao[0]!.loai);
    for (const loai of sinh) expect(LOAI_NGOAI_LE_CUA_SCANNER, loai).toContain(loai);
    expect([...LOAI_NGOAI_LE_CUA_SCANNER].sort()).toEqual([...sinh].sort());
  });
});

describe("[QNK-09d] khoá đã được kế toán BỎ QUA có lý do thì KHÔNG mở lại", () => {
  const e = () => engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" }));
  const cu = () => [hienCo({ nguonId: "p1", trangThai: "CHO_QUYET", lyDoCho: "NGHI_TRUNG" })];

  it("nguyên nhân còn nhưng dedupeKey đã bị bỏ qua ⇒ không ngoại lệ mới (nghĩa vụ vẫn ghi); đối chứng: khoá khác thì mở", () => {
    const kh = lapKeHoachDon(vao({ engine: e(), hienCo: cu(), ngoaiLeBoQua: new Set(["NGHI_TRUNG:PAYMENT:p1"]) }));
    expect(kh.ngoaiLeTao).toEqual([]);
    const dc = lapKeHoachDon(vao({ engine: e(), hienCo: cu(), ngoaiLeBoQua: new Set(["NGHI_TRUNG:PAYMENT:p9"]) }));
    expect(dc.ngoaiLeTao).toHaveLength(1);
  });

  it("bỏ qua chỉ chặn ĐÚNG khoá đó: cùng khoản mà LOẠI ngoại lệ khác vẫn mở (khoản khác cơ sở + nghi trùng)", () => {
    const kh = lapKeHoachDon(
      vao({ engine: e(), hienCo: cu(), khoanKhacCoSo: new Set(["p1"]), ngoaiLeBoQua: new Set(["NGHI_TRUNG:PAYMENT:p1"]) }),
    );
    expect(kh.ngoaiLeTao.map((n) => n.loai)).toEqual(["PHAP_NHAN_KHAC_NOI_NHAN_TIEN"]);
  });
});

describe("[QNK-10] đơn không có cơ sở", () => {
  it("centerId null ⇒ không ghi gì (cột centerId NOT NULL), báo `boQua`", () => {
    const kh = lapKeHoachDon(vao({ centerId: null, engine: engine(nv({ khoa: "PAYMENT:p1" })), hienCo: [] }));
    khongDoiGi(kh);
    expect(kh.boQua).toBe("THIEU_CO_SO");
    expect(lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })) })).boQua).toBeNull();
  });
});

describe("[QNK-11] bất biến của DB mà kế hoạch phải giữ", () => {
  it("MỌI dòng tạo / cập nhật sang CHO_QUYET đều có lyDoCho không rỗng (CHECK HoaDonNghiaVu_cho_quyet_ly_do_check)", () => {
    const lyDos: LyDoChoQuyet[] = ["NGHI_TRUNG", "LAN_THU_THIEU", "DOT_DA_HUY", "DON_DA_HUY", "TIEN_THUA", "LOAI_KHOAN_MO_HO", "THU_TRUOC_CHO_QUYET", "DIEU_CHINH_CHUA_CHOT", "LAP_THEO_DONG_CHUA_CHOT"];
    for (const lyDo of lyDos) {
      const t = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: lyDo })) })).tao[0]!;
      expect(t.lyDoCho, lyDo).toBeTruthy();
      const cu = hienCo({ nguonId: "p1" });
      const c = lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: lyDo })), hienCo: [cu] })).capNhat[0]!;
      expect(c.data.lyDoCho, lyDo).toBeTruthy();
    }
  });

  it("engine đưa CHO_QUYET mà KHÔNG có lý do ⇒ kế hoạch ném (không ghi dòng sẽ vi phạm CHECK)", () => {
    expect(() => lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", trangThai: "CHO_QUYET", lyDoChoQuyet: null })) }))).toThrow(/lý do/i);
  });

  it("nghĩa vụ của ĐƠN KHÁC lọt vào đầu vào ⇒ kế hoạch ném (không ghi chéo đơn / chéo cơ sở)", () => {
    expect(() => lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", orderId: "od-khac" })) }))).toThrow(/đơn/i);
    expect(() => lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1", centerId: "cs2" })) }))).toThrow(/cơ sở/i);
  });

  it("dòng bảng chiếu thuộc cơ sở khác đơn ⇒ ném (dữ liệu chéo cơ sở không được âm thầm sửa)", () => {
    expect(() => lapKeHoachDon(vao({ engine: engine(nv({ khoa: "PAYMENT:p1" })), hienCo: [hienCo({ nguonId: "p1", centerId: "cs2" })] }))).toThrow(/cơ sở/i);
  });
});
