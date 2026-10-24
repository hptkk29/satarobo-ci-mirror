/**
 * [AFF-SRC-*] — giải NGUỒN KHÁCH của một đối tác trong một campaign (đặc tả §44–§46). THUẦN, không DB.
 * [AFF-MA-*]  — chuẩn hoá mã danh mục (`chung.ts`).
 *
 * Luật cần canh: thứ tự ưu tiên 6 bậc; THIẾU cấu hình ⇒ XEM TAY (không UNKNOWN âm thầm); mâu thuẫn CÙNG bậc ⇒ XEM TAY, không chọn bừa theo thứ tự lưu.
 */
import { describe, expect, it } from "vitest";
import { MA_DANH_MUC_RE, chuanHoaMa, chuoiHoacNull, laLoiTrungKhoa } from "./chung";
import { NHAN_TU_DAU, giaiNguonCuaDoiTac, type DauVaoGiaiNguon, type QuyTacNguon } from "./giai-nguon";

const T_NV = "type-nhan-vien";
const T_TRUONG = "type-truong";
const G_SALE = "tag-sale";
const G_GV = "tag-giao-vien";
const S_NV = "src-nhan-vien";
const S_TRUONG = "src-truong";
const S_GV = "src-giao-vien";
const S_CAMP = "src-mac-dinh-campaign";
const S_LOAI = "src-mac-dinh-loai";

const dau = (p: Partial<DauVaoGiaiNguon> = {}): DauVaoGiaiNguon => ({
  quyTac: [],
  campaignMacDinh: null,
  doiTacLoaiId: T_NV,
  doiTacNhanIds: [],
  loaiMacDinh: null,
  ...p,
});
const r = (typeId: string | null, tagId: string | null, sourceGroupId: string): QuyTacNguon => ({ typeId, tagId, sourceGroupId });

describe("[AFF-SRC-01] thứ tự ưu tiên 6 bậc", () => {
  it("bậc 1: rule khớp CẢ loại lẫn nhãn thắng rule loại, rule nhãn, mặc định campaign, mặc định loại", () => {
    const kq = giaiNguonCuaDoiTac(
      dau({
        quyTac: [r(T_NV, null, S_NV), r(null, G_SALE, S_GV), r(T_NV, G_SALE, S_TRUONG)],
        doiTacNhanIds: [G_SALE],
        campaignMacDinh: S_CAMP,
        loaiMacDinh: S_LOAI,
      }),
    );
    expect(kq).toEqual({ sourceGroupId: S_TRUONG, tu: "RULE_LOAI_VA_NHAN" });
  });

  it("bậc 2: không có rule loại+nhãn ⇒ rule theo loại thắng rule theo nhãn", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_SALE, S_GV), r(T_NV, null, S_NV)], doiTacNhanIds: [G_SALE], campaignMacDinh: S_CAMP }));
    expect(kq).toEqual({ sourceGroupId: S_NV, tu: "RULE_LOAI" });
  });

  it("bậc 3: chỉ có rule theo nhãn", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_SALE, S_GV)], doiTacNhanIds: [G_SALE], campaignMacDinh: S_CAMP }));
    expect(kq).toEqual({ sourceGroupId: S_GV, tu: "RULE_NHAN" });
  });

  it("bậc 4 rồi 5: không rule nào khớp ⇒ mặc định campaign, rồi mặc định loại", () => {
    expect(giaiNguonCuaDoiTac(dau({ campaignMacDinh: S_CAMP, loaiMacDinh: S_LOAI }))).toEqual({ sourceGroupId: S_CAMP, tu: "MAC_DINH_CAMPAIGN" });
    expect(giaiNguonCuaDoiTac(dau({ loaiMacDinh: S_LOAI }))).toEqual({ sourceGroupId: S_LOAI, tu: "MAC_DINH_LOAI" });
  });

  it("rule của loại/nhãn KHÁC không khớp: đối tác loại NV không hưởng rule của loại Trường", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(T_TRUONG, null, S_TRUONG), r(null, G_GV, S_GV)], doiTacNhanIds: [G_SALE], loaiMacDinh: S_LOAI }));
    expect(kq).toEqual({ sourceGroupId: S_LOAI, tu: "MAC_DINH_LOAI" });
  });

  it("rule loại+nhãn cần ĐÚNG loại ∧ ĐÚNG nhãn: đúng loại mà thiếu nhãn ⇒ không khớp bậc 1", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(T_NV, G_SALE, S_TRUONG)], doiTacNhanIds: [G_GV], campaignMacDinh: S_CAMP }));
    expect(kq).toEqual({ sourceGroupId: S_CAMP, tu: "MAC_DINH_CAMPAIGN" });
  });
});

describe("[AFF-SRC-02] thiếu cấu hình ⇒ XEM TAY, không UNKNOWN âm thầm", () => {
  it("không rule, không mặc định ⇒ sourceGroupId = null + lý do", () => {
    const kq = giaiNguonCuaDoiTac(dau());
    expect(kq.sourceGroupId).toBeNull();
    expect(kq.tu).toBe("XEM_TAY");
    if (kq.tu === "XEM_TAY") expect(kq.lyDo).toMatch(/Chưa cấu hình nguồn/);
  });

  it("đối tác chưa gán loại (doiTacLoaiId = null) KHÔNG khớp nhầm rule có typeId = null (rule nhãn thuần)", () => {
    // Cấy `r.typeId === v.doiTacLoaiId` mà bỏ vế `r.typeId !== null`: null === null khớp ⇒ rule nhãn bị đọc như rule loại.
    const kq = giaiNguonCuaDoiTac(dau({ doiTacLoaiId: null, quyTac: [r(null, G_SALE, S_GV)], doiTacNhanIds: [] }));
    expect(kq.tu).toBe("XEM_TAY");
  });
});

