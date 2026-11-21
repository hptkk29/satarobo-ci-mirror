/**
 * [GWD-*] Luật GHI website + trang đích Affiliate, phần THUẦN (`ghi-website-dau-vao.ts`) — chạy được không cần Postgres.
 *
 *   [GWD-01] chuanHoaNoiDungWebsite: chuẩn hoá + từ chối, câu lỗi nêu ĐÚNG ô và chính mục hỏng
 *   [GWD-02] taoWebsiteSchema / suaWebsiteSchema: mã qua chuanHoaMa; strict (không lọt trường lạ); không có `code`/`status` ở schema sửa
 *   [GWD-03] kiemSuaWebsite: chỉ trường THẬT SỰ đổi; gốc URL + tên miền chỉ kiểm khi một trong hai đổi; gỡ tên miền của gốc URL bị chặn
 *   [GWD-04] kiemDoiTrangThaiWebsite / kiemXoaWebsite: lý do ≥ 10 ký tự (biên 9/10), xoá chỉ khi trống
 *   [GWD-05] trang đích: schema + kiemMauTrangDich + kiemBatTatTrangDich
 */
import { describe, expect, it } from "vitest";
import {
  LY_DO_TOI_THIEU_WEBSITE,
  SO_TEN_MIEN_TOI_DA,
  chuanHoaNoiDungWebsite,
  kiemBatTatTrangDich,
  kiemDoiTrangThaiWebsite,
  kiemMauTrangDich,
  kiemMaWebsite,
  kiemSuaWebsite,
  kiemXoaWebsite,
  suaTrangDichSchema,
  suaWebsiteSchema,
  taoTrangDichSchema,
  taoWebsiteSchema,
  type GiaTriWebsite,
} from "./ghi-website-dau-vao";

