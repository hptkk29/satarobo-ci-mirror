// @vitest-environment node
/**
 * [NHH-POL-RES-*] — resolver NGƯỜI HƯỞNG (04 §7). THUẦN.
 *
 * Ba kiểu resolver có đường gọi thật ở PR4: DIRECT_PERSON · TRANSACTION_ROLE · ORG_UNIT_ROLE.
 * SOURCE_MEMBER chưa có bảng (PR8) ⇒ luôn "treo", không đoán. SOURCE_OWNER đọc `ownerEmployeeId` của nguồn (nguồn động, 09/10/2026).
 * QLCS resolve theo đơn vị của GIAO DỊCH. RESIGNED/TERMINATED không sinh dòng (D13) — phần của họ TREO.
 */
import { describe, it, expect } from "vitest";

import { phanGiaiNguoiHuong, type NguCanhNguoiHuong, type VaiResolver } from "./nguoi-huong";
import { MASTER_VAI_HUONG } from "./vai-huong";
import { NHAN_LY_DO_TREO } from "./hang-cho-so-nhom";
import { nhanThieuNguoi } from "./mo-phong";

const NGAY = new Date("2026-10-20T03:00:00.000Z");

function vai(code: string): VaiResolver {
  const v = MASTER_VAI_HUONG.find((x) => x.code === code);
  if (!v) throw new Error(code);
  return { code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey };
}

function ctx(p: Partial<NguCanhNguoiHuong> = {}): NguCanhNguoiHuong {
  return {
    centerId: "cs1",
    assigneeDate: NGAY,
    lead: { convertedById: "u-sale", adminId: "u-admin" },
    phanCongCoSo: [],
    gvTrialUserId: null,
    attribution: null,
    trangThaiNhanSu: new Map(),
    affiliateConHoatDong: new Map(),
    ...p,
  };
}

const pc = (centerId: string, role: "QC" | "QL_TT", userId: string, from = "2026-01-01", to: string | null = null) => ({
  centerId,
  role,
  userId,
  effectiveFrom: new Date(`${from}T00:00:00.000Z`),
  effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null,
});

describe("[NHH-POL-RES] TRANSACTION_ROLE (Sale · Sale Admin · GV Trial)", () => {
  it("[NHH-POL-RES-01] SALE = Lead.convertedById; SALE_ADMIN = Lead.adminId", () => {
    const a = phanGiaiNguoiHuong(vai("SALE"), ctx());
    expect(a).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-sale" }] });
    const b = phanGiaiNguoiHuong(vai("SALE_ADMIN"), ctx());
    expect(b).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-admin" }] });
  });

  it("[NHH-POL-RES-02] đơn KHÔNG có lead ⇒ TREO (không lùi về người tạo đơn); lead thiếu người ⇒ TREO", () => {
    expect(phanGiaiNguoiHuong(vai("SALE"), ctx({ lead: null }))).toMatchObject({ loai: "TREO", lyDo: "KHONG_CO_LEAD" });
    expect(phanGiaiNguoiHuong(vai("SALE"), ctx({ lead: { convertedById: null, adminId: "u-admin" } }))).toMatchObject({
      loai: "TREO",
      lyDo: "LEAD_THIEU_NGUOI",
    });
    // đối chứng dương: cùng lead, vai kia vẫn có người
    expect(phanGiaiNguoiHuong(vai("SALE_ADMIN"), ctx({ lead: { convertedById: null, adminId: "u-admin" } })).loai).toBe("CO_NGUOI");
  });

  it("[NHH-POL-RES-03] TRIAL_TEACHER = GV của buổi trial bé đã học; không có ⇒ TREO", () => {
    expect(phanGiaiNguoiHuong(vai("TRIAL_TEACHER"), ctx({ gvTrialUserId: "u-gv" }))).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-gv" }] });
    expect(phanGiaiNguoiHuong(vai("TRIAL_TEACHER"), ctx())).toMatchObject({ loai: "TREO", lyDo: "KHONG_CO_GV_TRIAL" });
  });
});