describe("[AFF-SRC-03] mâu thuẫn CÙNG bậc ⇒ XEM TAY; cùng nguồn thì không mâu thuẫn", () => {
  it("đối tác mang hai nhãn, mỗi nhãn một nguồn ⇒ XEM TAY (không chọn theo thứ tự lưu)", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_SALE, S_NV), r(null, G_GV, S_GV)], doiTacNhanIds: [G_SALE, G_GV], campaignMacDinh: S_CAMP }));
    expect(kq.tu).toBe("XEM_TAY");
    if (kq.tu === "XEM_TAY") expect(kq.lyDo).toMatch(/mâu thuẫn/);
  });

  it("đảo thứ tự rule vẫn ra cùng kết quả (không phụ thuộc thứ tự lưu)", () => {
    const a = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_SALE, S_NV), r(null, G_GV, S_GV)], doiTacNhanIds: [G_SALE, G_GV] }));
    const b = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_GV, S_GV), r(null, G_SALE, S_NV)], doiTacNhanIds: [G_GV, G_SALE] }));
    expect(a).toEqual(b);
  });

  it("hai nhãn cùng trỏ MỘT nguồn ⇒ không mâu thuẫn", () => {
    const kq = giaiNguonCuaDoiTac(dau({ quyTac: [r(null, G_SALE, S_NV), r(null, G_GV, S_NV)], doiTacNhanIds: [G_SALE, G_GV] }));
    expect(kq).toEqual({ sourceGroupId: S_NV, tu: "RULE_NHAN" });
  });

  it("mâu thuẫn ở bậc thấp hơn KHÔNG ảnh hưởng khi bậc cao đã chốt", () => {
    const kq = giaiNguonCuaDoiTac(
      dau({ quyTac: [r(T_NV, G_SALE, S_TRUONG), r(null, G_SALE, S_NV), r(null, G_GV, S_GV)], doiTacNhanIds: [G_SALE, G_GV] }),
    );
    expect(kq).toEqual({ sourceGroupId: S_TRUONG, tu: "RULE_LOAI_VA_NHAN" });
  });
});

describe("[AFF-SRC-04] nhãn người đọc", () => {
  it("mọi bậc có nhãn tiếng Việt (Record đầy đủ, thêm bậc mà quên nhãn là lỗi biên dịch)", () => {
    expect(Object.keys(NHAN_TU_DAU).sort()).toEqual(["MAC_DINH_CAMPAIGN", "MAC_DINH_LOAI", "RULE_LOAI", "RULE_LOAI_VA_NHAN", "RULE_NHAN"]);
  });
});

describe("[AFF-MA-01] chuẩn hoá mã danh mục", () => {
  it("bỏ dấu, đ→D, HOA, ký tự lạ → '_', gộp và cắt '_' hai đầu", () => {
    expect(chuanHoaMa("Giới thiệu — Trường học")).toBe("GIOI_THIEU_TRUONG_HOC");
    expect(chuanHoaMa("  đối tác  KOL/KOC ")).toBe("DOI_TAC_KOL_KOC");
    expect(chuanHoaMa("__a__b__")).toBe("A_B");
    expect(chuanHoaMa("***")).toBe("");
  });

  it("kết quả hợp lệ khi đủ 3 ký tự: khớp MA_DANH_MUC_RE (cùng CHECK của migration)", () => {
    expect(MA_DANH_MUC_RE.test(chuanHoaMa("Trường học"))).toBe(true);
    expect(MA_DANH_MUC_RE.test(chuanHoaMa("ab"))).toBe(false); // ngắn hơn 3 — nơi gọi PHẢI kiểm, chuẩn hoá không thay được
    expect(MA_DANH_MUC_RE.test("a_b")).toBe(false); // chữ thường không hợp lệ
    expect(MA_DANH_MUC_RE.test("A".repeat(41))).toBe(false);
  });
});

describe("[AFF-MA-02] tiện ích nhỏ", () => {
  it("chuoiHoacNull: rỗng / khoảng trắng / null / undefined ⇒ null; còn lại trim", () => {
    expect(chuoiHoacNull("  ")).toBeNull();
    expect(chuoiHoacNull(null)).toBeNull();
    expect(chuoiHoacNull(undefined)).toBeNull();
    expect(chuoiHoacNull("  abc ")).toBe("abc");
  });

  it("laLoiTrungKhoa nhận ĐÚNG lỗi P2002, không nhận lỗi khác hay giá trị lạ", () => {
    expect(laLoiTrungKhoa({ code: "P2002" })).toBe(true);
    expect(laLoiTrungKhoa({ code: "P2003" })).toBe(false);
    expect(laLoiTrungKhoa(new Error("x"))).toBe(false);
    expect(laLoiTrungKhoa(null)).toBe(false);
    expect(laLoiTrungKhoa("P2002")).toBe(false);
  });
});
