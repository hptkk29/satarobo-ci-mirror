// [CKG-*] — LÕI THUẦN của P7-B v2 «khoản thu và giá GÓI đi theo ghi danh đang học» (`chuyen-khoan-ghi-danh.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Ánh xạ yêu cầu P7-B v2 → ca:
//   phạm vi = danh sách cặp do người ký chọn, KHÔNG tự chọn ⇒ [CKG-50..55]   |   giá đích là giá gói đã ký, KHÔNG mang giá cũ nguyên văn, nợ sau = 0 ⇒ [CKG-16..17] [CKG-60..62]
//   hai dây liên kết R1 (dòng đơn trỏ ghi danh mới) / R2 (transferredToId) ⇒ [00..03]   |   KHÔNG đoán khi dây lệch / không dây / cặp lệch bằng chứng ⇒ [04..06]   |   chặn: ghi danh mới đã có giá/tiền, biên lai, hoa hồng, hoàn tiền, bảo lưu ⇒ [10..14]
//   khoản không hợp lệ ⇒ [15]   |   dòng đơn trỏ ghi danh thứ ba ⇒ [18]   |   lệch học viên·khoá·cơ sở ⇒ [19]   |   trạng thái ghi danh ⇒ [20..23]   |   lô: cặp xấu / trùng đích / trùng nguồn dừng cả lô ⇒ [30..34]
//   dòng ký + vân tay dữ liệu ⇒ [40..43]   |   chạy lại: cặp đã xong ⇒ [56]
import { describe, expect, it } from "vitest";
import {
  KHUON_DONG_CHUYEN_KHOAN,
  GIA_TRONG,
  dongDauRaChuyenKhoan,
  lapKeHoachChuyenKhoan,
  phanTichCap,
  truocSauCapChuyen,
  xetUngVienChuyen,
  type CapYeuCau,
  type GhiDanhChuyen,
  type KhoanChuyen,
  type UngVienChuyen,
} from "./chuyen-khoan-ghi-danh";
import { giaDichWaveCB } from "./wave-c-sua-gia-ghi-danh";

// Không gõ nguyên văn cặp «trạng thái bán hàng = đã ghi nhận» / «trạng thái kế toán = đã xác nhận» dạng thuộc tính (lưới [BUOC-4b]/[BUOC-6] quét CẢ cây lib/).
const DA_GHI = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";
const GIA = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };
const TIEN = 5_016_000;
/** Giá thực dòng khoá học của đơn (totalPrice − discountAmount): 10.560.000 − 5% = 10.032.000 = đợt 1 + đợt 2. */
const GIA_DONG = 10_032_000;

const ge = (id: string, o: Partial<GhiDanhChuyen> = {}): GhiDanhChuyen => ({
  id, studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, transferredToId: null, gia: GIA, ...o,
});
const khoan = (id: string, o: Partial<KhoanChuyen> = {}): KhoanChuyen => ({
  id, orderId: "o1", amount: TIEN, paidDate: new Date("2026-09-20T03:00:00Z"), paymentType: "PAYMENT", saleStatus: DA_GHI, accountantStatus: DA_XAC_NHAN, adjustmentOfId: null, dongDonTroToi: null, coDongDon: false, ...o,
});
const KHONG_CO = { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0 };

/** Cặp được yêu cầu: giá gói = `final` (list = final, không giảm) — hàm chuẩn dựng năm cột. */
const yc = (final = TIEN, o: Partial<CapYeuCau> = {}): CapYeuCau => ({ cuId: "cu", moiId: "moi", giaMoi: giaDichWaveCB(final, 0), ...o });