describe("[NHH-POL-RES] ORG_UNIT_ROLE theo đơn vị của GIAO DỊCH, biên MỞ", () => {
  it("[NHH-POL-RES-04] QLCS = người phụ trách QL_TT của cơ sở GIAO DỊCH tại ngày thu; cơ sở khác không lẫn", () => {
    const c = ctx({ phanCongCoSo: [pc("cs1", "QL_TT", "u-ql1"), pc("cs2", "QL_TT", "u-ql2")] });
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), c)).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-ql1" }] });
    expect(phanGiaiNguoiHuong(vai("CENTER_MANAGER"), { ...c, centerId: "cs2" })).toMatchObject({ nguoi: [{ id: "u-ql2" }] });
  });

  it("[NHH-POL-RES-05] hiệu lực biên MỞ: đúng thời khắc bàn giao chỉ người MỚI khớp", () => {
    const c = ctx({
      assigneeDate: new Date("2026-10-01T00:00:00.000Z"),
      phanCongCoSo: [pc("cs1", "QL_TT", "u-cu", "2026-01-01", "2026-10-01"), pc("cs1", "QL_TT", "u-moi", "2026-10-01")],
    });
    const r = phanGiaiNguoiHuong(vai("CENTER_MANAGER"), c);
    expect(r).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ id: "u-moi" }] });
  });

  it("[NHH-POL-RES-06] chưa khai người phụ trách ⇒ TREO; giao dịch không quy được cơ sở ⇒ TREO (không đoán)", () => {
    expect(phanGiaiNguoiHuong(vai("MARKETING"), ctx())).toMatchObject({ loai: "TREO", lyDo: "CHUA_KHAI_NGUOI_PHU_TRACH" });
    expect(phanGiaiNguoiHuong(vai("MARKETING"), ctx({ centerId: null, phanCongCoSo: [pc("cs1", "QC", "u-qc")] }))).toMatchObject({
      loai: "TREO",
      lyDo: "KHONG_QUY_VE_CO_SO",
    });
  });

  it("[NHH-POL-RES-07] QC nhiều người ⇒ trả đủ danh sách đã khử trùng, sắp theo id (để chia đều)", () => {
    const c = ctx({ phanCongCoSo: [pc("cs1", "QC", "u-b"), pc("cs1", "QC", "u-a"), pc("cs1", "QC", "u-a", "2026-02-01")] });
    const r = phanGiaiNguoiHuong(vai("MARKETING"), c);
    expect(r.loai === "CO_NGUOI" && r.nguoi.map((n) => n.id)).toEqual(["u-a", "u-b"]);
  });
});

describe("[NHH-POL-RES] DIRECT_PERSON (người giới thiệu) — P1 nhưng resolver đã đúng", () => {
  const attr = { referrerKind: null, referrerParentUserId: "u-ph", referrerEmployeeUserId: "u-nv", referrerAffiliateId: "aff-1", referrerSaleUserId: null, nguonChuEmployeeId: null, nguonChuUserId: null };

  it("[NHH-POL-RES-08] mỗi vai lấy đúng cột của attribution; không có attribution ⇒ TREO", () => {
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT"), ctx({ attribution: attr }))).toMatchObject({ nguoi: [{ kind: "USER", id: "u-ph" }] });
    expect(phanGiaiNguoiHuong(vai("REFERRER_EMPLOYEE"), ctx({ attribution: attr }))).toMatchObject({ nguoi: [{ kind: "USER", id: "u-nv" }] });
    expect(phanGiaiNguoiHuong(vai("AFFILIATE"), ctx({ attribution: attr }))).toMatchObject({ nguoi: [{ kind: "AFFILIATE", id: "aff-1" }] });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT"), ctx())).toMatchObject({ loai: "TREO", lyDo: "THIEU_NGUOI_GIOI_THIEU" });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT"), ctx({ attribution: { ...attr, referrerParentUserId: null } }))).toMatchObject({
      loai: "TREO",
      lyDo: "THIEU_NGUOI_GIOI_THIEU",
    });
  });

  it("[NHH-POL-RES-09] affiliate đã ngừng hoạt động ⇒ TREO NGUOI_HUONG_NGHI (đối xứng RESIGNED)", () => {
    const r = phanGiaiNguoiHuong(vai("AFFILIATE"), ctx({ attribution: attr, affiliateConHoatDong: new Map([["aff-1", false]]) }));
    expect(r).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
  });
});

