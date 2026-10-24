// Ca [QCoSo-*] — AI SỬA ĐƯỢC CẤU HÌNH CỦA CƠ SỞ NÀO. Thuần, không DB.
//
// ⚠️ Luật này có HAI chỗ dùng và chúng phải KHÔNG ĐƯỢC LỆCH:
//   · cổng GHI      `setCenterSetting` / `clearCenterSetting` — từ chối ghi sai cơ sở;
//   · màn Cấu hình  `docCaiRiengTheoCoSo` — bày đúng cơ sở người ta sửa được.
//
// Lệch theo chiều màn bày THỪA thì không ai thấy cho tới lúc bấm Lưu: ô hiện ra MỞ, gõ số,
// bấm, rồi nhận "Không có quyền sửa cấu hình cơ sở này" (luật 12). Nên cả hai gọi cùng một
// hàm, và bộ này canh chính hàm ấy.
import { describe, it, expect } from "vitest";
import { SETTINGS } from "./registry";
import {
  duocSuaKhoaCuaCoSo,
  laQuanLyCoSo,
  coSoSuaDuoc,
  trongPhamVi,
  guTranQlcsDuoc,
  vuotTranQlcs,
  VAI_QUAN_LY_CO_SO,
  type ActorCoSo,
} from "./quyen-co-so";

const CS1 = "ou_cs1";
const CS2 = "ou_cs2";
const HO = "ou_ho";

const qlCs1: ActorCoSo = {
  isSuperAdmin: false,
  orgRoles: [{ orgUnitId: CS1, roleCode: "CENTER_MANAGER" }],
};
const ketoanCs1: ActorCoSo = {
  isSuperAdmin: false,
  orgRoles: [{ orgUnitId: CS1, roleCode: "CENTER_ACCOUNTANT" }],
};
const superAdmin: ActorCoSo = { isSuperAdmin: true, orgRoles: [] };

describe("[QCoSo-01] quản lý cơ sở: ĐÚNG cơ sở mình, không hơn", () => {
  it("sửa được cơ sở mình", () => {
    expect(laQuanLyCoSo(qlCs1, CS1)).toBe(true);
  });

  it("KHÔNG sửa được cơ sở khác", () => {
    expect(laQuanLyCoSo(qlCs1, CS2)).toBe(false);
  });

  it("vai KHÁC tại cùng cơ sở thì không sửa được", () => {
    // Kế toán cơ sở đứng đúng chỗ nhưng không phải vai quản lý — đây là chỗ một phép kiểm
    // viết ẩu ("có vai nào tại cơ sở này không") sẽ sai.
    expect(laQuanLyCoSo(ketoanCs1, CS1)).toBe(false);
  });

  it("không vai nào thì không sửa được gì", () => {
    expect(laQuanLyCoSo({ isSuperAdmin: false, orgRoles: [] }, CS1)).toBe(false);
  });
});

describe("[QCoSo-02] vai neo tại HO KHÔNG kéo theo cơ sở con", () => {
  it("quản lý neo tại HO không sửa được cấu hình CS1", () => {
    // ⚠️ Đây là hành vi CÓ CHỦ ĐÍCH của `setCenterSetting` từ R6-A: so khớp CHÍNH XÁC
    // `orgUnitId`, không theo cây con. Đổi nó là NỚI QUYỀN, phải hỏi — nhất là sau lượt
    // 11/08 đảo hình cây, khi `getSubtreeCenterIds(HO)` bắt đầu trả đủ danh sách cơ sở.
    const qlHo: ActorCoSo = {
      isSuperAdmin: false,
      orgRoles: [{ orgUnitId: HO, roleCode: "CENTER_MANAGER" }],
    };
    expect(laQuanLyCoSo(qlHo, CS1)).toBe(false);
    expect(coSoSuaDuoc(qlHo)).toEqual([HO]);
  });
});

describe("[QCoSo-03] phạm vi — fail-closed, và `TAT_CA` là một GIÁ TRỊ", () => {
  it("Quản trị tối cao ⇒ `TAT_CA`", () => {
    expect(coSoSuaDuoc(superAdmin)).toBe("TAT_CA");
  });

  it("quản lý hai cơ sở (kiêm nhiệm) ⇒ đủ hai, không trùng", () => {
    const kiem: ActorCoSo = {
      isSuperAdmin: false,
      orgRoles: [
        { orgUnitId: CS1, roleCode: "CENTER_MANAGER" },
        { orgUnitId: CS2, roleCode: "CENTER_MANAGER" },
        // Vai thứ hai tại CS1 — kiêm nhiệm thật có hình dạng này, và một bản cài đặt quên
        // khử trùng sẽ trả CS1 hai lần rồi màn vẽ hai hàng cho cùng một cơ sở.
        { orgUnitId: CS1, roleCode: "SUPER_ADMIN" },
      ],
    };
    expect(coSoSuaDuoc(kiem)).toEqual([CS1, CS2]);
  });

  it("không quản lý cơ sở nào ⇒ `[]`, KHÔNG phải `TAT_CA`", () => {
    // Mặc định của SCOPE phải fail-closed. Rơi về "tất cả" ở đây là bày cấu hình mọi cơ sở
    // cho người không quản lý cơ sở nào — và nó trông y hệt lúc chạy đúng.
    expect(coSoSuaDuoc(ketoanCs1)).toEqual([]);
  });
});

