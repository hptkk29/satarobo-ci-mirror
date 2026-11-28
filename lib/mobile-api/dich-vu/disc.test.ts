import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mô-đun nặng / chạm DB được thay bằng bản giả: bộ này THUẦN (không Postgres). ──
const hoanDb = vi.hoisted(() => ({
  updateMany: vi.fn(),
  thanhVienFind: vi.fn(),
  baiFind: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    discBanNhap: { updateMany: hoanDb.updateMany },
    discThanhVien: { findFirst: hoanDb.thanhVienFind },
    discBaiLam: { findFirst: hoanDb.baiFind },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 1000 })) }));

const ghi = vi.hoisted(() => ({
  camOnViec: vi.fn(),
  chayPhanTich: vi.fn(),
  datPin: vi.fn(),
  luuCheckin: vi.fn(),
  luuNhap: vi.fn(),
  luuThanhVien: vi.fn(),
  nopBaiSo: vi.fn(),
  phatDeCho: vi.fn(),
  taoKeHoach: vi.fn(),
  taoSo: vi.fn(),
  tickViec: vi.fn(),
  xacNhanPin: vi.fn(),
  xoaBaiLam: vi.fn(),
  xoaThanhVien: vi.fn(),
}));
vi.mock("@/lib/disc/so-gia-dinh/ghi", () => ghi);

const doc = vi.hoisted(() => ({ laySoCuaChu: vi.fn(), docPhanTichMoiNhat: vi.fn(), docHoatDongDaKiem: vi.fn(), docKeHoachDangChay: vi.fn() }));
vi.mock("@/lib/disc/so-gia-dinh/doc", async (goc) => ({ ...(await goc<typeof import("@/lib/disc/so-gia-dinh/doc")>()), ...doc }));

const nap = vi.hoisted(() => ({ napMan: vi.fn(), hocVienChuaNoi: vi.fn(), soHocVienCua: vi.fn() }));
vi.mock("@/lib/disc/so-gia-dinh/nap-man", () => nap);

import { createHash } from "node:crypto";

import { dePhatRaTuVe, phatDeChoThanhVien } from "@/lib/disc/so-gia-dinh/bai-lam";
import { dauVaoNha, GOC_GIO } from "@/lib/disc/so-gia-dinh/fixture";
import { kiemCheDoHocSinh } from "@/lib/mobile-api/che-do-hoc-sinh-thuan";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

import {
  ANH_XA_LOI,
  boLienKetWeb,
  chuVietTatApp,
  chanNeuDiscTat,
  checkinBody,
  docTongQuan,
  docTheCap,
  hrefSangDich,
  idHopLe,
  keHoachQuery,
  loiTuMien,
  luuNhapBody,
  luuThanhVienSo,
  nopBaiBody,
  nopBaiLamBai,
  phatDeBody,
  pinBody,
  taoKeHoachBody,
  taoSoBody,
  thanRong,
  thanhVienBody,
  theCapQuery,
  xoaThanhVienBody,
} from "./disc";

/**
 * [MDISC] DISC trên app — lưới THUẦN (không DB, không HTTP). Phần chạy HTTP/Postgres thật: `tests/mobile-api/disc.spec.ts` (người vận hành chạy).
 *   [MDISC-ERR] ánh xạ lỗi miền → HTTP đầy đủ + chỉ dùng mã có sẵn · [MDISC-SM] chế độ học sinh từ chối MỌI route DISC · [MDISC-W] dây nối route (cờ ở dòng đầu, không db trần, chỉ GET/POST)
 *   [MDISC-SCH] lược đồ chặt · [MDISC-LINK] view-model không còn liên kết web · [MDISC-NOP] nộp bài một lần (giành bản nháp / trả lại / lặp lại) · [MDISC-FLAG] cờ tắt ⇒ 404
 */