describe("[NHH-POL-RES] RESIGNED không sinh dòng (D13)", () => {
  it("[NHH-POL-RES-10] RESIGNED / TERMINATED ⇒ TREO; ON_LEAVE vẫn hưởng; phụ huynh (không phải nhân sự) vẫn hưởng", () => {
    const trang = (s: string | null) => ctx({ trangThaiNhanSu: new Map([["u-sale", s]]) });
    expect(phanGiaiNguoiHuong(vai("SALE"), trang("RESIGNED"))).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
    expect(phanGiaiNguoiHuong(vai("SALE"), trang("TERMINATED"))).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
    expect(phanGiaiNguoiHuong(vai("SALE"), trang("ON_LEAVE")).loai).toBe("CO_NGUOI");
    expect(phanGiaiNguoiHuong(vai("SALE"), trang("ACTIVE")).loai).toBe("CO_NGUOI");
    expect(phanGiaiNguoiHuong(vai("SALE"), trang(null)).loai).toBe("CO_NGUOI");
  });

  it("[NHH-POL-RES-11] nhiều người, một người nghỉ: danh sách chia vẫn đủ, người nghỉ vào `biLoai` (phần của họ treo, không chia lại)", () => {
    const c = ctx({
      phanCongCoSo: [pc("cs1", "QC", "u-a"), pc("cs1", "QC", "u-b")],
      trangThaiNhanSu: new Map([["u-b", "RESIGNED"]]),
    });
    const r = phanGiaiNguoiHuong(vai("MARKETING"), c);
    expect(r.loai).toBe("CO_NGUOI");
    if (r.loai === "CO_NGUOI") {
      expect(r.nguoi.map((n) => n.id)).toEqual(["u-a", "u-b"]);
      expect(r.biLoai.map((n) => n.nguoi.id)).toEqual(["u-b"]);
    }
    // tất cả đều nghỉ ⇒ TREO
    const tatCa = ctx({
      phanCongCoSo: [pc("cs1", "QC", "u-a"), pc("cs1", "QC", "u-b")],
      trangThaiNhanSu: new Map([["u-a", "RESIGNED"], ["u-b", "TERMINATED"]]),
    });
    expect(phanGiaiNguoiHuong(vai("MARKETING"), tatCa)).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
  });
});

describe("[NHH-POL-RES] resolver chưa hỗ trợ / lạ", () => {
  it("[NHH-POL-RES-12] SOURCE_MEMBER ⇒ TREO RESOLVER_CHUA_HO_TRO; SOURCE_OWNER khoá lạ ⇒ RESOLVER_KHONG_BIET; resolverKey lạ ⇒ TREO RESOLVER_KHONG_BIET", () => {
    expect(phanGiaiNguoiHuong({ code: "X", resolverType: "SOURCE_MEMBER", resolverKey: null }, ctx())).toMatchObject({
      loai: "TREO",
      lyDo: "RESOLVER_CHUA_HO_TRO",
    });
    // SOURCE_OWNER đã có đường gọi thật — khoá lạ vẫn KHÔNG đoán
    expect(phanGiaiNguoiHuong({ code: "X", resolverType: "SOURCE_OWNER", resolverKey: null }, ctx())).toMatchObject({ lyDo: "RESOLVER_KHONG_BIET" });
    expect(phanGiaiNguoiHuong({ code: "X", resolverType: "TRANSACTION_ROLE", resolverKey: "KHONG_CO" }, ctx())).toMatchObject({
      loai: "TREO",
      lyDo: "RESOLVER_KHONG_BIET",
    });
  });
});

