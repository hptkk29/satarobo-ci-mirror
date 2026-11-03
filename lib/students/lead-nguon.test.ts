// lib/students/lead-nguon.test.ts — LƯỚI GHIM MÃ NGUỒN cho cổng đọc lead từ phía học viên
// (25/09/2026). Mẫu "lưới ghim mã nguồn" của CLAUDE.md: luật cần khoá có dạng "lời gọi
// này phải đi qua cổng kia", thứ test thuần không chứng minh được vì nó nằm trong hàm chạm
// DB + next-auth.
//
// Luật được ghim (đo ở lib/db-scope.ts:4-5): `scopedDb` chỉ cách ly truy vấn TOP-LEVEL.
// Đọc lead xuyên `student → enrollments → leadChild → lead` là đọc được phiếu CƠ SỞ KHÁC
// mà không cổng nào kêu. Mã TRƯỚC khi có lưới này (dạng cần chặn) trông như:
//     db.student.findFirst({ select: { enrollments: { select: { leadChild: { select: {
//       lead: { select: { parentName: true, phone: true } } } } } } } })
// hoặc một `sdb.lead.findFirst(...)` trả thẳng ra mà không hỏi `canSeeLead`.
//
// Neo HẸP + đếm SỐ LẦN + bỏ chú thích trước (luật 11: chú thích giải thích bản vá hay chứa
// đúng chuỗi đang cấm — chính khối chú thích ngay trên là ví dụ).
//
// Kèm ở cuối: ca HÀNH VI cho cổng đường dẫn ảnh đại diện (`[AVT-*]`), dựng bằng mock.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { resolve } from "node:path";