/** Người gọi giả (phiên đã xác thực). Cờ `DISC_PIN_ENFORCE_ENABLED` TẮT trong bộ này ⇒ `baoVeDisc` cho qua mà không chạm DB. */
const NG = (id = "u1") => ({ userId: id, sessionId: `s-${id}`, name: "", email: "", phone: null, hocSinhId: null }) as never;
const GOC = resolve(process.cwd(), "app/api/mobile/v1/parent/disc");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function cacRoute(d: string, ra: string[] = []): string[] {
  for (const t of readdirSync(d)) {
    const p = join(d, t);
    if (statSync(p).isDirectory()) cacRoute(p, ra);
    else if (t === "route.ts") ra.push(p);
  }
  return ra;
}
const tepRoute = cacRoute(GOC);
const duongCua = (p: string) => "/api/mobile/v1/parent/disc" + p.replace(/\\/g, "/").slice(GOC.replace(/\\/g, "/").length).replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, "x-$1");
const phuongThucCua = (ma: string) => [...ma.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]!);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
});
afterEach(() => {
  delete process.env.DISC_ENABLED;
});

describe("[MDISC-ERR] ánh xạ lỗi miền → HTTP", () => {
  it("[MDISC-ERR-01] phủ ĐỦ mọi mã `MaLoi` của ghi.ts (đọc từ chính nguồn — thêm mã mới mà quên ánh xạ là đỏ, ngoài lỗi biên dịch)", () => {
    const ma = readFileSync(resolve(process.cwd(), "lib/disc/so-gia-dinh/ghi.ts"), "utf8");
    const khoi = /export type MaLoi =([\s\S]*?);/.exec(ma)?.[1] ?? "";
    const cacMa = [...khoi.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!).sort();
    expect(cacMa.length).toBeGreaterThanOrEqual(19);
    expect(Object.keys(ANH_XA_LOI).sort()).toEqual(cacMa);
  });

  it("[MDISC-ERR-02] không tồn tại / không thuộc tài khoản ⇒ 404 (không phân biệt); khoá PIN ⇒ 429 + Retry-After; PIN sai ⇒ 403; hết lượt ⇒ 409", () => {
    for (const m of ["KHONG_CO_SO", "KHONG_TIM_THAY", "HOC_VIEN_KHONG_THUOC_TAI_KHOAN"] as const) {
      const e = loiTuMien({ loi: m, thongBao: "x" });
      expect([e.code, e.status]).toEqual(["NOT_FOUND", 404]);
    }
    const khoa = loiTuMien({ loi: "PIN_BI_KHOA", thongBao: "x" });
    expect([khoa.code, khoa.status, khoa.retryAfterGiay]).toEqual(["RATE_LIMITED", 429, 900]);
    expect(loiTuMien({ loi: "PIN_SAI", thongBao: "x" }).status).toBe(403);
    expect(loiTuMien({ loi: "QUA_NHIEU_BAI", thongBao: "x" })).toMatchObject({ code: "HET_LUOT", status: 409 });
    expect(loiTuMien({ loi: "NOP_BAI_LOI", thongBao: "x" })).toMatchObject({ code: "VALIDATION", status: 400 });
  });

  it("[MDISC-ERR-03] không mã miền nào ra 5xx NGOẠI TRỪ `DISC_LOI_HE_THONG` (503, FAIL-CLOSED có chủ đích khi cổng bảo vệ PIN gặp sự cố — có Retry-After); thông báo của miền được giữ nguyên", () => {
    for (const [m, d] of Object.entries(ANH_XA_LOI)) {
      expect(d.status, m).toBeGreaterThanOrEqual(400);
      if (m === "DISC_LOI_HE_THONG") expect(d.status).toBe(503);
      else expect(d.status, m).toBeLessThan(500);
    }
    expect(loiTuMien({ loi: "DISC_LOI_HE_THONG", thongBao: "x" }).retryAfterGiay).toBe(30);
    expect(loiTuMien({ loi: "DAY_THANH_VIEN", thongBao: "Sổ gia đình có tối đa 8 thành viên." }).message).toBe("Sổ gia đình có tối đa 8 thành viên.");
  });
});

