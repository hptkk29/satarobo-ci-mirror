// TS-03 (US-02 AC5) — lint no-inline-authz 2 tầng, viết TRƯỚC config (luật Nền Hệ thống #5):
//   (a) no-restricted-syntax trong scope action (5 glob: app/**/_actions*.ts + actions.ts
//       + _*actions*.ts + _*-core.ts + _actions/**/*.ts — mở rộng 09/08 sau review đối kháng):
//       chặn hasRole()/isParentOnly()/getEffectiveRoles(), .roles.includes(...),
//       so sánh ===/!== có vế .role hoặc .centerId (TRỪ so với undefined/null — guard
//       partial-update/change-detection không phải kiểm quyền).
//   (b) authz/require-can-in-write-action (plugin local lib/eslint/require-can-in-write-action.mjs):
//       exported async function (kể cả `export { fn }` / `export default fn`) có lời gọi GHI
//       (.create(/.update(/...) — duyệt AST, comment không ảnh hưởng — mà thân không có
//       can(/assertCan(/checkPermission(/... → report tại tên function.
// Dùng ESLint Node API với filePath giả — theo mẫu db-restriction.test.ts.
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { INLINE_AUTHZ_ALLOWLIST } from "./inline-authz-allowlist.mjs";

const RULE_A = "no-restricted-syntax";
const RULE_B = "authz/require-can-in-write-action";

// DÙNG CHUNG 1 instance warm-up cho CẢ 2 rule (đừng cộng 30s CI mỗi rule).
const eslint = new ESLint();

// Instance riêng cho freshness: bật LẠI 2 rule trên file allowlist (severity-only
// giữ nguyên options của block gốc trong eslint.config.mjs; overrideConfig áp CUỐI
// nên thắng block off grandfather).
const eslintNoGrandfather = new ESLint(
  INLINE_AUTHZ_ALLOWLIST.length > 0
    ? {
        overrideConfig: [
          {
            files: [...INLINE_AUTHZ_ALLOWLIST],
            rules: { [RULE_A]: "error", [RULE_B]: "error" },
          },
        ],
      }
    : {},
);

async function lint(code: string, filePath: string) {
  const [res] = await eslint.lintText(code, { filePath });
  return res.messages.filter((m) => m.ruleId === RULE_A || m.ruleId === RULE_B);
}

// Glob char-class `[[]id[]]` → đường dẫn thật `[id]` (như db-allowlist-freshness.test.ts).
function unescapeGlob(entry: string): string {
  return entry.replace(/\[\[\]/g, "[").replace(/\[\]\]/g, "]");
}

const IN_SCOPE_UNDERSCORE = "app/(admin)/admin/__ts03_new__/_actions.ts";
const IN_SCOPE_PLAIN = "app/(portal)/portal/__ts03_new__/actions.ts";
// 3 dạng tên file action mà glob gốc bỏ sót (review đối kháng 09/08, finding 1) —
// pin để scope không co lại: _<gì đó>-actions.ts, _<gì đó>-core.ts, _actions/<file>.ts.
const IN_SCOPE_PREFIXED_ACTIONS = "app/(portal)/portal/__ts03_new__/_eval-actions.ts";
const IN_SCOPE_CORE = "app/(admin)/admin/__ts03_new__/_foo-core.ts";
const IN_SCOPE_ACTIONS_DIR = "app/(admin)/admin/_actions/__ts03_new__.ts";
const OUT_SCOPE_PAGE = "app/(admin)/admin/__ts03_new__/page.tsx";
const OUT_SCOPE_LIB = "lib/__ts03_new__/helper.ts";

// ── Fixture tầng (a) — mỗi pattern một đoạn code hợp lệ TS, không có lời gọi ghi ──
const CODE_HAS_ROLE = `declare function hasRole(u: unknown, r: string): boolean;
declare const user: unknown;
export async function guardA() {
  if (!hasRole(user, "HR")) throw new Error("x");
}
`;

