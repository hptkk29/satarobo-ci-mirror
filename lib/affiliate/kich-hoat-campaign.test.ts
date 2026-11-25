/**
 * [AFL1-*] — CỔNG KÍCH HOẠT CAMPAIGN (AFF-L1): thưởng · điều kiện đối tác · nhất quán `policyId` · liệt kê TẤT CẢ blocker kèm đường sửa. Thuần, không DB.
 *
 *   [AFL1-01] thưởng chưa chọn (null) ⇒ chặn, KHÁC với «không có mức riêng» (NONE) — ô trống không phải là một lựa chọn
 *   [AFL1-02] «có thưởng» mà không có chính sách đang áp ⇒ chặn; chỉ nháp / đã hết hạn / đã thay / chỉ chờ hiệu lực: nháp & hết hạn & thay KHÔNG tính, chờ hiệu lực (ACTIVE) tính
 *   [AFL1-03] «không có mức riêng» mà vẫn có chính sách đang áp ⇒ chặn (màn nói «không thưởng» trong khi sổ vẫn ghi tiền); đối chứng dương: chính sách đã hết hạn thì qua
 *   [AFL1-04] điều kiện đối tác: quy tắc trỏ loại/nhãn đã tắt = quy tắc chết; không nguồn mặc định + toàn quy tắc chết ⇒ chặn (câu riêng); có nguồn mặc định thì qua; một quy tắc sống là đủ
 *   [AFL1-05] `policyId` của quy tắc: trỏ chính sách không có phiên bản phạm vi CAMPAIGN của campaign này ⇒ chặn; trỏ đúng ⇒ qua; null ⇒ qua
 *   [AFL1-06] MỘT lượt liệt kê đủ MỌI blocker, mỗi cái mang `muc` trong tập đóng; `hrefMucSua` dựng đường đúng cho từng mục
 *   [AFL1-07] `kiemDoiCheDoThuong`: ENDED không đổi · ACTIVE đòi lý do ≥ 10 ký tự · NONE bị chặn khi còn chính sách đang áp (đối chứng dương: hết hạn thì cho)
 *   [AFL1-08] kiểu tính suy từ CHÍNH hằng của guardrail (không gõ cứng), bảng ánh xạ trường nói thật cái gì engine KHÔNG có
 */
import { describe, expect, it, vi } from "vitest";
import { KIEU_TINH_CHUA_HO_TRO } from "@/lib/hoa-hong/guardrail-kich-hoat";
import {
  CHE_DO_THUONG,
  MUC_SUA_CAMPAIGN,
  hrefMucSua,
  kiemDoiCheDoThuong,
  kiemKichHoatCampaign,
  phienBanDangAp,
  type DuLieuKichHoat,
  type PhienBanCuaCampaign,
} from "./ghi-campaign-dau-vao";
import { ANH_XA_TRUONG, KIEU_TINH_CAMPAIGN, hrefSoanChinhSachCampaign, hrefSuaNhapChinhSach, trangThaiCacKieuTinh } from "./hoa-hong-campaign-dau-vao";

const NOW = new Date("2026-10-20T03:00:00.000Z");
const TOT = { ten: "Giới thiệu bởi đối tác", status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null };
const QT = (p: Partial<DuLieuKichHoat["quyTac"][number]> = {}): DuLieuKichHoat["quyTac"][number] => ({
  sourceGroupId: "src-1",
  loaiConDung: null,
  nhanConDung: null,
  policyId: null,
  policyCoPhienBanCuaCampaign: false,
  ...p,
});
const PB = (p: Partial<PhienBanCuaCampaign> = {}): PhienBanCuaCampaign => ({ status: "ACTIVE", effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null, ...p });

