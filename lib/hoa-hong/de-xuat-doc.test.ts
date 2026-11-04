// @vitest-environment node
/**
 * [BCUI-*] — "ai thấy đề xuất nào" và "ai duyệt được cấp mấy" (THUẦN, không DB). Nút duyệt chỉ vẽ khi `viec.duyet`; hàm này dùng CÙNG khoá quyền (`KHOA_DUYET_DE_XUAT`) và CÙNG hàm tách nhiệm
 * (`lyDoKhongDuocDuyet`) với service duyệt (luật 12). Mỗi ca "KHÔNG duyệt được" có đối chứng dương "ca kia duyệt được" (CLAUDE.md luật 11 — ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng).
 */
import { describe, expect, it } from "vitest";

import type { Actor, PermEntry } from "@/lib/auth/actor";

import { cuaSoTrangDeXuat, phamViDeXuat, viecCuaNguoiXem } from "./de-xuat-doc";
import { capKeTiepCuaDeXuat, deXuatDangMo, maDeXuat, nhanTrangThaiDeXuat, toneTrangThaiDeXuat, type TrangThaiDeXuat } from "./de-xuat-nhan";

const perm = (action: string): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "X", centerScope: "ALL" });
const actor = (userId: string, ...cacKhoa: string[]): Actor => ({
  userId,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: cacKhoa.map(perm),
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
});

const NGUOI_KHIEU_NAI = "u-khieu-nai";
const CAP1 = "u-hr-1";
const CAP2 = "u-hr-2";
const dx = (p: Partial<Parameters<typeof viecCuaNguoiXem>[1]> = {}): Parameters<typeof viecCuaNguoiXem>[1] => ({
  nguonGoc: "DISPUTE",
  trangThai: "APPROVED_L1",
  quanTri: "SECOND_APPROVAL_REQUIRED",
  requestedById: NGUOI_KHIEU_NAI,
  approver1Id: CAP1,
  nguoiHuongTrongGoi: new Set([NGUOI_KHIEU_NAI]),
  ...p,
});

describe("[BCUI-01] viecCuaNguoiXem — quyền theo NGUỒN GỐC đề xuất", () => {
  it("giữ khoá duyệt khiếu nại ⇒ duyệt được cấp 2 của đề xuất khiếu nại; đối chứng: không giữ khoá ⇒ KHÔNG, kèm tên khoá", () => {
    const co = viecCuaNguoiXem(actor(CAP2, "commission_disputes:review"), dx());
    expect(co).toEqual({ cap: 2, duyet: true, tuChoi: true, lyDoKhong: null });
    const khong = viecCuaNguoiXem(actor(CAP2), dx());
    expect(khong).toMatchObject({ cap: 2, duyet: false, tuChoi: false });
    expect(khong.lyDoKhong).toContain("commission_disputes:review");
  });

  it("khoá CHÉO không mở: người giữ commission_disputes:review KHÔNG duyệt đề xuất ĐỔI NGUỒN; người giữ commission_periods:manage KHÔNG duyệt đề xuất KHIẾU NẠI (đối chứng: đúng khoá ⇒ duyệt)", () => {
    const doiNguon = dx({ nguonGoc: "SOURCE_CHANGE", trangThai: "PENDING", quanTri: "SINGLE_APPROVAL", approver1Id: null, requestedById: "u-sale" });
    expect(viecCuaNguoiXem(actor(CAP1, "commission_disputes:review"), doiNguon).duyet).toBe(false);
    expect(viecCuaNguoiXem(actor(CAP1, "commission_periods:manage"), doiNguon).duyet).toBe(true);
    expect(viecCuaNguoiXem(actor(CAP2, "commission_periods:manage"), dx()).duyet).toBe(false);
  });
});

describe("[BCUI-02] viecCuaNguoiXem — TÁCH NHIỆM", () => {
  const hr = (id: string) => actor(id, "commission_disputes:review");

  it("người khiếu nại / người đề xuất KHÔNG duyệt dù giữ khoá; đối chứng: người khác duyệt được", () => {
    const r = viecCuaNguoiXem(hr(NGUOI_KHIEU_NAI), dx());
    expect(r.duyet).toBe(false);
    expect(r.lyDoKhong).toMatch(/người đề xuất|khiếu nại/);
    expect(viecCuaNguoiXem(hr(CAP2), dx()).duyet).toBe(true);
  });

  it("người đã duyệt cấp 1 KHÔNG duyệt cấp 2; đối chứng: người khác duyệt được", () => {
    const r = viecCuaNguoiXem(hr(CAP1), dx());
    expect(r.duyet).toBe(false);
    expect(r.lyDoKhong).toMatch(/cấp 1/);
    expect(viecCuaNguoiXem(hr(CAP2), dx()).duyet).toBe(true);
  });

  it("người HƯỞNG trong gói KHÔNG duyệt đề xuất làm thay đổi tiền của chính mình; đối chứng: người không có tên trong gói duyệt được", () => {
    const co = dx({ nguoiHuongTrongGoi: new Set([NGUOI_KHIEU_NAI, CAP2]) });
    const r = viecCuaNguoiXem(hr(CAP2), co);
    expect(r.duyet).toBe(false);
    expect(r.lyDoKhong).toMatch(/người hưởng/);
    expect(viecCuaNguoiXem(hr("u-khac"), co).duyet).toBe(true);
  });

  it("đề xuất cần hai người ở PENDING ⇒ việc kế tiếp là cấp 1; ở APPROVED_L1 ⇒ cấp 2 (cấp suy từ TRẠNG THÁI, không từ client)", () => {
    expect(viecCuaNguoiXem(hr(CAP1), dx({ trangThai: "PENDING", approver1Id: null })).cap).toBe(1);
    expect(viecCuaNguoiXem(hr(CAP2), dx()).cap).toBe(2);
  });

  it("trạng thái CUỐI (POSTED · REJECTED · STALE) ⇒ cap null, không nút, không câu 'không được' (đề xuất đã xong)", () => {
    for (const trangThai of ["POSTED", "REJECTED", "STALE"] as const) {
      expect(viecCuaNguoiXem(hr(CAP2), dx({ trangThai })), trangThai).toEqual({ cap: null, duyet: false, tuChoi: false, lyDoKhong: null });
    }
  });
});

