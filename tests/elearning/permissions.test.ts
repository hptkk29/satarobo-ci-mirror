// @vitest-environment node
/**
 * EL-02 · AC2 + AC3 + AC6 — MA TRẬN 15 VAI × 17 QUYỀN (255 ô) trên `ROLE_SEED`.
 *
 * Vì sao kiểm ở tầng seed chứ không tầng DB: `prisma/seed-roles.ts` LÀ nguồn của
 * bảng vai trên prod — workflow `seed-prod-roles.yml` ghi thẳng từ file này trong
 * MỘT `$transaction`. Sai ở đây là sai trên prod, và sai theo kiểu không ai thấy:
 * bảng quyền vẫn dựng được, người dùng chỉ "tự nhiên không bấm được nút".
 *
 * Bảng dưới chép nguyên từ EL-02 §3 (HỢP ĐỒNG V2 §Z1) và **không được đặt lại ở
 * đây**. Muốn đổi quyền thì đổi kế hoạch trước, rồi đổi cả hai nơi.
 *
 * ⚠️ Test này KHÔNG chạm DB nên nó không chứng minh prod đã được seed. Cổng đó là
 * DoD (a): chạy `seed-prod-roles.yml` TỪ `main` sau khi PR đã merge — ⛔ không bao
 * giờ từ nhánh feature, vì nhánh feature mang bản `seed-roles.ts` thiếu phần quyền
 * chưa merge của luồng khác, và seed ghi lại toàn bộ bảng vai trong một transaction
 * ⇒ quyền của luồng kia bị ghi đè im lặng.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_SEED } from "@/prisma/seed-roles";

const SA = "SUPER_ADMIN";
const HR = "HO_HR";
const TR = "TRAINING";
const CM = "CENTER_MANAGER";
const AUD = "AUDITOR";

/** 9 vai nhân viên còn lại — cột "STAFF9" của bảng §3. */
const STAFF9 = [
  "HO_ACCOUNTANT",
  "CENTER_HR",
  "HO_MARKETING",
  "HO_SALE",
  "CENTER_CLASS_MANAGER",
  "CENTER_SALES_CSM",
  "TEACHER",
  "ASSISTANT_TEACHER",
  "CENTER_ACCOUNTANT",
];

/** Bảng §3 — key → danh sách vai được phép. Không vai nào khác được có. */
const MATRIX: Record<string, string[]> = {
  "elearning:portal:access": [SA, HR, TR, CM, ...STAFF9, AUD],
  "elearning:lesson:learn": [SA, HR, TR, CM, ...STAFF9],
  "elearning:program:manage": [SA, HR, TR],
  "elearning:content:author": [SA, HR, TR],
  "elearning:content:publish": [SA, TR],
  "elearning:assignment:create": [SA, HR, TR, CM],
  "elearning:assignment:extend": [SA, HR, TR, CM],
  "elearning:requirement:manage": [SA, HR, TR],
  "elearning:progress:view-own": [SA, HR, TR, CM, ...STAFF9],
  "elearning:progress:view-team": [SA, HR, TR, CM, AUD],
  "elearning:progress:view-all": [SA, HR, TR, AUD],
  "elearning:video-analytics:view": [SA, HR, TR, CM, AUD],
  "elearning:exam:grade": [SA, HR, TR],
  "elearning:exam:unlock": [SA, HR, TR],
  "elearning:certificate:issue": [SA, HR],
  "elearning:certificate:revoke": [SA, HR],
  "elearning:report:export": [SA, HR, TR, CM, AUD],
};

const ALL_KEYS = Object.keys(MATRIX);
const ALL_ROLES = [SA, HR, TR, CM, ...STAFF9, AUD, "PARENT"];

function permsOf(code: string): string[] {
  const role = ROLE_SEED.find((r) => r.code === code);
  if (!role) throw new Error(`ROLE_SEED thiếu vai "${code}"`);
  return role.perms.map((p) => p.action);
}