describe("[QCoSo-04] `trongPhamVi` đọc đúng cả hai nhánh", () => {
  it("`TAT_CA` chứa mọi đơn vị", () => {
    expect(trongPhamVi("TAT_CA", CS2)).toBe(true);
  });

  it("danh sách chỉ chứa thứ trong nó", () => {
    expect(trongPhamVi([CS1], CS1)).toBe(true);
    expect(trongPhamVi([CS1], CS2)).toBe(false);
  });

  it("danh sách RỖNG không chứa gì — đối chứng của nhánh trên", () => {
    expect(trongPhamVi([], CS1)).toBe(false);
  });
});

describe("[QCoSo-05] danh sách vai là một quyết định, không phải chi tiết cài đặt", () => {
  it("đúng HAI vai sửa được cấu hình cơ sở", () => {
    // Thêm vai vào đây là cho thêm người đổi tham số TIỀN của một cơ sở (trần số đợt, trần
    // ưu đãi, làm tròn, hạn QR). Ca này đỏ để việc đó phải được viết ra, không làm tiện tay.
    expect([...VAI_QUAN_LY_CO_SO].sort()).toEqual(["CENTER_MANAGER", "SUPER_ADMIN"]);
  });
});

describe("[QCoSo-06] ĐÚNG CƠ SỞ chưa đủ — còn phải ĐÚNG KHOÁ", () => {
  // 🔴 SINH RA TỪ MỘT LẦN CẤP THỪA QUYỀN, 25/09/2026.
  //
  // Bản 24/09 cho Quản lý cơ sở vào tab "Thanh toán" và lọc danh sách bày ra bằng
  // `centerOverridable` — 13 khoá. Nhưng chốt của chủ dự án (22/09) chỉ nói đúng hai:
  // *"trần số đợt / số ưu đãi thì QLCS chỉnh được"*. Mười một khoá còn lại là chính sách
  // tiền của công ty (mức ưu đãi anh chị em, dung sai làm tròn, hạn QR, nhắc nợ).
  //
  // Chủ dự án mở màn bằng tài khoản QLCS và hỏi: *"setting của admin sao nằm ở QLCS?"*
  //
  // ⚠️ Và lọc giao diện KHÔNG phải cổng: mỗi Server Action là một endpoint riêng, gọi
  // thẳng với một khoá khác vẫn tới được `setCenterSetting`. Nên luật sống ở hàm này.
  const qlcs: ActorCoSo = {
    isSuperAdmin: false,
    orgRoles: [{ orgUnitId: CS1, roleCode: "CENTER_MANAGER" }],
  };
  const TRAN_DOT = { centerOverridable: true, qlcsSuaDuoc: true };
  const CHINH_SACH = { centerOverridable: true }; // vd `billing.siblingPercentSecond`
  const TOAN_CUC = { centerOverridable: false };

  it("QLCS sửa được khoá khai `qlcsSuaDuoc`", () => {
    expect(duocSuaKhoaCuaCoSo(qlcs, TRAN_DOT)).toBe(true);
  });

  it("QLCS KHÔNG sửa được khoá cài-riêng-được nhưng không khai `qlcsSuaDuoc`", () => {
    // Đây là vế bản cũ để lọt: `centerOverridable` đúng nên cổng cũ cho qua.
    expect(duocSuaKhoaCuaCoSo(qlcs, CHINH_SACH)).toBe(false);
  });

  it("thiếu cờ ⇒ MẶC ĐỊNH TỪ CHỐI, khoá mới không tự chảy về cấp cơ sở", () => {
    expect(duocSuaKhoaCuaCoSo(qlcs, { centerOverridable: true })).toBe(false);
    expect(duocSuaKhoaCuaCoSo(qlcs, { centerOverridable: true, qlcsSuaDuoc: false })).toBe(false);
  });

  it("Quản trị tối cao KHÔNG bị vế này chặn", () => {
    // Đối chứng: siết nhầm chiều thì quản trị hết cài riêng được cho mọi cơ sở.
    expect(duocSuaKhoaCuaCoSo(superAdmin, CHINH_SACH)).toBe(true);
  });

  it("khoá TOÀN CỤC thì không ai cài riêng, kể cả quản trị tối cao", () => {
    expect(duocSuaKhoaCuaCoSo(superAdmin, TOAN_CUC)).toBe(false);
    expect(duocSuaKhoaCuaCoSo(qlcs, TOAN_CUC)).toBe(false);
  });
});

