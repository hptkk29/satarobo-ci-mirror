/**
 * BẤT BIẾN QUYỀN CỦA MODULE ZALOCRM (S6) — canh những lần QUÊN, không canh "mã chạy không".
 *
 * Quyền chạy HAI TẦNG song song và cả hai đều phải khai bằng tay:
 *   • v1 — ma trận TĨNH `PERMISSIONS` (`lib/auth/permissions.ts`). Đây là thứ chạy ở
 *     local/dev/CI (cờ `RBAC_V2_ENABLED` mặc định OFF trong code).
 *   • v2 — dữ liệu ĐỘNG `RoleDef`/`RolePermission` seed từ `prisma/seed-roles.ts`.
 *     Đây là thứ ĐANG ENFORCE trên prod.
 * Quên tầng nào cũng hỏng CÂM ở đúng một môi trường mà môi trường kia vẫn xanh —
 * dạng "chạy máy tôi thì được", không tái hiện nổi.
 *
 * Nhóm quan trọng nhất ở đây là [ZC-Q-02] (scope GLOBAL). Xem chú thích của nó để
 * biết vì sao bản kế hoạch ghi "CENTER" là SAI.
 */
import { describe, it, expect } from "vitest";
import { ALL_ACTIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { ACTION_REGISTRY } from "@/lib/auth/action-registry";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../../prisma/seed-roles";

/** Quyền duy nhất của module: mở màn ZaloCRM nhúng và nhắn khách qua nick Zalo cá nhân. */
const KEY = "zalocrm:use";

/** action -> danh sách RoleDef (v2) đang giữ nó. */
const vaiV2Giu = (action: string) =>
  ROLE_SEED.filter((r) => r.perms.some((p) => p.action === action)).map((r) => r.code);

describe("ZaloCRM · quyền — khai đủ hai tầng (v1 tĩnh + v2 động)", () => {
  it("[ZC-Q-01] ALL_ACTIONS và ACTION_REGISTRY đều chứa zalocrm:use", () => {
    // `ALL_ACTIONS = Object.keys(PERMISSIONS)` và `buildActor()` LỌC mọi
    // `UserPermissionGrant` theo đúng tập đó (`lib/auth/actor.ts`). Không khai ở v1 thì
    // grant mang key này bị VỨT IM LẶNG — không lỗi, không cảnh báo, không log.
    expect(ALL_ACTIONS).toContain(KEY);
    expect(ACTION_REGISTRY).toContain(KEY);
  });

  it("[ZC-Q-02] mọi perm zalocrm:* trong ROLE_SEED có scopeType === 'GLOBAL'", () => {
    // 🔴 ĐẢO KẾ HOẠCH: §5 S6 ghi "seed scope CENTER". SAI, và sai theo kiểu chỉ vỡ trên prod.
    // `lib/auth/can.ts` nhánh `case "CENTER"` mở đầu bằng `if (!target?.centerId) return false`
    // (nhánh cutover cũng vậy với `orgUnitId`). Cổng trang `/zalo-crm` gọi
    // `checkPermission("zalocrm:use")` TRẦN — không có target ⇒ CENTER luôn trả FALSE.
    // Hệ quả: trên PROD (RBAC v2 đang bật) mọi vai trừ SUPER_ADMIN bị đá khỏi trang,
    // trong khi LOCAL (v1 tĩnh, không có khái niệm scope) vẫn xanh nên không ai phát hiện.
    // Cách ly cơ sở KHÔNG đến từ `scopeType` mà từ `scopedDb` / `where` theo `orgUnitId`.
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms
        .filter((p) => p.action.startsWith("zalocrm:"))
        .filter((p) => p.scopeType !== "GLOBAL")
        .map((p) => `${r.code} · ${p.action}[${p.scopeType}]`),
    );
    expect(viPham).toEqual([]);
  });

  it("[ZC-Q-03] ĐÚNG 3 vai: SUPER_ADMIN, CENTER_MANAGER, CENTER_SALES_CSM", () => {
    // Người trực ZaloCRM = Sale cơ sở; QLCS theo dõi/trực thay khi Sale vắng.
    // SUPER_ADMIN bắt buộc có ở v2 lẫn v1 (permissions.test.ts khoá cứng chiều v1).
    //
    // 🔴 Giáo vụ (`CENTER_CLASS_MANAGER`) ĐÃ BỊ GỠ 13/09/2026, đảo quyết định 06/09.
    // Lý do không phải "dọn cho gọn": vai đó từng được ánh xạ sang `admin` bên fork, mà
    // `admin` ở đó BỎ QUA toàn bộ ma trận quyền (`settings` chứa khoá Public API,
    // `permission_group`, `user`, `zalo_account`, `audit_log`).
    //
    // Chốt CỨNG cả tập chứ không chỉ `toContain`: `toContain` không bắt được vai THỪA,
    // mà thừa mới là hướng nguy hiểm ở đây.
    const giu = [...vaiV2Giu(KEY)].sort();
    expect(giu).toEqual(["CENTER_MANAGER", "CENTER_SALES_CSM", "SUPER_ADMIN"]);
  });

  it("[ZC-Q-04] vai KHÔNG có: HO_SALE, TEACHER, CENTER_ACCOUNTANT, HO_HR, PARENT, AUDITOR", () => {
    // HO_SALE bị loại theo chốt 9.7 (Hội sở không dùng ZaloCRM — nick Zalo cá nhân
    // thuộc về người trực tại cơ sở). Các vai còn lại không trực khách.
    // ⚠️ Muốn chặn ai thì KHÔNG cấp / gỡ `UserOrgRole` — `can()` v2 không có nhánh DENY,
    // grant DENY bị bỏ qua im lặng.
    const KHONG = ["HO_SALE", "TEACHER", "CENTER_ACCOUNTANT", "HO_HR", "PARENT", "AUDITOR"];
    const giu = vaiV2Giu(KEY);
    for (const vai of KHONG) expect(giu, `vai ${vai} không được cấp`).not.toContain(vai);
  });

  it("[ZC-Q-05] descriptor registry có zalocrm:use với action === 'use'", () => {
    // `registry.test.ts` parity 2 chiều: khai v1 mà quên registry → đỏ; ngược lại cũng đỏ.
    // Và `row.action` phải bằng đúng phần sau dấu ":" của key.
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    const row = descriptors.get(KEY);
    expect(row, "chưa khai zalocrm:use trong lib/permissions/registry/**").toBeDefined();
    expect(row?.action).toBe("use");
    expect(row?.module.length ?? 0).toBeGreaterThan(0);
  });

  it("[ZC-Q-06] ma trận v1 = SUPER_ADMIN + CENTER_MANAGER + SALES_CSM (đúng 3 vai)", () => {
    // Từ 13/09/2026 hai tầng KHỚP NHAU: ba vai v1 ở đây ứng đúng ba RoleDef v2 ở
    // [ZC-Q-03]. Trước đó v2 có thêm Giáo vụ và v1 không biểu diễn được vai ấy, nên
    // local và prod cho kết quả khác nhau — nay hết lệch.
    const v1 = PERMISSIONS[KEY as (typeof ALL_ACTIONS)[number]];
    expect([...v1].sort()).toEqual(["CENTER_MANAGER", "SALES_CSM", "SUPER_ADMIN"]);
  });

  it("[ZC-Q-07] parity v1↔v2 cho SALES_CSM: cấp v1 thì CENTER_SALES_CSM phải có ở v2", () => {
    // `rbac-parity.test.ts` ép SALES_CSM parity TUYỆT ĐỐI (lost = []). Ghim lại ở đây để
    // khi ai đó sửa một trong hai tầng thì lỗi hiện ngay trong bộ test của module này,
    // kèm lời giải thích, thay vì đỏ ở một file quyền chung không nhắc gì tới ZaloCRM.
    const coV1 = (PERMISSIONS[KEY as (typeof ALL_ACTIONS)[number]] as readonly string[]).includes(
      "SALES_CSM",
    );
    const coV2 = vaiV2Giu(KEY).includes("CENTER_SALES_CSM");
    expect({ coV1, coV2 }).toEqual({ coV1: true, coV2: true });
  });
});
