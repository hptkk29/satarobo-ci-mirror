/**
 * [NHH-UI-GC-*] — `giaiNguonChon`: lựa chọn thô của ô chọn nguồn → `NguonChonDaGiai`. THUẦN (tra cứu DB do chỗ gọi đưa vào).
 * Fixture CỐ Ý lệch: người được chọn là GIÁO VIÊN; vai chỉ là SNAPSHOT (`anhChup.referrerRoleCode`) — nhóm GHI = nhóm người nhập đã chọn,
 * kể cả nhóm do admin tạo (nguồn động, SPEC §2 V1).
 */
import { describe, expect, it } from "vitest";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { giaiNguonChon, type NhomTraCuu, type TraCuuNguoiChon } from "./giai-nguon-chon";
import { ANH_CHUP_TRONG } from "./tin-hieu";
import type { NguonChonDauVao } from "./tin-hieu";

/** Nhóm do ADMIN tạo (không nằm trong 9 mã gốc) — yêu cầu NHÂN SỰ giới thiệu, đúng ca "nguồn thứ 10". */
const NHOM_ADMIN: NhomTraCuu = {
  id: "id-TRUONG_HOC",
  code: "TRUONG_HOC",
  active: true,
  requiresNote: false,
  selectable: true,
  referrerRequirement: "EMPLOYEE",
  cuaSoRiengNgay: null,
  chuNhanVienId: null,
};

const nhom = (tat: readonly string[] = []): NhomTraCuu[] => [
  ...DANH_MUC_GOC.map((g) => ({
    id: `id-${g.code}`,
    code: g.code,
    active: !tat.includes(g.code),
    requiresNote: g.requiresNote,
    selectable: g.selectable,
    referrerRequirement: g.referrerRequirement,
    cuaSoRiengNgay: null,
    chuNhanVienId: null,
  })),
  NHOM_ADMIN,
];

const TRA_TRONG: TraCuuNguoiChon = { nhanSu: null, hocVienCo: false, phuHuynhCo: false, doiTacCo: false, saleCuaPhuHuynh: null };

function giai(chon: Partial<NguonChonDauVao> & { groupCode: string }, tra: Partial<TraCuuNguoiChon> = {}, tat: readonly string[] = []) {
  const ds = nhom(tat);
  const { groupCode, ...conLai } = chon;
  return giaiNguonChon({
    chon: { groupId: `id-${groupCode}`, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null, ...conLai },
    nhomTheoId: new Map(ds.map((g) => [g.id, g])),
    vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
    tra: { ...TRA_TRONG, ...tra },
  });
}

describe("[NHH-UI-GC-01] nhóm không cần người", () => {
  it("chọn Quảng cáo ⇒ ghi đúng nhóm, không người, không giải trình", () => {
    expect(giai({ groupCode: "PAID_ADS" })).toEqual({ groupCode: "PAID_ADS", nguoi: null, giaiTrinh: null, loi: null, anhChup: ANH_CHUP_TRONG });
  });
  it("nhóm Khác: giải trình ≥10 ký tự (đã trim) được GIỮ; thiếu ⇒ lỗi đúng câu của kiemGiaiTrinh", () => {
    expect(giai({ groupCode: "OTHER", giaiTrinh: "  khách đến từ hội thảo STEM " })).toMatchObject({ giaiTrinh: "khách đến từ hội thảo STEM", loi: null });
    expect(giai({ groupCode: "OTHER", giaiTrinh: "ngắn" }).loi).toContain("giải trình");
  });
  it("giải trình thừa ở nhóm KHÔNG cần ⇒ bị bỏ (null), không lưu chữ lạc nhóm", () => {
    expect(giai({ groupCode: "WALK_IN", giaiTrinh: "chữ thừa chữ thừa" }).giaiTrinh).toBeNull();
  });
  it("chọn người ở nhóm không có người ⇒ lỗi (không nuốt dữ liệu)", () => {
    const r = giai({ groupCode: "PAID_ADS", employeeId: "e1" }, { nhanSu: { status: "ACTIVE", roleCodes: [] } });
    expect(r.loi).toContain("không có người giới thiệu");
  });
});

