// @vitest-environment node
/** [ONL-RBAC-*] Quyền `onl:*` của E-learning Online: registry · matrix v1 · RoleDef v2 · tách khỏi `elearning:*` của Nội bộ. */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { ALL_ACTIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { elearningOnlineModule } from "@/lib/permissions/registry/elearning-online";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEYS = elearningOnlineModule.permissions.map((p) => p.key);
const v2 = (code: string) => new Set((ROLE_SEED.find((r) => r.code === code)?.perms ?? []).map((p) => p.action));
const onl = (code: string) => KEYS.filter((k) => v2(code).has(k));

/** Bảng ĐÚNG: vai v2 → các key `onl:` được giữ. Sửa bảng này là một quyết định phân quyền, không phải chỉnh test. */
const BANG: Record<string, string[]> = {
  TRAINING: KEYS,
  HO_MARKETING: ["onl:course:view", "onl:report:view"],
  HO_ACCOUNTANT: ["onl:report:view"],
};

describe("[ONL-RBAC-01] registry", () => {
  it("11 key, prefix `onl:` đúng 3 đoạn, `action` là đoạn cuối, vào được collectDescriptors không trùng", () => {
    expect(KEYS).toHaveLength(11);
    expect(new Set(KEYS).size).toBe(11);
    for (const p of elearningOnlineModule.permissions) {
      expect(p.key.startsWith("onl:"), p.key).toBe(true);
      expect(p.key.split(":")).toHaveLength(3);
      expect(p.action).toBe(p.key.split(":").at(-1));
    }
    const all = collectDescriptors(ALL_MODULE_DECLS);
    for (const k of KEYS) expect(all.has(k), k).toBe(true);
  });

  it("🔴 mọi key có trong ALL_ACTIONS (key thiếu ⇒ grant bị vứt im lặng) và có dòng v1", () => {
    for (const k of KEYS) {
      expect(ALL_ACTIONS.includes(k as never), k).toBe(true);
      expect(PERMISSIONS[k as keyof typeof PERMISSIONS], k).toBeDefined();
    }
  });
});

describe("[ONL-RBAC-02] vai nào được gì (v2 = nguồn enforce prod)", () => {
  it.each(Object.keys(BANG))("%s giữ ĐÚNG tập key (đối chứng dương) ", (code) => {
    expect(onl(code).sort()).toEqual([...BANG[code]!].sort());
  });

  it("SUPER_ADMIN giữ đủ 11 key (khai tường minh để ma trận đọc được)", () => {
    expect(onl("SUPER_ADMIN").sort()).toEqual([...KEYS].sort());
  });

  it("🔴 Marketing CHỈ ĐỌC: xem khoá + báo cáo tổng hợp; KHÔNG sửa/phát hành/xem học viên/PII/cấp/thu hồi", () => {
    const co = new Set(onl("HO_MARKETING"));
    expect(co.has("onl:course:view")).toBe(true); // đối chứng dương
    for (const k of ["onl:course:manage", "onl:course:release", "onl:student:view", "onl:student:pii", "onl:student:grant", "onl:student:revoke", "onl:assessment:manage", "onl:assessment:grade", "onl:certificate:issue"]) {
      expect(co.has(k), k).toBe(false);
    }
  });

  it("🔴 vai nội bộ / cơ sở / giáo viên / CSKH / phụ huynh KHÔNG có key `onl:*` nào — quyền Nội bộ không mặc nhiên mở Online", () => {
    for (const code of ["CENTER_MANAGER", "CENTER_HR", "HO_HR", "TEACHER", "ASSISTANT_TEACHER", "CENTER_SALES_CSM", "HO_SALE", "CENTER_ACCOUNTANT", "CENTER_CLASS_MANAGER", "AUDITOR", "GIAM_DOC", "PARENT"]) {
      expect(ROLE_SEED.some((r) => r.code === code), `${code} phải tồn tại trong seed (đối chứng)`).toBe(true);
      expect(onl(code), code).toEqual([]);
    }
  });

  it("🔴 vai giữ `elearning:content:author` (Nội bộ) mà KHÔNG được liệt kê ở bảng trên thì không có `onl:course:manage`", () => {
    for (const r of ROLE_SEED) {
      if (r.code === "SUPER_ADMIN" || r.code === "TRAINING") continue;
      expect(v2(r.code).has("onl:course:manage"), r.code).toBe(false);
    }
  });
});

describe("[ONL-RBAC-03] matrix v1 (chạy ở local/dev) khớp v2", () => {
  it("v1 và v2 giữ cùng tập vai cho từng key (ánh xạ MARKETING→HO_MARKETING, ACCOUNTANT→HO_ACCOUNTANT)", () => {
    const map: Record<string, string> = { TRAINING: "TRAINING", MARKETING: "HO_MARKETING", ACCOUNTANT: "HO_ACCOUNTANT" };
    for (const k of KEYS) {
      const v1 = PERMISSIONS[k as keyof typeof PERMISSIONS].filter((r) => r !== "SUPER_ADMIN").map((r) => map[r] ?? `?${r}`).sort();
      const v2roles = ["TRAINING", "HO_MARKETING", "HO_ACCOUNTANT"].filter((c) => v2(c).has(k)).sort();
      expect(v1, k).toEqual(v2roles);
    }
  });

  it("v1 không có PARENT nào ở key `onl:*`", () => {
    for (const k of KEYS) expect(PERMISSIONS[k as keyof typeof PERMISSIONS].includes("PARENT" as never), k).toBe(false);
  });
});

describe("[ONL-RBAC-04] bề mặt mã nguồn — key `onl:` chỉ khai ở các tệp được phép", () => {
  it("🔴 ngoài registry · index · permissions.ts · seed-roles · tệp test, không tệp nào khai chuỗi `\"onl:`… làm KEY (chỉ dùng qua hằng/typed)", () => {
    // Cho phép: nơi khai (4 tệp) + test + nơi GỌI (can/assertCan/defineAction permission). Nơi gọi không khai key mới — test dưới bắt key LẠ.
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-hoE", '"onl:[a-z-]+:[a-z-]+"', "--", "lib", "app", "prisma"], { encoding: "utf8" });
    } catch (e) {
      const err = e as { status?: number };
      if (err.status !== 1) throw e;
    }
    const dung = new Set(out.split("\n").filter(Boolean).map((s) => s.replace(/"/g, "")));
    const la = [...dung].filter((k) => !KEYS.includes(k));
    expect(la, "key `onl:` chưa khai trong registry").toEqual([]);
  });
});