const DU: DuLieuKichHoat = {
  attributionModel: "FIRST_VALID",
  defaultSourceGroupId: "src-1",
  effectiveFrom: null,
  effectiveTo: null,
  quyTac: [],
  website: [{ ten: "quatang.edu.vn", status: "ACTIVE" }],
  nguon: new Map([["src-1", TOT]]),
  cheDoThuong: "POLICY",
  phienBanChinhSach: [PB()],
  now: NOW,
};
const chan = (p: Partial<DuLieuKichHoat>) => kiemKichHoatCampaign({ ...DU, ...p });
const maChan = (p: Partial<DuLieuKichHoat>) => chan(p).map((c) => c.ma);

describe("[AFL1-01] thưởng chưa chọn ≠ không thưởng", () => {
  it("cấu hình đủ + «có thưởng» + chính sách đang áp ⇒ không chặn gì (đối chứng dương của cả khối)", () => {
    expect(chan({})).toEqual([]);
  });
  it("null ⇒ đúng MỘT blocker THUONG_CHUA_CHON ở mục hoa-hong; NONE ⇒ qua (không có blocker thưởng)", () => {
    const r = chan({ cheDoThuong: null, phienBanChinhSach: [] });
    expect(r.map((c) => c.ma)).toEqual(["THUONG_CHUA_CHON"]);
    expect(r[0]!.muc).toBe("hoa-hong");
    expect(r[0]!.thongBao).toContain("không phải là «không thưởng»");
    expect(maChan({ cheDoThuong: "NONE", phienBanChinhSach: [] })).toEqual([]);
  });
  it("null KHÔNG bị che bởi việc có chính sách đang áp: vẫn chặn (chưa chọn là chưa chọn)", () => {
    expect(maChan({ cheDoThuong: null })).toEqual(["THUONG_CHUA_CHON"]);
  });
});

describe("[AFL1-02] «có thưởng» cần chính sách đang áp", () => {
  it("không có phiên bản nào ⇒ THUONG_THIEU_CHINH_SACH", () => {
    expect(maChan({ phienBanChinhSach: [] })).toEqual(["THUONG_THIEU_CHINH_SACH"]);
  });
  it("chỉ nháp / đã thay / đã hết / ACTIVE nhưng quá effectiveTo ⇒ vẫn thiếu; ACTIVE chờ hiệu lực (effectiveFrom tương lai) ⇒ đủ", () => {
    for (const status of ["DRAFT", "SUPERSEDED", "EXPIRED"]) {
      expect(maChan({ phienBanChinhSach: [PB({ status })] }), status).toEqual(["THUONG_THIEU_CHINH_SACH"]);
    }
    expect(maChan({ phienBanChinhSach: [PB({ effectiveTo: new Date("2026-10-01T00:00:00.000Z") })] }), "quá hạn").toEqual(["THUONG_THIEU_CHINH_SACH"]);
    expect(maChan({ phienBanChinhSach: [PB({ effectiveTo: NOW })] }), "đúng lúc now (biên mở)").toEqual(["THUONG_THIEU_CHINH_SACH"]);
    expect(maChan({ phienBanChinhSach: [PB({ effectiveFrom: new Date("2026-12-01T00:00:00.000Z") })] }), "chờ hiệu lực").toEqual([]);
  });
});

describe("[AFL1-03] «không có mức riêng» không được trái với chính sách đang áp", () => {
  it("NONE + chính sách đang áp ⇒ THUONG_MAU_THUAN (nói rõ số chính sách)", () => {
    const r = chan({ cheDoThuong: "NONE" });
    expect(r.map((c) => c.ma)).toEqual(["THUONG_MAU_THUAN"]);
    expect(r[0]!.thongBao).toContain("1 chính sách");
  });
  it("đối chứng dương: chính sách đã hết hạn / đã thay thì NONE qua", () => {
    expect(maChan({ cheDoThuong: "NONE", phienBanChinhSach: [PB({ effectiveTo: new Date("2026-10-01T00:00:00.000Z") })] })).toEqual([]);
    expect(maChan({ cheDoThuong: "NONE", phienBanChinhSach: [PB({ status: "SUPERSEDED" })] })).toEqual([]);
  });
  it("phienBanDangAp là MỘT định nghĩa cho cả hai chiều", () => {
    expect(phienBanDangAp([PB(), PB({ status: "DRAFT" }), PB({ status: "EXPIRED" })], NOW)).toHaveLength(1);
  });
});

