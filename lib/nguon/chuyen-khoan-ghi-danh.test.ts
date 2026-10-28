// [CKG-*] — LÕI THUẦN của P7-B «khoản thu và giá đi theo ghi danh đang học» (`chuyen-khoan-ghi-danh.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Ánh xạ yêu cầu P7-B → ca:
//   hai dây liên kết R1 (dòng đơn trỏ ghi danh mới) / R2 (transferredToId) ⇒ [00..03]   |   KHÔNG đoán khi dây lệch / không dây ⇒ [04..05]   |   chặn: ghi danh mới đã có giá/tiền, biên lai, hoa hồng, hoàn tiền, bảo lưu ⇒ [10..14]
//   khoản không hợp lệ (chờ xác nhận / từ chối / điều chỉnh) ⇒ [15]   |   ghi danh cũ không giá / tiền vượt giá / dòng đơn trỏ ghi danh thứ ba ⇒ [16..18]   |   lệch học viên·khoá·cơ sở ⇒ [19]
//   trạng thái ghi danh (cũ phải đã đóng, mới phải còn hiệu lực) ⇒ [20..22]   |   lô: trùng đích / trùng nguồn dừng cả lô ⇒ [30..31]   |   dòng ký ⇒ [40..42]
import { describe, expect, it } from "vitest";
import {
  KHUON_DONG_CHUYEN_KHOAN,
  GIA_TRONG,
  dongDauRaChuyenKhoan,
  lapKeHoachChuyenKhoan,
  xetUngVienChuyen,
  type GhiDanhChuyen,
  type KhoanChuyen,
  type UngVienChuyen,
} from "./chuyen-khoan-ghi-danh";

// Không gõ nguyên văn cặp «trạng thái bán hàng = đã ghi nhận» / «trạng thái kế toán = đã xác nhận» dạng thuộc tính (lưới [BUOC-4b]/[BUOC-6] quét CẢ cây lib/).
const DA_GHI = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";
const GIA = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };

const ge = (id: string, o: Partial<GhiDanhChuyen> = {}): GhiDanhChuyen => ({
  id, studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, transferredToId: null, gia: GIA, ...o,
});
const khoan = (id: string, o: Partial<KhoanChuyen> = {}): KhoanChuyen => ({
  id, orderId: "o1", amount: 5_016_000, paidDate: new Date("2026-09-20T03:00:00Z"), paymentType: "PAYMENT", saleStatus: DA_GHI, accountantStatus: DA_XAC_NHAN, adjustmentOfId: null, dongDonTroToi: null, coDongDon: false, ...o,
});
const KHONG_CO = { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0 };

/** Mặc định: ghi danh cũ TRANSFERRED giữ 1 khoản + giá; ghi danh mới STUDYING trống; dây R2 hợp lệ. */
function uv(o: Omit<Partial<UngVienChuyen>, "cu" | "moi"> & { cu?: Partial<GhiDanhChuyen>; moi?: Partial<GhiDanhChuyen> | null } = {}): UngVienChuyen {
  const cu = ge("cu", { status: "TRANSFERRED", transferredToId: "moi", ...o.cu });
  const moi = o.moi === null ? null : ge("moi", { status: "STUDYING", gia: GIA_TRONG, ...o.moi });
  return {
    cu,
    r1: o.r1 ?? [],
    r2: o.r2 === undefined ? "moi" : o.r2,
    moi,
    khoanCu: o.khoanCu ?? [khoan("p1")],
    khoanMoi: o.khoanMoi ?? 0,
    moiCo: o.moiCo ?? KHONG_CO,
    cuCo: o.cuCo ?? KHONG_CO,
  };
}
const ma = (u: UngVienChuyen) => {
  const r = xetUngVienChuyen(u);
  return "loai" in r ? r.loai.ma : "OK";
};