/** Mặc định: ghi danh cũ TRANSFERRED giữ 1 khoản + giá cũ (10,56tr — SAI so với gói); ghi danh mới STUDYING trống; dây R2 hợp lệ. */
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
    dauVan: o.dauVan ?? "dv-1",
    daXong: o.daXong ?? false,
    // mặc định: một đơn, một dòng khoá học, giá thực 10,032tr (đơn Sata3 − 5%)
    dongKhoaDon: o.dongKhoaDon ?? { soDon: 1, soDongKhoa: 1, gia: GIA_DONG },
  };
}
const ma = (u: UngVienChuyen, y: CapYeuCau = yc(u.khoanCu.reduce((s, k) => s + k.amount, 0) || TIEN)) => {
  const r = xetUngVienChuyen(u, y);
  return "loai" in r ? r.loai.ma : "OK";
};

describe("[CKG] đối chứng dương + hai dây liên kết", () => {
  it("[CKG-00] ĐỐI CHỨNG DƯƠNG dây R2 (transferredToId): chuyển 1 khoản, GIÁ GÓI ĐÃ KÝ (không phải giá cũ) đi theo, báo dây R2", () => {
    const r = xetUngVienChuyen(uv(), yc());
    expect("dong" in r && r.dong).toMatchObject({ cuId: "cu", moiId: "moi", khoanIds: ["p1"], tongTien: TIEN, giaCu: GIA, giaMoi: giaDichWaveCB(TIEN, 0), dayLienKet: "R2" });
    expect("dong" in r && r.dong.giaMoi.finalPrice).not.toBe(GIA.finalPrice);
  });

  it("[CKG-01] ĐỐI CHỨNG DƯƠNG dây R1 (dòng đơn trỏ ghi danh mới), ghi danh cũ WITHDREW không có transferredToId", () => {
    const r = xetUngVienChuyen(uv({ cu: { status: "WITHDREW", transferredToId: null }, r2: null, r1: ["moi"], khoanCu: [khoan("p1", { amount: 8_976_000 })] }), yc(8_976_000));
    expect("dong" in r && r.dong).toMatchObject({ dayLienKet: "R1", tongTien: 8_976_000 });
  });

  it("[CKG-02] cả hai dây cùng trỏ MỘT ghi danh ⇒ R1+R2", () => {
    const r = xetUngVienChuyen(uv({ r1: ["moi"] }), yc());
    expect("dong" in r && r.dong.dayLienKet).toBe("R1+R2");
  });

  it("[CKG-03] nhiều khoản của cùng ghi danh cũ ⇒ chuyển CẢ HAI trong một dòng; danh sách khoản được sắp, tổng đúng", () => {
    const r = xetUngVienChuyen(uv({ khoanCu: [khoan("p2", { amount: 1_230_000 }), khoan("p1", { amount: 1_230_000 })] }), yc(2_460_000));
    expect("dong" in r && r.dong).toMatchObject({ khoanIds: ["p1", "p2"], tongTien: 2_460_000 });
  });

  it("[CKG-04] hai dây trỏ hai ghi danh KHÁC nhau ⇒ HAI_DAY_LIEN_KET_LECH, không đoán", () => {
    expect(ma(uv({ r1: ["khac"] }))).toBe("HAI_DAY_LIEN_KET_LECH");
  });

  it("[CKG-05] không dây nào (không R1, không transferredToId) ⇒ KHONG_TIM_RA_GHI_DANH_MOI; có id nhưng ghi danh không tồn tại ⇒ cũng loại", () => {
    expect(ma(uv({ cu: { transferredToId: null }, r2: null, r1: [], moi: null }))).toBe("KHONG_TIM_RA_GHI_DANH_MOI");
    expect(ma(uv({ moi: null }))).toBe("KHONG_TIM_RA_GHI_DANH_MOI");
  });

  it("[CKG-06] người ký chọn cặp cu→KHÁC nhưng bằng chứng chỉ tới `moi` ⇒ CAP_LECH_BANG_CHUNG (chọn cặp và kiểm bằng chứng là HAI việc độc lập; không đoán)", () => {
    expect(ma(uv(), yc(TIEN, { moiId: "khac" }))).toBe("CAP_LECH_BANG_CHUNG");
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
    const r = xetUngVienChuyen(uv({ cuCo: { ...KHONG_CO, bienLai: 1, hoaHong: 2 } }), yc());
    expect("dong" in r && r.dong).toMatchObject({ bienLaiConTroCu: 1, hoaHongConTroCu: 2 });
  });

  it.each([
    ["khoản chờ xác nhận", { accountantStatus: "PENDING" }],
    ["khoản bị từ chối", { accountantStatus: "REJECTED" }],
    ["bút toán điều chỉnh", { adjustmentOfId: "x" }],
    ["khoản chưa ghi nhận", { saleStatus: "DRAFT" }],
    ["khoản không phải PAYMENT", { paymentType: "REFUND" }],
  ] as [string, Partial<KhoanChuyen>][])("[CKG-15] %s trong các khoản của ghi danh cũ ⇒ KHOAN_KHONG_HOP_LE (không trộn, kế toán xử lý trước)", (_t, k) => {
    expect(ma(uv({ khoanCu: [khoan("p1"), khoan("p2", k)] }), yc(TIEN * 2))).toBe("KHOAN_KHONG_HOP_LE");
  });

  it("[CKG-16] ghi danh cũ KHÔNG có giá thì VẪN chuyển được (v2: giá đích do người ký đưa, không phụ thuộc giá cũ)", () => {
    expect(ma(uv({ cu: { gia: GIA_TRONG } }))).toBe("OK");
    expect(ma(uv({ cu: { gia: { ...GIA, finalPrice: null } } }))).toBe("OK");
  });

  it("[CKG-17] giá đích THẤP hơn Σ khoản thu sống ⇒ GIA_DICH_KHAC_TONG_THU (không bao giờ tạo tiền thừa); khớp Σ thu thì được", () => {
    expect(ma(uv(), yc(TIEN - 1))).toBe("GIA_DICH_KHAC_TONG_THU");
    expect(ma(uv(), yc(TIEN))).toBe("OK");
    // giá CŨ trùng giá đích hay không cũng không quan trọng: thước là Σ tiền thật
    expect(ma(uv({ cu: { gia: { ...GIA, finalPrice: TIEN, listPrice: TIEN, tuition: TIEN } } }), yc(TIEN))).toBe("OK");
  });

  it("[CKG-17b] giá đích CAO hơn Σ thu (còn nợ đợt chưa thu): chỉ nhận khi BẰNG giá thực dòng khoá học duy nhất của đơn (DB); khai cao hơn mà không khớp dòng đơn ⇒ GIA_DICH_KHONG_KHOP_DONG", () => {
    // đúng: 10.032.000 = giá dòng đơn, Σ thu 5.016.000 ⇒ ghi danh mới nợ 5.016.000
    const r = xetUngVienChuyen(uv(), yc(GIA_DONG));
    expect("dong" in r && r.dong).toMatchObject({ tongTien: TIEN, giaMoi: giaDichWaveCB(GIA_DONG, 0) });
    expect("dong" in r && r.dong.giaMoi.finalPrice! - r.dong.tongTien).toBe(5_016_000);
    // người ký khai cao hơn dòng đơn một đồng ⇒ nợ ảo ⇒ từ chối
    expect(ma(uv(), yc(GIA_DONG + 1))).toBe("GIA_DICH_KHONG_KHOP_DONG");
    // cao hơn Σ thu nhưng thấp hơn giá dòng đơn ⇒ cũng không khớp
    expect(ma(uv(), yc(TIEN + 1))).toBe("GIA_DICH_KHONG_KHOP_DONG");
  });

  it("[CKG-17c] giá cao hơn Σ thu mà các khoản thuộc >1 đơn, hoặc đơn không có đúng 1 dòng khoá học, hoặc không có giá dòng ⇒ DON_KHONG_MOT_DONG_KHOA (không đoán)", () => {
    expect(ma(uv({ dongKhoaDon: { soDon: 2, soDongKhoa: 1, gia: GIA_DONG } }), yc(GIA_DONG))).toBe("DON_KHONG_MOT_DONG_KHOA");
    expect(ma(uv({ dongKhoaDon: { soDon: 1, soDongKhoa: 2, gia: null } }), yc(GIA_DONG))).toBe("DON_KHONG_MOT_DONG_KHOA");
    expect(ma(uv({ dongKhoaDon: { soDon: 1, soDongKhoa: 0, gia: null } }), yc(GIA_DONG))).toBe("DON_KHONG_MOT_DONG_KHOA");
    // giá = Σ thu thì KHÔNG cần đơn: nhánh cũ nguyên vẹn
    expect(ma(uv({ dongKhoaDon: { soDon: 2, soDongKhoa: 2, gia: null } }), yc(TIEN))).toBe("OK");
  });

  it("[CKG-17d] báo cáo TRƯỚC/SAU: ghi danh mới mang nợ = giá − Σ thu (5.016.000), tổng tiền trước = sau; ghi danh cũ về NULL", () => {
    const r = xetUngVienChuyen(uv(), yc(GIA_DONG));
    if (!("dong" in r)) throw new Error("phải ra dòng");
    const t = truocSauCapChuyen(r.dong, 0);
    expect(t.sau).toMatchObject({ giaMoi: GIA_DONG, daThuMoi: TIEN, noMoi: GIA_DONG - TIEN, giaCu: null, noCu: null });
    expect(t.tongTienTruoc).toBe(t.tongTienSau);
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
  ] as [string, Parameters<typeof uv>[0]][])("[CKG-19] hai ghi danh %s ⇒ LECH_HOC_VIEN_KHOA_CO_SO (hoặc CAP_LECH_BANG_CHUNG khi tự trỏ chính nó)", (_t, o) => {
    const u = uv(o);
    const r = xetUngVienChuyen(u, yc(TIEN, { moiId: u.moi?.id ?? "moi" }));
    expect("loai" in r && ["LECH_HOC_VIEN_KHOA_CO_SO"]).toContain("loai" in r ? r.loai.ma : "OK");
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

  it("[CKG-23] ghi danh cũ không giữ khoản thu sống nào ⇒ KHONG_CO_KHOAN", () => {
    expect(ma(uv({ khoanCu: [] }), yc())).toBe("KHONG_CO_KHOAN");
  });

  it("[CKG-30] hai ghi danh cũ cùng đích ⇒ TRUNG_DICH ⇒ DỪNG CẢ LÔ, không dòng ghi", () => {
    const a = uv();
    const b = uv({ cu: { id: "cu2", transferredToId: "moi" }, khoanCu: [khoan("p9")] });
    const k = lapKeHoachChuyenKhoan([a, b], [yc(), yc(TIEN, { cuId: "cu2" })]);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.loiLo.map((l) => l.ma)).toContain("TRUNG_DICH");
  });

  it("[CKG-31] hai yêu cầu cùng ghi danh cũ ⇒ TRUNG_NGUON ⇒ dừng cả lô", () => {
    const k = lapKeHoachChuyenKhoan([uv()], [yc(), yc()]);
    expect(k.dung).toBe(true);
    expect(k.loiLo.map((l) => l.ma)).toEqual(expect.arrayContaining(["TRUNG_NGUON", "TRUNG_DICH"]));
    expect(k.ghi).toEqual([]);
  });

  it("[CKG-32] v2: MỘT cặp được yêu cầu trượt quy tắc ⇒ DỪNG CẢ LÔ (hai cặp tốt + một cặp xấu ⇒ không ghi cặp nào; không bỏ qua im lặng)", () => {
    const a = uv();
    const b = uv({ cu: { id: "cuB", transferredToId: "moiB" }, moi: { id: "moiB" }, r2: "moiB", khoanCu: [khoan("pB")] });
    const xau = uv({ cu: { id: "cuX", transferredToId: "moiX" }, moi: { id: "moiX", gia: GIA }, r2: "moiX", khoanCu: [khoan("pX")] });
    const k = lapKeHoachChuyenKhoan([a, xau, b], [yc(), yc(TIEN, { cuId: "cuX", moiId: "moiX" }), yc(TIEN, { cuId: "cuB", moiId: "moiB" })]);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.loiLo.map((l) => `${l.cuId}:${l.ma}`)).toEqual(["cuX:GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN"]);
  });

  it("[CKG-34] CỬA SỔ NGÀY THU: một khoản ngoài [01/09, 23/10) ⇒ NGOAI_CUA_SO_NGAY_THU dù mọi điều kiện khác đủ; sát biên: 01/09 00:00 VN vào, 31/08 23:59 VN ra, 23/10 00:00 VN ra", () => {
    const co = (iso: string) => ma(uv({ khoanCu: [khoan("p1", { paidDate: new Date(iso) })] }));
    expect(co("2026-06-10T03:00:00Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(co("2026-08-31T16:59:59Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(co("2026-08-31T17:00:00Z")).toBe("OK");
    expect(co("2026-10-22T16:59:59Z")).toBe("OK");
    expect(co("2026-10-22T17:00:00Z")).toBe("NGOAI_CUA_SO_NGAY_THU");
    expect(ma(uv({ khoanCu: [khoan("p1"), khoan("p2", { paidDate: new Date("2026-06-10T03:00:00Z") })] }), yc(TIEN * 2))).toBe("NGOAI_CUA_SO_NGAY_THU");
  });
});

describe("[CKG] phạm vi do người ký chọn (v2)", () => {
  it("[CKG-50] KHÔNG yêu cầu ⇒ kế hoạch rỗng; ứng viên có sẵn nhưng không được chọn KHÔNG bao giờ vào kế hoạch (ca mới phát sinh không lọt)", () => {
    const k = lapKeHoachChuyenKhoan([uv()], []);
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
  });

  it("[CKG-51] hai ứng viên đủ bằng chứng, chỉ MỘT được chọn ⇒ chỉ cặp đó có dòng ký; cặp kia không mặt trong dòng ký", () => {
    const b = uv({ cu: { id: "cuB", transferredToId: "moiB" }, moi: { id: "moiB" }, r2: "moiB", khoanCu: [khoan("pB")] });
    const k = lapKeHoachChuyenKhoan([uv(), b], [yc(TIEN, { cuId: "cuB", moiId: "moiB" })]);
    expect(k.ghi.map((g) => g.cuId)).toEqual(["cuB"]);
    expect(k.dongDauRa.join("\n")).not.toContain("|cu|");
  });

  it("[CKG-52] cặp được chọn mà ghi danh cũ không tồn tại ⇒ CAP_KHONG_CO_GHI_DANH_CU, dừng", () => {
    const k = lapKeHoachChuyenKhoan([uv()], [yc(TIEN, { cuId: "khongco", moiId: "moiX" })]);
    expect(k.dung).toBe(true);
    expect(k.loiLo.map((l) => l.ma)).toEqual(["CAP_KHONG_CO_GHI_DANH_CU"]);
  });

  it("[CKG-53] phanTichCap: khuôn đúng (giá niêm yết · % giảm · giá cuối) dựng năm cột bằng hàm chuẩn; giá cuối khai ≠ hàm chuẩn ⇒ lỗi (bắt gõ nhầm số được ký)", () => {
    const ok = phanTichCap("abcdefgh1:abcdefgh2:10560000:15:8976000");
    expect("cap" in ok && ok.cap[0]).toMatchObject({ cuId: "abcdefgh1", moiId: "abcdefgh2", giaMoi: { listPrice: 10_560_000, finalPrice: 8_976_000, tuition: 8_976_000 } });
    expect("loi" in phanTichCap("abcdefgh1:abcdefgh2:10560000:15:8976001")).toBe(true);
  });

  it.each([
    ["rỗng", ""],
    ["thiếu trường", "abcdefgh1:abcdefgh2:10560000:15"],
    ["id quá ngắn", "a:b:10560000:15:8976000"],
    ["cũ trùng mới", "abcdefgh1:abcdefgh1:10560000:15:8976000"],
    ["phần trăm > 100", "abcdefgh1:abcdefgh2:10560000:101:1"],
    ["giá có dấu chấm", "abcdefgh1:abcdefgh2:10.560.000:15:8976000"],
    ["giá âm", "abcdefgh1:abcdefgh2:-1:15:8976000"],
    ["dấu phẩy thừa", "abcdefgh1:abcdefgh2:10560000:15:8976000,"],
    ["ghi danh cũ lặp", "abcdefgh1:abcdefgh2:10560000:15:8976000,abcdefgh1:abcdefgh3:10560000:15:8976000"],
    ["ghi danh mới lặp", "abcdefgh1:abcdefgh2:10560000:15:8976000,abcdefgh3:abcdefgh2:10560000:15:8976000"],
  ])("[CKG-54] phanTichCap từ chối: %s", (_t, raw) => {
    expect("loi" in phanTichCap(raw)).toBe(true);
  });

  it("[CKG-55] phanTichCap(null/undefined) ⇒ lỗi (không có phạm vi mặc định)", () => {
    expect("loi" in phanTichCap(null)).toBe(true);
    expect("loi" in phanTichCap(undefined)).toBe(true);
  });

  it("[CKG-56] chạy lại: cặp ĐÃ Ở TRẠNG THÁI ĐÍCH ⇒ vào `daXong`, 0 dòng ghi, không lỗi (idempotent)", () => {
    const k = lapKeHoachChuyenKhoan([uv({ daXong: true, khoanCu: [] })], [yc()]);
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.daXong).toEqual(["cu"]);
    expect(k.dongDauRa).toEqual([]);
  });
});

describe("[CKG] giá gói đã ký — không mang giá cũ (v2)", () => {
  it("[CKG-60] giá niêm yết 10.560.000 giảm 15% ⇒ ghi danh mới nhận 8.976.000 (năm cột), KHÔNG phải 10.560.000 của ghi danh cũ", () => {
    const g = giaDichWaveCB(10_560_000, 15);
    const r = xetUngVienChuyen(uv({ khoanCu: [khoan("p1", { amount: 8_976_000 })] }), yc(8_976_000, { giaMoi: g }));
    expect("dong" in r && r.dong.giaMoi).toEqual(g);
    expect("dong" in r && r.dong.giaMoi.finalPrice).toBe(8_976_000);
    expect("dong" in r && r.dong.giaCu.finalPrice).toBe(10_560_000);
  });

  it("[CKG-61] ngay cả khi giá cũ = giá gói thì dòng vẫn mang giaMoi do người ký đưa (không đọc lại từ ghi danh cũ)", () => {
    const r = xetUngVienChuyen(uv({ cu: { gia: { ...GIA, listPrice: TIEN, tuition: TIEN, finalPrice: TIEN } } }), yc());
    expect("dong" in r && r.dong.giaMoi).toEqual(giaDichWaveCB(TIEN, 0));
  });

  it("[CKG-62] BEFORE/AFTER: nợ ghi danh cũ trước = giá cũ − đã thu (nợ ảo), sau = không còn giá; nợ ghi danh mới trước = không có, sau = 0; tổng tiền học viên trước = sau", () => {
    const r = xetUngVienChuyen(uv(), yc());
    if (!("dong" in r)) throw new Error("cần dòng");
    const t = truocSauCapChuyen(r.dong, 0);
    expect(t.truoc).toMatchObject({ giaCu: 10_560_000, daThuCu: TIEN, noCu: 10_560_000 - TIEN, giaMoi: null, noMoi: null });
    expect(t.sau).toMatchObject({ giaCu: null, daThuCu: 0, noCu: null, giaMoi: TIEN, daThuMoi: TIEN, noMoi: 0 });
    expect(t.tongTienTruoc).toBe(t.tongTienSau);
  });
});

describe("[CKG] dòng ký + vân tay dữ liệu", () => {
  it("[CKG-40] dòng ký ràng ghi danh cũ → mới, khoản (đã sắp), tổng tiền, giá cũ → giá gói mới, dây, VÂN TAY; không chứa tên/SĐT/email", () => {
    const k = lapKeHoachChuyenKhoan([uv({ khoanCu: [khoan("p2", { amount: 1_000_000 }), khoan("p1", { amount: 2_000_000 })] })], [yc(3_000_000)]);
    expect(k.dongDauRa).toEqual([[KHUON_DONG_CHUYEN_KHOAN, "cu", "moi", "p1,p2", "3000000", "10560000/NULL/0/10560000/10560000", "3000000/PERCENT/0/3000000/3000000", "R2", "dv-1"].join("|")]);
    expect(KHUON_DONG_CHUYEN_KHOAN.endsWith("/v2")).toBe(true);
    expect(k.dongDauRa[0]).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("[CKG-41] PLAN_SHA độc lập thứ tự đầu vào và ĐỔI khi đổi khoản / đích / giá cũ / giá gói", () => {
    const a = uv();
    const b = uv({ cu: { id: "cuB", transferredToId: "moiB" }, moi: { id: "moiB" }, r2: "moiB", khoanCu: [khoan("pB")] });
    const cap = [yc(), yc(TIEN, { cuId: "cuB", moiId: "moiB" })];
    expect(lapKeHoachChuyenKhoan([a, b], cap).sha).toBe(lapKeHoachChuyenKhoan([b, a], [...cap].reverse()).sha);
    expect(lapKeHoachChuyenKhoan([a], [yc()]).sha).not.toBe(lapKeHoachChuyenKhoan([uv({ khoanCu: [khoan("pZ")] })], [yc()]).sha);
    expect(lapKeHoachChuyenKhoan([a], [yc()]).sha).not.toBe(lapKeHoachChuyenKhoan([uv({ cu: { gia: { ...GIA, finalPrice: 9_000_000 } } })], [yc()]).sha);
    expect(lapKeHoachChuyenKhoan([a], [yc()]).sha).not.toBe(lapKeHoachChuyenKhoan([a], [yc(TIEN, { giaMoi: giaDichWaveCB(5_280_000, 5) })]).sha);
  });

  it("[CKG-42] dongDauRaChuyenKhoan là hàm DUY NHẤT dựng dòng ký (kế hoạch dùng đúng nó)", () => {
    const k = lapKeHoachChuyenKhoan([uv()], [yc()]);
    expect(k.dongDauRa).toEqual(dongDauRaChuyenKhoan(k.ghi));
  });

  it("[CKG-43] VÂN TAY: dữ liệu liên quan đổi một byte kể từ lần chạy thử (vân tay khác) ⇒ dòng ký khác ⇒ PLAN_SHA khác ⇒ cổng ký từ chối (phải chạy thử lại, ký lại)", () => {
    const truoc = lapKeHoachChuyenKhoan([uv({ dauVan: "dv-A" })], [yc()]);
    const sau = lapKeHoachChuyenKhoan([uv({ dauVan: "dv-B" })], [yc()]);
    expect(truoc.dongDauRa[0]).not.toBe(sau.dongDauRa[0]);
    expect(truoc.sha).not.toBe(sau.sha);
    expect(truoc.dongDauRa[0]!.endsWith("|dv-A")).toBe(true);
  });
});