describe("[NHH-UI-GC-02] nhóm của danh mục: UNKNOWN / nhóm ngừng / id lạ KHÔNG bao giờ qua", () => {
  it("UNKNOWN (selectable=false) · nhóm INACTIVE · id không có ⇒ lỗi 'không còn dùng được'", () => {
    expect(giai({ groupCode: "UNKNOWN" }).loi).toContain("không còn dùng được");
    expect(giai({ groupCode: "WALK_IN" }, {}, ["WALK_IN"]).loi).toContain("không còn dùng được");
    const ds = nhom();
    const r = giaiNguonChon({
      chon: { groupId: "id-khong-co", employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null },
      nhomTheoId: new Map(ds.map((g) => [g.id, g])),
      vaiSangNguon: VAI_SANG_NGUON_MAC_DINH,
      tra: TRA_TRONG,
    });
    expect(r.loi).toContain("không còn dùng được");
  });
});

describe("[NHH-UI-GC-03] nhân sự: nhóm GHI = nhóm nhân sự giới thiệu (vai chỉ là snapshot)", () => {
  it("bấm nhóm nhân sự, người là GIÁO VIÊN ⇒ ghi EMPLOYEE_REFERRAL; người ghi đúng employeeId", () => {
    const r = giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e-gv" }, { nhanSu: { status: "ACTIVE", roleCodes: ["TEACHER"] } });
    expect(r).toEqual({
      groupCode: "EMPLOYEE_REFERRAL",
      nguoi: { kind: "EMPLOYEE", employeeId: "e-gv" },
      giaiTrinh: null,
      loi: null,
      anhChup: { referrerRoleCode: "TEACHER", referrerSaleUserId: null, nguoiGioiThieu: { employeeCode: null, roleCodes: ["TEACHER"], orgUnitId: null }, nguon: null },
    });
  });
  it("mọi vai (kể cả không vai nào) ⇒ CÙNG một nhóm nhân sự giới thiệu", () => {
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: { status: "ACTIVE", roleCodes: [] } }).groupCode).toBe("EMPLOYEE_REFERRAL");
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: { status: "ON_LEAVE", roleCodes: ["CENTER_MANAGER"] } }).groupCode).toBe("EMPLOYEE_REFERRAL");
  });
  it("nhóm nhân sự gốc đã NGỪNG nhưng người nhập bấm nhóm admin tạo ⇒ giữ nhóm đã bấm (không phụ thuộc nhóm gốc)", () => {
    const r = giai({ groupCode: "TRUONG_HOC", employeeId: "e" }, { nhanSu: { status: "ACTIVE", roleCodes: ["TEACHER"] } }, ["EMPLOYEE_REFERRAL"]);
    expect(r).toMatchObject({ groupCode: "TRUONG_HOC", loi: null });
  });
  // V1 (SPEC nguồn động §2): nhóm do admin tạo có yêu cầu NHÂN SỰ trước đây bị ghi đè về nhóm nhân sự gốc ⇒ chính sách riêng của nguồn mới không bao giờ
  // áp dụng. Ghim `it.fails` đã gỡ khi vá; ca âm tính + đối chứng dương nằm ở [DYN-V1-02] bên dưới.
  it("[NHH-DYN-V1] nhóm nhân sự do admin tạo được GIỮ NGUYÊN khi chọn nhân sự (không bị ghi đè về EMPLOYEE_REFERRAL)", () => {
    const r = giai({ groupCode: "TRUONG_HOC", employeeId: "e" }, { nhanSu: { status: "ACTIVE", roleCodes: ["TEACHER"] } });
    expect(r).toMatchObject({ groupCode: "TRUONG_HOC", loi: null });
  });
  it("[DYN-V1-02] ca ÂM TÍNH kèm ĐỐI CHỨNG DƯƠNG: nhóm admin tạo kiểu nhân sự KHÔNG bị ghi đè dù vai là gì; nhóm nhân sự gốc cũng giữ nguyên; vai chỉ đổi ẢNH CHỤP", () => {
    for (const [roleCodes, vai] of [[["TEACHER"], "TEACHER"], [["CENTER_SALES_CSM"], "SALE"], [["CENTER_MANAGER"], "MANAGER"], [[], "OTHER_EMPLOYEE"]] as const) {
      const admin = giai({ groupCode: "TRUONG_HOC", employeeId: "e", }, { nhanSu: { status: "ACTIVE", roleCodes } });
      expect(admin.groupCode, `admin/${vai}`).toBe("TRUONG_HOC");
      expect(admin.anhChup.referrerRoleCode, `admin/${vai}`).toBe(vai);
      const goc = giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: { status: "ACTIVE", roleCodes } });
      expect(goc.groupCode, `goc/${vai}`).toBe("EMPLOYEE_REFERRAL");
      expect(goc.anhChup.referrerRoleCode, `goc/${vai}`).toBe(vai);
    }
  });

  it("[DYN-V1-03] dấu vết nhân sự vào ảnh chụp: mã NV · vai thô · đơn vị (không PII ngoài mã)", () => {
    const r = giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: { status: "ACTIVE", roleCodes: ["TEACHER", "TRAINING"], employeeCode: "SR.NV.07", orgUnitId: "ou-cs1" } });
    expect(r.anhChup.nguoiGioiThieu).toEqual({ employeeCode: "SR.NV.07", roleCodes: ["TEACHER", "TRAINING"], orgUnitId: "ou-cs1" });
  });

  it("[DYN-V1-04] phụ huynh: Sale phụ trách PH đi vào ảnh chụp; không tìm được ⇒ null (đường quy nguồn ghi cờ THIEU_SALE_PH)", () => {
    const co = giai({ groupCode: "PARENT_REFERRAL", studentId: "s" }, { hocVienCo: true, saleCuaPhuHuynh: "sale-X" });
    expect(co.anhChup).toEqual({ referrerRoleCode: null, referrerSaleUserId: "sale-X", nguoiGioiThieu: null, nguon: null });
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "s" }, { hocVienCo: true, saleCuaPhuHuynh: null }).anhChup.referrerSaleUserId).toBeNull();
  });

  it("nhân sự đã nghỉ (RESIGNED) hoặc không tồn tại ⇒ lỗi (D13)", () => {
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: { status: "RESIGNED", roleCodes: [] } }).loi).toContain("không còn làm việc");
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL", employeeId: "e" }, { nhanSu: null }).loi).toContain("không tồn tại");
  });
  it("nhóm cần nhân sự mà không chọn ai ⇒ lỗi đúng câu của kiemThamChieu", () => {
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL" }).loi).toBe("Nguồn này cần chọn nhân sự giới thiệu.");
  });
});