const CODE_ROLES_INCLUDES = `declare const session: { user: { roles: string[] } };
export async function guardB() {
  if (!session.user.roles.includes("HR")) throw new Error("x");
}
`;

const CODE_ROLE_EQ = `declare const session: { user: { role: string } };
export async function guardC() {
  if (session.user.role !== "SUPER_ADMIN") throw new Error("x");
}
`;

const CODE_CENTER_EQ = `declare const a: { centerId: string | null };
declare const b: { centerId: string | null };
export async function guardD() {
  if (a.centerId !== b.centerId) throw new Error("x");
}
`;

// Finding 4 (09/08): so sánh với undefined/null là guard partial-update/change-detection,
// KHÔNG phải kiểm quyền → không được bắt (cả 2 chiều trái/phải).
const CODE_CENTER_VS_UNDEFINED = `declare const input: { centerId?: string };
export async function partialUpdateGuard() {
  if (input.centerId !== undefined) throw new Error("x");
  if (undefined === input.centerId) throw new Error("y");
}
`;

const CODE_CENTER_VS_NULL = `declare const input: { centerId: string | null };
export async function nullGuard() {
  if (input.centerId === null) throw new Error("x");
  if (null !== input.centerId) throw new Error("y");
}
`;

const CODE_ROLE_VS_UNDEFINED = `declare const patch: { role?: string };
export async function rolePatchGuard() {
  if (patch.role !== undefined) throw new Error("x");
}
`;

const CODE_ROLE_VS_LITERAL = `declare const user: { role: string };
export async function adminGate() {
  if (user.role === "ADMIN") throw new Error("x");
}
`;

// ── Fixture tầng (b) ──
const CODE_WRITE_NO_CAN = `declare const db: { thing: { update: (a: unknown) => Promise<unknown> } };
export async function saveThingAction(input: unknown) {
  await db.thing.update({ where: input });
}
`;

const CODE_WRITE_WITH_CHECK = `declare function checkPermission(k: string): Promise<void>;
declare const db: { thing: { update: (a: unknown) => Promise<unknown> } };
export async function saveThingAction(input: unknown) {
  await checkPermission("things:update");
  await db.thing.update({ where: input });
}
`;

const CODE_WRITE_ARROW_NO_CAN = `declare const db: { thing: { deleteMany: (a: unknown) => Promise<unknown> } };
export const wipeThingsAction = async () => {
  await db.thing.deleteMany({});
};
`;

// Finding 2 (09/08): dạng `export { fn }` (specifiers, declaration=null) từng lọt lưới.
const CODE_WRITE_EXPORT_SPECIFIER = `declare const db: { x: { deleteMany: (a: unknown) => Promise<unknown> } };
async function wipeAction() {
  await db.x.deleteMany({});
}
export { wipeAction };
`;

const CODE_WRITE_EXPORT_DEFAULT_IDENT = `declare const db: { x: { update: (a: unknown) => Promise<unknown> } };
const saveAction = async (input: unknown) => {
  await db.x.update({ where: input });
};
export default saveAction;
`;

// Finding 3 (09/08): comment chứa "can (" từng TẮT rule im lặng (text-match trên body
// gồm comment). Sau vá: duyệt AST CallExpression — comment không ảnh hưởng.
const CODE_WRITE_COMMENT_CAN = `declare const db: { x: { update: (a: unknown) => Promise<unknown> } };
export async function saveWithCommentAction(input: unknown) {
  // here we can (safely) update
  await db.x.update({ where: input });
}
`;

// Giới hạn biết trước GIỮ CHỦ ĐÍCH (header rule ghi rõ): mọi member call .delete(...)
// tính là GHI kể cả không phải Prisma (map.delete) — ưu tiên giảm false-negative;
// escape hatch = eslint-disable-next-line kèm lý do.
const CODE_MAP_DELETE = `declare const cache: Map<string, number>;
export async function evictAction(key: string) {
  cache.delete(key);
}
`;

