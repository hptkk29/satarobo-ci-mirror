/**
 * Bất biến "MENU NÓI THẬT": với mọi mục sidebar có `perm` và trang có cổng
 * `if (...) redirect(...)`, tập action ở menu phải BẰNG tập action ở cổng.
 *
 * Hai chiều lệch, hai loại lỗi — smoke prod 10/07 gặp đủ cả hai:
 *   menu ⊄ gate  → DEAD LINK: bấm menu là văng /dashboard (Marketing × /site-content).
 *   gate ⊄ menu  → HỞ QUYỀN THEO URL: gõ URL là vào dù menu giấu (Kế toán đọc học bạ).
 *
 * Test này quét TĨNH sidebar.tsx + page.tsx nên bắt được cả route mới thêm sau này.
 * Muốn lệch có chủ đích → khai vào GATE_MISMATCH_ALLOWLIST kèm lý do trong page-gates.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Role } from "@prisma/client";
import { PAGE_GATES, GATE_MISMATCH_ALLOWLIST } from "@/lib/auth/page-gates";
import { PERMISSIONS, can as canV1, type Action } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const ROOT = process.cwd();
const SIDEBAR = path.join(ROOT, "components/admin/sidebar.tsx");
/**
 * Route trong `PAGE_GATES` KHÔNG nằm ở `app/(admin)/admin/*`.
 *
 * Hiện RỖNG: ngoại lệ duy nhất từng có — biểu mẫu nhập khách ở host public
 * (`app/(intake)/`, 22/08/2026) — đã dời về admin ngày 23/08, nên bảng gate lại
 * đúng một luật "mọi màn có gate đều ở route group admin".
 *
 * Thêm ngoại lệ mới thì thêm một dòng ở đây, đừng nới `pageFile` thành "tìm khắp
 * app/" — quét mù sẽ nuốt luôn ca trang bị xoá mà gate còn nằm lại trong bảng.
 */
const PAGE_DIR_OVERRIDE: Record<string, string> = {
  // Site Sale nằm ở route group riêng `app/(sale)/`, không phải `(admin)`.
  // Khai tường minh từng route thay vì nới `pageFile` thành "tìm khắp app/":
  // quét mù sẽ nuốt luôn ca trang bị xoá mà gate còn nằm lại trong bảng.
  "/sale/trial": "app/(sale)",
  "/sale/khach-cua-toi": "app/(sale)",
  "/sale/tra-cuu": "app/(sale)",
  "/sale/hop-thu": "app/(sale)",

  "/sale/nhap-khach-hang": "app/(sale)",
};

/**
 * Route mà trang của nó là ROUTE ĐỘNG, nên không có `<href>/page.tsx`.
 * Vd `/sale/chot-don` → `app/(sale)/sale/chot-don/[leadId]/page.tsx`: đơn luôn
 * gắn với MỘT khách cụ thể nên không tồn tại trang "chốt đơn" trần.
 *
 * Khai ĐƯỜNG DẪN ĐẦY ĐỦ thay vì nới `pageFile` thành "tìm khắp app/" — quét mù
 * sẽ nuốt luôn ca trang bị xoá mà gate còn nằm lại trong bảng, tức mất đúng cái
 * mà test này sinh ra để bắt.
 */
const PAGE_FILE_OVERRIDE: Record<string, string> = {
  "/sale/chot-don": "app/(sale)/sale/chot-don/[leadId]/page.tsx",
};

const pageFile = (href: string) =>
  PAGE_FILE_OVERRIDE[href]
    ? path.join(ROOT, PAGE_FILE_OVERRIDE[href])
    : path.join(ROOT, PAGE_DIR_OVERRIDE[href] ?? "app/(admin)/admin", href, "page.tsx");

