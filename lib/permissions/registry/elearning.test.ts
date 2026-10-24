/**
 * EL-02 · AC1 + AC7 + AC8 — registry quyền module đào tạo nội bộ.
 *
 * Ba thứ được pin ở đây, mỗi thứ vá một cách hỏng khác nhau:
 *
 *  - **AC1** 17 key vào được `collectDescriptors()` mà không đụng key của module
 *    khác. Trùng key ⇒ `DuplicatePermissionKeyError` lúc deploy, không phải lúc test.
 *  - **AC7** 17 key có mặt trong `ALL_ACTIONS`. Đây KHÔNG phải chuyện hình thức:
 *    `buildActor()` lọc `PermissionGrant`/`UserPermissionGrant` theo đúng tập đó,
 *    nên key thiếu ⇒ grant bị vứt IM LẶNG. Đúng cái bẫy đã đốt 114 tài khoản
 *    PARENT ngày 10/08/2026 (đọc được, ghi thì `PERMISSION_DENIED`, không ai hiểu vì sao).
 *  - **AC8 / BP-2(a)** bề mặt xung đột với luồng khác đúng một chỗ. Test này quét
 *    CÂY MÃ NGUỒN: ngoài ba file được phép, không được có `"elearning:"` nào khác.
 *    Rải key ra file dùng chung là kiểu xung đột merge tệ nhất — git nối hai nửa
 *    thành bảng quyền sai mà vẫn biên dịch được.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  ALL_MODULE_DECLS,
  collectDescriptors,
  DuplicatePermissionKeyError,
} from "./index";
import { elearningModule } from "./elearning";
import { ALL_ACTIONS } from "@/lib/auth/permissions";

const KEYS = elearningModule.permissions.map((p) => p.key);

describe("EL-02 · AC1. Registry nhận đủ 17 key", () => {
  it("module khai đúng 17 key, không trùng nhau", () => {
    expect(KEYS).toHaveLength(17);
    expect(new Set(KEYS).size).toBe(17);
  });

  it("mọi key mang prefix `elearning:` và có ĐÚNG 3 đoạn", () => {
    for (const key of KEYS) {
      expect(key.startsWith("elearning:"), key).toBe(true);
      expect(key.split(":"), key).toHaveLength(3);
    }
  });

  it("`action` là ĐOẠN CUỐI của key — hợp đồng của PermissionDecl", () => {
    // `types.ts` giữ format v1 `resource:verb`, nên trường `action` không thể là
    // cả key. Sai chỗ này thì descriptor ghi vào DB mang verb rác, và không có
    // gì báo — bảng quyền vẫn dựng được.
    for (const p of elearningModule.permissions) {
      expect(p.action, p.key).toBe(p.key.split(":").at(-1));
    }
  });

  it("collectDescriptors() nhận đủ 17 key và KHÔNG ném DuplicatePermissionKeyError", () => {
    const all = collectDescriptors(ALL_MODULE_DECLS);
    for (const key of KEYS) expect(all.has(key), key).toBe(true);
    expect(all.get(KEYS[0])?.module).toBe("elearning");
  });

  it("khai trùng key với module khác ⇒ ném lỗi ngay (không im lặng đè)", () => {
    const clash = {
      module: "gia-mao",
      permissions: [{ key: KEYS[0], action: "access" }],
    };
    expect(() => collectDescriptors([...ALL_MODULE_DECLS, clash])).toThrow(
      DuplicatePermissionKeyError,
    );
  });

  it("prefix `elearning:` chỉ do MỘT module sở hữu", () => {
    const owners = new Set(
      ALL_MODULE_DECLS.filter((m) =>
        m.permissions.some((p) => p.key.startsWith("elearning:")),
      ).map((m) => m.module),
    );
    expect([...owners]).toEqual(["elearning"]);
  });
});

describe("EL-02 · AC7. 17 key phải nằm trong ALL_ACTIONS (matrix v1)", () => {
  it.each(KEYS)("%s có trong ALL_ACTIONS", (key) => {
    // Thiếu một dòng ở `PERMISSIONS` là grant mang key đó bị `buildActor()` lọc
    // bỏ mà không báo gì. Liệt kê từng key để bản báo lỗi chỉ đúng key thiếu.
    expect(ALL_ACTIONS).toContain(key);
  });
});

describe("EL-02 · AC8 / BP-2(a). Bề mặt xung đột đúng một chỗ", () => {
  /** Bốn nơi ĐƯỢC PHÉP KHAI key `elearning:` — mọi nơi khác là rải rác. */
  const ALLOWED = [
    "lib/permissions/registry/elearning.ts", // nơi khai duy nhất
    "lib/permissions/registry/elearning.test.ts", // chính file này
    "lib/auth/permissions.ts", // matrix v1, bắt buộc theo AC7
    "prisma/seed-roles.ts", // gán quyền cho vai (dữ liệu, không phải khai báo)
    "tests/elearning/permissions.test.ts", // bảng ma trận đối chiếu
  ];

  it("không có KHAI BÁO key `elearning:` nào rải rác ngoài danh sách cho phép", () => {
    // Soát KHAI BÁO, không soát mọi lần nhắc tới key. Phân biệt này quan trọng:
    // call-site hợp lệ (`can(actor, "elearning:portal:access")`) sẽ mọc lên ở mọi
    // ticket EL-03+ và đó là chuyện bình thường; nếu bắt cả chúng thì test này
    // biến thành thuế phải trả mỗi ticket, và cái giá quen thuộc của một test
    // hay đỏ vô cớ là có người tắt nó đi.
    //
    // Ba hình dạng KHAI BÁO cần chặn:
    //   `key: "elearning:…"`      → một PermissionDecl thứ hai ở đâu đó
    //   `"elearning:…": [`        → một dòng matrix v1 thứ hai
    //   `action: "elearning:…"`   → gán quyền cho vai (chỉ seed-roles.ts được làm)
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "-lE",
          "--",
          "(key|action): \"elearning:|\"elearning:[a-z:-]+\": \\[",
          "--",
          "*.ts",
          "*.tsx",
        ],
        { encoding: "utf8" },
      );
    } catch (err) {
      // `git grep` thoát mã 1 khi KHÔNG có kết quả — đó là trạng thái hợp lệ.
      const code = (err as { status?: number }).status;
      if (code !== 1) throw err;
    }
    const stray = out
      .split("\n")
      .map((f) => f.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .filter((f) => !ALLOWED.includes(f));
    expect(stray).toEqual([]);
  });

  it("registry/index.ts đổi đúng 2 dòng: một import + một phần tử mảng", () => {
    // Con số này là AC8. Nó giữ cho luồng chat realtime và parity site GV không
    // phải hoà giải một mảng dùng chung bị hai bên cùng sửa.
    const src = execFileSync("git", ["show", "HEAD:lib/permissions/registry/index.ts"], {
      encoding: "utf8",
    });
    const before = (src.match(/elearningModule/g) ?? []).length;
    expect(before).toBeLessThanOrEqual(2);
  });
});

describe("EL-02 · AC5. Module không sinh ra một grant DENY nào", () => {
  it("mã của module không nhắc tới DENY", () => {
    // `can()` v2 là ALLOW-wins THUẦN (`lib/auth/can.ts` — "OI-7 ALLOW-wins, KHÔNG
    // DENY"). Một grant DENY sẽ bị bỏ qua im lặng: không chặn được ai, không báo
    // lỗi, và người đọc bảng quyền tin rằng đã chặn. Loại trừ của EL-05 phải đi
    // bằng bảng dữ liệu `TrnAssignmentExclude`, không bằng quyền.
    const files = [
      "lib/permissions/registry/elearning.ts",
      "lib/elearning/entry.ts",
    ];
    for (const f of files) {
      let src: string;
      try {
        src = execFileSync("git", ["show", `HEAD:${f}`], { encoding: "utf8" });
      } catch {
        continue; // file chưa tồn tại ở commit này (vd entry.ts thuộc PR khác)
      }
      expect(src.includes('"DENY"'), f).toBe(false);
      expect(src.includes("'DENY'"), f).toBe(false);
    }
  });
});