describe("[NHH-UI-GC-04] phụ huynh · đối tác: phải TỒN TẠI (FK Restrict — id ma làm lead.create nổ và mất khách)", () => {
  it("phụ huynh: chỉ studentId, chỉ parentUserId, hoặc cả hai đều được; thiếu bản ghi ⇒ lỗi", () => {
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "s", parentUserId: "u" }, { hocVienCo: true, phuHuynhCo: true })).toMatchObject({
      groupCode: "PARENT_REFERRAL",
      nguoi: { kind: "PARENT", parentUserId: "u", studentId: "s" },
      loi: null,
    });
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "s" }, { hocVienCo: true }).loi).toBeNull();
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "s" }, { hocVienCo: false }).loi).toContain("Phụ huynh");
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "s", parentUserId: "u" }, { hocVienCo: true, phuHuynhCo: false }).loi).toContain("Phụ huynh");
  });
  it("đối tác: tồn tại ∧ đang hoạt động mới qua", () => {
    expect(giai({ groupCode: "PARTNER", affiliateId: "a" }, { doiTacCo: true })).toMatchObject({ nguoi: { kind: "AFFILIATE", affiliateId: "a" }, loi: null });
    expect(giai({ groupCode: "PARTNER", affiliateId: "a" }, { doiTacCo: false }).loi).toContain("Đối tác");
  });
  it("chuỗi rỗng / toàn khoảng trắng ở ô id coi như KHÔNG chọn (biểu mẫu gửi chuỗi rỗng cho ô để trống)", () => {
    expect(giai({ groupCode: "PARENT_REFERRAL", studentId: "  ", parentUserId: "" }).loi).toBe("Nguồn này cần chọn phụ huynh giới thiệu.");
  });
  it("người LẠC LOẠI (đối tác ở nhóm nhân sự) ⇒ lỗi", () => {
    expect(giai({ groupCode: "EMPLOYEE_REFERRAL", affiliateId: "a" }, { doiTacCo: true }).loi).toBe("Nguồn này cần chọn nhân sự giới thiệu.");
  });
});