describe("[QCoSo-07] ĐÚNG NĂM khoá được khai `qlcsSuaDuoc` — đây là một quyết định", () => {
  it("không nhiều hơn, không ít hơn chốt 22/09 + `pause.minDays` (spec bảo lưu §D, mở ở Phiên 7) + `billing.scopeMaxDiscountPercent` (chủ dự án chốt 20/10/2026: \"cho qlcs tự chỉnh cho từng cơ sở được\") + `enrollment.catchUpMaxSessions` (chốt 21/10/2026: QLCS đặt n học vượt, tối đa 12)", () => {
    // Thêm khoá thứ ba là mở thêm một quyết định TIỀN cho cấp cơ sở. Ca này đỏ để việc
    // đó phải được viết ra, không làm tiện tay lúc thêm một setting mới.
    const co = Object.values(SETTINGS)
      .filter((d) => (d as { qlcsSuaDuoc?: boolean }).qlcsSuaDuoc === true)
      .map((d) => d.key)
      .sort();
    expect(co).toEqual(["billing.scopeMaxDiscountPercent", "enrollment.catchUpMaxSessions", "orders.maxDiscountItems", "orders.maxInstallments", "pause.minDays"]);
  });
});

describe("[QCoSo-08] trần RIÊNG của QLCS (`tranQlcs`) — chủ dự án chốt 20/10/2026: QLCS tối đa 30%, chỉ admin tuỳ ý", () => {
  const khoa = SETTINGS["billing.scopeMaxDiscountPercent"];
  it("khoá trần giảm phạm vi khai tranQlcs = 30; biên schema của admin vẫn 1–100", () => {
    expect(khoa.tranQlcs).toBe(30);
    expect(khoa.schema.safeParse(100).success).toBe(true);
    expect(khoa.schema.safeParse(101).success).toBe(false);
  });
  it("QLCS đặt 30 ⇒ qua; 31 ⇒ bị chặn kèm câu nêu trần; hạ xuống 10 ⇒ qua", () => {
    expect(vuotTranQlcs(qlCs1, khoa, 30)).toBeNull();
    expect(vuotTranQlcs(qlCs1, khoa, 10)).toBeNull();
    expect(vuotTranQlcs(qlCs1, khoa, 31)).toContain("tối đa 30");
  });
  it("Quản trị hệ thống đặt 50 hay 100 ⇒ không bị chặn", () => {
    expect(vuotTranQlcs(superAdmin, khoa, 50)).toBeNull();
    expect(vuotTranQlcs(superAdmin, khoa, 100)).toBeNull();
  });
  it("khoá không khai tranQlcs ⇒ không chặn; giá trị không phải số để schema xét", () => {
    expect(vuotTranQlcs(qlCs1, {}, 999)).toBeNull();
    expect(vuotTranQlcs(qlCs1, khoa, "abc")).toBeNull();
  });
  it("gỡ mức riêng: mức toàn hệ ≤ 30 ⇒ gỡ được; admin đặt toàn hệ 40 ⇒ QLCS KHÔNG gỡ được (gỡ = nâng vòng qua trần)", () => {
    expect(guTranQlcsDuoc(qlCs1, khoa, 25)).toBeNull();
    expect(guTranQlcsDuoc(qlCs1, khoa, 40)).toContain("không gỡ mức riêng");
    expect(guTranQlcsDuoc(superAdmin, khoa, 40)).toBeNull();
  });
  it("chỉ HAI khoá khai tranQlcs (thêm khoá thứ ba là một quyết định tiền): trần giảm phạm vi 30 và n học vượt 12", () => {
    const co = Object.values(SETTINGS).filter((d) => (d as { tranQlcs?: number }).tranQlcs !== undefined).map((d) => d.key).sort();
    expect(co).toEqual(["billing.scopeMaxDiscountPercent", "enrollment.catchUpMaxSessions"]);
    expect(SETTINGS["enrollment.catchUpMaxSessions"].tranQlcs).toBe(12);
    // QLCS đặt 12 ⇒ qua, 13 ⇒ chặn; admin vẫn tới biên schema (48).
    const n = SETTINGS["enrollment.catchUpMaxSessions"];
    expect(vuotTranQlcs(qlCs1, n, 12)).toBeNull();
    expect(vuotTranQlcs(qlCs1, n, 13)).toContain("tối đa 12");
    expect(vuotTranQlcs(superAdmin, n, 40)).toBeNull();
  });
});
