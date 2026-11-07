// [SNC-HOLD-*] — «NGƯỜI CHỐT CHƯA XÁC ĐỊNH» (`convertedById = NULL` trên lead ĐÃ chuyển đổi `convertedAt ≠ NULL`) PHẢI là trạng thái HOLD TOÀN DIỆN:
// không đường hoa hồng nào được suy ra một người nhận từ `assignedToId` rồi trả tiền.
//
// Kiểm kê MỌI đường chọn người hưởng (đo 22/10/2026 trên mã):
//   SALE ← Lead.convertedById (engine cũ `commission-run.ts` · engine mới `LEAD_CONVERTED_BY`)       — KHÔNG có lùi            [HOLD-01/02]
//   SALE_ADMIN ← Lead.adminId · QC/QL_TT ← sổ phân công cơ sở · TRIAL_TEACHER ← GV buổi trial        — không đọc người chốt    [HOLD-04]
//   REFERRER_PARENT/EMPLOYEE/AFFILIATE ← attribution · SOURCE_OWNER ← chủ nguồn                      — không đọc người chốt    [HOLD-04]
//   REFERRER_PARENT_SALE ← ẢNH CHỤP `attribution.referrerSaleUserId`, ảnh chụp dựng bằng `chonSaleCuaPhuHuynh` (có lùi `assignedToId`) [HOLD-03]
//   «chủ lead» ở cảnh báo/khiếu nại/đổi nguồn: quyền & chống gian lận, KHÔNG trả tiền                                          [HOLD-05]
// Chỗ DUY NHẤT có lùi sang `assignedToId` là `chonSaleCuaPhuHuynh`; nó đã được chặn cho lead đã chuyển đổi. Lưới `[HOLD-05]` canh để đường thứ hai không mọc ra.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapButToanHoaHong, thongKe, SELECT_HOA_HONG, type HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { DEFAULT_RATES } from "@/lib/crm/commission";
import { tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import { phanGiaiNguoiHuong, type NguCanhNguoiHuong, type VaiResolver } from "@/lib/hoa-hong/nguoi-huong";
import { chonSaleCuaPhuHuynh, type HocVienCuaPhuHuynh, type LeadCuaHocVien } from "@/lib/nguon/sale-cua-phu-huynh";

const NGAY = new Date("2026-06-15T03:00:00.000Z");
const BAY_GIO = new Date("2026-10-22T00:00:00.000Z");
const ASSIGNEE = "u-assignee"; // người đang được gán của lead đã bị CLEAR — KHÔNG được nhận tiền từ trạng thái hold

describe("[SNC-HOLD] engine CŨ", () => {
  it("[SNC-HOLD-01] lead hold (convertedById NULL): tầng SALE không sinh dòng, số tiền hiện ở `chuaCoNguoiHuong`; `assignedToId` KHÔNG nằm trong dữ liệu engine nhìn thấy", () => {
    const row: HangThanhToanHoaHong = {
      id: "p1",
      amount: 10_000_000,
      accountantStatus: TRANG_THAI_THUC_THU[0],
      adjustmentOfId: null,
      paidDate: NGAY,
      confirmedAt: NGAY,
      centerId: "cs-2",
      adjustmentOf: null,
      enrollment: { renewedFromEnrollmentId: null },
      order: { leadId: "L1", centerId: "cs-2", lead: { convertedById: null, adminId: null, centerId: "cs-1" } },
    };
    const bt = mapButToanHoaHong([row], []);
    const dong = tinhHoaHongTheoKy({ period: "2026-06", butToan: bt, ratesAt: () => DEFAULT_RATES });
    expect(dong.filter((d) => d.tier === "SALE")).toEqual([]);
    expect(dong.some((d) => d.recipientId === ASSIGNEE)).toBe(false);
    expect(thongKe("2026-06", bt, dong, () => DEFAULT_RATES).chuaCoNguoiHuong.SALE).toBe(Math.round(10_000_000 * DEFAULT_RATES.SALE));
    // cấu trúc: engine cũ chỉ đọc đúng ba cột của lead — thêm `assignedToId` vào đây là đỏ
    const lead = (SELECT_HOA_HONG.order.select.lead.select) as Record<string, boolean>;
    expect(Object.keys(lead).sort()).toEqual(["adminId", "centerId", "convertedById"]);
  });
});

describe("[SNC-HOLD] engine MỚI — mọi resolver, lead hold", () => {
  const ctx = (p: Partial<NguCanhNguoiHuong> = {}): NguCanhNguoiHuong => ({
    centerId: "cs-2",
    assigneeDate: NGAY,
    lead: { convertedById: null, adminId: null },
    phanCongCoSo: [],
    gvTrialUserId: null,
    attribution: null,
    trangThaiNhanSu: new Map(),
    affiliateConHoatDong: new Map(),
    ...p,
  });
  const vai = (resolverType: VaiResolver["resolverType"], resolverKey: string | null): VaiResolver => ({ code: "X", resolverType, resolverKey });

  it("[SNC-HOLD-02] SALE (LEAD_CONVERTED_BY) ⇒ TREO LEAD_THIEU_NGUOI; ngữ cảnh engine KHÔNG có `assignedToId` (không thể lùi về người chăm)", () => {
    expect(phanGiaiNguoiHuong(vai("TRANSACTION_ROLE", "LEAD_CONVERTED_BY"), ctx())).toMatchObject({ loai: "TREO", lyDo: "LEAD_THIEU_NGUOI" });
    expect(Object.keys(ctx().lead!).sort()).toEqual(["adminId", "convertedById"]);
    // đối chứng dương: có người chốt ⇒ trả đúng người đó
    expect(phanGiaiNguoiHuong(vai("TRANSACTION_ROLE", "LEAD_CONVERTED_BY"), ctx({ lead: { convertedById: "u-sale", adminId: null } }))).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-sale" }] });
  });

  it("[SNC-HOLD-03a] NULL + REFERRER_PARENT_SALE: attribution PHỤ HUYNH giới thiệu mà CHƯA có ảnh chụp Sale ⇒ TREO THIEU_SALE_PHU_HUYNH (không lùi về Sale đang chốt đơn / người chăm); có ảnh chụp ⇒ dùng ảnh chụp", () => {
    const attr = (referrerSaleUserId: string | null) => ({
      referrerKind: "PARENT" as const,
      referrerParentUserId: "u-ph",
      referrerSaleUserId,
      referrerEmployeeUserId: null,
      referrerAffiliateId: null,
      nguonChuEmployeeId: null,
      nguonChuUserId: null,
    });
    expect(phanGiaiNguoiHuong(vai("DIRECT_PERSON", "REFERRER_PARENT_SALE"), ctx({ attribution: attr(null) }))).toMatchObject({ loai: "TREO", lyDo: "THIEU_SALE_PHU_HUYNH" });
    expect(phanGiaiNguoiHuong(vai("DIRECT_PERSON", "REFERRER_PARENT_SALE"), ctx({ attribution: attr("u-sale-chup") }))).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-sale-chup" }] });
    // KHÔNG phải giới thiệu của phụ huynh ⇒ treo, không suy
    expect(phanGiaiNguoiHuong(vai("DIRECT_PERSON", "REFERRER_PARENT_SALE"), ctx({ attribution: { ...attr("u-x"), referrerKind: "EMPLOYEE" } }))).toMatchObject({ loai: "TREO", lyDo: "THIEU_NGUOI_GIOI_THIEU" });
  });

  it("[SNC-HOLD-04] NULL + nguồn trả tiền quảng cáo / chủ nguồn / giới thiệu NV / affiliate / GV trial / QC / QL_TT: kết quả KHÔNG phụ thuộc người chốt — không có người ⇒ treo; có người của CHÍNH vai đó ⇒ người của vai đó, không bao giờ `assignedToId`", () => {
    const tatCa: VaiResolver[] = [
      vai("TRANSACTION_ROLE", "LEAD_ADMIN"),
      vai("TRANSACTION_ROLE", "TRIAL_TEACHER"),
      vai("ORG_UNIT_ROLE", "ASSIGNEE_QC"),
      vai("ORG_UNIT_ROLE", "ASSIGNEE_QL_TT"),
      vai("DIRECT_PERSON", "REFERRER_PARENT"),
      vai("DIRECT_PERSON", "REFERRER_EMPLOYEE"),
      vai("DIRECT_PERSON", "AFFILIATE"),
      vai("DIRECT_PERSON", "REFERRER_PARENT_SALE"),
      vai("SOURCE_OWNER", "SOURCE_OWNER"),
      vai("SOURCE_MEMBER", null),
    ];
    for (const v of tatCa) {
      const r = phanGiaiNguoiHuong(v, ctx());
      expect(r.loai, `${v.resolverType}/${v.resolverKey}`).toBe("TREO"); // không dữ liệu của vai ấy ⇒ treo
    }
    // nguồn trả tiền quảng cáo: chủ nguồn có tài khoản ⇒ trả CHỦ NGUỒN (đúng chính sách), độc lập với người chốt NULL
    const nguon = ctx({ attribution: { referrerKind: null, referrerParentUserId: null, referrerSaleUserId: null, referrerEmployeeUserId: null, referrerAffiliateId: null, nguonChuEmployeeId: "e-chu", nguonChuUserId: "u-chu-nguon" } });
    expect(phanGiaiNguoiHuong(vai("SOURCE_OWNER", "SOURCE_OWNER"), nguon)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-chu-nguon" }] });
    const moi: string[] = [];
    for (const v of tatCa) {
      const r = phanGiaiNguoiHuong(v, nguon);
      if (r.loai === "CO_NGUOI") moi.push(...r.nguoi.map((n) => n.id));
    }
    expect(moi).toEqual(["u-chu-nguon"]);
    expect(moi).not.toContain(ASSIGNEE);
  });
});

describe("[SNC-HOLD-03b] đường ảnh chụp «Sale phụ trách phụ huynh» — chỗ DUY NHẤT từng lùi về assignedToId", () => {
  const lead = (p: Partial<LeadCuaHocVien>): LeadCuaHocVien => ({
    id: "l1",
    convertedById: null,
    assignedToId: ASSIGNEE,
    convertedAt: null,
    createdAt: new Date("2026-08-06T00:00:00Z"),
    deletedAt: null,
    ...p,
  });
  const hv = (l: LeadCuaHocVien, id = "s1"): HocVienCuaPhuHuynh => ({ id, parentUserId: "ph", lead: l });
  const chon = (hs: HocVienCuaPhuHuynh[]) => chonSaleCuaPhuHuynh({ studentId: "s1", parentUserId: "ph", hocVien: hs, bayGio: BAY_GIO });

  it("lead ĐÃ chuyển đổi (convertedAt ≠ NULL) mà người chốt NULL ⇒ KHÔNG lùi về assignedToId ⇒ null (cờ xem tay THIEU_SALE_PH); đối chứng: có người chốt ⇒ người chốt thắng", () => {
    const hold = lead({ convertedAt: new Date("2026-08-07T01:13:57Z") });
    expect(chon([hv(hold)])).toBeNull();
    expect(chon([hv({ ...hold, convertedById: "u-sale" })])).toBe("u-sale");
  });

  it("lead CHƯA TỪNG chuyển đổi (convertedAt NULL — dữ liệu trước cột convertedById) vẫn lùi về người chăm: hành vi cũ giữ nguyên cho dữ liệu cũ", () => {
    expect(chon([hv(lead({}))])).toBe(ASSIGNEE);
  });

  it("lead hold bị bỏ qua, xét lead CŨ HƠN của cùng phụ huynh có Sale thật; không phải trả người chăm của lead hold", () => {
    const hold = lead({ id: "moi", convertedAt: new Date("2026-08-07T00:00:00Z") });
    const cu = lead({ id: "cu", convertedById: "u-sale-cu", convertedAt: new Date("2026-03-01T00:00:00Z"), createdAt: new Date("2026-02-01T00:00:00Z") });
    expect(chon([hv(hold, "s1"), hv(cu, "s2")])).toBe("u-sale-cu");
  });

  it("[SNC-HOLD-03c] 7 lead «My» (Sale Excel đã xoá, lead gán lại cho người kế nhiệm) sau CLEAR: Sale-phụ-trách-PH = null, KHÔNG phải người kế nhiệm", () => {
    const my = lead({ assignedToId: "u-lien", convertedAt: new Date("2026-08-07T01:13:57Z") });
    expect(chon([hv(my)])).toBeNull();
  });
});

describe("[SNC-HOLD-05] LƯỚI: không đường hoa hồng nào đọc `assignedToId` để chọn người nhận", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
  const duyet = (thuMuc: string): string[] =>
    readdirSync(resolve(process.cwd(), thuMuc), { withFileTypes: true }).flatMap((e) => {
      const p = join(thuMuc, e.name).replace(/\\/g, "/");
      return e.isDirectory() ? duyet(p) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
    });

  it("engine cũ (`lib/crm/commission*.ts`) không đọc assignedToId; engine mới (`lib/hoa-hong/**`) chỉ đọc ở BA tệp GOVERNANCE (cảnh báo / khiếu nại — quyền, không trả tiền)", () => {
    const cu = readdirSync(resolve(process.cwd(), "lib/crm")).filter((t) => /^commission.*\.ts$/.test(t) && !/\.test\.ts$/.test(t));
    expect(cu.length).toBeGreaterThan(3); // lưới không quét rỗng
    for (const t of cu) expect(doc(`lib/crm/${t}`), t).not.toContain("assignedToId");
    const moi = duyet("lib/hoa-hong");
    expect(moi.length).toBeGreaterThan(20);
    const co = moi.filter((p) => doc(p).includes("assignedToId")).sort();
    expect(co).toEqual(["lib/hoa-hong/canh-bao-de-xuat.ts", "lib/hoa-hong/khieu-nai-dich.ts", "lib/hoa-hong/khieu-nai-quan-he.ts"]);
    // ba tệp đó chỉ dùng để dựng tập «chủ lead» (quyền/khiếu nại), không trả tiền
    const DUNG_CHO: Record<string, RegExp> = {
      "lib/hoa-hong/canh-bao-de-xuat.ts": /chuUser/,
      "lib/hoa-hong/khieu-nai-quan-he.ts": /CHU_LEAD/,
      "lib/hoa-hong/khieu-nai-dich.ts": /quanHeVoiKhoan\(/,
    };
    for (const p of co) expect(doc(p), p).toMatch(DUNG_CHO[p]!);
  });

  it("đường duy nhất trong `lib/nguon` lùi về assignedToId để chọn Sale là `sale-cua-phu-huynh.ts`, và nó có guard `convertedAt === null`", () => {
    const s = doc("lib/nguon/sale-cua-phu-huynh.ts");
    expect(s.match(/assignedToId/g)?.length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/l\.convertedAt === null && coGiaTri\(l\.assignedToId\)/);
    const khac = duyet("lib/nguon").filter((p) => p !== "lib/nguon/sale-cua-phu-huynh.ts" && /(?:\?\?|\|\|)\s*[\w.?]*assignedToId|assignedToId\s*(?:\?\?|\|\|)/.test(doc(p)));
    expect(khac).toEqual([]); // không có `x ?? assignedToId` / `assignedToId || y` nào khác trong lib/nguon
  });
});