describe("[AFL1-04] điều kiện đối tác: có cách quy nguồn ÁP ĐƯỢC", () => {
  it("không nguồn mặc định + không quy tắc ⇒ chặn câu «chưa có»", () => {
    const r = chan({ defaultSourceGroupId: null, quyTac: [] });
    expect(r.map((c) => c.ma)).toEqual(["DOI_TAC_NGUON"]);
    expect(r[0]!.thongBao).toContain("Chưa có nguồn mặc định");
    expect(r[0]!.muc).toBe("quy-tac");
  });
  it("không nguồn mặc định + MỌI quy tắc trỏ loại/nhãn đã tắt ⇒ chặn câu RIÊNG («đã tắt nên không khớp ai»)", () => {
    const r = chan({ defaultSourceGroupId: null, quyTac: [QT({ loaiConDung: false }), QT({ nhanConDung: false })] });
    expect(r.map((c) => c.ma)).toEqual(["DOI_TAC_NGUON"]);
    expect(r[0]!.thongBao).toContain("đã tắt");
  });
  it("một quy tắc SỐNG là đủ (đối chứng dương); có nguồn mặc định thì quy tắc chết không chặn", () => {
    expect(chan({ defaultSourceGroupId: null, quyTac: [QT({ loaiConDung: false }), QT({ loaiConDung: true })] })).toEqual([]);
    expect(chan({ defaultSourceGroupId: "src-1", quyTac: [QT({ loaiConDung: false })] })).toEqual([]);
  });
  it("quy tắc xét CẢ loại lẫn nhãn: tắt MỘT trong hai là chết", () => {
    expect(maChan({ defaultSourceGroupId: null, quyTac: [QT({ loaiConDung: true, nhanConDung: false })] })).toEqual(["DOI_TAC_NGUON"]);
    expect(maChan({ defaultSourceGroupId: null, quyTac: [QT({ loaiConDung: true, nhanConDung: true })] })).toEqual([]);
  });
  it("nguồn của quy tắc vẫn bị kiểm trạng thái dù quy tắc chết (nguồn ngừng ⇒ chặn riêng)", () => {
    const r = chan({ quyTac: [QT({ sourceGroupId: "src-2", loaiConDung: false })], nguon: new Map([["src-1", TOT], ["src-2", { ...TOT, ten: "Nguồn ngừng", status: "INACTIVE" }]]) });
    expect(r.map((c) => c.ma)).toEqual(["NGUON_KHONG_DUNG"]);
    expect(r[0]!.thongBao).toContain("Nguồn ngừng");
  });
});

describe("[AFL1-05] `AffiliateCampaignRule.policyId` phải nhất quán", () => {
  it("null ⇒ qua; trỏ chính sách CÓ phiên bản campaign này ⇒ qua; trỏ chính sách KHÔNG có ⇒ POLICY_RULE_LECH ở mục quy-tac", () => {
    expect(chan({ quyTac: [QT()] })).toEqual([]);
    expect(chan({ quyTac: [QT({ policyId: "p1", policyCoPhienBanCuaCampaign: true })] })).toEqual([]);
    const r = chan({ quyTac: [QT({ policyId: "p-khac", policyCoPhienBanCuaCampaign: false })] });
    expect(r.map((c) => c.ma)).toEqual(["POLICY_RULE_LECH"]);
    expect(r[0]!.muc).toBe("quy-tac");
    expect(r[0]!.thongBao).toContain("1 quy tắc");
  });
  it("nhiều quy tắc lệch ⇒ MỘT blocker đếm đủ", () => {
    const r = chan({ quyTac: [QT({ policyId: "a" }), QT({ policyId: "b" }), QT()] });
    expect(r.filter((c) => c.ma === "POLICY_RULE_LECH")).toHaveLength(1);
    expect(r.find((c) => c.ma === "POLICY_RULE_LECH")!.thongBao).toContain("2 quy tắc");
  });
});