describe("[MDISC-SM] chế độ học sinh (H-S3) từ chối mọi route DISC", () => {
  it("[MDISC-SM-01] lưới thấy đủ route (đối chứng dương) và mỗi (phương thức, đường dẫn) bị chặn khi phiên đang khoá vào một học sinh", () => {
    expect(tepRoute.length).toBeGreaterThanOrEqual(17);
    for (const p of tepRoute) {
      for (const m of phuongThucCua(readFileSync(p, "utf8"))) {
        const r = kiemCheDoHocSinh({ pathname: duongCua(p), method: m, hocSinhId: "hs-1" });
        expect(r, `${m} ${duongCua(p)} KHÔNG bị chặn ở chế độ học sinh`).toEqual({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
      }
    }
  });

  it("[MDISC-SM-02] đối chứng dương: phiên phụ huynh thường đi được; và bộ kiểm có cho học sinh một đường THẬT (lịch của chính mình) — tức lời từ chối ở trên không phải do bộ kiểm chặn tất", () => {
    expect(kiemCheDoHocSinh({ pathname: "/api/mobile/v1/parent/disc", method: "GET", hocSinhId: null })).toEqual({ ok: true });
    expect(kiemCheDoHocSinh({ pathname: "/api/mobile/v1/students/hs-1/schedule", method: "GET", hocSinhId: "hs-1" })).toEqual({ ok: true });
  });

  it("[MDISC-SM-03] KHÔNG có đường DISC theo học sinh nào được mở (`/students/:id/disc…`): phòng khi sau này có người thêm", () => {
    for (const m of ["GET", "POST"]) {
      for (const d of ["/students/hs-1/disc", "/students/hs-1/disc/report", "/students/hs-1/personality-robot/disc"]) {
        expect(kiemCheDoHocSinh({ pathname: `/api/mobile/v1${d}`, method: m, hocSinhId: "hs-1" }).ok, `${m} ${d}`).toBe(false);
      }
    }
  });
});

describe("[MDISC-W] dây nối route", () => {
  it("[MDISC-W-01] mọi route: chỉ GET/POST; cờ `chanNeuDiscTat()` ở DÒNG ĐẦU của từng hàm, TRƯỚC cổng đăng nhập/đọc thân; đi qua cổng phụ huynh", () => {
    for (const p of tepRoute) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      const pt = phuongThucCua(ma);
      expect(pt.length, p).toBeGreaterThan(0);
      for (const m of pt) expect(["GET", "POST"], `${p}: ${m}`).toContain(m);
      for (const khoi of ma.split(/export async function /).slice(1)) {
        const than = khoi.slice(khoi.indexOf("{\n") + 2);
        const dau = than.split("\n").find((d) => d.trim() !== "" && !/^\s*const \{ \w+ \} = await ctx\.params;$/.test(d)) ?? "";
        expect(dau.trim(), `${p}: dòng đầu phải là cổng cờ`).toBe("const tat = chanNeuDiscTat();");
        expect(khoi.indexOf("chanNeuDiscTat()"), p).toBeLessThan(khoi.search(/chayChoPhuHuynh(CoThan)?\(/));
      }
      expect(ma, `${p} không qua cổng phụ huynh`).toMatch(/chayChoPhuHuynh(CoThan)?\(/);
    }
  });

  it("[MDISC-W-02] route KHÔNG chạm DB / miền trực tiếp (mọi truy cập nằm ở dịch vụ) và không nhận id người dùng từ thân/URL (userId CHỈ từ phiên)", () => {
    for (const p of tepRoute) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      expect(ma, p).not.toMatch(/@\/lib\/db|@\/lib\/disc\/|scopedDb|portalDb/);
      expect(ma, `${p} đọc userId từ ngoài phiên`).not.toMatch(/\b(?:than|params)\.userId|searchParams[^\n]*userId/);
      // V8.31: dịch vụ nhận `nguoi` (phiên đã xác thực, kèm sessionId cho cổng PIN) — route truyền `nguoi` (hoặc `nguoi.userId` ở đường bootstrap `book`).
      expect((ma.match(/\(nguoi\b|nguoi\.userId/g) ?? []).length, p).toBeGreaterThanOrEqual(1);
    }
  });

  it("[MDISC-W-03] dịch vụ: không import auth web / `@/lib/auth`, không log câu trả lời (không console.*), không `any`", () => {
    const ma = boChuThich(readFileSync(resolve(process.cwd(), "lib/mobile-api/dich-vu/disc.ts"), "utf8"));
    expect(ma).not.toMatch(/from\s+["']@\/lib\/auth["']/);
    expect(ma).not.toMatch(/console\./);
    expect(ma).not.toMatch(/:\s*any\b|as any\b|<any>/);
  });
});

describe("[MDISC-SCH] lược đồ CHẶT", () => {
  it("[MDISC-SCH-01] khoá lạ ⇒ từ chối (không gỡ im lặng) ở mọi thân", () => {
    const cases: Array<[string, { safeParse: (x: unknown) => { success: boolean } }, unknown]> = [
      ["taoSo", taoSoBody, { tenChuSo: "Mẹ", vaiTroChuSo: "me", userId: "x" }],
      ["thanhVien", thanhVienBody, { ten: "An", vaiTro: "con", giaDinhId: "x" }],
      ["phatDe", phatDeBody, { thanhVienId: "a", cachLam: "TU_LAM", boDe: "PH" }],
      ["luuNhap", luuNhapBody, { thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 }, them: 1 }],
      ["nopBai", nopBaiBody, { thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 }, ketQua: { D: 99 } }],
      ["keHoach", taoKeHoachBody, { ky: "NGAY_7", batDau: "2026-11-02", doKho: 5 }],
      ["pin", pinBody, { pin: "4729", them: 1 }],
      ["xoaTv", xoaThanhVienBody, { cheDo: "giu-bai", id: "x" }],
      ["rong", thanRong, { viecId: "x" }],
    ];
    for (const [ten, s, v] of cases) expect(s.safeParse(v).success, ten).toBe(false);
  });

  it("[MDISC-SCH-02] đối chứng dương: thân đúng được nhận", () => {
    expect(taoSoBody.safeParse({ tenChuSo: "Mẹ", vaiTroChuSo: "me", namSinhChuSo: 1990 }).success).toBe(true);
    expect(thanhVienBody.safeParse({ ten: "An", vaiTro: "con", namSinh: 2019 }).success).toBe(true);
    expect(phatDeBody.safeParse({ thanhVienId: "a", cachLam: "GOC_NHIN" }).success).toBe(true);
    expect(nopBaiBody.safeParse({ thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3, "1": 7 } }).success).toBe(true);
    expect(pinBody.safeParse({ pin: "4729" }).success).toBe(true);
    expect(thanRong.safeParse({}).success).toBe(true);
  });

  it("[MDISC-SCH-03] câu trả lời: giá trị ngoài 1–7, khoá không phải số, quá 400 câu ⇒ từ chối; xoá thành viên BẮT BUỘC chọn chế độ (không mặc định)", () => {
    const co = (traLoi: unknown) => nopBaiBody.safeParse({ thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi }).success;
    expect(co({ "0": 0 })).toBe(false);
    expect(co({ "0": 8 })).toBe(false);
    expect(co({ "0": 2.5 })).toBe(false);
    expect(co({ "0": "3" })).toBe(false);
    expect(co({ a: 3 })).toBe(false);
    expect(co(Object.fromEntries(Array.from({ length: 401 }, (_, i) => [String(i % 1000), 3])))).toBe(false); // 401 khoá khác nhau (0..400 ⇒ ≤ 3 chữ số)
    expect(xoaThanhVienBody.safeParse({}).success).toBe(false);
    expect(xoaThanhVienBody.safeParse({ cheDo: "xoa-het" }).success).toBe(false);
  });

  it("[MDISC-SCH-04] check-in: phần tử lồng nhau cũng chặt; điểm hoà thuận 1–5; tuần ≥ 1", () => {
    const co = (d: unknown) => checkinBody.safeParse({ keHoachId: "k", tuan: 1, diem: d }).success;
    expect(co([{ thanhVienId: "a", diem: 4 }])).toBe(true);
    expect(co([{ thanhVienId: "a", diem: 4, ghiChu: "x" }])).toBe(false);
    expect(co([{ thanhVienId: "a", diem: 6 }])).toBe(false);
    expect(co([])).toBe(false);
  });

  it("[MDISC-SCH-05] tham số truy vấn: số nguyên 1..400 chuyển thành số; khoá lạ / tab lạ ⇒ từ chối; id thẻ cặp ≤ 64 ký tự", () => {
    expect(keHoachQuery.parse({ tab: "CHECKIN", ngay: "3", tuan: "12", plan: "THANG_1" })).toEqual({ tab: "CHECKIN", ngay: 3, tuan: 12, plan: "THANG_1" });
    expect(keHoachQuery.safeParse({ tab: "KHAC" }).success).toBe(false);
    expect(keHoachQuery.safeParse({ ngay: "0" }).success).toBe(false);
    expect(keHoachQuery.safeParse({ ngay: "401" }).success).toBe(false);
    expect(keHoachQuery.safeParse({ x: "1" }).success).toBe(false);
    expect(theCapQuery.safeParse({ a: "a".repeat(65) }).success).toBe(false);
    expect(theCapQuery.safeParse({ a: "a", b: "b" }).success).toBe(true);
    expect(() => idHopLe("")).toThrow(LoiApiMobile);
    expect(() => idHopLe("x".repeat(65))).toThrow(LoiApiMobile);
  });
});

describe("[MDISC-LINK] view-model không còn liên kết web", () => {
  it("[MDISC-LINK-01] `hrefSangDich` đọc id từ liên kết `/portal/disc…`; liên kết lạ / neo trang ⇒ null", () => {
    expect(hrefSangDich("/portal/disc/lam-bai?nguoi=tv%201&cach=TU_LAM")).toEqual({ man: "lam-bai", nguoi: "tv 1", cach: "TU_LAM" });
    expect(hrefSangDich("/portal/disc?muc=the-cap&a=x&b=y")).toEqual({ man: "the-cap", a: "x", b: "y" });
    expect(hrefSangDich("/portal/disc?muc=ca-nhan&nguoi=z")).toEqual({ man: "ca-nhan", nguoi: "z" });
    expect(hrefSangDich("/portal/disc?muc=ke-hoach&ky=NAM_1")).toEqual({ man: "ke-hoach", ky: "NAM_1" });
    expect(hrefSangDich("#h-bd")).toBeNull();
    expect(hrefSangDich("https://evil.example/portal/disc")).toBeNull();
    expect(hrefSangDich("/admin/leads")).toBeNull();
  });

  it("[MDISC-LINK-02] `docTongQuan` trên nhà 4 người (dựng bằng hàm THẬT của web): không chuỗi nào còn `/portal/` hay `href`; id thành viên vẫn có ở `dich`", async () => {
    const dv = dauVaoNha("du-ca-nha");
    nap.napMan.mockResolvedValue({ so: { id: "g1", ten: "Nhà thử", coPin: false, thanhVien: dv.thanhVien, chuSoId: dv.chuSoId, bai: dv.bai }, pt: null, dv, capNhatKeHoach: false });
    const r = await docTongQuan(NG(), GOC_GIO);
    expect(r.coSo).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toContain("/portal/");
    expect(json).not.toMatch(/"(?:dao)?[hH]ref"/);
    expect(json).toContain('"dich":{"man":"ca-nhan"');
    expect(json).toContain('"nguoi":"con"');
  });

  it("[MDISC-LINK-03] `docTheCap`: ma trận mang `aId`/`bId` + `dich` (không href); a/b lạ không làm lộ gì (chọn lại mặc định)", async () => {
    const dv = dauVaoNha("du-ca-nha");
    nap.napMan.mockResolvedValue({ so: { id: "g1" }, pt: null, dv, capNhatKeHoach: false });
    const r = await docTheCap(NG(), { a: "khong-co", b: "cung-khong" }, GOC_GIO);
    const json = JSON.stringify(r);
    expect(json).not.toContain("/portal/");
    expect(json).toContain('"aId"');
    expect(json).not.toContain("khong-co");
  });

  it("[MDISC-LINK-04] chưa có sổ ⇒ `coSo:false` kèm số học viên gợi ý; KHÔNG có dữ liệu thành viên nào", async () => {
    nap.napMan.mockResolvedValue(null);
    nap.soHocVienCua.mockResolvedValue(2);
    expect(await docTongQuan(NG())).toEqual({ coSo: false, soHocVienGoiY: 2 });
  });

  it("[MDISC-LINK-05] `boLienKetWeb` giữ nguyên Date / số / null và không đụng đối tượng không thuần", () => {
    const d = new Date("2026-11-02T03:00:00.000Z");
    const r = boLienKetWeb({ a: d, b: null, c: [1, { href: "/portal/disc?muc=thanh-vien" }], href: "#x" }) as Record<string, unknown>;
    expect(r.a).toBe(d);
    expect(r.b).toBeNull();
    expect(r.c).toEqual([1, { dich: { man: "thanh-vien" } }]);
    expect(r.dich).toBeNull();
  });
});

describe("[MDISC-FLAG] cờ DISC_ENABLED", () => {
  it("[MDISC-FLAG-01] chỉ đúng chuỗi 'true' mới bật; tắt ⇒ 404 NOT_FOUND không phân biệt với 'không có route'", async () => {
    for (const v of [undefined, "", "false", "1", "TRUE", " true"]) {
      if (v === undefined) delete process.env.DISC_ENABLED;
      else process.env.DISC_ENABLED = v;
      const r = chanNeuDiscTat();
      expect(r, JSON.stringify(v)).not.toBeNull();
      expect(r!.status).toBe(404);
      expect(((await r!.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    }
    process.env.DISC_ENABLED = "true";
    expect(chanNeuDiscTat()).toBeNull();
  });
});

describe("[MDISC-NOP] nộp bài một lần", () => {
  const NOW = new Date("2026-11-21T03:00:00.000Z");
  const khoa = () => process.env.DISC_PEPPER!;
  const veThat = (tv: string, bayGio = NOW) => phatDeChoThanhVien({ boDe: "PH", thanhVienId: tv, daThay: [], hat: "h", khoa: khoa(), bayGio, dungNganHang: false }).ve;
  const dauVao = (ve: string) => ({ thanhVienId: "tv1", cachLam: "TU_LAM" as const, ve, traLoi: { "0": 3, "1": 4 } });
  const ketQuaOk = { ok: true as const, baiId: "b1", thanhVienId: "tv1", ten: "Mẹ", cachLam: "TU_LAM" as const, boDe: "PH", nhan: "D", diem: { D: 60, I: 40, S: 30, C: 50 }, truoc: null, daCoPhanTich: false };
  const hangBai = { id: "b-cu", thanhVienId: "tv1", tenLuc: "Mẹ", boDe: "PH", phienBanBoDe: "1.1", cachLam: "TU_LAM", diem: { D: 61.5, I: 40.2, S: 30.1, C: 52.4 }, kieu: { loai: "don", truc: "D" }, canhBao: [], createdAt: new Date(NOW.getTime() - 60_000) };

  beforeEach(() => {
    doc.laySoCuaChu.mockResolvedValue({ id: "g1", ownerUserId: "u1" });
    doc.docPhanTichMoiNhat.mockResolvedValue(null);
  });

  it("[MDISC-NOP-01] chưa có sổ ⇒ 404; không đụng bản nháp, không chấm", async () => {
    doc.laySoCuaChu.mockResolvedValue(null);
    await expect(nopBaiLamBai(NG(), dauVao("x".repeat(12)), NOW)).rejects.toMatchObject({ status: 404 });
    expect(hoanDb.updateMany).not.toHaveBeenCalled();
    expect(ghi.nopBaiSo).not.toHaveBeenCalled();
  });

  it("[MDISC-NOP-02] V8.28: adapter KHÔNG còn «giành»/đổi tên vé — gọi thẳng `nopBaiSo` của domain MỘT lần, kết quả đi qua nguyên vẹn; không chạm bản nháp ở tầng adapter", async () => {
    ghi.nopBaiSo.mockResolvedValue(ketQuaOk);
    const ve = veThat("tv1");
    const r = await nopBaiLamBai(NG(), dauVao(ve), NOW);
    expect(r).toMatchObject({ baiId: "b1", nhan: "D", lapLai: false });
    expect(ghi.nopBaiSo).toHaveBeenCalledTimes(1);
    expect(ghi.nopBaiSo.mock.calls[0]![0]).toBe("u1");
    expect(hoanDb.updateMany).not.toHaveBeenCalled();
    expect(readFileSync(resolve(process.cwd(), "lib/mobile-api/dich-vu/disc.ts"), "utf8")).not.toContain("~dang-nop");
  });

  it("[MDISC-NOP-03] chấm thất bại (thiếu câu / trả lời phẳng…) ⇒ 400, KHÔNG tra lại kết quả cũ; bản nháp do domain giữ (giao dịch cuộn ngược) nên adapter không cần «trả lại»", async () => {
    ghi.nopBaiSo.mockResolvedValue({ ok: false, loi: "NOP_BAI_LOI", thongBao: "Còn câu chưa trả lời." });
    await expect(nopBaiLamBai(NG(), dauVao(veThat("tv1")), NOW)).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
    expect(hoanDb.baiFind).not.toHaveBeenCalled();
    expect(hoanDb.updateMany).not.toHaveBeenCalled();
  });

  it("[MDISC-NOP-04] lỗi không lường trước giữa chừng (DB rớt) ⇒ ném tiếp (không nuốt lỗi, không tra kết quả cũ)", async () => {
    ghi.nopBaiSo.mockRejectedValue(new Error("db rớt"));
    await expect(nopBaiLamBai(NG(), dauVao(veThat("tv1")), NOW)).rejects.toThrow("db rớt");
    expect(hoanDb.baiFind).not.toHaveBeenCalled();
  });

  it("[MDISC-NOP-05] vé ĐÃ DÙNG (`VE_DA_DUNG`: nộp lại sau timeout / bị yêu cầu đồng thời giành mất): vé hợp lệ + có lần làm của chính người này trong hạn ⇒ trả lại kết quả đó (`lapLai`), KHÔNG chấm lại", async () => {
    ghi.nopBaiSo.mockResolvedValue({ ok: false, loi: "VE_DA_DUNG", thongBao: "Bài này đã được nộp." });
    hoanDb.thanhVienFind.mockResolvedValue({ id: "tv1" });
    hoanDb.baiFind.mockResolvedValue(hangBai);
    const ve = veThat("tv1");
    const r = await nopBaiLamBai(NG(), dauVao(ve), NOW);
    expect(r).toMatchObject({ baiId: "b-cu", lapLai: true, nhan: "D", truoc: null, daCoPhanTich: false });
    expect(ghi.nopBaiSo).toHaveBeenCalledTimes(1);
    const where = hoanDb.baiFind.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ giaDinhId: "g1", thanhVienId: "tv1", cachLam: "TU_LAM", nguoiTraLoiId: "u1" });
    // …và PHẢI cùng bộ câu hỏi với vé (không trả bài của một lần làm khác) + cửa sổ 15 phút.
    const dv = dePhatRaTuVe({ ve, thanhVienId: "tv1", khoa: khoa(), bayGio: NOW });
    expect(dv.ok).toBe(true);
    expect(where.maDe).toBe(createHash("sha256").update((dv.ok ? dv.maCau : []).join("|")).digest("hex"));
    expect((where.createdAt as { gte: Date }).gte.getTime()).toBe(NOW.getTime() - 15 * 60_000);
  });

  it("[MDISC-NOP-08] công thức `maDe` của dịch vụ ≡ công thức ghi bài của web (ghim văn bản — lệch là «trả lại» không bao giờ khớp)", () => {
    const web = readFileSync(resolve(process.cwd(), "lib/disc/so-gia-dinh/ghi.ts"), "utf8");
    expect(web).toContain('const maDe = createHash("sha256").update(kq.maCau.join("|")).digest("hex");');
    const app = readFileSync(resolve(process.cwd(), "lib/mobile-api/dich-vu/disc.ts"), "utf8");
    expect(app).toContain('const maDe = createHash("sha256").update(ve.maCau.join("|")).digest("hex");');
  });

  it("[MDISC-NOP-06] vé đã dùng nhưng KHÔNG có lần làm nào trong hạn (bản nháp bị xoá vì lý do khác) ⇒ 409 LUOT_DA_NOP, không chấm lại", async () => {
    ghi.nopBaiSo.mockResolvedValue({ ok: false, loi: "VE_DA_DUNG", thongBao: "x" });
    hoanDb.thanhVienFind.mockResolvedValue({ id: "tv1" });
    hoanDb.baiFind.mockResolvedValue(null);
    await expect(nopBaiLamBai(NG(), dauVao(veThat("tv1")), NOW)).rejects.toMatchObject({ code: "LUOT_DA_NOP", status: 409 });
    expect(ghi.nopBaiSo).toHaveBeenCalledTimes(1);
  });

  it("[MDISC-NOP-07] vé giả / của người khác / hết hạn thì KHÔNG bao giờ được 'trả lại kết quả' (không dò được bài của người khác): hỏng ⇒ 400, hết hạn ⇒ 409 HET_HAN, thành viên lạ ⇒ 404", async () => {
    ghi.nopBaiSo.mockResolvedValue({ ok: false, loi: "VE_DA_DUNG", thongBao: "x" });
    hoanDb.thanhVienFind.mockResolvedValue({ id: "tv1" });
    hoanDb.baiFind.mockResolvedValue(hangBai);
    await expect(nopBaiLamBai(NG(), dauVao("vé-giả-mạo-không-hợp-lệ"), NOW)).rejects.toMatchObject({ status: 400 });
    await expect(nopBaiLamBai(NG(), dauVao(veThat("tv-khac")), NOW)).rejects.toMatchObject({ status: 400 }); // vé phát cho người khác
    const veCu = veThat("tv1", new Date(NOW.getTime() - 3 * 86_400_000));
    await expect(nopBaiLamBai(NG(), dauVao(veCu), NOW)).rejects.toMatchObject({ code: "HET_HAN", status: 409 });
    hoanDb.thanhVienFind.mockResolvedValue(null);
    await expect(nopBaiLamBai(NG(), dauVao(veThat("tv1")), NOW)).rejects.toMatchObject({ status: 404 });
    expect(hoanDb.baiFind).toHaveBeenCalledTimes(0); // cả bốn ca đều dừng TRƯỚC khi đọc bài của ai
  });

  it("[MDISC-NOP-09] ánh xạ lỗi: `VE_DA_DUNG` ⇒ 409 LUOT_DA_NOP (khi domain trả thẳng lỗi này ra khỏi adapter)", () => {
    const e = loiTuMien({ loi: "VE_DA_DUNG", thongBao: "x" });
    expect([e.code, e.status]).toEqual(["LUOT_DA_NOP", 409]);
  });

});

describe("[MDISC-GC] sửa thành viên không xoá ghi chú (app không gửi `ghiChu`)", () => {
  beforeEach(() => {
    doc.laySoCuaChu.mockResolvedValue({ id: "g1", ownerUserId: "u1" });
    ghi.luuThanhVien.mockResolvedValue({ ok: true, id: "tv1", moi: false });
  });
  it("[MDISC-GC-01] có `id` mà thiếu `ghiChu` ⇒ adapter nạp ghi chú hiện có rồi mới gọi domain (domain hiểu «thiếu» là XOÁ)", async () => {
    hoanDb.thanhVienFind.mockResolvedValue({ ghiChu: "Thích robot" });
    await luuThanhVienSo(NG(), { id: "tv1", ten: "Mẹ", vaiTro: "me" } as never);
    expect(hoanDb.thanhVienFind.mock.calls[0]![0]).toMatchObject({ where: { id: "tv1", giaDinhId: "g1", deletedAt: null } });
    expect(ghi.luuThanhVien.mock.calls[0]![1]).toMatchObject({ id: "tv1", ghiChu: "Thích robot" });
  });
  it("[MDISC-GC-02] khách GỬI `ghiChu` (kể cả null để xoá có chủ ý) ⇒ giữ nguyên giá trị gửi, không tra DB; thành viên MỚI (không `id`) ⇒ không tra DB", async () => {
    await luuThanhVienSo(NG(), { id: "tv1", ten: "Mẹ", vaiTro: "me", ghiChu: null } as never);
    expect(ghi.luuThanhVien.mock.calls[0]![1]).toMatchObject({ ghiChu: null });
    await luuThanhVienSo(NG(), { ten: "Con", vaiTro: "con" } as never);
    expect(hoanDb.thanhVienFind).not.toHaveBeenCalled();
  });
});

describe("[MDISC-CHU] chữ viết tắt ô tròn không bắt đầu bằng dấu câu", () => {
  it("[MDISC-CHU-01] tên thường ≡ luật web; tên có ngoặc/dấu đầu từ không còn ra «(O»; không có chữ nào ⇒ «?»", () => {
    expect(chuVietTatApp("Nguyễn Văn An")).toBe("VA");
    expect(chuVietTatApp("Lan")).toBe("LAN");
    expect(chuVietTatApp("Ông (Ngoại)")).toBe("ÔN");
    expect(chuVietTatApp("(Ông) Ngoại")).toBe("ÔN");
    expect(chuVietTatApp("(Bố)")).toBe("BỐ");
    expect(chuVietTatApp("«» ()")).toBe("?");
    expect(chuVietTatApp("  ")).toBe("?");
  });
});
