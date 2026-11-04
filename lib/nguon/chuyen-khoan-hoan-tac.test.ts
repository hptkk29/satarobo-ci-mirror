// [CKH-*] — LÕI THUẦN của HOÀN TÁC P7-B v2 (`chuyen-khoan-hoan-tac.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Hoàn tác chỉ chạy khi trạng thái HIỆN TẠI đúng bằng trạng thái SAU lượt chuyển; có gì lệch ⇒ DỪNG, không sửa nửa vời.
//   đối chứng dương ⇒ [00]   |   mỗi điều kiện lệch ⇒ [10..19]   |   lô ⇒ [20..22]   |   dòng ký ⇒ [30..31]   |   phân tích --cap ⇒ [40..41]
import { describe, expect, it } from "vitest";
import {
  KHUON_DONG_HOAN_TAC,
  dongDauRaHoanTac,
  lapKeHoachHoanTac,
  phanTichCapHoanTac,
  xetHoanTac,
  type CapHoanTac,
  type CapTrongNhatKy,
  type TrangThaiHoanTac,
} from "./chuyen-khoan-hoan-tac";
import { GIA_TRONG, type GhiDanhChuyen } from "./chuyen-khoan-ghi-danh";
import { giaDichWaveCB } from "./wave-c-sua-gia-ghi-danh";

const DA_GHI = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";
const GIA_CU = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };
const GOI = giaDichWaveCB(10_560_000, 15); // 8.976.000

const ge = (id: string, o: Partial<GhiDanhChuyen> = {}): GhiDanhChuyen => ({
  id, studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, transferredToId: null, gia: GIA_TRONG, ...o,
});
const Y: CapHoanTac = { cuId: "cu", moiId: "moi" };
const NK: CapTrongNhatKy = { luotKhoa: "luot:1:1", cu: "cu", moi: "moi", khoan: ["p1"], tongTien: 8_976_000, giaCu: GIA_CU, giaMoi: GOI };
const khoan = (id = "p1", o: Partial<TrangThaiHoanTac["khoanMoi"][number]> = {}) => ({
  id, amount: 8_976_000, paymentType: "PAYMENT", saleStatus: DA_GHI, accountantStatus: DA_XAC_NHAN, adjustmentOfId: null, ...o,
});
/** Trạng thái SAU lượt chuyển: ghi danh cũ đã đóng + không giá + không khoản; ghi danh mới đang học + giá gói + giữ khoản. */
const tt = (o: Partial<Omit<TrangThaiHoanTac, "cu" | "moi">> & { cu?: Partial<GhiDanhChuyen>; moi?: Partial<GhiDanhChuyen> } = {}): TrangThaiHoanTac => ({
  cu: ge("cu", { status: "WITHDREW", ...o.cu }),
  moi: ge("moi", { status: "STUDYING", gia: GOI, ...o.moi }),
  khoanMoi: o.khoanMoi ?? [khoan()],
  soKhoanSongCu: o.soKhoanSongCu ?? 0,
  moiCo: o.moiCo ?? { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0 },
  daHoanTac: o.daHoanTac ?? false,
});
const ma = (n: CapTrongNhatKy | null, t: TrangThaiHoanTac | null) => {
  const r = xetHoanTac(Y, n, t);
  return "loi" in r ? r.loi.ma : "OK";
};

describe("[CKH] hoàn tác — đối chứng dương", () => {
  it("[CKH-00] trạng thái hiện tại = sau lượt chuyển ⇒ dòng hoàn tác: khoản về ghi danh cũ, giá gói của ghi danh mới về NULL, giá cũ khôi phục đúng nhật ký", () => {
    const r = xetHoanTac(Y, NK, tt());
    expect("dong" in r && r.dong).toEqual({ cuId: "cu", moiId: "moi", khoanIds: ["p1"], tongTien: 8_976_000, giaMoiHienTai: GOI, giaCuKhoiPhuc: GIA_CU, luotKhoa: "luot:1:1" });
  });
});