// ── Fixture wrapper cục bộ MỘT CẤP (trả nợ NỢ 3, 09/08) ──
// Wrapper FunctionDeclaration cùng file có gọi check → action đi qua nó KHÔNG bị report.
const CODE_WRITE_LOCAL_WRAPPER_FN = `declare function checkPermission(k: string): Promise<void>;
declare const db: { x: { update: (a: unknown) => Promise<unknown> } };
async function ensurePermission() {
  await checkPermission("things:update");
}
export async function saveViaWrapperAction(input: unknown) {
  await ensurePermission();
  await db.x.update({ where: input });
}
`;

// Wrapper dạng VariableDeclarator arrow ở module scope — cũng được nhận.
const CODE_WRITE_LOCAL_WRAPPER_ARROW = `declare function assertPermission(k: string): Promise<void>;
declare const db: { x: { deleteMany: (a: unknown) => Promise<unknown> } };
const guardWipe = async () => {
  await assertPermission("things:delete");
};
export async function wipeViaArrowWrapperAction() {
  await guardWipe();
  await db.x.deleteMany({});
}
`;

// Wrapper cục bộ nhưng thân KHÔNG có call check nào → action vẫn bị report.
const CODE_WRITE_LOCAL_WRAPPER_NO_CHECK = `declare const db: { x: { update: (a: unknown) => Promise<unknown> } };
async function ensureSession() {
  if (!globalThis) throw new Error("chưa đăng nhập");
}
export async function saveNoCheckWrapperAction(input: unknown) {
  await ensureSession();
  await db.x.update({ where: input });
}
`;

// Giới hạn ghi nhận CHỦ ĐÍCH: wrapper import từ file khác nằm ngoài tầm AST 1 file
// → vẫn report (dù wrapper thật có thể kiểm quyền). Escape hatch = gọi check trực tiếp
// trong thân, hoặc eslint-disable kèm lý do.
const CODE_WRITE_IMPORTED_WRAPPER = `import { ensurePermission } from "./guards";
declare const db: { x: { update: (a: unknown) => Promise<unknown> } };
export async function saveViaImportedWrapperAction(input: unknown) {
  await ensurePermission();
  await db.x.update({ where: input });
}
`;

// Lần lintText đầu nạp cả config + typescript-eslint (~30s). Warm-up trước.
beforeAll(async () => {
  await lint("export {};\n", "lib/__warmup__.ts");
}, 90_000);

describe("[TS-03/a] no-restricted-syntax chặn kiểm quyền inline trong action files", () => {
  it("hasRole(...) trong _actions.ts → lỗi, message trỏ về can()", { timeout: 60_000 }, async () => {
    const msgs = await lint(CODE_HAS_ROLE, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].ruleId).toBe(RULE_A);
    expect(msgs[0].message).toContain("can(");
  });

  it(".roles.includes(...) trong actions.ts → lỗi", async () => {
    const msgs = await lint(CODE_ROLES_INCLUDES, IN_SCOPE_PLAIN);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].ruleId).toBe(RULE_A);
  });

  it("so sánh .role !== ... → lỗi", async () => {
    const msgs = await lint(CODE_ROLE_EQ, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].ruleId).toBe(RULE_A);
    expect(msgs[0].message).toContain("can(");
  });

  it("so sánh .centerId !== ... → lỗi (escape hatch trong message)", async () => {
    const msgs = await lint(CODE_CENTER_EQ, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].ruleId).toBe(RULE_A);
    expect(msgs[0].message).toContain("eslint-disable-next-line");
  });

  it("so sánh .centerId với undefined (2 chiều) = guard partial-update → KHÔNG bắt (finding 4)", async () => {
    const msgs = await lint(CODE_CENTER_VS_UNDEFINED, IN_SCOPE_UNDERSCORE);
    expect(msgs).toEqual([]);
  });

  it("so sánh .centerId với null (2 chiều) = change-detection → KHÔNG bắt (finding 4)", async () => {
    const msgs = await lint(CODE_CENTER_VS_NULL, IN_SCOPE_UNDERSCORE);
    expect(msgs).toEqual([]);
  });

  it("so sánh .role với undefined → KHÔNG bắt (finding 4)", async () => {
    const msgs = await lint(CODE_ROLE_VS_UNDEFINED, IN_SCOPE_UNDERSCORE);
    expect(msgs).toEqual([]);
  });

  it('user.role === "ADMIN" (string literal) VẪN bị bắt sau khi nới undefined/null', async () => {
    const msgs = await lint(CODE_ROLE_VS_LITERAL, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].ruleId).toBe(RULE_A);
  });

  it("file NGOÀI scope (page.tsx / lib) KHÔNG bị chặn", async () => {
    const msgsPage = await lint(CODE_ROLE_EQ, OUT_SCOPE_PAGE);
    const msgsLib = await lint(CODE_WRITE_NO_CAN, OUT_SCOPE_LIB);
    expect(msgsPage).toEqual([]);
    expect(msgsLib).toEqual([]);
  });
});