describe("[AFL1-06] liệt kê TẤT CẢ blocker, mỗi cái có đường sửa", () => {
  const TAT_CA: Partial<DuLieuKichHoat> = {
    attributionModel: "SPLIT",
    defaultSourceGroupId: null,
    quyTac: [],
    website: [],
    effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
    cheDoThuong: null,
  };
  it("một lượt ra đủ cả sáu nhóm, không dừng ở cái đầu", () => {
    const r = chan(TAT_CA);
    expect(r.map((c) => c.ma).sort()).toEqual(["DOI_TAC_NGUON", "HIEU_LUC", "MO_HINH", "THUONG_CHUA_CHON", "WEBSITE"]);
    for (const c of r) expect(MUC_SUA_CAMPAIGN).toContain(c.muc);
  });
  it("mỗi mục trỏ đúng chỗ: thông tin → trang sửa; còn lại → neo trên trang chi tiết", () => {
    const goc = "/nguon-hoa-hong/campaign/TET_2027";
    expect(hrefMucSua(goc, "thong-tin")).toBe(`${goc}/sua`);
    expect(hrefMucSua(goc, "hoa-hong")).toBe(`${goc}#hoa-hong`);
    expect(hrefMucSua(goc, "quy-tac")).toBe(`${goc}#quy-tac`);
    expect(hrefMucSua(goc, "website")).toBe(`${goc}#website`);
    const theoMa = Object.fromEntries(chan(TAT_CA).map((c) => [c.ma, c.muc]));
    expect(theoMa).toMatchObject({ MO_HINH: "thong-tin", HIEU_LUC: "thong-tin", WEBSITE: "website", DOI_TAC_NGUON: "quy-tac", THUONG_CHUA_CHON: "hoa-hong" });
  });
});

describe("[AFL1-07] kiemDoiCheDoThuong", () => {
  const ap = [PB()];
  const hetHan = [PB({ effectiveTo: new Date("2026-10-01T00:00:00.000Z") })];
  const ky = (p: Partial<Parameters<typeof kiemDoiCheDoThuong>[0]>) => kiemDoiCheDoThuong({ trangThai: "DRAFT", den: "POLICY", lyDo: null, phienBanChinhSach: [], now: NOW, ...p });
  it("nháp / tạm dừng đổi được không cần lý do; kết thúc thì không", () => {
    expect(ky({}).ok).toBe(true);
    expect(ky({ trangThai: "PAUSED" }).ok).toBe(true);
    const r = ky({ trangThai: "ENDED" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.truong).toBe("trangThai");
  });
  it("campaign ĐANG CHẠY đòi lý do ≥ 10 ký tự (ngắn / trống đều bị từ chối); đủ dài thì qua", () => {
    for (const lyDo of [null, "", "  ", "ngắn"]) {
      const r = ky({ trangThai: "ACTIVE", lyDo });
      expect(r.ok, String(lyDo)).toBe(false);
      if (!r.ok) expect(r.truong).toBe("lyDo");
    }
    expect(ky({ trangThai: "ACTIVE", lyDo: "Đủ mười ký tự rồi" }).ok).toBe(true);
  });
  it("NONE bị chặn khi còn chính sách đang áp; đối chứng dương: hết hạn / không có thì cho; POLICY luôn cho", () => {
    const r = ky({ den: "NONE", phienBanChinhSach: ap });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.truong).toBe("cheDoThuong");
      expect(r.loi).toContain("tab Chính sách");
    }
    expect(ky({ den: "NONE", phienBanChinhSach: hetHan }).ok).toBe(true);
    expect(ky({ den: "NONE", phienBanChinhSach: [] }).ok).toBe(true);
    expect(ky({ den: "POLICY", phienBanChinhSach: ap }).ok).toBe(true);
  });
  it("tập lựa chọn đúng hai giá trị", () => {
    expect([...CHE_DO_THUONG]).toEqual(["NONE", "POLICY"]);
  });
});

