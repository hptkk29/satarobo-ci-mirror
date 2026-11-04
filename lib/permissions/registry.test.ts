// TS-01 (US-01) — Registry chặn key trùng · AUTO-CI · viết TRƯỚC hiện thực (luật cứng #5).
//
// Mục tiêu: hai module không thể khai cùng một permission key; registry thật
// không trùng; và registry không được trôi so với ALL_ACTIONS của matrix v1
// (nguồn quyền đang enforce — zero-behavior-change ở P0).
import { describe, it, expect } from "vitest";
import { ALL_ACTIONS } from "@/lib/auth/permissions";
import {
  ALL_MODULE_DECLS,
  collectDescriptors,
  DuplicatePermissionKeyError,
} from "@/lib/permissions/registry";
import type { ModuleDecl } from "@/lib/permissions/registry/types";

describe("TS-01 · registry chặn key trùng", () => {
  it("hai module khai cùng một key → throw nêu rõ key + đúng 2 module xung đột", () => {
    const fakeDecls: ModuleDecl[] = [
      {
        module: "CLASS",
        permissions: [{ key: "class.session.update", action: "update" }],
      },
      {
        module: "SCHEDULE",
        permissions: [{ key: "class.session.update", action: "update" }],
      },
    ];

    expect(() => collectDescriptors(fakeDecls)).toThrowError(
      DuplicatePermissionKeyError,
    );
    try {
      collectDescriptors(fakeDecls);
      expect.unreachable("phải throw DuplicatePermissionKeyError");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("class.session.update");
      expect(message).toContain("CLASS");
      expect(message).toContain("SCHEDULE");
    }
  });

  it("registry thật (ALL_MODULE_DECLS) không có key trùng", () => {
    expect(() => collectDescriptors(ALL_MODULE_DECLS)).not.toThrow();
  });

  it("collectDescriptors là hàm pure — gọi 2 lần cho kết quả bằng nhau", () => {
    const first = collectDescriptors(ALL_MODULE_DECLS);
    const second = collectDescriptors(ALL_MODULE_DECLS);
    expect(second.size).toBe(first.size);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
  });
});

describe("TS-01 · chống trôi hai nguồn (registry ↔ ALL_ACTIONS v1)", () => {
  // Mọi key hiện tại của registry đều theo format v1 `resource:verb`.
  // Key format mới (dấu chấm, vd "iam.group.manage" về sau) được miễn assert (b) —
  // chúng thuộc module chưa có trong matrix v1.
  const V1_KEY_RE = /^[a-z0-9_-]+:[a-z0-9-]+$/;

  // Key KHAI TRƯỚC (AC4): tồn tại trên nhánh feat/chat-realtime nhưng chưa merge
  // vào base của nhánh này. Assert (c) tự dọn: chat merge xong là list này PHẢI rỗng.
  const PRE_DECLARED_V1_KEYS = new Set<string>([
    "chat:read",
    "chat:send",
    "chat:announce",
    "chat:moderate",
    "chat:admin",
  ]);

  it("(a) mọi action của matrix v1 đều có descriptor trong registry", () => {
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    const missing = ALL_ACTIONS.filter((action) => !descriptors.has(action));
    expect(missing).toEqual([]);
  });

  it("(b) mọi descriptor key dạng v1 `resource:verb` đều nằm trong ALL_ACTIONS", () => {
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    const v1Actions = new Set<string>(ALL_ACTIONS);
    const stray = [...descriptors.keys()].filter(
      (key) =>
        V1_KEY_RE.test(key) &&
        !v1Actions.has(key) &&
        !PRE_DECLARED_V1_KEYS.has(key),
    );
    expect(stray).toEqual([]);
  });

  it("(c) exception khai-trước tự VÔ HIỆU khi key vào ALL_ACTIONS + list chỉ chứa key có thật trong registry", () => {
    // KHÔNG ép rút entry bằng CI: CI chạy cả trên nhánh đơn (chưa có chat trong
    // ALL_ACTIONS) lẫn merge-commit PR vào test (ĐÃ có chat — test Đợt 0 merge 09/08)
    // — một assert "phải rỗng khi key vào ALL_ACTIONS" đỏ ở đúng cây merge (đã xảy
    // ra, CI run 31278080426). Cơ chế đúng: exemption trong (b) chỉ kích hoạt khi
    // key CHƯA có trong ALL_ACTIONS — key vào rồi thì (a)+(b) tự phủ như key thường.
    // Việc dọn list là vệ sinh của story hoà nhập sau khi nền merge, không phải gate.
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    // Vệ sinh không phụ thuộc thế giới: mọi key khai-trước PHẢI thực sự nằm trong
    // registry (chặn entry rác trỏ key không tồn tại).
    const ghost = [...PRE_DECLARED_V1_KEYS].filter((key) => !descriptors.has(key));
    expect(ghost).toEqual([]);
    // Và khi key ĐÃ vào ALL_ACTIONS (cây merge): parity (a) phải phủ nó qua registry.
    const v1Actions = new Set<string>(ALL_ACTIONS);
    for (const key of PRE_DECLARED_V1_KEYS) {
      if (v1Actions.has(key)) expect(descriptors.has(key)).toBe(true);
    }
  });

  it("mỗi descriptor mang module không rỗng và action khớp phần verb của key v1", () => {
    const descriptors = collectDescriptors(ALL_MODULE_DECLS);
    for (const row of descriptors.values()) {
      expect(row.module.length).toBeGreaterThan(0);
      if (V1_KEY_RE.test(row.key)) {
        expect(row.action).toBe(row.key.split(":")[1]);
      }
    }
  });
});