describe("[CKH] hoàn tác — MỖI điều kiện lệch ⇒ DỪNG (không sửa nửa vời)", () => {
  it("[CKH-10] không có nhật ký lượt ghi chứa cặp ⇒ KHONG_CO_NHAT_KY_GHI (không đoán giá/khoản cũ)", () => {
    expect(ma(null, tt())).toBe("KHONG_CO_NHAT_KY_GHI");
  });

  it("[CKH-11] không đọc được một trong hai ghi danh ⇒ KHONG_DOC_DUOC_GHI_DANH", () => {
    expect(ma(NK, null)).toBe("KHONG_DOC_DUOC_GHI_DANH");
  });

  it("[CKH-12] đã hoàn tác rồi ⇒ DA_HOAN_TAC (không hoàn tác lần hai)", () => {
    expect(ma(NK, tt({ daHoanTac: true }))).toBe("DA_HOAN_TAC");
  });

  it.each([
    ["ghi danh cũ không còn đóng (đã được mở lại ACTIVE)", { cu: { status: "ACTIVE" } }],
    ["ghi danh cũ bị xoá mềm", { cu: { deletedAt: new Date("2026-10-27T00:00:00Z") } }],
    ["ghi danh mới đã đóng (WITHDREW)", { moi: { status: "WITHDREW" } }],
    ["ghi danh mới bị xoá mềm", { moi: { deletedAt: new Date("2026-10-27T00:00:00Z") } }],
  ] as [string, Parameters<typeof tt>[0]][])("[CKH-13] %s ⇒ TRANG_THAI_GHI_DANH_DOI", (_t, o) => {
    expect(ma(NK, tt(o))).toBe("TRANG_THAI_GHI_DANH_DOI");
  });

  it("[CKH-14] có người SỬA GIÁ ghi danh mới sau lượt chuyển (dù 1đ) ⇒ GIA_DA_BI_SUA; ghi danh cũ đã có giá lại ⇒ GIA_DA_BI_SUA", () => {
    expect(ma(NK, tt({ moi: { gia: { ...GOI, finalPrice: (GOI.finalPrice ?? 0) + 1 } } }))).toBe("GIA_DA_BI_SUA");
    expect(ma(NK, tt({ cu: { gia: { ...GIA_CU, finalPrice: 1 } } }))).toBe("GIA_DA_BI_SUA");
  });

  it("[CKH-15] tập khoản sống của ghi danh mới KHÁC tập đã chuyển (thêm một khoản / thiếu một khoản / khoản khác id) ⇒ TAP_KHOAN_DA_DOI", () => {
    expect(ma(NK, tt({ khoanMoi: [khoan("p1"), khoan("p2", { amount: 1 })] }))).toBe("TAP_KHOAN_DA_DOI");
    expect(ma(NK, tt({ khoanMoi: [] }))).toBe("TAP_KHOAN_DA_DOI");
    expect(ma(NK, tt({ khoanMoi: [khoan("pKhac")] }))).toBe("TAP_KHOAN_DA_DOI");
  });

  it("[CKH-16] ghi danh cũ lại có khoản sống (ai đó gắn thêm sau lượt chuyển) ⇒ TAP_KHOAN_DA_DOI", () => {
    expect(ma(NK, tt({ soKhoanSongCu: 1 }))).toBe("TAP_KHOAN_DA_DOI");
  });

  it.each([
    ["khoản chờ xác nhận", { accountantStatus: "PENDING" }],
    ["khoản bị từ chối", { accountantStatus: "REJECTED" }],
    ["thành bút toán điều chỉnh", { adjustmentOfId: "x" }],
    ["không còn ghi nhận", { saleStatus: "DRAFT" }],
    ["thành hoàn tiền", { paymentType: "REFUND" }],
  ] as [string, Partial<TrangThaiHoanTac["khoanMoi"][number]>][])("[CKH-17] khoản %s sau lượt chuyển ⇒ KHOAN_DA_DOI_TRANG_THAI", (_t, k) => {
    expect(ma(NK, tt({ khoanMoi: [khoan("p1", k)] }))).toBe("KHOAN_DA_DOI_TRANG_THAI");
  });

  it("[CKH-18] số tiền khoản đổi (Σ ≠ tổng lượt ghi) ⇒ KHOAN_DA_DOI_TRANG_THAI", () => {
    expect(ma(NK, tt({ khoanMoi: [khoan("p1", { amount: 8_976_001 })] }))).toBe("KHOAN_DA_DOI_TRANG_THAI");
  });

  it.each([
    ["biên lai", { bienLai: 1 }],
    ["hoa hồng", { hoaHong: 1 }],
    ["yêu cầu hoàn", { hoanTien: 1 }],
    ["bảo lưu", { baoLuu: 1 }],
  ])("[CKH-19] ghi danh mới đã có %s sau lượt chuyển ⇒ GHI_DANH_MOI_DA_CO_CHUNG_TU (kéo ngược sẽ tách chứng từ khỏi khoản — kế toán quyết)", (_t, c) => {
    expect(ma(NK, tt({ moiCo: { bienLai: 0, hoaHong: 0, hoanTien: 0, baoLuu: 0, ...c } }))).toBe("GHI_DANH_MOI_DA_CO_CHUNG_TU");
  });
});