describe("[AFL1-08] kiểu tính + ánh xạ trường nói thật", () => {
  it("«dùng được» của từng kiểu suy từ CHÍNH hằng KIEU_TINH_CHUA_HO_TRO của guardrail", () => {
    const tt = trangThaiCacKieuTinh();
    expect(tt.map((k) => k.kieu)).toEqual([...KIEU_TINH_CAMPAIGN]);
    for (const k of tt) expect(k.dungDuoc, k.kieu).toBe(!(KIEU_TINH_CHUA_HO_TRO as readonly string[]).includes(k.kieu));
    // PERCENT luôn dùng được; FIXED thì TỰ THEO hằng (L2 gỡ nó khỏi `KIEU_TINH_CHUA_HO_TRO` thì dòng này tự đổi, không phải sửa test).
    expect(tt.find((k) => k.kieu === "PERCENT")!.dungDuoc).toBe(true);
    expect(tt.find((k) => k.kieu === "FIXED_PER_PURCHASE")!.ghiChu).toContain(KIEU_TINH_CHUA_HO_TRO.includes("FIXED_PER_PURCHASE") ? "Chưa kích hoạt được" : "Dùng được");
  });
  it("hold và stacking được nói THẲNG là không có trong engine; trường có trong engine ánh xạ vào khái niệm có thật", () => {
    const khong = ANH_XA_TRUONG.filter((d) => !d.coTrongEngine).map((d) => d.truong);
    expect(khong).toEqual(["Số ngày giữ (hold)", "Cách cộng dồn (stacking)"]);
    expect(ANH_XA_TRUONG.find((d) => d.truong === "Kiểu tính · giá trị")!.khaiNiem).toContain("CommissionRule");
    expect(ANH_XA_TRUONG.find((d) => d.truong === "Hiệu lực từ · đến")!.khaiNiem).toContain("effectiveFrom");
  });
  it("đường tới trình soạn dùng MÃ campaign (không phải id) và mã có ký tự đặc biệt được mã hoá", () => {
    expect(hrefSoanChinhSachCampaign("TET_2027")).toBe("/nguon-hoa-hong/chinh-sach/moi?campaign=TET_2027");
    expect(hrefSoanChinhSachCampaign("a b&c")).toBe("/nguon-hoa-hong/chinh-sach/moi?campaign=a%20b%26c");
    expect(hrefSuaNhapChinhSach("p1", "v1")).toBe("/nguon-hoa-hong/chinh-sach/p1/soan?v=v1");
  });
});

describe("[AFL1-08c] kiểu tính TỰ THEO hằng khi hằng đổi (không gõ cứng tên kiểu)", () => {
  it("giả lập L2 gỡ FIXED khỏi KIEU_TINH_CHUA_HO_TRO ⇒ FIXED thành «Dùng được», PERCENT không đổi; giả lập thêm PERCENT vào hằng ⇒ PERCENT bị khoá", async () => {
    vi.resetModules();
    vi.doMock("@/lib/hoa-hong/guardrail-kich-hoat", () => ({ KIEU_TINH_CHUA_HO_TRO: [] as const }));
    const mo = await import("./hoa-hong-campaign-dau-vao");
    expect(mo.trangThaiCacKieuTinh().map((k) => [k.kieu, k.dungDuoc])).toEqual([
      ["PERCENT", true],
      ["FIXED_PER_PURCHASE", true],
    ]);
    vi.resetModules();
    vi.doMock("@/lib/hoa-hong/guardrail-kich-hoat", () => ({ KIEU_TINH_CHUA_HO_TRO: ["PERCENT"] as const }));
    const khoa = await import("./hoa-hong-campaign-dau-vao");
    expect(khoa.trangThaiCacKieuTinh().map((k) => [k.kieu, k.dungDuoc])).toEqual([
      ["PERCENT", false],
      ["FIXED_PER_PURCHASE", true],
    ]);
    vi.doUnmock("@/lib/hoa-hong/guardrail-kich-hoat");
    vi.resetModules();
  });
});
