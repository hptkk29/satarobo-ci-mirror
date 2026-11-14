// lib/integrations/zalocrm/vai-tro.test.ts — S1 · ánh xạ vai Sata → vai ZaloCRM.
//
// Vì sao bảng ánh xạ này phải có test riêng dù chỉ là một `Record`: nó là thứ quyết
// định người mở màn Zalo CRM bước vào fork với tư cách `admin` (đọc mọi hội thoại của
// org) hay `member` (chỉ nick mình). Sai một dòng ở đây thì Sata KHÔNG báo lỗi gì —
// cửa mở ra bên kia mới rộng ra, và bên kia không có lưới nào của repo này canh.
import { describe, it, expect } from "vitest";
import {
  maVaiCuaNguoiDung,
  vaiZaloCrm,
  VAI_ZALOCRM,
  VAI_DUOC_CAP_NICK,
  VAI_KHONG_THEM_DUOC_VAO_NICK,
} from "./vai-tro";
import { RELATIONSHIP_ROLE_CODES } from "@/lib/auth/actor";

describe("[ZC-SSO-07] ánh xạ vai Sata → vai ZaloCRM", () => {
  it("[ZC-SSO-07a] CHỈ SUPER_ADMIN ⇒ 'admin' — không ai khác", () => {
    // 🔴 Ca này là hàng rào an ninh, không phải ca hình thức. `admin` bên fork đi qua
    // `if (user.role === 'owner' || 'admin') return true` trong `userHasGrant`, tức BỎ
    // QUA toàn bộ ma trận quyền: `settings` (chứa khoá Public API), `permission_group`,
    // `user`, `zalo_account` (gỡ nick), `audit_log`. Thêm một vai vào nhánh `admin` là
    // mở đúng chừng đó cửa, và Sata sẽ KHÔNG báo lỗi gì.
    expect(vaiZaloCrm(["SUPER_ADMIN"])).toBe("admin");

    const CHI_LA_MEMBER = ["CENTER_MANAGER", "CENTER_SALES_CSM", "SALES_CSM"];
    for (const ma of CHI_LA_MEMBER) {
      expect(vaiZaloCrm([ma]), `${ma} phải là member, không được là admin`).toBe("member");
    }
    // Chốt cứng danh sách vai được cấp `admin` — thêm một dòng vào bảng là ca này đỏ,
    // buộc người thêm phải đọc đoạn trên.
    const vaiAdmin = Object.entries(VAI_ZALOCRM)
      .filter(([, v]) => v === "admin")
      .map(([k]) => k);
    expect(vaiAdmin).toEqual(["SUPER_ADMIN"]);
  });

  it("[ZC-SSO-07b] Giáo vụ KHÔNG dùng ZaloCRM — không ánh xạ, không ký vé", () => {
    // Chốt 13/09/2026 (đảo quyết định 06/09). Đi kèm gỡ `zalocrm:use` khỏi
    // `CENTER_CLASS_MANAGER` trong `prisma/seed-roles.ts`: còn quyền mà mất ánh xạ thì
    // họ mở màn ra chỉ để đọc "vai của bạn chưa được ánh xạ".
    expect(vaiZaloCrm(["CENTER_CLASS_MANAGER"])).toBeNull();
    expect("CENTER_CLASS_MANAGER" in VAI_ZALOCRM).toBe(false);
  });

  it("Sale ⇒ 'member' — cả mã v1 (SALES_CSM) lẫn mã v2 (CENTER_SALES_CSM)", () => {
    // Hai hệ tên chạy song song: `User.role` là enum `Role` (v1, SALES_CSM), còn
    // `UserOrgRole.role.code` là RoleDef (v2, CENTER_SALES_CSM). Máy local chạy v1,
    // prod chạy v2 — khai thiếu một vế là Sale vào được ở một môi trường và bị từ chối
    // ở môi trường kia, đúng loại lệch không tái hiện được.
    expect(vaiZaloCrm(["SALES_CSM"])).toBe("member");
    expect(vaiZaloCrm(["CENTER_SALES_CSM"])).toBe("member");
  });

  it("vai khác ⇒ null (fail-closed: KHÔNG ký token)", () => {
    for (const ma of [
      "TEACHER",
      "ASSISTANT_TEACHER",
      "CENTER_ACCOUNTANT",
      "HO_ACCOUNTANT",
      "HO_HR",
      "CENTER_HR",
      "HO_MARKETING",
      "HO_SALE", // chốt 9.7 — Hội sở KHÔNG dùng trục Zalo cá nhân
      "TRAINING",
      "AUDITOR",
      "PARENT",
      "VAI_KHONG_TON_TAI",
    ]) {
      expect(vaiZaloCrm([ma]), `${ma} không được ánh xạ sang vai ZaloCRM`).toBeNull();
    }
    expect(vaiZaloCrm([])).toBeNull();
  });

  it("vai RỘNG NHẤT thắng khi kiêm nhiệm — không phụ thuộc thứ tự mảng", () => {
    // Kiêm nhiệm là chuyện thật (QLCS kiêm tư vấn). Lấy vai đầu tiên khớp thì kết quả
    // đổi theo thứ tự dòng `UserOrgRole` trong DB — tức cùng một người, hai lần mở
    // trang ra hai quyền khác nhau.
    //
    // Sau 13/09/2026 cả hai vai này đều là `member`, nên phép kiểm "không đổi theo thứ
    // tự" phải dùng cặp có hai mức KHÁC nhau mới còn ý nghĩa.
    expect(vaiZaloCrm(["CENTER_SALES_CSM", "CENTER_MANAGER"])).toBe("member");
    expect(vaiZaloCrm(["CENTER_MANAGER", "CENTER_SALES_CSM"])).toBe("member");
    expect(vaiZaloCrm(["CENTER_SALES_CSM", "SUPER_ADMIN"])).toBe("admin");
    expect(vaiZaloCrm(["SUPER_ADMIN", "CENTER_SALES_CSM"])).toBe("admin");
  });

  it("bảng chỉ có đúng hai giá trị đích — 'owner' của fork KHÔNG bao giờ được cấp", () => {
    // Fork có vai `owner` (toàn quyền tổ chức, đổi được cấu hình + xoá org). Sata không
    // ánh xạ ai sang đó: chủ tổ chức bên fork do người vận hành tạo tay một lần.
    expect(new Set(Object.values(VAI_ZALOCRM))).toEqual(new Set(["admin", "member"]));
  });

  it("mã vai rỗng / null / trùng lặp không làm lệch kết quả", () => {
    expect(vaiZaloCrm(["", "  ", "SALES_CSM", "SALES_CSM"])).toBe("member");
    expect(vaiZaloCrm(["", "   "])).toBeNull();
  });
});