describe("[CKG] đối chứng dương + hai dây liên kết", () => {
  it("[CKG-00] ĐỐI CHỨNG DƯƠNG dây R2 (transferredToId): chuyển 1 khoản, giá cũ đi theo, báo dây R2", () => {
    const r = xetUngVienChuyen(uv());
    expect("dong" in r && r.dong).toMatchObject({ cuId: "cu", moiId: "moi", khoanIds: ["p1"], tongTien: 5_016_000, giaCu: GIA, dayLienKet: "R2" });
  });

  it("[CKG-01] ĐỐI CHỨNG DƯƠNG dây R1 (dòng đơn trỏ ghi danh mới), ghi danh cũ WITHDREW không có transferredToId", () => {
    const r = xetUngVienChuyen(uv({ cu: { status: "WITHDREW", transferredToId: null }, r2: null, r1: ["moi"], khoanCu: [khoan("p1", { amount: 8_976_000 })] }));
    expect("dong" in r && r.dong).toMatchObject({ dayLienKet: "R1", tongTien: 8_976_000 });
  });

  it("[CKG-02] cả hai dây cùng trỏ MỘT ghi danh ⇒ R1+R2", () => {
    const r = xetUngVienChuyen(uv({ r1: ["moi"] }));
    expect("dong" in r && r.dong.dayLienKet).toBe("R1+R2");
  });

  it("[CKG-03] nhiều khoản của cùng ghi danh cũ ⇒ chuyển CẢ HAI trong một dòng; danh sách khoản được sắp, tổng đúng", () => {
    const r = xetUngVienChuyen(uv({ khoanCu: [khoan("p2", { amount: 1_230_000 }), khoan("p1", { amount: 1_230_000 })] }));
    expect("dong" in r && r.dong).toMatchObject({ khoanIds: ["p1", "p2"], tongTien: 2_460_000 });
  });

  it("[CKG-04] hai dây trỏ hai ghi danh KHÁC nhau ⇒ HAI_DAY_LIEN_KET_LECH, không đoán", () => {
    expect(ma(uv({ r1: ["khac"] }))).toBe("HAI_DAY_LIEN_KET_LECH");
  });

  it("[CKG-05] không dây nào (không R1, không transferredToId) ⇒ KHONG_TIM_RA_GHI_DANH_MOI; có id nhưng ghi danh không tồn tại ⇒ cũng loại", () => {
    expect(ma(uv({ cu: { transferredToId: null }, r2: null, r1: [], moi: null }))).toBe("KHONG_TIM_RA_GHI_DANH_MOI");
    expect(ma(uv({ moi: null }))).toBe("KHONG_TIM_RA_GHI_DANH_MOI");
  });
});

describe("[CKG] chặn — KHÔNG đè lên thứ đã có", () => {
  it("[CKG-10] ghi danh mới ĐÃ CÓ giá (dù một cột) ⇒ GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN", () => {
    expect(ma(uv({ moi: { gia: { ...GIA_TRONG, finalPrice: 1 } } }))).toBe("GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN");
    expect(ma(uv({ moi: { gia: GIA } }))).toBe("GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN");
  });

  it("[CKG-11] ghi danh mới ĐÃ CÓ khoản thu sống ⇒ GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN (chống gắn trùng / trộn tiền hai nơi)", () => {
    expect(ma(uv({ khoanMoi: 1 }))).toBe("GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN");
  });

  it.each([
    ["biên lai trên ghi danh mới", { moiCo: { ...KHONG_CO, bienLai: 1 } }],
    ["hoa hồng trên ghi danh mới", { moiCo: { ...KHONG_CO, hoaHong: 1 } }],
    ["yêu cầu hoàn tiền trên ghi danh mới", { moiCo: { ...KHONG_CO, hoanTien: 1 } }],
    ["bảo lưu trên ghi danh mới", { moiCo: { ...KHONG_CO, baoLuu: 1 } }],
    ["yêu cầu hoàn tiền trên ghi danh cũ", { cuCo: { ...KHONG_CO, hoanTien: 1 } }],
    ["bảo lưu trên ghi danh cũ", { cuCo: { ...KHONG_CO, baoLuu: 1 } }],
  ] as [string, Partial<UngVienChuyen>][])("[CKG-12] %s ⇒ CO_RANG_BUOC_CHAN", (_t, o) => {
    expect(ma(uv(o))).toBe("CO_RANG_BUOC_CHAN");
  });

  it("[CKG-13] biên lai / hoa hồng trên ghi danh CŨ thì KHÔNG chặn (chỉ báo: lệnh không đổi chứng từ), và được ghi vào dòng báo cáo", () => {
    const r = xetUngVienChuyen(uv({ cuCo: { ...KHONG_CO, bienLai: 1, hoaHong: 2 } }));
    expect("dong" in r && r.dong).toMatchObject({ bienLaiConTroCu: 1, hoaHongConTroCu: 2 });
  });

  it.each([
    ["khoản chờ xác nhận", { accountantStatus: "PENDING" }],
    ["khoản bị từ chối", { accountantStatus: "REJECTED" }],
    ["bút toán điều chỉnh", { adjustmentOfId: "x" }],
    ["khoản chưa ghi nhận", { saleStatus: "DRAFT" }],
    ["khoản không phải PAYMENT", { paymentType: "REFUND" }],
  ] as [string, Partial<KhoanChuyen>][])("[CKG-15] %s trong các khoản của ghi danh cũ ⇒ KHOAN_KHONG_HOP_LE (không trộn, kế toán xử lý trước)", (_t, k) => {
    expect(ma(uv({ khoanCu: [khoan("p1"), khoan("p2", k)] }))).toBe("KHOAN_KHONG_HOP_LE");
  });

  it("[CKG-16] ghi danh cũ KHÔNG có giá để mang đi ⇒ GHI_DANH_CU_KHONG_CO_GIA", () => {
    expect(ma(uv({ cu: { gia: GIA_TRONG } }))).toBe("GHI_DANH_CU_KHONG_CO_GIA");
    expect(ma(uv({ cu: { gia: { ...GIA, finalPrice: null } } }))).toBe("GHI_DANH_CU_KHONG_CO_GIA");
  });

  it("[CKG-17] Σ khoản vượt giá ghi danh cũ ⇒ TIEN_VUOT_GIA; bằng giá thì được", () => {
    expect(ma(uv({ khoanCu: [khoan("p1", { amount: 10_560_001 })] }))).toBe("TIEN_VUOT_GIA");
    expect(ma(uv({ khoanCu: [khoan("p1", { amount: 10_560_000 })] }))).toBe("OK");
  });

  it("[CKG-18] dòng đơn của khoản trỏ ghi danh THỨ BA ⇒ DONG_DON_TRO_GHI_DANH_THU_BA; trỏ ghi danh mới hoặc cũ hoặc chưa trỏ thì được", () => {
    expect(ma(uv({ khoanCu: [khoan("p1", { dongDonTroToi: "ba", coDongDon: true })] }))).toBe("DONG_DON_TRO_GHI_DANH_THU_BA");
    expect(ma(uv({ khoanCu: [khoan("p1", { dongDonTroToi: "moi", coDongDon: true })] }))).toBe("OK");
    expect(ma(uv({ khoanCu: [khoan("p1", { dongDonTroToi: "cu", coDongDon: true })] }))).toBe("OK");
    expect(ma(uv({ khoanCu: [khoan("p1", { dongDonTroToi: null, coDongDon: true })] }))).toBe("OK");
  });

  it.each([
    ["khác học viên", { moi: { studentId: "s2" } }],
    ["khác khoá", { moi: { courseId: "k2" } }],
    ["khác cơ sở", { moi: { centerId: "cs2" } }],
    ["khoá rỗng", { moi: { courseId: null }, cu: { courseId: null } }],
    ["trỏ chính nó", { cu: { transferredToId: "cu" }, r2: "cu", moi: { id: "cu" } }],
  ] as [string, Parameters<typeof uv>[0]][])("[CKG-19] hai ghi danh %s ⇒ LECH_HOC_VIEN_KHOA_CO_SO", (_t, o) => {
    expect(ma(uv(o))).toBe("LECH_HOC_VIEN_KHOA_CO_SO");
  });
});