describe("[DYN-RES] vai nguồn ĐỘNG: REFERRER_PARENT_SALE (ảnh chụp Sale của phụ huynh) · SOURCE_OWNER (người phụ trách nguồn)", () => {
  const attrPh = {
    referrerKind: "PARENT" as const,
    referrerParentUserId: "u-ph",
    referrerEmployeeUserId: null,
    referrerAffiliateId: null,
    referrerSaleUserId: "u-sale-x",
    nguonChuEmployeeId: null,
    nguonChuUserId: null,
  };

  it("[DYN-RES-01] REFERRER_PARENT_SALE = ảnh chụp referrerSaleUserId, KHÔNG phải người chốt đơn (Lead.convertedById)", () => {
    const r = phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), ctx({ attribution: attrPh, lead: { convertedById: "u-sale-y", adminId: null } }));
    expect(r).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-sale-x" }] });
    // đối chứng: vai SALE vẫn là người chốt đơn
    expect(phanGiaiNguoiHuong(vai("SALE"), ctx({ attribution: attrPh, lead: { convertedById: "u-sale-y", adminId: null } }))).toMatchObject({ nguoi: [{ id: "u-sale-y" }] });
  });

  it("[DYN-RES-02] thiếu ảnh chụp: giới thiệu PH mà KHÔNG có Sale ⇒ TREO THIEU_SALE_PHU_HUYNH (hàng chờ nhìn thấy, không 0đ giả, không tự gán Sale chốt đơn)", () => {
    const r = phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), ctx({ attribution: { ...attrPh, referrerSaleUserId: null }, lead: { convertedById: "u-sale-y", adminId: null } }));
    expect(r).toMatchObject({ loai: "TREO", lyDo: "THIEU_SALE_PHU_HUYNH" });
  });

  it("[DYN-RES-03] attribution KHÔNG phải giới thiệu PH (hoặc không có attribution) ⇒ TREO THIEU_NGUOI_GIOI_THIEU (lý do IM LẶNG — bình thường, khác lỗi dữ liệu)", () => {
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), ctx({ attribution: { ...attrPh, referrerKind: "EMPLOYEE", referrerParentUserId: null } }))).toMatchObject({ lyDo: "THIEU_NGUOI_GIOI_THIEU" });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), ctx())).toMatchObject({ lyDo: "THIEU_NGUOI_GIOI_THIEU" });
  });

  it("[DYN-RES-04] Sale đã nghỉ việc ⇒ TREO NGUOI_HUONG_NGHI (D13); ON_LEAVE vẫn hưởng", () => {
    const c = (s: string) => ctx({ attribution: attrPh, trangThaiNhanSu: new Map([["u-sale-x", s]]) });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), c("RESIGNED"))).toMatchObject({ loai: "TREO", lyDo: "NGUOI_HUONG_NGHI" });
    expect(phanGiaiNguoiHuong(vai("REFERRER_PARENT_SALE"), c("ON_LEAVE")).loai).toBe("CO_NGUOI");
  });

  it("[DYN-RES-05] SOURCE_OWNER = User của nhân sự phụ trách NGUỒN; nghỉ việc ⇒ NGUOI_HUONG_NGHI", () => {
    const a = { ...attrPh, referrerKind: null, nguonChuEmployeeId: "e-chu", nguonChuUserId: "u-chu" };
    expect(phanGiaiNguoiHuong(vai("SOURCE_OWNER"), ctx({ attribution: a }))).toMatchObject({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-chu" }] });
    expect(phanGiaiNguoiHuong(vai("SOURCE_OWNER"), ctx({ attribution: a, trangThaiNhanSu: new Map([["u-chu", "TERMINATED"]]) }))).toMatchObject({ lyDo: "NGUOI_HUONG_NGHI" });
  });

  it("[DYN-RES-06] SOURCE_OWNER thiếu dữ liệu ⇒ TREO NGUON_CHUA_CO_NGUOI_PHU_TRACH: nguồn chưa khai chủ · chủ chưa có tài khoản · không có nguồn — canCu nói đúng ca nào", () => {
    const khongChu = phanGiaiNguoiHuong(vai("SOURCE_OWNER"), ctx({ attribution: attrPh }));
    expect(khongChu).toMatchObject({ loai: "TREO", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
    const chuKhongTk = phanGiaiNguoiHuong(vai("SOURCE_OWNER"), ctx({ attribution: { ...attrPh, nguonChuEmployeeId: "e-chu", nguonChuUserId: null } }));
    expect(chuKhongTk).toMatchObject({ loai: "TREO", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
    expect(chuKhongTk.canCu).not.toBe(khongChu.canCu);
    expect(phanGiaiNguoiHuong(vai("SOURCE_OWNER"), ctx())).toMatchObject({ loai: "TREO", lyDo: "NGUON_CHUA_CO_NGUOI_PHU_TRACH" });
  });

  it("[DYN-RES-07] hai vai mới nằm trong master và trỏ đúng khoá resolver", () => {
    expect(vai("REFERRER_PARENT_SALE")).toMatchObject({ resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" });
    expect(vai("SOURCE_OWNER")).toMatchObject({ resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" });
  });

  it("[DYN-RES-08] hai lý do mới có NHÃN tiếng Việt ở CẢ hai nơi người vận hành đọc (hàng chờ sổ + thử tính) — mo-phong dùng Record<string> nên tsc KHÔNG bắt thiếu", () => {
    for (const ma of ["THIEU_SALE_PHU_HUYNH", "NGUON_CHUA_CO_NGUOI_PHU_TRACH"] as const) {
      expect(NHAN_LY_DO_TREO[ma].length).toBeGreaterThan(10);
      expect(nhanThieuNguoi(ma)).not.toBe(ma);
    }
  });
});
