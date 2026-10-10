// Ca [MG-*] — "menu gọn theo vai" (28/09/2026): mục nào ẩn khỏi menu của người đang xem.
// Luật: mục chỉ ẩn khi MỌI vai đang dùng đều ẩn nó. Sai thì nghiêng về HIỆN THỪA — không bao
// giờ giấu một lối vào mà một vai khác của chính người đó cần.
import { describe, expect, it } from "vitest";
import { menuAnTheoVai, vaiDangDungChoMenu } from "./menu-gon";

const KT = ["/students", "/classes", "/tra-cuu"];
const bang = (o: Record<string, string[]>) => new Map(Object.entries(o));

describe("[MG-01] một vai ⇒ ẩn đúng danh sách của vai đó", () => {
  it("kế toán ⇒ ẩn đủ, sắp xếp, bỏ trùng", () => {
    expect(menuAnTheoVai({ vai: ["HO_ACCOUNTANT"], anMenuCuaVai: bang({ HO_ACCOUNTANT: [...KT, "/classes"] }) })).toEqual([
      "/classes",
      "/students",
      "/tra-cuu",
    ]);
  });

  it("vai không khai gì ⇒ không ẩn gì", () => {
    expect(menuAnTheoVai({ vai: ["CENTER_MANAGER"], anMenuCuaVai: bang({ CENTER_MANAGER: [] }) })).toEqual([]);
  });
});

describe("[MG-02] nhiều vai ⇒ chỉ ẩn phần MỌI vai cùng ẩn", () => {
  it("kế toán kiêm Sale (Sale không ẩn Tra cứu) ⇒ Tra cứu HIỆN, phần còn lại vẫn ẩn nếu Sale cũng ẩn", () => {
    const an = menuAnTheoVai({
      vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"],
      anMenuCuaVai: bang({ HO_ACCOUNTANT: KT, CENTER_SALES_CSM: ["/classes"] }),
    });
    expect(an).toEqual(["/classes"]);
  });

  it("vai thứ hai không có dòng RoleDef nạp được ⇒ coi như không ẩn gì ⇒ không ẩn mục nào", () => {
    // Fail-open: thiếu dữ liệu vai thì hiện như cũ, không đoán.
    expect(menuAnTheoVai({ vai: ["HO_ACCOUNTANT", "VAI_LA"], anMenuCuaVai: bang({ HO_ACCOUNTANT: KT }) })).toEqual([]);
  });
});

describe("[MG-03] không có vai nào ⇒ không ẩn gì (v1 / người chưa neo vai)", () => {
  it("danh sách vai rỗng", () => {
    expect(menuAnTheoVai({ vai: [], anMenuCuaVai: bang({ HO_ACCOUNTANT: KT }) })).toEqual([]);
  });
});

describe("[MG-04] vai đang dùng cho menu", () => {
  const actor = {
    isSuperAdmin: false,
    orgRoles: [
      { orgUnitId: "ho", roleCode: "HO_ACCOUNTANT" },
      { orgUnitId: "cs1", roleCode: "HO_ACCOUNTANT" },
      { orgUnitId: "cs1", roleCode: "CENTER_SALES_CSM" },
    ],
  };

  it("cờ RBAC v2 TẮT ⇒ không xét vai (mã vai v1 khác bộ mã RoleDef) ⇒ rỗng", () => {
    expect(vaiDangDungChoMenu(actor, false)).toEqual([]);
  });

  it("cờ BẬT ⇒ mã vai duy nhất, sắp xếp", () => {
    expect(vaiDangDungChoMenu(actor, true)).toEqual(["CENTER_SALES_CSM", "HO_ACCOUNTANT"]);
  });

  it("Quản trị tối cao ⇒ rỗng (không bao giờ gọn menu của người cấu hình hệ thống)", () => {
    expect(vaiDangDungChoMenu({ ...actor, isSuperAdmin: true }, true)).toEqual([]);
  });

  it("không có actor ⇒ rỗng", () => {
    expect(vaiDangDungChoMenu(null, true)).toEqual([]);
  });
});