describe("[CKH] lô + dòng ký", () => {
  const nhatKy = new Map([["cu>moi", NK]]);
  const trangThai = new Map([["cu", tt()]]);

  it("[CKH-20] một cặp lệch trong lô ⇒ DỪNG CẢ LÔ, không dòng hoàn tác nào (kể cả cặp tốt)", () => {
    const nk2 = new Map([...nhatKy, ["cuB>moiB", { ...NK, cu: "cuB", moi: "moiB", khoan: ["pB"] }]]);
    const t2 = new Map([...trangThai, ["cuB", tt({ cu: { id: "cuB" }, moi: { id: "moiB" }, khoanMoi: [khoan("pKhac")] })]]);
    const k = lapKeHoachHoanTac([Y, { cuId: "cuB", moiId: "moiB" }], nk2, t2);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.loiLo.map((l) => `${l.cuId}:${l.ma}`)).toEqual(["cuB:TAP_KHOAN_DA_DOI"]);
  });

  it("[CKH-21] cặp không có trong nhật ký ⇒ DỪNG (không hoàn tác cặp không do lệnh P7-B chuyển)", () => {
    const k = lapKeHoachHoanTac([Y], new Map(), trangThai);
    expect(k.dung).toBe(true);
    expect(k.loiLo.map((l) => l.ma)).toEqual(["KHONG_CO_NHAT_KY_GHI"]);
  });

  it("[CKH-22] phạm vi rỗng ⇒ kế hoạch rỗng, không lỗi", () => {
    const k = lapKeHoachHoanTac([], new Map(), new Map());
    expect(k.dung).toBe(false);
    expect(k.dongDauRa).toEqual([]);
  });

  it("[CKH-30] dòng ký: ghi danh cũ → mới, khoản (đã sắp), tổng, giá gói hiện tại → giá khôi phục, lượt ghi nguồn; không PII", () => {
    const k = lapKeHoachHoanTac([Y], nhatKy, trangThai);
    expect(k.dongDauRa).toEqual([[KHUON_DONG_HOAN_TAC, "cu", "moi", "p1", "8976000", "10560000/PERCENT/1584000/8976000/8976000", "10560000/NULL/0/10560000/10560000", "luot:1:1"].join("|")]);
    expect(KHUON_DONG_HOAN_TAC).not.toMatch(/chuyen-khoan-ghi-danh\//);
    expect(k.dongDauRa[0]).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("[CKH-31] PLAN_SHA đổi khi đổi giá khôi phục / lượt nguồn / khoản; dongDauRaHoanTac là hàm DUY NHẤT dựng dòng ký", () => {
    const k = lapKeHoachHoanTac([Y], nhatKy, trangThai);
    const k2 = lapKeHoachHoanTac([Y], new Map([["cu>moi", { ...NK, luotKhoa: "luot:2:1" }]]), trangThai);
    const k3 = lapKeHoachHoanTac([Y], new Map([["cu>moi", { ...NK, giaCu: { ...GIA_CU, finalPrice: 9_000_000 } }]]), trangThai);
    expect(k.sha).not.toBe(k2.sha);
    expect(k.sha).not.toBe(k3.sha);
    expect(k.dongDauRa).toEqual(dongDauRaHoanTac(k.ghi));
  });
});

describe("[CKH] phanTichCapHoanTac", () => {
  it("[CKH-40] khuôn đúng cuId:moiId, nhiều cặp cách nhau dấu phẩy, sắp theo cuId", () => {
    const r = phanTichCapHoanTac("abcdefgh2:abcdefgh9,abcdefgh1:abcdefgh8");
    expect("cap" in r && r.cap).toEqual([{ cuId: "abcdefgh1", moiId: "abcdefgh8" }, { cuId: "abcdefgh2", moiId: "abcdefgh9" }]);
  });

  it.each([
    ["rỗng", ""],
    ["thiếu moiId", "abcdefgh1"],
    ["thừa trường", "abcdefgh1:abcdefgh2:3"],
    ["id ngắn", "a:b"],
    ["cũ = mới", "abcdefgh1:abcdefgh1"],
    ["dấu phẩy thừa", "abcdefgh1:abcdefgh2,"],
    ["cũ lặp", "abcdefgh1:abcdefgh2,abcdefgh1:abcdefgh3"],
    ["mới lặp", "abcdefgh1:abcdefgh2,abcdefgh3:abcdefgh2"],
  ])("[CKH-41] từ chối: %s", (_t, raw) => {
    expect("loi" in phanTichCapHoanTac(raw)).toBe(true);
  });

  it("[CKH-42] null/undefined ⇒ lỗi (không có phạm vi mặc định)", () => {
    expect("loi" in phanTichCapHoanTac(null)).toBe(true);
    expect("loi" in phanTichCapHoanTac(undefined)).toBe(true);
  });
});