describe("[BCUI-03] phamViDeXuat — fail-closed, gác bằng KHOÁ DUYỆT chứ không bằng tiền tố commission:", () => {
  it("không giữ khoá nào ⇒ null (không thấy gì); đối chứng: giữ khoá ⇒ có điều kiện", () => {
    expect(phamViDeXuat(actor("u"))).toBeNull();
    expect(phamViDeXuat(actor("u", "commission_disputes:review"))).not.toBeNull();
  });

  it("commission:view-center (xem sổ) KHÔNG đủ để thấy đề xuất; chỉ view-self ⇒ chỉ đề xuất CỦA KHIẾU NẠI MÌNH", () => {
    expect(phamViDeXuat(actor("u", "commission:view-center"))).toBeNull();
    const rieng = JSON.stringify(phamViDeXuat(actor("u-sale", "commission:view-self")));
    expect(rieng).toContain('"requestedById":"u-sale"');
    expect(rieng).toContain('"origin":"DISPUTE"');
    expect(rieng).not.toContain("SOURCE_CHANGE");
  });

  it("khoá quản kỳ ⇒ đề xuất ĐỔI NGUỒN, không đề xuất khiếu nại; khoá duyệt khiếu nại ⇒ ngược lại", () => {
    const kyChi = JSON.stringify(phamViDeXuat(actor("u", "commission_periods:manage")));
    expect(kyChi).toContain("SOURCE_CHANGE");
    expect(kyChi).not.toContain('"origin":"DISPUTE"');
    const hrChi = JSON.stringify(phamViDeXuat(actor("u", "commission_disputes:review")));
    expect(hrChi).toContain('"origin":"DISPUTE"');
    expect(hrChi).not.toContain("SOURCE_CHANGE");
  });
});

describe("[BCUI-04] nhãn trạng thái duyệt — nói đang chờ AI", () => {
  const TAT_CA: TrangThaiDeXuat[] = ["PENDING", "APPROVED_L1", "POSTED", "REJECTED", "STALE"];

  it("mỗi trạng thái có nhãn riêng; PENDING nói rõ cần hai người hay một; APPROVED_L1 là cấp 2", () => {
    expect(new Set(TAT_CA.map((s) => nhanTrangThaiDeXuat(s, "SINGLE_APPROVAL"))).size).toBeGreaterThanOrEqual(4);
    expect(nhanTrangThaiDeXuat("PENDING", "SECOND_APPROVAL_REQUIRED")).toMatch(/cấp 1.*2 người/);
    expect(nhanTrangThaiDeXuat("PENDING", "SINGLE_APPROVAL")).toBe("Chờ duyệt");
    expect(nhanTrangThaiDeXuat("APPROVED_L1", "SECOND_APPROVAL_REQUIRED")).toMatch(/cấp 2/);
  });

  it("đang mở = PENDING | APPROVED_L1 (đúng hai trạng thái có cấp kế tiếp); trạng thái cuối không có cấp; tông không phát minh màu", () => {
    for (const s of TAT_CA) {
      expect(deXuatDangMo(s), s).toBe(capKeTiepCuaDeXuat(s) !== null);
      expect(["success", "warning", "danger", "info", "muted"]).toContain(toneTrangThaiDeXuat(s));
    }
    expect(maDeXuat("clx0abcdef123456")).toBe("DX-123456");
  });
});

describe("[BCUI-31] cuaSoTrangDeXuat — tab «Đề xuất điều chỉnh» phân trang phía MÁY CHỦ (chụp lại sau khi bang-coverage đỏ: 50 đề xuất đầu là mọi thứ người duyệt thấy)", () => {
  it("[BCUI-31a] trang trong tầm ⇒ giữ; bỏ qua (trang−1)×cỡ; số trang là ceil", () => {
    expect(cuaSoTrangDeXuat(1, 26, 25)).toEqual({ trang: 1, boQua: 0, soTrang: 2 });
    expect(cuaSoTrangDeXuat(2, 26, 25)).toEqual({ trang: 2, boQua: 25, soTrang: 2 });
  });
  it("[BCUI-31b] trang vượt cuối / âm / không phải số ⇒ kẹp về trang hợp lệ (không để người dùng gõ URL ra một trang rỗng)", () => {
    expect(cuaSoTrangDeXuat(9, 26, 25)).toEqual({ trang: 2, boQua: 25, soTrang: 2 });
    expect(cuaSoTrangDeXuat(-3, 26, 25)).toEqual({ trang: 1, boQua: 0, soTrang: 2 });
    expect(cuaSoTrangDeXuat(Number.NaN, 26, 25)).toEqual({ trang: 1, boQua: 0, soTrang: 2 });
  });
  it("[BCUI-31c] không có đề xuất nào mở ⇒ một trang rỗng hợp lệ (không chia cho 0)", () => {
    expect(cuaSoTrangDeXuat(1, 0, 25)).toEqual({ trang: 1, boQua: 0, soTrang: 1 });
  });
});