describe("[ZC-SSO-08] maVaiCuaNguoiDung — gom mã vai từ CẢ HAI hệ (v1 session + v2 actor)", () => {
  it("gộp User.role, User.roles[] và orgRoles[].roleCode, bỏ trùng", () => {
    const ma = maVaiCuaNguoiDung({
      role: "SALES_CSM",
      roles: ["SALES_CSM", "TEACHER"],
      orgRoles: [{ roleCode: "CENTER_SALES_CSM" }, { roleCode: "CENTER_SALES_CSM" }],
    });
    expect(new Set(ma)).toEqual(new Set(["SALES_CSM", "TEACHER", "CENTER_SALES_CSM"]));
  });

  it("thiếu trường nào cũng không ném — Actor dựng tay hay thiếu orgRoles", () => {
    expect(maVaiCuaNguoiDung({})).toEqual([]);
    expect(maVaiCuaNguoiDung({ role: null, roles: null, orgRoles: null })).toEqual([]);
    expect(maVaiCuaNguoiDung({ role: "SUPER_ADMIN" })).toEqual(["SUPER_ADMIN"]);
  });

  it("người chỉ có vai ở DB (v2) vẫn ra vai ZaloCRM đúng dù session.role là vai khác", () => {
    // Ca thật: tài khoản gốc mang `role = SALES_CSM` nhưng được nâng lên quản trị tối
    // cao bằng `UserOrgRole`. Đọc mỗi session là cấp nhầm `member`.
    const ma = maVaiCuaNguoiDung({
      role: "SALES_CSM",
      orgRoles: [{ roleCode: "SUPER_ADMIN" }],
    });
    expect(vaiZaloCrm(ma)).toBe("admin");

    // Chiều ngược lại cũng phải đúng: vai v2 KHÔNG nằm trong bảng (Giáo vụ) thì không
    // được mượn vai v1 của session để lọt qua.
    const maGiaoVu = maVaiCuaNguoiDung({
      role: "TEACHER",
      orgRoles: [{ roleCode: "CENTER_CLASS_MANAGER" }],
    });
    expect(vaiZaloCrm(maGiaoVu)).toBeNull();
  });
});

describe("[VT-04] hai danh sách vai — KHÔNG được gộp, KHÔNG được lệch nguồn", () => {
  it("`VAI_KHONG_THEM_DUOC_VAO_NICK` khớp `RELATIONSHIP_ROLE_CODES`", () => {
    // 🔴 Hai nơi khai cùng một khái niệm "vai không phải nhân sự". `vai-tro.ts` là module
    // THUẦN nên không `import` được từ `lib/auth/actor` (tệp đó chạm DB) — nên bản sao
    // là bắt buộc, và ca này là thứ duy nhất giữ hai bản khớp nhau.
    //
    // Thêm một vai quan hệ mới (vd `GUARDIAN`) mà quên khai ở đây ⇒ người thuộc vai ấy
    // thêm được vào nick Zalo, tức đọc được chat của khách.
    expect([...VAI_KHONG_THEM_DUOC_VAO_NICK].sort()).toEqual([...RELATIONSHIP_ROLE_CODES].sort());
  });

  it("tập MẶC ĐỊNH và tập KHÔNG-THÊM-ĐƯỢC là hai khái niệm rời nhau", () => {
    // Đối chứng cho ca trên: nếu ai đó "dọn" bằng cách cho `VAI_DUOC_CAP_NICK` gánh cả
    // hai việc thì giao dịch này đỏ.
    for (const v of VAI_KHONG_THEM_DUOC_VAO_NICK) {
      expect(VAI_DUOC_CAP_NICK, `${v} không bao giờ được dùng nick`).not.toContain(v);
    }
    // Và tập mặc định phải còn HẸP — đây là danh sách quyết định "ai đọc được nick CHƯA
    // giao". Nới nó là nới quyền mà không ai bấm nút nào.
    expect([...VAI_DUOC_CAP_NICK].sort()).toEqual([
      "CENTER_MANAGER",
      "CENTER_SALES_CSM",
      "SALES_CSM",
    ]);
  });
});