/** Bỏ comment để chuỗi trong `// ...` không bị đếm là action thật. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type MenuItem = { label: string; href: string; perms: string[] };

/** Đọc mục sidebar: dạng `perm: [...PAGE_GATES["/x"]]` và dạng mảng chuỗi thường. */
function readSidebar(): MenuItem[] {
  const src = stripComments(fs.readFileSync(SIDEBAR, "utf8"));
  const out: MenuItem[] = [];
  const viaGates = /label:\s*"([^"]+)"[^}]*?href:\s*"([^"]+)"[^}]*?perm:\s*\[\s*\.\.\.PAGE_GATES\[\s*"([^"]+)"\s*\]\s*\]/g;
  for (const m of src.matchAll(viaGates)) {
    const gate = PAGE_GATES[m[3] as keyof typeof PAGE_GATES];
    expect(gate, `sidebar trỏ PAGE_GATES["${m[3]}"] nhưng bảng không có route đó`).toBeDefined();
    out.push({ label: m[1], href: m[2], perms: [...gate] });
  }
  const literal = /label:\s*"([^"]+)"[^}]*?href:\s*"([^"]+)"[^}]*?perm:\s*\[([^.\]][^\]]*)\]/g;
  for (const m of src.matchAll(literal)) {
    out.push({ label: m[1], href: m[2], perms: [...m[3].matchAll(/"([^"]+)"/g)].map((x) => x[1]) });
  }
  return out;
}

/** CHỈ lấy action nằm trong điều kiện của `if (...) redirect(...)` — bỏ qua các
 *  checkPermission tính cờ UI (canCreate/canEdit/canApprove...). */
function readGate(href: string): string[] | null {
  const f = pageFile(href);
  if (!fs.existsSync(f)) return null;
  const src = stripComments(fs.readFileSync(f, "utf8"));
  const out = new Set<string>();
  for (const m of src.matchAll(/if\s*\(([\s\S]{0,400}?)\)\s*\{?\s*redirect\(/g)) {
    const cond = m[1];
    for (const a of cond.matchAll(/check(?:Any)?Permission\(\s*["']([^"']+)["']/g)) out.add(a[1]);
    for (const g of cond.matchAll(/PAGE_GATES\[\s*["']([^"']+)["']\s*\]/g)) {
      for (const act of PAGE_GATES[g[1] as keyof typeof PAGE_GATES] ?? []) out.add(act);
    }
  }
  return out.size > 0 ? [...out] : null;
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("PAGE_GATES — bảng gate là nguồn duy nhất", () => {
  it("mọi action trong bảng đều là Action hợp lệ của ma trận v1", () => {
    for (const [href, actions] of Object.entries(PAGE_GATES)) {
      for (const a of actions) {
        expect(PERMISSIONS, `${href}: action "${a}" không tồn tại trong PERMISSIONS`).toHaveProperty(a);
      }
    }
  });

  it("mỗi route trong bảng có page.tsx và page.tsx gác bằng chính PAGE_GATES[href]", () => {
    for (const href of Object.keys(PAGE_GATES)) {
      const f = pageFile(href);
      expect(fs.existsSync(f), `thiếu ${f}`).toBe(true);
      const src = stripComments(fs.readFileSync(f, "utf8"));
      expect(
        src.includes(`PAGE_GATES["${href}"]`) || src.includes(`PAGE_GATES['${href}']`),
        `${href}/page.tsx phải gác bằng PAGE_GATES["${href}"], không khai action rời`,
      ).toBe(true);
    }
  });

  it("không route nào vừa nằm trong bảng vừa nằm trong allowlist", () => {
    for (const href of GATE_MISMATCH_ALLOWLIST) {
      expect(Object.keys(PAGE_GATES)).not.toContain(href);
    }
  });

  /**
   * BẤT BIẾN CHỐNG "CHẠY MÁY TÔI THÌ ĐƯỢC" (thêm 09/08/2026).
   *
   * Gate cấp trang gọi `checkAnyPermission(PAGE_GATES[href])` **không có target**.
   * Dưới RBAC v2 (đang bật prod) `scopeMatches` đòi target với CENTER/ASSIGNED/CLASS/OWN
   * (lib/auth/can.ts:18,29) ⇒ action seed ở scope đó trả FALSE khi gọi trần: vai giữ
   * đúng quyền vẫn bị khoá ngoài cửa TRÊN PROD, còn máy dev (v1 tĩnh) vẫn xanh nên
   * không ai thấy. Đây chính là bẫy đã suýt dính khi định gác /tin-nhan bằng `chat:read`
   * (QLCS=CENTER, GV=ASSIGNED).
   *
   * Luật: action nào xuất hiện trong PAGE_GATES thì ở MỌI RoleDef giữ nó phải là GLOBAL
   * (cách ly cơ sở đã do scopedDb + kiểm CÓ target ở tầng action lo).
   */
  it("mọi action trong bảng phải là GLOBAL ở mọi RoleDef giữ nó (gate gọi KHÔNG target)", () => {
    const gateActions = new Set<string>(Object.values(PAGE_GATES).flat());
    const viPham: string[] = [];
    for (const role of ROLE_SEED) {
      for (const p of role.perms) {
        if (gateActions.has(p.action) && p.scopeType !== "GLOBAL") {
          viPham.push(`${role.code} · ${p.action} = ${p.scopeType}`);
        }
      }
    }
    expect(
      viPham,
      `Action dùng làm gate nhưng seed non-GLOBAL (gọi trần sẽ FALSE trên prod):\n  - ${viPham.join("\n  - ")}\n`,
    ).toEqual([]);
  });
});

/**
 * /tin-nhan — ai được vào màn chat của site admin.
 *
 * Hợp đồng: `docs/chat-realtime/permissions.md` cho Sale ❌ ở MỌI ô chat; TestScenarios
 * TS-01.6 đòi "sale1 gọi mọi endpoint chat → 403 toàn bộ". Trước 09/08/2026 gate là
 * `["parent-requests:manage", "classes:view-own"]`, mà `parent-requests:manage` là chìa
 * khoá CSKH của Sale (dùng cho /cham-soc-hv, /canh-bao-rui-ro — không gỡ khỏi Sale
 * được) ⇒ Sale mở được /tin-nhan (200, danh sách rỗng). Cửa mở trong khi hợp đồng nói
 * đóng, nên gate đổi sang `students:view-own-class`.
 *
 * Kiểm CẢ HAI tầng: v1 (chạy local/dev) và v2 (đang enforce prod) phải cho cùng câu
 * trả lời — lệch tầng chính là chỗ bug ẩn.
 */
describe("/tin-nhan — Sale bị chặn, QLCS/GV/Admin vẫn vào được", () => {
  const GATE = PAGE_GATES["/tin-nhan"];

  /** v1: vào được ⟺ có ≥1 action trong gate (đúng ngữ nghĩa checkAnyPermission). */
  const vaoDuocV1 = (role: Role) => GATE.some((a) => canV1(role, a as Action));

  /** v2 gọi TRẦN: chỉ perm GLOBAL mới ăn (SUPER_ADMIN bypass, xử lý riêng). */
  const vaoDuocV2 = (roleCode: string) => {
    const r = ROLE_SEED.find((x) => x.code === roleCode);
    if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${roleCode}`);
    if (roleCode === "SUPER_ADMIN") return true; // can() v2 bypass vai quản trị tối cao
    return r.perms.some(
      (p) => (GATE as readonly string[]).includes(p.action) && p.scopeType === "GLOBAL",
    );
  };

  /**
   * F5 (mở phạm vi 10/08/2026) ĐẢO ca này. Bản cũ pin "Sale KHÔNG vào được", viện dẫn
   * TS-01.6 ("sale gọi mọi endpoint chat → 403 toàn bộ") — đúng với phạm vi CŨ khi F5 đã
   * bị cắt khỏi P0. Nay Sale có kênh 1-1 với phụ huynh mình phụ trách nên PHẢI vào được
   * màn chat, nếu không thì mở hội thoại xong bị `redirect("/dashboard")`.
   *
   * Điều còn phải giữ nguyên và ca dưới đây canh: vào được TRANG không có nghĩa là đọc
   * được nhóm lớp. Phạm vi đọc là participant-based (`listConversationsForUser`), mà Sale
   * không bao giờ là thành viên nhóm lớp; và scope OWN của Sale không khớp target nhóm
   * lớp (pin ở lib/auth/chat-permissions.test.ts).
   */
  it("[F5] Sale VÀO ĐƯỢC /tin-nhan — cả v1 lẫn v2 (kênh 1-1 với PH mình phụ trách)", () => {
    expect(vaoDuocV1("SALES_CSM")).toBe(true);
    expect(vaoDuocV2("CENTER_SALES_CSM")).toBe(true);
  });

  it("QLCS / GV / Admin VẪN vào được — cả v1 lẫn v2 (không khoá nhầm cửa chính)", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"] as Role[]) {
      expect(vaoDuocV1(role), `v1: ${role} phải vào được /tin-nhan`).toBe(true);
    }
    for (const code of ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"]) {
      expect(vaoDuocV2(code), `v2: ${code} phải vào được /tin-nhan`).toBe(true);
    }
  });

  /**
   * Chốt 09/08/2026 — Giáo vụ vào nhóm lớp như QLCS ⇒ phải mở được CỬA màn chat.
   * CHỈ kiểm v2: `CENTER_CLASS_MANAGER` là RoleDef gán tay, enum `Role` (v1) không có nó
   * (lib/auth/legacy-role-map.ts) — nên không có vế v1 để so.
   * Đi kèm: vai này KHÔNG được lọt vào /hoc-ba (BGĐ 10/07 chốt Giáo vụ không xem học bạ)
   * — đó là lý do gate mượn `classes:view-own` chứ không mượn `students:view-own-class`.
   */
  it("[chốt 09/08] Giáo vụ (CENTER_CLASS_MANAGER) vào được /tin-nhan — nhưng KHÔNG lọt /hoc-ba", () => {
    expect(vaoDuocV2("CENTER_CLASS_MANAGER"), "v2: Giáo vụ phải vào được /tin-nhan").toBe(
      true,
    );
    const hocBa = PAGE_GATES["/hoc-ba"] as readonly string[];
    const giaoVu = ROLE_SEED.find((r) => r.code === "CENTER_CLASS_MANAGER")!;
    expect(
      giaoVu.perms.filter((p) => hocBa.includes(p.action)).map((p) => p.action),
      "Giáo vụ không được giữ action nào của gate /hoc-ba",
    ).toEqual([]);
  });

  it("vai ngoài ma trận chat (HR/Kế toán/Marketing/Đào tạo/PH) KHÔNG vào được", () => {
    for (const role of ["HR", "ACCOUNTANT", "MARKETING", "TRAINING", "PARENT"] as Role[]) {
      expect(vaoDuocV1(role), `v1: ${role} không được vào /tin-nhan`).toBe(false);
    }
    for (const code of ["TRAINING", "HO_SALE", "HO_HR", "HO_ACCOUNTANT", "HO_MARKETING", "PARENT"]) {
      expect(vaoDuocV2(code), `v2: ${code} không được vào /tin-nhan`).toBe(false);
    }
  });

  it("gate KHÔNG được dùng chat:* (scope CENTER/ASSIGNED → gọi trần FALSE trên prod)", () => {
    expect(GATE.filter((a) => a.startsWith("chat:"))).toEqual([]);
  });
});

describe("Bất biến menu ≡ gate (chống dead-link và hở-quyền-theo-URL)", () => {
  const items = readSidebar();

  it("đọc được sidebar (guard cho chính regex của test)", () => {
    expect(items.length).toBeGreaterThan(20);
    expect(items.some((i) => i.href === "/students")).toBe(true);
  });

  it("mọi mục menu có perm + trang có cổng ⇒ menu ≡ gate", () => {
    const lech: string[] = [];
    for (const it of items) {
      if (!it.perms.length || GATE_MISMATCH_ALLOWLIST.includes(it.href)) continue;
      const gate = readGate(it.href);
      if (!gate) continue; // trang không gác bằng permission (layout lo) — ngoài phạm vi
      if (JSON.stringify(sorted(it.perms)) !== JSON.stringify(sorted(gate))) {
        lech.push(`${it.href}\n     menu = [${sorted(it.perms)}]\n     gate = [${sorted(gate)}]`);
      }
    }
    expect(lech, `Route lệch menu↔gate:\n  - ${lech.join("\n  - ")}\n`).toEqual([]);
  });

  it("allowlist không chứa route đã hết lệch (dọn rác)", () => {
    for (const href of GATE_MISMATCH_ALLOWLIST) {
      const it = items.find((i) => i.href === href);
      if (!it) continue;
      const gate = readGate(href);
      if (!gate) continue;
      const equal = JSON.stringify(sorted(it.perms)) === JSON.stringify(sorted(gate));
      expect(equal, `${href} đã hết lệch → bỏ khỏi GATE_MISMATCH_ALLOWLIST`).toBe(false);
    }
  });
});