describe("EL-02 · AC2. Danh mục vai sau seed", () => {
  it("ROLE_SEED có đúng 16 vai và không trùng code", () => {
    // 15 → 16: GIAM_DOC (25/09/2026; giữ khi gỡ Cổng dữ liệu agent 02/10/2026 — vai ban hành
    // Chính sách khuyến mãi). Ma trận EL-02 bên dưới vẫn chỉ duyệt 15 vai của bảng §3 — vai
    // mới được khoá riêng ở ca kế tiếp: nó KHÔNG được mang quyền e-learning nào.
    expect(ROLE_SEED).toHaveLength(16);
    expect(new Set(ROLE_SEED.map((r) => r.code)).size).toBe(16);
  });

  it("vai GIAM_DOC KHÔNG mang quyền e-learning nào", () => {
    expect(permsOf("GIAM_DOC").filter((a) => a.startsWith("elearning:"))).toEqual([]);
  });

  it("15 vai của bảng §3 đều tồn tại trong ROLE_SEED", () => {
    const codes = new Set(ROLE_SEED.map((r) => r.code));
    for (const code of ALL_ROLES) expect(codes.has(code), code).toBe(true);
  });

  it("mọi RolePermission prefix `elearning:` đều scopeType GLOBAL (17/17)", () => {
    // Không phải "quên siết scope": cách ly cơ sở của module này đến từ dữ liệu
    // lượt giao, không từ scopeType. Gán CENTER/OWN ở đây là khoá trang của vai
    // ngay khi call-site gọi trần `can("elearning:...")` không truyền target.
    const wrong: string[] = [];
    for (const role of ROLE_SEED) {
      for (const p of role.perms) {
        if (p.action.startsWith("elearning:") && p.scopeType !== "GLOBAL") {
          wrong.push(`${role.code}/${p.action}=${p.scopeType}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("EL-02 · T4-03. Ma trận 15 vai × 17 quyền = 255 ô", () => {
  const cells = ALL_ROLES.flatMap((role) =>
    ALL_KEYS.map((key) => [role, key, MATRIX[key].includes(role)] as const),
  );

  it("phủ đúng 255 ô", () => {
    expect(cells).toHaveLength(255);
  });

  it.each(cells)("%s × %s → %s", (role, key, allowed) => {
    expect(permsOf(role).includes(key)).toBe(allowed);
  });
});

describe("EL-02 · AC3 + vai Kiểm toán chỉ đọc", () => {
  it("AUDITOR có ĐÚNG 5 quyền e-learning và 0 quyền nào khác", () => {
    const perms = permsOf(AUD);
    expect(perms).toHaveLength(5);
    expect([...perms].sort()).toEqual(
      [
        "elearning:portal:access",
        "elearning:progress:view-team",
        "elearning:progress:view-all",
        "elearning:report:export",
        "elearning:video-analytics:view",
      ].sort(),
    );
  });

  it("AUDITOR không có quyền GHI nào — kể cả tạo lượt giao (AC3)", () => {
    const perms = permsOf(AUD);
    const WRITE_VERBS = [
      "manage",
      "author",
      "publish",
      "create",
      "extend",
      "grade",
      "unlock",
      "issue",
      "revoke",
    ];
    for (const verb of WRITE_VERBS) {
      const offending = perms.filter((p) => p.endsWith(`:${verb}`));
      expect(offending, `AUDITOR không được có verb "${verb}"`).toEqual([]);
    }
    expect(perms).not.toContain("elearning:assignment:create");
    expect(perms).toContain("elearning:progress:view-all");
  });

  it("AUDITOR KHÔNG có lesson:learn — vai kiểm toán không bị giao bài", () => {
    // Có key này là người mang vai (BGĐ) lọt vào tập người học của cỗ máy giao
    // bài, rồi nhận hạn chót và bị đếm là "trễ" trong báo cáo tuân thủ.
    expect(permsOf(AUD)).not.toContain("elearning:lesson:learn");
  });

  it("`elearning:audit:view` KHÔNG tồn tại ở bất kỳ vai nào", () => {
    // R8 (AuditLog) chỉ SUPER_ADMIN trong toàn cửa sổ GĐ0→GĐ5: AuditLog không nằm
    // trong SCOPED_MODELS ⇒ một key GLOBAL là mở nhật ký TOÀN HỆ, kể cả module
    // ngoài e-learning.
    for (const role of ROLE_SEED) {
      expect(permsOf(role.code)).not.toContain("elearning:audit:view");
    }
  });
});

describe("EL-02 · AC6. 13 vai nhân viên đều học được", () => {
  it("đúng 13 vai có `elearning:lesson:learn` (không kể AUDITOR và PARENT)", () => {
    const learners = ROLE_SEED.filter((r) =>
      permsOf(r.code).includes("elearning:lesson:learn"),
    ).map((r) => r.code);
    expect(learners).toHaveLength(13);
    expect(learners).not.toContain(AUD);
    expect(learners).not.toContain("PARENT");
  });
});

describe("EL-02 · AC5 / T10-08. Không một grant DENY nào", () => {
  it("PARENT giữ nguyên 0 quyền e-learning", () => {
    // QĐ-2: người học là nhân sự. Cách chặn phụ huynh là KHÔNG CẤP, không phải
    // cấp rồi DENY — `can()` v2 là ALLOW-wins thuần nên DENY bị bỏ qua im lặng.
    expect(permsOf("PARENT").filter((p) => p.startsWith("elearning:"))).toEqual(
      [],
    );
  });

  it("không vai nào khai TRÙNG một action (bắt khối bị dán hai lần)", () => {
    // Lỗi đã xảy ra khi viết ticket này: `HO_SALE` khai `perms` trên MỘT dòng nên
    // đoạn chèn tự động trượt xuống vai kế tiếp, dán khối STAFF9 lần thứ hai vào
    // `CENTER_MANAGER`. Ma trận 255 ô KHÔNG bắt được — `includes()` không phân biệt
    // một lần với hai lần, và `createMany({ skipDuplicates: true })` khiến DB cũng
    // trông bình thường. Chỉ chỗ này thấy.
    const dup: string[] = [];
    for (const role of ROLE_SEED) {
      const seen = new Set<string>();
      for (const p of role.perms) {
        if (seen.has(p.action)) dup.push(`${role.code}/${p.action}`);
        seen.add(p.action);
      }
    }
    expect(dup).toEqual([]);
  });

  it("seed không khai scopeType nào ngoài GLOBAL cho module này", () => {
    const scopes = new Set(
      ROLE_SEED.flatMap((r) =>
        r.perms.filter((p) => p.action.startsWith("elearning:")).map((p) => p.scopeType),
      ),
    );
    expect([...scopes]).toEqual(["GLOBAL"]);
  });
});

/**
 * ⚠️ GUARD NÀY SINH RA TỪ MỘT LỖI THẬT (EL-13).
 *
 * Một `ActionConfig` khai `permission: "elearning:report:view"` — một khoá KHÔNG
 * TỒN TẠI trong `ROLE_SEED`. Không có gì đỏ: typecheck xanh (kiểu là `string`),
 * lint xanh, build xanh. Hậu quả là `can()` luôn trả `false` cho action đó, và
 * tính năng im lặng không dùng được với MỌI vai — kể cả SUPER_ADMIN.
 *
 * Loại lỗi này chỉ lộ ra khi có người thật ngồi thử đúng màn đó, và câu họ báo sẽ
 * là "bấm không ăn gì".
 */
describe("mọi khoá quyền dùng trong code đều CÓ THẬT trong ROLE_SEED", () => {
  it("không action nào khai một quyền `elearning:` không tồn tại", () => {
    const coThat = new Set<string>();
    for (const vai of ROLE_SEED) {
      for (const q of vai.perms) coThat.add(q.action);
    }

    const goc = join(process.cwd(), "lib", "elearning");
    const dung = new Set<string>();
    for (const ten of readdirSync(goc)) {
      if (!ten.endsWith(".ts") || ten.endsWith(".test.ts")) continue;
      const src = readFileSync(join(goc, ten), "utf8");
      // Chỉ soi dòng KHAI quyền của action, không soi mọi chuỗi trong tệp: chú
      // thích có nhắc tên khoá cũ, và bắt cả chúng là báo động giả.
      for (const m of src.matchAll(/permission:\s*"(elearning:[^"]+)"/g)) {
        dung.add(m[1]!);
      }
    }

    expect(dung.size).toBeGreaterThan(0);
    const thieu = [...dung].filter((k) => !coThat.has(k));
    expect(thieu).toEqual([]);
  });
});