describe("[TS-03] glob scope phủ đủ các dạng tên file action (finding 1)", () => {
  it("_<x>-actions.ts (vd _eval-actions.ts) VÀO scope — cả 2 tầng", async () => {
    const msgs = await lint(CODE_ROLE_EQ + CODE_WRITE_NO_CAN, IN_SCOPE_PREFIXED_ACTIONS);
    expect(msgs.some((m) => m.ruleId === RULE_A)).toBe(true);
    expect(msgs.some((m) => m.ruleId === RULE_B)).toBe(true);
  });

  it("_<x>-core.ts (logic thật của action tách file) VÀO scope", async () => {
    const msgs = await lint(CODE_WRITE_NO_CAN, IN_SCOPE_CORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });

  it("_actions/<file>.ts (action gom thư mục) VÀO scope", async () => {
    const msgs = await lint(CODE_WRITE_NO_CAN, IN_SCOPE_ACTIONS_DIR);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });
});

describe("[TS-03/b] require-can-in-write-action bắt action ghi thiếu can()", () => {
  it("exported async fn có .update( mà không có can/assertCan → lỗi tại TÊN function", async () => {
    const msgs = await lint(CODE_WRITE_NO_CAN, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
    // Report tại tên function (dòng 2 = `export async function saveThingAction`).
    expect(msgs[0].line).toBe(2);
    expect(msgs[0].message).toContain("can(");
  });

  it("action có checkPermission(...) trước khi ghi → KHÔNG lỗi", async () => {
    const msgs = await lint(CODE_WRITE_WITH_CHECK, IN_SCOPE_PLAIN);
    expect(msgs.filter((m) => m.ruleId === RULE_B)).toEqual([]);
  });

  it("export const arrow async có .deleteMany( thiếu can → lỗi", async () => {
    const msgs = await lint(CODE_WRITE_ARROW_NO_CAN, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });

  it("export { fn } (specifiers, declaration=null) → VẪN bị bắt (finding 2)", async () => {
    const msgs = await lint(CODE_WRITE_EXPORT_SPECIFIER, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
    // Report tại TÊN function (dòng 2 = `async function wipeAction`).
    expect(msgs[0].line).toBe(2);
    expect(msgs[0].message).toContain("wipeAction");
  });

  it("export default <identifier> → VẪN bị bắt (cùng lớp lỗ hổng finding 2)", async () => {
    const msgs = await lint(CODE_WRITE_EXPORT_DEFAULT_IDENT, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });

  it('comment "// here we can (safely) update" KHÔNG tắt được rule (finding 3 — AST, không text)', async () => {
    const msgs = await lint(CODE_WRITE_COMMENT_CAN, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });

  it("pin giới hạn biết trước: map.delete(key) vẫn tính là GHI (heuristic giữ chủ đích, xem header rule)", async () => {
    const msgs = await lint(CODE_MAP_DELETE, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });
});

describe("[TS-03/b] wrapper cục bộ MỘT CẤP cùng file (trả nợ NỢ 3)", () => {
  it("wrapper FunctionDeclaration có checkPermission → action đi qua wrapper KHÔNG lỗi", async () => {
    const msgs = await lint(CODE_WRITE_LOCAL_WRAPPER_FN, IN_SCOPE_UNDERSCORE);
    expect(msgs.filter((m) => m.ruleId === RULE_B)).toEqual([]);
  });

  it("wrapper const arrow module scope có assertPermission → KHÔNG lỗi", async () => {
    const msgs = await lint(CODE_WRITE_LOCAL_WRAPPER_ARROW, IN_SCOPE_UNDERSCORE);
    expect(msgs.filter((m) => m.ruleId === RULE_B)).toEqual([]);
  });

  it("wrapper cục bộ KHÔNG có call check trong thân → VẪN lỗi", async () => {
    const msgs = await lint(CODE_WRITE_LOCAL_WRAPPER_NO_CHECK, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
    expect(msgs[0].message).toContain("saveNoCheckWrapperAction");
  });

  it("wrapper IMPORT từ file khác → VẪN lỗi (giới hạn 1-file ghi nhận chủ đích)", async () => {
    const msgs = await lint(CODE_WRITE_IMPORTED_WRAPPER, IN_SCOPE_UNDERSCORE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].ruleId).toBe(RULE_B);
  });
});

describe("[TS-03] allowlist grandfather", () => {
  it("file trong allowlist KHÔNG bị 2 rule chặn (block off đặt CUỐI config)", async () => {
    expect(INLINE_AUTHZ_ALLOWLIST.length).toBeGreaterThan(0);
    const entry = INLINE_AUTHZ_ALLOWLIST[0];
    const msgs = await lint(CODE_ROLE_EQ + CODE_WRITE_NO_CAN, unescapeGlob(entry));
    expect(msgs).toEqual([]);
  });

  it("allowlist không có entry trùng lặp", () => {
    const dupes = INLINE_AUTHZ_ALLOWLIST.filter(
      (e: string, i: number) => INLINE_AUTHZ_ALLOWLIST.indexOf(e) !== i,
    );
    expect(dupes).toEqual([]);
  });

  it(
    "freshness: entry allowlist phải CÒN vi phạm khi bật lại rule — file sạch rồi thì XOÁ entry",
    { timeout: 180_000 },
    async () => {
      const stale: string[] = [];
      for (const entry of INLINE_AUTHZ_ALLOWLIST) {
        const literal = unescapeGlob(entry);
        const abs = path.resolve(process.cwd(), literal);
        // HAI THẾ GIỚI (bài học 09/08, lần 2): CI chạy cả trên nhánh đơn LẪN merge-ref
        // với test — nhánh khác (chat Đợt 1) có thể XOÁ file nằm trong allowlist
        // (vd portal/tin-nhan/actions.ts bị thay bởi hệ chat mới). File không tồn tại
        // → entry vô hại với pnpm lint (glob không match gì) → BỎ QUA kèm cảnh báo,
        // việc xoá entry thuộc story hoà nhập. CHỈ fail khi file TỒN TẠI mà đã sạch.
        if (!fs.existsSync(abs)) {
          console.warn(
            `[inline-authz freshness] Entry trỏ file không tồn tại trên cây này (nhánh khác đã xoá?) — dọn ở story hoà nhập: ${entry}`,
          );
          continue;
        }
        const [res] = await eslintNoGrandfather.lintText(
          fs.readFileSync(abs, "utf8"),
          { filePath: literal },
        );
        const hits = res.messages.filter(
          (m) => m.ruleId === RULE_A || m.ruleId === RULE_B,
        );
        if (hits.length === 0) stale.push(entry);
      }
      expect(
        stale,
        `File đã sạch inline-authz — XOÁ entry khỏi INLINE_AUTHZ_ALLOWLIST: ${stale.join(", ")}`,
      ).toEqual([]);
    },
  );
});
