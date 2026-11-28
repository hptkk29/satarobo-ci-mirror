import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Không DB, không R2, không mạng: cơ sở dữ liệu / kiểm toán / rate-limit / cổng «đã đủ điều kiện tải» đều được giả.
const M = vi.hoisted(() => ({
  hoSo: true,
  cons: [] as Array<{ name: string; currentGrade: number | null }>,
  rl: { success: true, remaining: 10, resetAt: Date.now() + 60_000 },
  audit: [] as unknown[],
  auditLoi: false,
  thuTu: [] as string[],
  phuHuynhDuocTai: vi.fn(),
}));
vi.mock("@/lib/db", async (goc) => ({ ...(await goc<typeof import("@/lib/db")>()), db: { student: { findMany: vi.fn(async () => M.cons) } } }));
vi.mock("@/lib/portal/tu-sach", () => ({
  phuHuynhDuocTai: (...a: unknown[]) => {
    M.thuTu.push("dieu-kien");
    M.phuHuynhDuocTai(...a);
    return Promise.resolve(M.hoSo);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => {
    M.thuTu.push("rate-limit");
    return M.rl;
  }),
}));
vi.mock("@/lib/audit/audit-log", () => ({
  writeAudit: vi.fn(async (p: unknown) => {
    M.thuTu.push("audit");
    if (M.auditLoi) throw new Error("db down");
    M.audit.push(p);
    return {};
  }),
}));

import { kiemCheDoHocSinh } from "../che-do-hoc-sinh-thuan";
import { docKhoLocal, ghiKhoLocal, kiemUrlLocal } from "../kho-tep-rieng";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";
import { bucketTuSachHopLe } from "@/lib/tu-sach/bucket-pdf";
import { EBOOKS } from "@/lib/tu-sach/ebook";
import { SGK } from "@/lib/tu-sach/sgk";
import type { KhoTep } from "@/lib/tu-sach/tai";

import { datKhoTuSach, GIOI_HAN_LIEN_KET_TU_SACH, laySachGiaoKhoa, layTuSach, lienKetTaiEbook, lienKetTaiEbookSchema, sachGiaoKhoaQuery } from "./tu-sach";

/**
 * [TSM-*] «Tủ sách cho ba mẹ» trên app — luật THUẦN (không DB / R2 / mạng):
 *   [TSM-01] cờ TU_SACH_ENABLED tắt ⇒ 404 TRƯỚC mọi việc (không đụng kho / DB / rate-limit); chỉ đúng 'true' mới bật
 *   [TSM-02] chế độ học sinh: luật chung từ chối mọi đường /parent/library/**; dịch vụ cũng từ chối (phòng thủ chiều sâu)
 *   [TSM-03] danh mục: đúng 20 ebook của web, không lộ khoá/URL tệp; lớp của con chỉ gồm lớp 1–12
 *   [TSM-04] sách giáo khoa: chỉ liên kết ngoài NXBGD; lọc theo lớp; tham số sai bị từ chối
 *   [TSM-05] xin liên kết: mã lạ/ngoài danh mục bị chặn TRƯỚC rate-limit / DB / kho; không chạm khoá ngoài `tu-sach/ebook/<so>/sach.pdf`
 *   [TSM-06] chưa đủ điều kiện tải ⇒ 403, kho không bị chạm (không HEAD, không ký, không audit)
 *   [TSM-07] thành công: ký đúng khoá, TTL ≤ 15 phút (300 s), AuditLog TRƯỚC khi ký và không chứa URL/khoá
 *   [TSM-08] tệp chưa nhập / kho chưa cấu hình ⇒ 404 và KHÔNG ký, KHÔNG audit; kho ném lỗi ⇒ 503 không lộ lỗi; audit lỗi ⇒ 503 không ký
 *   [TSM-09] chạm trần rate-limit ⇒ 429 + Retry-After, kho không bị chạm
 *   [TSM-10] không có đường lùi công khai: mã nguồn không dùng URL công khai; bucket Tủ sách trùng bucket công khai ⇒ coi như chưa cấu hình
 *   [TSM-11] kho LOCAL (thử nghiệm): URL ký hết hạn ≤ 300 s; sửa khoá / hạn / chữ ký ⇒ bị từ chối; quá hạn ⇒ bị từ chối
 */