describe("[CKG] trạng thái hai ghi danh + lô", () => {
  it.each(["ACTIVE", "STUDYING", "PENDING"])("[CKG-20] ghi danh cũ còn hiệu lực (%s) ⇒ GHI_DANH_CU_CHUA_DONG (không rút tiền khỏi ghi danh đang học)", (st) => {
    expect(ma(uv({ cu: { status: st } }))).toBe("GHI_DANH_CU_CHUA_DONG");
  });

  it("[CKG-21] ghi danh cũ đã xoá mềm ⇒ GHI_DANH_CU_CHUA_DONG", () => {
    expect(ma(uv({ cu: { deletedAt: new Date("2026-10-01T00:00:00Z") } }))).toBe("GHI_DANH_CU_CHUA_DONG");
  });

  it.each(["WITHDREW", "TRANSFERRED", "CANCELLED"])("[CKG-22] ghi danh MỚI đã đóng (%s) hoặc xoá mềm ⇒ GHI_DANH_MOI_KHONG_HOP_LE", (st) => {
    expect(ma(uv({ moi: { status: st } }))).toBe("GHI_DANH_MOI_KHONG_HOP_LE");
    expect(ma(uv({ moi: { deletedAt: new Date("2026-10-01T00:00:00Z") } }))).toBe("GHI_DANH_MOI_KHONG_HOP_LE");
  });

  it("[CKG-23] ghi danh cũ không giữ khoản thu sống nào ⇒ KHONG_CO_KHOAN (và là lý do chạy lại ra 0)", () => {
    expect(ma(uv({ khoanCu: [] }))).toBe("KHONG_CO_KHOAN");
  });

  it("[CKG-30] hai ghi danh cũ cùng đích ⇒ TRUNG_DICH ⇒ DỪNG CẢ LÔ, không dòng ghi", () => {
    const a = uv();
    const b = uv({ cu: { id: "cu2", transferredToId: "moi" }, khoanCu: [khoan("p9")] });
    const k = lapKeHoachChuyenKhoan([a, b]);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.loiLo.map((l) => l.ma)).toContain("TRUNG_DICH");
  });

  it("[CKG-31] một ghi danh cũ xuất hiện hai lần ⇒ TRUNG_NGUON ⇒ dừng cả lô", () => {
    const k = lapKeHoachChuyenKhoan([uv(), uv()]);
    expect(k.dung).toBe(true);
    expect(k.loiLo.map((l) => l.ma)).toEqual(expect.arrayContaining(["TRUNG_NGUON", "TRUNG_DICH"]));
    expect(k.ghi).toEqual([]);
  });

  it("[CKG-32] cặp lệch bị LOẠI, không làm dừng lô: hai cặp hợp lệ + một cặp lệch ⇒ ghi hai, loại một", () => {
    const a = uv();
    const b = uv({ cu: { id: "cuB", transferredToId: "moiB" }, moi: { id: "moiB" }, r2: "moiB", khoanCu: [khoan("pB")] });
    const xau = uv({ cu: { id: "cuX", transferredToId: "moiX" }, moi: { id: "moiX", gia: GIA }, r2: "moiX", khoanCu: [khoan("pX")] });
    const k = lapKeHoachChuyenKhoan([a, xau, b]);
    expect(k.dung).toBe(false);
    expect(k.ghi.map((g) => g.cuId)).toEqual(["cu", "cuB"]);
    expect(k.loai.map((l) => l.cuId)).toEqual(["cuX"]);
  });

  it("[CKG-34] CỬA SỔ NGÀY THU: một khoản ngoài [01/09, 23/10) (dữ liệu lịch sử «Nhập liệu ban đầu» tháng 6) ⇒ NGOAI_CUA_SO_NGAY_THU dù mọi điều kiện khác đủ; sát biên: 01/09 00:00 VN vào, 31/08 23:59 VN ra, 23/10 00:00 VN ra", () => {
    const co = (iso: string) => ma(uv({ khoanCu: [khoan("p1", { paidDate: new Date(iso) })] }));
    expect(co("2026-06-10T03:00:00Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(co("2026-08-31T16:59:59Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(co("2026-08-31T17:00:00Z")).toBe("OK");
    expect(co("2026-10-22T16:59:59Z")).toBe("OK");
    expect(co("2026-10-22T17:00:00Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(ma(uv({ khoanCu: [khoan("p1"), khoan("p2", { paidDate: new Date("2026-06-10T03:00:00Z") })] }))).toBe("NGOAI_CUA_SO_NGAY_THU");
  });

  it("[CKG-33] phạm vi rỗng ⇒ kế hoạch rỗng, không lỗi (chạy lại sau khi chuyển ra 0)", () => {
    const k = lapKeHoachChuyenKhoan([]);
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
  });
});

describe("[CKG] dòng ký", () => {
  it("[CKG-40] dòng ký ràng ghi danh cũ → mới, danh sách khoản (đã sắp), tổng tiền, giá mang đi, dây liên kết; không chứa tên/SĐT/email", () => {
    const k = lapKeHoachChuyenKhoan([uv({ khoanCu: [khoan("p2", { amount: 1_000_000 }), khoan("p1", { amount: 2_000_000 })] })]);
    expect(k.dongDauRa).toEqual([[KHUON_DONG_CHUYEN_KHOAN, "cu", "moi", "p1,p2", "3000000", "10560000/NULL/0/10560000/10560000", "R2"].join("|")]);
    expect(k.dongDauRa[0]).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("[CKG-41] PLAN_SHA độc lập thứ tự đầu vào và ĐỔI khi đổi khoản / đích / giá", () => {
    const a = uv();
    const b = uv({ cu: { id: "cuB", transferredToId: "moiB" }, moi: { id: "moiB" }, r2: "moiB", khoanCu: [khoan("pB")] });
    expect(lapKeHoachChuyenKhoan([a, b]).sha).toBe(lapKeHoachChuyenKhoan([b, a]).sha);
    expect(lapKeHoachChuyenKhoan([a]).sha).not.toBe(lapKeHoachChuyenKhoan([uv({ khoanCu: [khoan("pZ")] })]).sha);
    expect(lapKeHoachChuyenKhoan([a]).sha).not.toBe(lapKeHoachChuyenKhoan([uv({ cu: { gia: { ...GIA, finalPrice: 9_000_000 } } })]).sha);
  });

  it("[CKG-42] dongDauRaChuyenKhoan là hàm DUY NHẤT dựng dòng ký (kế hoạch dùng đúng nó)", () => {
    const k = lapKeHoachChuyenKhoan([uv()]);
    expect(k.dongDauRa).toEqual(dongDauRaChuyenKhoan(k.ghi));
  });
});