/** Đọc mã nguồn, BỎ chú thích: dòng trước, khối sau (thứ tự này tránh `//…/*` mở khối giả). */
function nguon(duongDan: string): string {
  return fs
    .readFileSync(resolve(process.cwd(), duongDan), "utf8")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const DOC = "lib/students/lead-nguon.ts";
const ACTIONS = "app/(admin)/admin/students/[id]/_lien-ket-lead-actions.ts";
const KHOI_LEAD = "app/(admin)/admin/leads/[id]/_components/hoc-vien-tu-lead.tsx";

describe("[LNS-01] tầng đọc: phiếu trả ra phải qua canSeeLead", () => {
  it("canSeeLead( được GỌI (không chỉ import) — một chỗ, trong xemDuocLead", () => {
    const s = nguon(DOC);
    expect(dem(s, /\bcanSeeLead\(/g), "không thấy LỜI GỌI canSeeLead(").toBe(1);
    expect(s).toMatch(/function xemDuocLead\([^)]*\)[^{]*\{\s*return canSeeLead\(/);
  });

  it("đủ 5 cửa gác xemDuocLead( — mỗi đường trả phiếu một cửa", () => {
    // docLeadNguon · duocDoiLienKetCu · docGoiY (vòng `them`) · timLeadDeGan · hocVienCuaLead.
    // Gỡ một cửa là số này tụt; thêm đường đọc mới thì sửa số KÈM lý do.
    const s = nguon(DOC);
    const goi = dem(s, /\bxemDuocLead\(/g) - dem(s, /function xemDuocLead\(/g);
    expect(goi).toBe(5);
  });
});

describe("[LNS-02] tầng đọc: lead đọc TOP-LEVEL qua client đã cách ly", () => {
  it("đọc chi tiết phiếu bằng `.lead.findFirst(` trên sdb / scopedDb(...)", () => {
    const s = nguon(DOC);
    expect(dem(s, /\bsdb\.lead\.findFirst\(/g)).toBeGreaterThanOrEqual(2);
    expect(dem(s, /scopedDb\([^)]*\)\.lead\.findFirst\(/g)).toBeGreaterThanOrEqual(1);
  });

  it("KHÔNG kéo dữ liệu lead qua include/select LỒNG (leadChild → lead, hay `lead: { select|include`)", () => {
    const s = nguon(DOC);
    expect(s).not.toMatch(/leadChild:\s*\{[^}]*\blead:/);
    expect(dem(s, /\blead:\s*\{\s*(select|include)\b/g)).toBe(0);
  });

  it("`db` trần chạm Lead CHỈ để hỏi có/không (select đúng { id: true })", () => {
    const s = nguon(DOC);
    const tatCa = dem(s, /(?<![\w.])db\.lead\./g);
    const chiId = dem(
      s,
      /(?<![\w.])db\.lead\.findFirst\(\{\s*where:\s*\{[^}]*\},\s*select:\s*\{\s*id:\s*true\s*\},?\s*\}\)/g,
    );
    expect(tatCa).toBeGreaterThan(0);
    expect(chiId, "có lời gọi db.lead.* trả nhiều hơn id").toBe(tatCa);
  });

  it("module chỉ chạy phía server", () => {
    expect(nguon(DOC)).toMatch(/^import "server-only";$/m);
  });
});

describe("[LNS-03] action gắn/gỡ: cổng đứng trước phép ghi", () => {
  it("phiếu ĐÍCH qua cổng cách ly + canSeeLead trước khi gắn", () => {
    const s = nguon(ACTIONS);
    expect(dem(s, /\bsdb\.lead\.findFirst\(/g)).toBe(1);
    expect(dem(s, /\bcanSeeLead\(/g)).toBe(1);
    // Cổng đứng TRƯỚC transaction ghi.
    expect(s.indexOf("canSeeLead(")).toBeLessThan(s.indexOf("$transaction("));
  });

  it("phiếu CŨ: đổi/gỡ phải hỏi duocDoiLienKetCu (2 chỗ: gắn đè + gỡ)", () => {
    expect(dem(nguon(ACTIONS), /\bduocDoiLienKetCu\(/g)).toBe(2);
  });

  it("học viên qua passesScope('Student') — scopedDb không che đường ghi", () => {
    const s = nguon(ACTIONS);
    expect(s).toMatch(/passesScope\("Student",/);
    // Cả 3 action đều đi qua helper tầm nhìn.
    expect(dem(s, /\bhocVienTrongTamNhin\(/g) - dem(s, /function hocVienTrongTamNhin\(/g)).toBe(3);
  });

  it("⛔ không ghi Enrollment (leadChildId là tín hiệu 'đã chốt' của báo cáo chuyển đổi)", () => {
    for (const f of [ACTIONS, DOC]) {
      expect(nguon(f), f).not.toMatch(/\.enrollment\.(create|update|upsert|delete)\w*\(/);
    }
  });

  it("'use server' chỉ export hàm async", () => {
    const s = nguon(ACTIONS);
    expect(s).toMatch(/^"use server";/);
    const exports = s.match(/^export\s+(?!async function)\S+/gm) ?? [];
    expect(exports).toEqual([]);
  });
});

describe("[LNS-04] khối 'Đã thành học viên' trên trang lead đi qua hàm đã gác", () => {
  it("component lấy dữ liệu qua hocVienCuaLead, không tự truy vấn", () => {
    const s = nguon(KHOI_LEAD);
    expect(s).toMatch(/hocVienCuaLead\(/);
    expect(s).not.toMatch(/scopedDb|@\/lib\/db["']/);
  });

  it("trang lead gắn khối đó đúng MỘT lần", () => {
    expect(dem(nguon("app/(admin)/admin/leads/[id]/page.tsx"), /<DaThanhHocVien\b/g)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [AVT-*] Cổng đường dẫn ảnh đại diện — HÀNH VI, dựng action thật với mock.
// ─────────────────────────────────────────────────────────────────────────────
const m = vi.hoisted(() => ({
  update: vi.fn(),
  audit: vi.fn(),
  student: { id: "hv_1", centerId: "cs1", avatarUrl: null as string | null },
  permission: true,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", name: "QL" } })) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: vi.fn(async () => m.permission) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: vi.fn(async () => ({ userId: "u1" })) }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: vi.fn(() => true),
  scopedDb: vi.fn(() => ({
    student: { findFirst: vi.fn(async () => m.student) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ student: { update: m.update } }),
  })),
}));
vi.mock("@/lib/audit/log", () => ({
  getAuditActor: () => ({ actorId: "u1", actorName: "QL" }),
  logStudentAudit: m.audit,
}));
vi.mock("@/lib/storage/r2-client", () => ({ getR2PublicUrl: () => "https://cdn.satarobo.vn" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const HOP_LE =
  "https://cdn.satarobo.vn/uploads/students/2026-09/3f2b8c1e-9a4d-4b7e-8c21-5d6e7f809a1b.webp";

describe("[AVT-01] datAnhDaiDienHocVien chỉ nhận URL do route upload của hệ thống sinh ra", () => {
  beforeEach(() => {
    m.update.mockReset();
    m.audit.mockReset();
    m.permission = true;
    m.student = { id: "hv_1", centerId: "cs1", avatarUrl: null };
  });

  it("URL đúng khuôn ⇒ ghi + audit", async () => {
    const { datAnhDaiDienHocVien } = await import(
      "@/app/(admin)/admin/students/[id]/_anh-dai-dien-actions"
    );
    const r = await datAnhDaiDienHocVien({ studentId: "hv_1", url: HOP_LE });
    expect(r).toEqual({ ok: true });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "hv_1" }, data: { avatarUrl: HOP_LE } });
    expect(m.audit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ảnh ngoài (tracking pixel)", "https://evil.example/p.png"],
    ["đúng host, sai thư mục", "https://cdn.satarobo.vn/uploads/images/2026-09/a.webp"],
    ["host giả mạo tiền tố", "https://cdn.satarobo.vn.evil.example/uploads/students/2026-09/3f2b8c1e-9a4d-4b7e-8c21-5d6e7f809a1b.webp"],
    ["leo thư mục", "https://cdn.satarobo.vn/uploads/students/2026-09/../../x/3f2b8c1e-9a4d-4b7e-8c21-5d6e7f809a1b.webp"],
    ["kèm query", `${HOP_LE}?t=1`],
    ["đuôi svg", HOP_LE.replace(/\.webp$/, ".svg")],
    ["http thay https", HOP_LE.replace("https://", "http://")],
  ])("từ chối: %s", async (_ten, url) => {
    const { datAnhDaiDienHocVien } = await import(
      "@/app/(admin)/admin/students/[id]/_anh-dai-dien-actions"
    );
    const r = await datAnhDaiDienHocVien({ studentId: "hv_1", url });
    expect(r.ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("url null ⇒ xoá ảnh (không cần kho)", async () => {
    m.student = { id: "hv_1", centerId: "cs1", avatarUrl: HOP_LE };
    const { datAnhDaiDienHocVien } = await import(
      "@/app/(admin)/admin/students/[id]/_anh-dai-dien-actions"
    );
    const r = await datAnhDaiDienHocVien({ studentId: "hv_1", url: null });
    expect(r).toEqual({ ok: true });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "hv_1" }, data: { avatarUrl: null } });
  });

  it("thiếu students:edit ⇒ từ chối trước mọi thứ", async () => {
    m.permission = false;
    const { datAnhDaiDienHocVien } = await import(
      "@/app/(admin)/admin/students/[id]/_anh-dai-dien-actions"
    );
    const r = await datAnhDaiDienHocVien({ studentId: "hv_1", url: HOP_LE });
    expect(r.ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });
});

// 25/09/2026 — lượt rà đối kháng. Ba luật mới, ghim theo LỜI GỌI (không theo import).
describe("[LNS-05] bản vá sau rà đối kháng", () => {
  const khongChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("gắn/gỡ ghi CÓ ĐIỀU KIỆN: 2 lời gọi updateMany(where: dieuKienGhi(...)), 0 lời gọi student.update(", () => {
    const s = khongChuThich(nguon(ACTIONS));
    expect(dem(s, /\.student\.updateMany\(\{\s*where: dieuKienGhi\(/g)).toBe(2);
    expect(dem(s, /\.student\.update\(/g)).toBe(0);
    expect(dem(s, /ghi\.count !== 1\) throw new LoiLienKet\(LOI_DA_DOI\)/g)).toBe(2);
  });

  it("gắn lead hỏi hồ sơ đã ẩn danh NĐ13 TRƯỚC transaction", () => {
    const s = khongChuThich(nguon(ACTIONS));
    const iAnDanh = s.indexOf("await hocVienDaAnDanh(hv)");
    const iTx = s.indexOf("$transaction");
    expect(iAnDanh).toBeGreaterThan(0);
    expect(iAnDanh).toBeLessThan(iTx);
  });

  it("tầng đọc: SĐT học viên bị che ⇒ KHÔNG so lead theo SĐT", () => {
    const s = khongChuThich(nguon(DOC));
    expect(dem(s, /!parentPhoneMasked && \(await duocSoSdt\(canViewPii\)\)/g)).toBe(1);
    expect(dem(s, /!input\.sdtHocVienBiChe && \(await duocSoSdt\(canViewPii\)\)/g)).toBe(1);
  });
});