const NGUOI: NguoiGoi = { userId: "u-ph-1", sessionId: "s1", name: "Ba Mẹ", email: "ph@example.com", phone: null, hocSinhId: null };
const NGUOI_HS: NguoiGoi = { ...NGUOI, hocSinhId: "hs-1" };

function khoGia(o: Partial<KhoTep> = {}) {
  const k = {
    daCauHinh: vi.fn(() => true),
    tonTai: vi.fn(async (_k: string) => {
      M.thuTu.push("head");
      return true;
    }),
    kyLinkTai: vi.fn(async (khoa: string, ten: string, ttl: number) => {
      M.thuTu.push("ky");
      return `https://kho.invalid/${khoa}?ten=${ten}&ttl=${ttl}`;
    }),
  };
  return Object.assign(k, o);
}

const loi = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as LoiApiMobile | null;
const ma = (e: LoiApiMobile | null) => (e ? [e.status, e.code] : null);

beforeEach(() => {
  process.env.TU_SACH_ENABLED = "true";
  M.hoSo = true;
  M.cons = [];
  M.rl = { success: true, remaining: 10, resetAt: Date.now() + 60_000 };
  M.audit = [];
  M.auditLoi = false;
  M.thuTu = [];
  M.phuHuynhDuocTai.mockClear();
});
afterEach(() => {
  delete process.env.TU_SACH_ENABLED;
  datKhoTuSach(null);
});

describe("[TSM-01] cờ TU_SACH_ENABLED", () => {
  it("tắt (mặc định / giá trị lạ) ⇒ 404 cho cả ba hàm, không đụng gì khác", async () => {
    const kho = khoGia();
    datKhoTuSach(kho);
    for (const v of [undefined, "false", "TRUE", "1", ""]) {
      if (v === undefined) delete process.env.TU_SACH_ENABLED;
      else process.env.TU_SACH_ENABLED = v;
      for (const goi of [() => layTuSach(NGUOI), () => laySachGiaoKhoa(NGUOI, {}), () => lienKetTaiEbook(NGUOI, "1")]) {
        expect(ma(await loi(goi())), `cờ=${String(v)}`).toEqual([404, "NOT_FOUND"]);
      }
    }
    expect(M.thuTu).toEqual([]);
    expect(kho.tonTai).not.toHaveBeenCalled();
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
  });
});