const TAO = { code: "quatang edu", name: "Quà tặng", baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn"], trackingEnabled: true, defaultCampaignId: null };
const HIEN_TAI: GiaTriWebsite = { name: "Quà tặng", baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"], trackingEnabled: true, defaultCampaignId: null };

describe("[GWD-01] chuanHoaNoiDungWebsite", () => {
  it("chuẩn hoá: bỏ / cuối, hạ chữ thường, bỏ trùng, giữ thứ tự", () => {
    const kq = chuanHoaNoiDungWebsite({ baseUrl: " https://QuaTang.edu.vn/ ", allowedDomains: ["QUATANG.edu.vn", "www.quatang.edu.vn", "quatang.edu.vn"] });
    expect(kq).toEqual({ ok: true, baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"] });
  });

  it("tên miền rỗng ⇒ lỗi ô allowedDomains; quá nhiều ⇒ lỗi ô allowedDomains", () => {
    expect(chuanHoaNoiDungWebsite({ baseUrl: "https://a.vn", allowedDomains: [] })).toMatchObject({ ok: false, truong: "allowedDomains" });
    const nhieu = Array.from({ length: SO_TEN_MIEN_TOI_DA + 1 }, (_, i) => `d${i}.vn`);
    expect(chuanHoaNoiDungWebsite({ baseUrl: "https://d0.vn", allowedDomains: nhieu })).toMatchObject({ ok: false, truong: "allowedDomains" });
  });

  it("mục hỏng đầu tiên được nêu NGUYÊN VĂN trong câu lỗi (người khai biết dòng nào sai)", () => {
    const kq = chuanHoaNoiDungWebsite({ baseUrl: "https://a.vn", allowedDomains: ["a.vn", "https://b.vn"] });
    expect(kq.ok).toBe(false);
    if (!kq.ok) {
      expect(kq.truong).toBe("allowedDomains");
      expect(kq.loi).toContain("https://b.vn");
    }
  });

  it("gốc URL trống ⇒ lỗi ô baseUrl; host ngoài danh sách ⇒ câu nói thẳng «thêm vào danh sách»; http / đường dẫn ⇒ nhãn lý do của hàm kiểm", () => {
    expect(chuanHoaNoiDungWebsite({ baseUrl: "  ", allowedDomains: ["a.vn"] })).toMatchObject({ ok: false, truong: "baseUrl" });
    const ngoai = chuanHoaNoiDungWebsite({ baseUrl: "https://b.vn", allowedDomains: ["a.vn"] });
    expect(ngoai).toMatchObject({ ok: false, truong: "baseUrl" });
    if (!ngoai.ok) expect(ngoai.loi).toMatch(/danh sách tên miền được phép/);
    const http = chuanHoaNoiDungWebsite({ baseUrl: "http://a.vn", allowedDomains: ["a.vn"] });
    expect(http).toMatchObject({ ok: false, truong: "baseUrl" });
    if (!http.ok) expect(http.loi).toMatch(/https/);
    expect(chuanHoaNoiDungWebsite({ baseUrl: "https://a.vn/lp", allowedDomains: ["a.vn"] })).toMatchObject({ ok: false, truong: "baseUrl" });
  });

  it("tên miền con KHÔNG tự được phép: gốc URL www.a.vn khi chỉ khai a.vn ⇒ từ chối", () => {
    expect(chuanHoaNoiDungWebsite({ baseUrl: "https://www.a.vn", allowedDomains: ["a.vn"] })).toMatchObject({ ok: false, truong: "baseUrl" });
  });
});

describe("[GWD-02] schema", () => {
  it("tạo: mã qua chuanHoaMa (bỏ dấu, HOA, gạch dưới); id campaign rỗng ⇒ null", () => {
    const kq = taoWebsiteSchema.safeParse({ ...TAO, code: "quà tặng edu", defaultCampaignId: "  " });
    expect(kq.success).toBe(true);
    if (kq.success) {
      expect(kq.data.code).toBe("QUA_TANG_EDU");
      expect(kq.data.defaultCampaignId).toBeNull();
    }
  });

  it("tạo: mã sai luật ⇒ lỗi gắn ô code", () => {
    const kq = taoWebsiteSchema.safeParse({ ...TAO, code: "a" });
    expect(kq.success).toBe(false);
    if (!kq.success) expect(kq.error.issues[0]?.path[0]).toBe("code");
  });

  it("tạo: strict — trường lạ (status, id, createdById) bị từ chối; thiếu trackingEnabled bị từ chối", () => {
    for (const lạ of [{ status: "INACTIVE" }, { id: "x" }, { createdById: "u" }]) {
      expect(taoWebsiteSchema.safeParse({ ...TAO, ...lạ }).success, JSON.stringify(lạ)).toBe(false);
    }
    const { trackingEnabled: _bo, ...thieu } = TAO;
    expect(taoWebsiteSchema.safeParse(thieu).success).toBe(false);
  });

  it("tạo: tên 1 ký tự / quá dài ⇒ lỗi ô name", () => {
    for (const name of ["a", "a".repeat(121)]) {
      const kq = taoWebsiteSchema.safeParse({ ...TAO, name });
      expect(kq.success).toBe(false);
      if (!kq.success) expect(kq.error.issues[0]?.path[0]).toBe("name");
    }
  });

  it("sửa: mọi ô tuỳ chọn; KHÔNG nhận `code` hay `status` (strict)", () => {
    expect(suaWebsiteSchema.safeParse({}).success).toBe(true);
    expect(suaWebsiteSchema.safeParse({ name: "Tên mới" }).success).toBe(true);
    expect(suaWebsiteSchema.safeParse({ code: "ABC" }).success).toBe(false);
    expect(suaWebsiteSchema.safeParse({ status: "INACTIVE" }).success).toBe(false);
    const kq = suaWebsiteSchema.safeParse({ defaultCampaignId: "" });
    expect(kq.success && kq.data.defaultCampaignId).toBeNull();
  });
});

describe("[GWD-03] kiemSuaWebsite", () => {
  it("không gửi gì ⇒ không đổi gì; gửi lại nguyên xi ⇒ không đổi gì", () => {
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: {} })).toMatchObject({ ok: true, truongDoi: [] });
    const lai = kiemSuaWebsite({
      hienTai: HIEN_TAI,
      patch: { name: "Quà tặng", baseUrl: "https://quatang.edu.vn/", allowedDomains: ["quatang.edu.vn", "www.quatang.edu.vn"], trackingEnabled: true, defaultCampaignId: null },
    });
    expect(lai).toMatchObject({ ok: true, truongDoi: [] });
  });

  it("chỉ liệt kê trường thật sự đổi; đổi tên miền theo thứ tự khác = đổi", () => {
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { name: "Tên khác", trackingEnabled: false } })).toMatchObject({ ok: true, truongDoi: ["name", "trackingEnabled"] });
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { allowedDomains: ["www.quatang.edu.vn", "quatang.edu.vn"] } })).toMatchObject({ ok: true, truongDoi: ["allowedDomains"] });
  });

  it("đổi campaign mặc định: báo `doiCampaignMacDinh` chỉ khi đổi SANG một campaign (gỡ về null thì không)", () => {
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { defaultCampaignId: "c1" } })).toMatchObject({ ok: true, truongDoi: ["defaultCampaignId"], doiCampaignMacDinh: true });
    const co = { ...HIEN_TAI, defaultCampaignId: "c1" };
    expect(kiemSuaWebsite({ hienTai: co, patch: { defaultCampaignId: null } })).toMatchObject({ ok: true, truongDoi: ["defaultCampaignId"], doiCampaignMacDinh: false });
    expect(kiemSuaWebsite({ hienTai: co, patch: { defaultCampaignId: "c1" } })).toMatchObject({ ok: true, truongDoi: [], doiCampaignMacDinh: false });
  });

  it("gỡ tên miền đang là host của gốc URL ⇒ lỗi gắn ô allowedDomains và NÓI RÕ nguyên nhân; đổi gốc URL sang host chưa khai ⇒ lỗi ô baseUrl", () => {
    const go = kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { allowedDomains: ["www.quatang.edu.vn"] } });
    expect(go).toMatchObject({ ok: false, truong: "allowedDomains" });
    if (!go.ok) expect(go.loi).toContain("https://quatang.edu.vn");
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { baseUrl: "https://khac.vn" } })).toMatchObject({ ok: false, truong: "baseUrl" });
    // đối chứng dương: đổi gốc URL sang tên miền đã khai
    expect(kiemSuaWebsite({ hienTai: HIEN_TAI, patch: { baseUrl: "https://www.quatang.edu.vn" } })).toMatchObject({ ok: true, truongDoi: ["baseUrl"] });
  });

  it("website cũ mang gốc URL KHÔNG đúng luật mới vẫn sửa được TÊN (không kiểm khi gốc URL và tên miền không đổi); sửa tên miền thì bị kiểm", () => {
    const cu: GiaTriWebsite = { ...HIEN_TAI, baseUrl: "https://quatang.edu.vn/lp" };
    expect(kiemSuaWebsite({ hienTai: cu, patch: { name: "Chỉ đổi tên" } })).toMatchObject({ ok: true, truongDoi: ["name"] });
    expect(kiemSuaWebsite({ hienTai: cu, patch: { allowedDomains: ["quatang.edu.vn"] } })).toMatchObject({ ok: false });
  });
});