describe("[TSM-02] chế độ học sinh", () => {
  const duong = ["/api/mobile/v1/parent/library", "/api/mobile/v1/parent/library/textbooks", "/api/mobile/v1/parent/library/ebooks/1/download-link"];
  it("luật chung (mặc định từ chối): GET/POST mọi đường /parent/library/** của phiên học sinh ⇒ bị chặn", () => {
    for (const d of duong) {
      for (const method of ["GET", "POST"]) {
        expect(kiemCheDoHocSinh({ pathname: d, method, hocSinhId: "hs-1" }), `${method} ${d}`).toEqual({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
      }
    }
    // Đối chứng dương: cùng đường nhưng phiên PHỤ HUYNH (hocSinhId null) thì qua cổng này.
    for (const d of duong) expect(kiemCheDoHocSinh({ pathname: d, method: "GET", hocSinhId: null })).toEqual({ ok: true });
  });
  it("dịch vụ cũng từ chối phiên học sinh (403 FORBIDDEN) và không chạm kho", async () => {
    const kho = khoGia();
    datKhoTuSach(kho);
    for (const goi of [() => layTuSach(NGUOI_HS), () => laySachGiaoKhoa(NGUOI_HS, {}), () => lienKetTaiEbook(NGUOI_HS, "1")]) expect(ma(await loi(goi()))).toEqual([403, "FORBIDDEN"]);
    expect(kho.tonTai).not.toHaveBeenCalled();
    expect(M.thuTu).toEqual([]);
  });
});

describe("[TSM-03] danh mục ebook", () => {
  it("đúng 20 ebook của web, theo thứ tự, không lộ khoá / URL tệp / bucket", async () => {
    datKhoTuSach(khoGia());
    const d = await layTuSach(NGUOI);
    expect(d.ebooks.map((e) => e.so)).toEqual(EBOOKS.map((e) => e.so));
    expect(d.ebooks).toHaveLength(20);
    expect(d.chuDe).toHaveLength(6);
    expect(d.soSachGiaoKhoa).toBe(SGK.length);
    expect(d.taiDuoc).toBe(true);
    expect(d.khoSanSang).toBe(true);
    const txt = JSON.stringify(d);
    expect(txt).not.toMatch(/sach\.pdf|tu-sach\/ebook|r2\.|cloudflarestorage|X-Amz|bucket/i);
    expect(d.ebooks[0]!.anhBia).toBe("/tu-sach/bia/1.jpg");
    expect(Object.keys(d.ebooks[0]!).sort()).toEqual(["anhBia", "chuDe", "doiTuong", "moTa", "phuDe", "so", "soTrang", "tieuDe"]);
  });
  it("taiDuoc phản ánh hồ sơ (chưa có phường/xã ⇒ false); khoSanSang phản ánh kho", async () => {
    M.hoSo = false;
    datKhoTuSach(khoGia({ daCauHinh: () => false }));
    const d = await layTuSach(NGUOI);
    expect([d.taiDuoc, d.khoSanSang]).toEqual([false, false]);
    expect(M.phuHuynhDuocTai).toHaveBeenCalledWith("u-ph-1"); // userId từ phiên
  });
  it("lớp của con: chỉ 1–12, chỉ tên + lớp (không id học viên)", async () => {
    M.cons = [
      { name: "Bé An", currentGrade: 4 },
      { name: "Bé Bình", currentGrade: null },
      { name: "Bé Chi", currentGrade: 13 },
      { name: "Bé Dũng", currentGrade: 0 },
    ];
    datKhoTuSach(khoGia());
    expect((await layTuSach(NGUOI)).conCoKhaiLop).toEqual([{ ten: "Bé An", lop: 4 }]);
  });
});

describe("[TSM-04] sách giáo khoa", () => {
  it("không lọc ⇒ đủ danh mục; lọc theo lớp ⇒ đúng lớp; mọi URL là liên kết ngoài NXBGD (không phải tệp của Sata Robo)", async () => {
    const tat = (await laySachGiaoKhoa(NGUOI, {})).sach;
    expect(tat).toHaveLength(SGK.length);
    for (const s of tat) expect(s.url, s.id).toMatch(/^https:\/\/taphuan\.nxbgd\.vn\/tap-huan\/doc-sach\//);
    const l4 = (await laySachGiaoKhoa(NGUOI, { grade: 4 })).sach;
    expect(l4.length).toBeGreaterThan(0);
    expect(l4.every((s) => s.lop === 4)).toBe(true);
    expect(l4).toHaveLength(SGK.filter((s) => s.lop === 4).length);
  });
  it("tham số grade: chỉ số nguyên 1–12", () => {
    expect(sachGiaoKhoaQuery.parse({}).grade).toBeUndefined();
    expect(sachGiaoKhoaQuery.parse({ grade: "12" }).grade).toBe(12);
    for (const x of ["0", "13", "-1", "1.5", "abc"]) expect(sachGiaoKhoaQuery.safeParse({ grade: x }).success, x).toBe(false);
  });
});

describe("[TSM-05] mã sách vào liên kết tải", () => {
  it.each([["abc"], [""], ["-1"], ["1.5"], ["1234"], ["../1"], ["1/../2"], ["%2e%2e"], ["1e2"], [" 1"], ["01 "]])("mã %j ⇒ 400 VALIDATION, không rate-limit / DB / kho", async (so) => {
    const kho = khoGia();
    datKhoTuSach(kho);
    expect(ma(await loi(lienKetTaiEbook(NGUOI, so)))).toEqual([400, "VALIDATION"]);
    expect(M.thuTu).toEqual([]);
    expect(kho.tonTai).not.toHaveBeenCalled();
  });
  it.each([["0"], ["21"], ["999"]])("số %s không có trong danh mục (không phải bản đã xuất bản) ⇒ 404, không chạm kho", async (so) => {
    const kho = khoGia();
    datKhoTuSach(kho);
    expect(ma(await loi(lienKetTaiEbook(NGUOI, so)))).toEqual([404, "NOT_FOUND"]);
    expect(M.thuTu).toEqual([]);
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
  });
  it("thân yêu cầu: chỉ nhận {} (lược đồ strict)", () => {
    expect(lienKetTaiEbookSchema.safeParse({}).success).toBe(true);
    expect(lienKetTaiEbookSchema.safeParse({ khoa: "tu-sach/ebook/1/sach.pdf" }).success).toBe(false);
    expect(lienKetTaiEbookSchema.safeParse({ so: 1 }).success).toBe(false);
  });
});

describe("[TSM-06] chưa đủ điều kiện tải", () => {
  it("hồ sơ chưa có phường/xã ⇒ 403 FORBIDDEN; không HEAD, không ký, không audit", async () => {
    M.hoSo = false;
    const kho = khoGia();
    datKhoTuSach(kho);
    const e = await loi(lienKetTaiEbook(NGUOI, "2"));
    expect(ma(e)).toEqual([403, "FORBIDDEN"]);
    expect(e!.message).toMatch(/phường\/xã/);
    expect(kho.tonTai).not.toHaveBeenCalled();
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
    expect(M.audit).toHaveLength(0);
  });
});

describe("[TSM-07] thành công", () => {
  it("ký đúng khoá PDF của cuốn, TTL 300 s (≤ 900), audit TRƯỚC khi ký, audit không chứa URL / khoá", async () => {
    const kho = khoGia();
    datKhoTuSach(kho);
    const kq = await lienKetTaiEbook(NGUOI, "3");
    expect(kho.tonTai).toHaveBeenCalledWith("tu-sach/ebook/3/sach.pdf");
    expect(kho.kyLinkTai).toHaveBeenCalledTimes(1);
    const [khoa, ten, ttl] = kho.kyLinkTai.mock.calls[0]!;
    expect(khoa).toBe("tu-sach/ebook/3/sach.pdf");
    expect(ten).toMatch(/^Sata-Robo-Ebook-3-[A-Za-z0-9-]+\.pdf$/);
    expect(ttl).toBe(300);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
    expect(kq).toEqual({ url: expect.stringContaining("tu-sach/ebook/3/sach.pdf"), hetHanSauGiay: 300, tenTep: ten });
    // thứ tự: rate-limit → điều kiện → HEAD → audit → ký
    expect(M.thuTu).toEqual(["rate-limit", "dieu-kien", "head", "audit", "ky"]);
    expect(M.audit).toHaveLength(1);
    const a = M.audit[0] as { action: string; entityId: string; actor: { id: string }; newValues: unknown };
    expect([a.action, a.entityId, a.actor.id]).toEqual(["PH_TAI_EBOOK", "3", "u-ph-1"]);
    expect(JSON.stringify(a)).not.toMatch(/sach\.pdf|kho\.invalid|https?:/);
  });
});

describe("[TSM-08] không có gì để tải / lỗi", () => {
  it("tệp chưa nhập ⇒ 404 đang cập nhật; KHÔNG ký, KHÔNG audit", async () => {
    const kho = khoGia({ tonTai: vi.fn(async () => false) });
    datKhoTuSach(kho);
    const e = await loi(lienKetTaiEbook(NGUOI, "4"));
    expect(ma(e)).toEqual([404, "NOT_FOUND"]);
    expect(e!.message).toMatch(/cập nhật/);
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
    expect(M.audit).toHaveLength(0);
  });
  it("kho chưa cấu hình ⇒ 404, không HEAD, không ký (không rơi về bucket công khai)", async () => {
    const kho = khoGia({ daCauHinh: vi.fn(() => false) });
    datKhoTuSach(kho);
    expect(ma(await loi(lienKetTaiEbook(NGUOI, "4")))).toEqual([404, "NOT_FOUND"]);
    expect(kho.tonTai).not.toHaveBeenCalled();
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
  });
  it("kho ném lỗi ⇒ 503 SERVER, không lộ nội dung lỗi", async () => {
    datKhoTuSach(khoGia({ tonTai: vi.fn(async () => { throw new Error("AccessDenied: secret-bucket-xyz"); }) }));
    const e = await loi(lienKetTaiEbook(NGUOI, "4"));
    expect(ma(e)).toEqual([503, "SERVER"]);
    expect(e!.message).not.toMatch(/AccessDenied|secret/);
  });
  it("audit lỗi ⇒ 503 và KHÔNG ký (không dấu thì không cấp)", async () => {
    M.auditLoi = true;
    const kho = khoGia();
    datKhoTuSach(kho);
    expect(ma(await loi(lienKetTaiEbook(NGUOI, "4")))).toEqual([503, "SERVER"]);
    expect(kho.kyLinkTai).not.toHaveBeenCalled();
  });
});

describe("[TSM-09] rate-limit", () => {
  it("chạm trần ⇒ 429 RATE_LIMITED kèm Retry-After; không chạm DB / kho; trần = trần của web (60 / 10 phút)", async () => {
    M.rl = { success: false, remaining: 0, resetAt: Date.now() + 42_000 };
    const kho = khoGia();
    datKhoTuSach(kho);
    const e = await loi(lienKetTaiEbook(NGUOI, "1"));
    expect(ma(e)).toEqual([429, "RATE_LIMITED"]);
    expect(e!.retryAfterGiay).toBeGreaterThanOrEqual(1);
    expect(e!.retryAfterGiay).toBeLessThanOrEqual(43);
    expect(M.phuHuynhDuocTai).not.toHaveBeenCalled();
    expect(kho.tonTai).not.toHaveBeenCalled();
    expect(GIOI_HAN_LIEN_KET_TU_SACH).toEqual({ max: 60, windowMs: 600_000 });
  });
});

describe("[TSM-10] không có đường lùi công khai", () => {
  const nguon = readFileSync(path.resolve(process.cwd(), "lib/mobile-api/dich-vu/tu-sach.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("mã nguồn dịch vụ + ba route không dùng URL công khai của R2 / bucket công khai", () => {
    const route = ["library/route.ts", "library/textbooks/route.ts", "library/ebooks/[so]/download-link/route.ts"].map((p) => readFileSync(path.resolve(process.cwd(), "app/api/mobile/v1/parent", p), "utf8")).join("\n");
    for (const t of [nguon, route]) {
      expect(t).not.toMatch(/getPublicUrl|getR2PublicUrl|R2_PUBLIC_URL|R2_BUCKET_NAME|getR2Bucket\(/);
    }
    // Khoá R2 chỉ dựng từ số nguyên của danh mục qua `khoaSach`, không nối chuỗi từ client.
    expect(nguon).not.toMatch(/`tu-sach\/ebook\/\$\{/);
    expect(nguon).toMatch(/khoaSach\.pdf\(so\)/);
  });
  it("bucket Tủ sách trùng bucket công khai (hoặc thiếu) ⇒ coi như chưa cấu hình (kho không ký)", () => {
    expect(bucketTuSachHopLe({ R2_BUCKET_NAME: "pub", R2_TU_SACH_BUCKET_NAME: "pub" })).toBe(false);
    expect(bucketTuSachHopLe({ R2_BUCKET_NAME: "pub" })).toBe(false);
    expect(bucketTuSachHopLe({ R2_BUCKET_NAME: "pub", R2_TU_SACH_BUCKET_NAME: "rieng" })).toBe(true);
  });
});

describe("[TSM-11] kho LOCAL thử nghiệm: URL ký", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tu-sach-"));
  const truoc = { dir: process.env.MOBILE_UPLOAD_LOCAL_DIR, sec: process.env.NEXTAUTH_SECRET, env: process.env.NODE_ENV };
  beforeAll(() => {
    process.env.MOBILE_UPLOAD_LOCAL_DIR = dir;
    process.env.NEXTAUTH_SECRET = "tu-sach-test-secret-khong-dung-that-32+";
  });
  afterAll(() => {
    if (truoc.dir === undefined) delete process.env.MOBILE_UPLOAD_LOCAL_DIR;
    else process.env.MOBILE_UPLOAD_LOCAL_DIR = truoc.dir;
    if (truoc.sec === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = truoc.sec;
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => vi.useRealTimers());

  const phan = (url: string) => {
    const u = new URL(url);
    const khoa = decodeURIComponent(u.pathname.replace(/^\/api\/dev-kho\//, ""));
    return { khoa, e: Number(u.searchParams.get("e")), c: u.searchParams.get("c") ?? "", s: u.searchParams.get("s") ?? "" };
  };

  it("ký hợp lệ ⇒ khớp; hạn ≤ 300 s; sửa khoá / hạn / chữ ký ⇒ từ chối; quá hạn ⇒ từ chối; tệp chưa có ⇒ 404 không ký", async () => {
    // chưa có tệp ⇒ 404, không có URL nào được cấp
    expect(ma(await loi(lienKetTaiEbook(NGUOI, "5")))).toEqual([404, "NOT_FOUND"]);
    await ghiKhoLocal("tu-sach/ebook/5/sach.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4 thử"));
    await ghiKhoLocal("tu-sach/ebook/6/sach.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4 khác"));
    expect(await docKhoLocal("tu-sach/ebook/5/sach.pdf")).not.toBeNull();

    const t0 = Date.now();
    const kq = await lienKetTaiEbook(NGUOI, "5");
    const p = phan(kq.url);
    expect(p.khoa).toBe("tu-sach/ebook/5/sach.pdf");
    expect(kq.hetHanSauGiay).toBe(300);
    expect(p.e - t0).toBeLessThanOrEqual(300_000 + 2_000);
    expect(p.e - t0).toBeLessThanOrEqual(15 * 60_000);
    expect(kiemUrlLocal("get", p.khoa, p.e, p.c, p.s)).toBe(true);
    // đổi sang cuốn khác với chữ ký của cuốn này ⇒ từ chối
    expect(kiemUrlLocal("get", "tu-sach/ebook/6/sach.pdf", p.e, p.c, p.s)).toBe(false);
    // kéo dài hạn ⇒ từ chối
    expect(kiemUrlLocal("get", p.khoa, p.e + 3_600_000, p.c, p.s)).toBe(false);
    // sửa chữ ký ⇒ từ chối
    expect(kiemUrlLocal("get", p.khoa, p.e, p.c, p.s.slice(0, -1) + (p.s.endsWith("0") ? "1" : "0"))).toBe(false);
    // dùng chữ ký GET cho hành động PUT ⇒ từ chối (không ghi đè được tệp sách)
    expect(kiemUrlLocal("put", p.khoa, p.e, p.c, p.s)).toBe(false);
    // quá hạn ⇒ từ chối
    vi.useFakeTimers();
    vi.setSystemTime(p.e + 1_000);
    expect(kiemUrlLocal("get", p.khoa, p.e, p.c, p.s)).toBe(false);
  });
});