describe("[GWD-04] kiemDoiTrangThaiWebsite · kiemXoaWebsite", () => {
  const ly = (n: number) => "x".repeat(n);

  it("ngừng: lý do 9 ký tự ⇒ từ chối; 10 ⇒ được; toàn khoảng trắng ⇒ từ chối; null ⇒ từ chối", () => {
    expect(LY_DO_TOI_THIEU_WEBSITE).toBe(10);
    expect(kiemDoiTrangThaiWebsite({ tu: "ACTIVE", den: "INACTIVE", lyDo: ly(9) })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemDoiTrangThaiWebsite({ tu: "ACTIVE", den: "INACTIVE", lyDo: ly(10) })).toEqual({ ok: true });
    expect(kiemDoiTrangThaiWebsite({ tu: "ACTIVE", den: "INACTIVE", lyDo: `   ${ly(5)}    ` })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemDoiTrangThaiWebsite({ tu: "ACTIVE", den: "INACTIVE", lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
  });

  it("bật lại: lý do tuỳ chọn; cùng trạng thái ⇒ từ chối", () => {
    expect(kiemDoiTrangThaiWebsite({ tu: "INACTIVE", den: "ACTIVE", lyDo: null })).toEqual({ ok: true });
    expect(kiemDoiTrangThaiWebsite({ tu: "ACTIVE", den: "ACTIVE", lyDo: null })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemDoiTrangThaiWebsite({ tu: "INACTIVE", den: "INACTIVE", lyDo: ly(20) })).toMatchObject({ ok: false, truong: "trangThai" });
  });

  it("xoá: chỉ khi 0 trang đích ∧ 0 campaign ∧ lý do đủ; mỗi vế vi phạm cho câu riêng nêu SỐ", () => {
    expect(kiemXoaWebsite({ soTrangDich: 0, soCampaign: 0, lyDo: ly(10) })).toEqual({ ok: true });
    const camp = kiemXoaWebsite({ soTrangDich: 0, soCampaign: 2, lyDo: ly(10) });
    expect(camp).toMatchObject({ ok: false, truong: "xoa" });
    if (!camp.ok) expect(camp.loi).toContain("2 campaign");
    const trang = kiemXoaWebsite({ soTrangDich: 3, soCampaign: 0, lyDo: ly(10) });
    expect(trang).toMatchObject({ ok: false, truong: "xoa" });
    if (!trang.ok) expect(trang.loi).toContain("3 trang đích");
    expect(kiemXoaWebsite({ soTrangDich: 0, soCampaign: 0, lyDo: ly(9) })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemXoaWebsite({ soTrangDich: 0, soCampaign: 0, lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
  });
});

describe("[GWD-05] trang đích", () => {
  it("schema tạo: strict; nhãn rỗng ⇒ null; nhãn quá dài ⇒ lỗi", () => {
    const ok = taoTrangDichSchema.safeParse({ siteId: "s1", pathPattern: "/a", label: "  " });
    expect(ok.success && ok.data.label).toBeNull();
    expect(taoTrangDichSchema.safeParse({ siteId: "s1", pathPattern: "/a", label: null, isActive: false }).success).toBe(false);
    expect(taoTrangDichSchema.safeParse({ siteId: "", pathPattern: "/a", label: null }).success).toBe(false);
    expect(taoTrangDichSchema.safeParse({ siteId: "s1", pathPattern: "/a", label: "x".repeat(121) }).success).toBe(false);
  });

  it("schema sửa: mọi ô tuỳ chọn; không nhận siteId", () => {
    expect(suaTrangDichSchema.safeParse({}).success).toBe(true);
    expect(suaTrangDichSchema.safeParse({ pathPattern: "/b" }).success).toBe(true);
    expect(suaTrangDichSchema.safeParse({ siteId: "s2" }).success).toBe(false);
  });

  it("kiemMauTrangDich: trả mẫu đã chuẩn hoá hoặc lỗi gắn ô pathPattern", () => {
    expect(kiemMauTrangDich(" /khoa-robotics/ ")).toEqual({ ok: true, mau: "/khoa-robotics" });
    expect(kiemMauTrangDich("/khoa-hoc/*")).toEqual({ ok: true, mau: "/khoa-hoc/*" });
    expect(kiemMauTrangDich("/a/../b")).toMatchObject({ ok: false, truong: "pathPattern" });
    expect(kiemMauTrangDich("//evil.com")).toMatchObject({ ok: false, truong: "pathPattern" });
  });

  it("kiemBatTatTrangDich: cùng trạng thái ⇒ từ chối, khác ⇒ được", () => {
    expect(kiemBatTatTrangDich({ tu: true, den: false })).toEqual({ ok: true });
    expect(kiemBatTatTrangDich({ tu: false, den: true })).toEqual({ ok: true });
    expect(kiemBatTatTrangDich({ tu: true, den: true })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemBatTatTrangDich({ tu: false, den: false })).toMatchObject({ ok: false, truong: "trangThai" });
  });

  it("kiemMaWebsite khớp MA_DANH_MUC_RE", () => {
    expect(kiemMaWebsite("QUATANG_EDU")).toBeNull();
    for (const x of ["AB", "quatang", "QUA TANG", "QUÀ_TẶNG", "A".repeat(41)]) expect(kiemMaWebsite(x), x).not.toBeNull();
  });
});
