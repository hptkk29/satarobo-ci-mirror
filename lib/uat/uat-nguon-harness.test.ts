/**
 * [UNH-*] — LƯỚI của bộ UAT Nguồn (tests/uat-nguon): các cổng an toàn THUẦN + dây nối giữa bảng vai, seed UAT và tên ca.
 *
 * Bộ UAT đăng nhập thật vào một địa chỉ HTTPS bằng tài khoản `uat.*`; hai việc không được sai là (1) chỉ nói chuyện với `test.satarobo.vn`, không bao giờ prod,
 * (2) mật khẩu không lọt vào bằng chứng. Hai việc đó là hàm thuần ở `tests/uat-nguon/_lib/an-toan.ts` nên test được không cần trình duyệt/mạng.
 *
 * Ca canh lỗi chỉ tin sau khi CẤY lại lỗi và thấy đỏ (luật 14): xem bảng cấy ở `docs/source-commission/closeout/uat-harness.md` §7.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cheBiMat, cheBiMatSau, kiemMoiTruong, layMoiTruong, maCaTuTen, maDotChay, maNguon, moiTruongTuEnv, phanLoaiRequest, tenDuLieu, TIEN_TO_DU_LIEU } from "@/tests/uat-nguon/_lib/an-toan";
import { VAI } from "@/tests/uat-nguon/_lib/vai";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const TEST = layMoiTruong("https://test.satarobo.vn", false);

describe("[UNH-ENV] cổng môi trường: CHỈ https://test.satarobo.vn", () => {
  it("[UNH-ENV-01] nhận đúng địa chỉ test (có/không dấu / cuối, hoa thường)", () => {
    for (const u of ["https://test.satarobo.vn", "https://test.satarobo.vn/", "HTTPS://TEST.SATAROBO.VN"]) {
      const r = kiemMoiTruong(u, false);
      expect(r.ok, u).toBe(true);
      if (r.ok) expect(r.env).toEqual({ origin: "https://test.satarobo.vn", host: "test.satarobo.vn", mayDev: false });
    }
  });

  it("[UNH-ENV-02] TỪ CHỐI mọi host prod và host của site khác", () => {
    for (const u of [
      "https://satarobo.vn",
      "https://www.satarobo.vn",
      "https://admin.satarobo.vn",
      "https://hocvien.satarobo.vn",
      "https://giaovien.satarobo.vn",
      "https://sale.satarobo.vn",
      "https://e-learning.satarobo.vn",
    ]) {
      expect(kiemMoiTruong(u, false).ok, u).toBe(false);
    }
  });

  it("[UNH-ENV-03] TỪ CHỐI các mẹo giả host: hậu tố, tiền tố, user@, fragment, dấu chấm cuối", () => {
    for (const u of [
      "https://test.satarobo.vn.evil.com",
      "https://evil-test.satarobo.vn",
      "https://xtest.satarobo.vn",
      "https://test.satarobo.vn@satarobo.vn",
      "https://user:pw@test.satarobo.vn", // đúng host test nhưng nhúng user:pass — cổng riêng, không phải cổng host
      "https://test.satarobo.vn:pass@admin.satarobo.vn",
      "https://satarobo.vn#test.satarobo.vn",
      "https://satarobo.vn/?h=test.satarobo.vn",
      "https://test.satarobo.vn.",
    ]) {
      expect(kiemMoiTruong(u, false).ok, u).toBe(false);
    }
  });

  it("[UNH-ENV-04] TỪ CHỐI http, cổng riêng, đường dẫn, query; và chuỗi rỗng/hỏng", () => {
    for (const u of ["http://test.satarobo.vn", "https://test.satarobo.vn:8443", "https://test.satarobo.vn/login", "https://test.satarobo.vn/?a=1", "", "   ", "test.satarobo.vn", "not a url"]) {
      expect(kiemMoiTruong(u, false).ok, JSON.stringify(u)).toBe(false);
    }
    expect(kiemMoiTruong(undefined, false).ok).toBe(false);
    expect(kiemMoiTruong(null, false).ok).toBe(false);
  });

  it("[UNH-ENV-05] localhost CHỈ khi mayDev=true và http; mayDev KHÔNG mở được prod", () => {
    expect(kiemMoiTruong("http://localhost:3177", false).ok).toBe(false);
    expect(kiemMoiTruong("http://127.0.0.1:3000", false).ok).toBe(false);
    const dev = kiemMoiTruong("http://localhost:3177", true);
    expect(dev.ok).toBe(true);
    if (dev.ok) expect(dev.env).toEqual({ origin: "http://localhost:3177", host: "localhost:3177", mayDev: true });
    expect(kiemMoiTruong("https://localhost:3177", true).ok).toBe(false);
    for (const u of ["https://satarobo.vn", "https://admin.satarobo.vn", "http://admin.satarobo.vn", "https://test.satarobo.vn.evil.com", "http://localhost.evil.com"]) {
      expect(kiemMoiTruong(u, true).ok, u).toBe(false);
    }
  });

  it("[UNH-ENV-06] moiTruongTuEnv: chỉ UAT_MAY_DEV đúng chuỗi '1' mới mở localhost; thiếu UAT_BASE_URL thì NÉM", () => {
    expect(() => moiTruongTuEnv({ UAT_BASE_URL: "http://localhost:3177" })).toThrow(/Từ chối chạy/);
    expect(() => moiTruongTuEnv({ UAT_BASE_URL: "http://localhost:3177", UAT_MAY_DEV: "true" })).toThrow(/Từ chối chạy/);
    expect(moiTruongTuEnv({ UAT_BASE_URL: "http://localhost:3177", UAT_MAY_DEV: "1" }).mayDev).toBe(true);
    expect(() => moiTruongTuEnv({})).toThrow(/Từ chối chạy/);
    expect(moiTruongTuEnv({ UAT_BASE_URL: "https://test.satarobo.vn" }).origin).toBe("https://test.satarobo.vn");
  });
});

describe("[UNH-REQ] cổng host của trình duyệt: không request nào tới prod", () => {
  it("[UNH-REQ-01] cùng host test: cho (kể cả tài nguyên tĩnh và API)", () => {
    for (const u of ["https://test.satarobo.vn/login", "https://test.satarobo.vn/_next/static/x.js", "https://test.satarobo.vn/api/auth/session"]) {
      expect(phanLoaiRequest(u, false, TEST), u).toBe("cho");
      expect(phanLoaiRequest(u, true, TEST), u).toBe("cho");
    }
  });

  it("[UNH-REQ-02] chuyển trang (hoặc bất kỳ request) sang host satarobo.vn KHÁC test: CHẶN", () => {
    for (const u of ["https://admin.satarobo.vn/dashboard", "https://satarobo.vn/", "https://hocvien.satarobo.vn/portal", "https://giaovien.satarobo.vn/teacher", "https://api.satarobo.vn/x"]) {
      expect(phanLoaiRequest(u, true, TEST), `${u} (nav)`).toBe("chan");
      expect(phanLoaiRequest(u, false, TEST), `${u} (subresource)`).toBe("chan");
    }
  });

  it("[UNH-REQ-03] chuyển trang sang host lạ: CHẶN; tài nguyên tĩnh bên thứ ba: cho (ảnh chụp không vỡ)", () => {
    expect(phanLoaiRequest("https://evil.com/steal", true, TEST)).toBe("chan");
    expect(phanLoaiRequest("https://test.satarobo.vn.evil.com/", true, TEST)).toBe("chan");
    expect(phanLoaiRequest("https://fonts.gstatic.com/s/font.woff2", false, TEST)).toBe("cho");
  });

  it("[UNH-REQ-04] data:/blob:/about: cho; URL hỏng: CHẶN", () => {
    expect(phanLoaiRequest("data:image/png;base64,AAAA", false, TEST)).toBe("cho");
    expect(phanLoaiRequest("blob:https://test.satarobo.vn/abc", false, TEST)).toBe("cho");
    expect(phanLoaiRequest("about:blank", true, TEST)).toBe("cho");
    expect(phanLoaiRequest("not a url", false, TEST)).toBe("chan");
  });

  it("[UNH-REQ-05] chế độ máy dev: chỉ host:cổng đã khai là 'cùng host'", () => {
    const dev = layMoiTruong("http://localhost:3177", true);
    expect(phanLoaiRequest("http://localhost:3177/login", true, dev)).toBe("cho");
    expect(phanLoaiRequest("http://localhost:3178/login", true, dev)).toBe("chan");
    expect(phanLoaiRequest("https://admin.satarobo.vn/", true, dev)).toBe("chan");
  });
});

describe("[UNH-CHE] che bí mật khỏi bằng chứng", () => {
  const MK = "Mat-khau-UAT-9xQ#";
  it("[UNH-CHE-01] thay MỌI lần xuất hiện, kể cả trong khoá và mảng lồng nhau", () => {
    expect(cheBiMat(`a ${MK} b ${MK}`, [MK])).toBe("a *** b ***");
    const ra = cheBiMatSau({ [`k-${MK}`]: [`x${MK}`, { y: MK }], so: 5, ok: true, rong: null }, [MK]);
    expect(JSON.stringify(ra)).not.toContain(MK);
    expect(ra).toEqual({ "k-***": ["x***", { y: "***" }], so: 5, ok: true, rong: null });
  });
  it("[UNH-CHE-02] bí mật ngắn (< 6 ký tự) hoặc rỗng KHÔNG được dùng làm khoá thay (tránh xoá lung tung); mật khẩu UAT thật luôn ≥ 8", () => {
    expect(cheBiMat("abc abc", ["abc"])).toBe("abc abc");
    expect(cheBiMat("abc", [""])).toBe("abc");
  });
});

describe("[UNH-TEN] mã ca, mã đợt, tiền tố dữ liệu", () => {
  it("[UNH-TEN-01] mã ca lấy từ đầu tên test", () => {
    expect(maCaTuTen("[SRC-01] CRUD")).toBe("SRC-01");
    expect(maCaTuTen("  [SRC-25] x")).toBe("SRC-25");
    expect(maCaTuTen("SRC-01 thiếu ngoặc")).toBeNull();
    expect(maCaTuTen("x [SRC-01] ở giữa")).toBeNull();
  });
  it("[UNH-TEN-02] mã đợt chạy: chuẩn hoá HOA+số, 4–14 ký tự; ngoài khoảng ⇒ sinh từ đồng hồ truyền vào", () => {
    expect(maDotChay("25123456789 1", 0)).toBe("251234567891");
    expect(maDotChay("ab-cd12", 0)).toBe("ABCD12");
    expect(maDotChay("x", 36 * 36)).toBe("L100");
    expect(maDotChay(undefined, 36)).toBe("L10");
    expect(maDotChay("khong-hop-le-vi-qua-dai-123456789", 36)).toBe("L10");
  });
  it("[UNH-TEN-03] mã nguồn hợp lệ với luật mã của form (HOA, số, gạch dưới, ≤ 40) và tên mang tiền tố dữ liệu", () => {
    const ma = maNguon("251234567891", "B");
    expect(ma).toMatch(/^[A-Z0-9_]{3,40}$/);
    expect(ma.startsWith("UAT_SOURCE_FINAL_")).toBe(true);
    expect(maNguon("X".repeat(14), "B".repeat(30)).length).toBeLessThanOrEqual(40);
    expect(tenDuLieu("D1", "A")).toBe(`${TIEN_TO_DU_LIEU} D1 A`);
    expect(tenDuLieu("D1", "").startsWith(TIEN_TO_DU_LIEU)).toBe(true);
  });
});

describe("[UNH-VAI] bảng vai khớp seed UAT", () => {
  const seed = doc("prisma/seed-uat/00-tai-khoan.ts");
  const tuSeed = new Map<string, string | null>();
  for (const m of seed.matchAll(/\{ local: "(uat\.[a-z0-9]+)"[^}]*?roleCode: (?:"([A-Z_]+)"|null)/g)) tuSeed.set(m[1]!, m[2] ?? null);

  it("[UNH-VAI-01] đối chứng: bộ đọc thấy ≥ 12 tài khoản trong seed (không đọc rỗng)", () => {
    expect(tuSeed.size).toBeGreaterThanOrEqual(12);
    expect(tuSeed.get("uat.marketing")).toBe("HO_MARKETING");
  });

  it("[UNH-VAI-02] mỗi vai trong bảng tồn tại ở seed với ĐÚNG RoleDef (PARENT = null)", () => {
    for (const [khoa, v] of Object.entries(VAI)) {
      expect(tuSeed.has(v.local), `${khoa}: ${v.local} không có trong seed`).toBe(true);
      const goc = tuSeed.get(v.local);
      expect(v.roleCode === "PARENT" ? goc === null : goc === v.roleCode, `${khoa}: ${v.local} roleCode ${v.roleCode} ≠ seed ${goc}`).toBe(true);
    }
  });

  it("[UNH-VAI-03] đủ các vai mà các ca đang dùng (admin, marketing, giamdoc, ketoan, sale1, sale2, saleho, nhansu)", () => {
    for (const k of ["admin", "marketing", "giamdoc", "ketoan", "sale1", "sale2", "saleho", "nhansu"]) expect(Object.keys(VAI)).toContain(k);
  });
});

describe("[UNH-CA] tên ca", () => {
  const DIR = "tests/uat-nguon";
  const tep = readdirSync(resolve(process.cwd(), DIR)).filter((t) => t.endsWith(".uat.ts"));
  const tieuDe: string[] = [];
  for (const t of tep) for (const m of doc(join(DIR, t)).matchAll(/^test(?:\.skip)?\(\s*"([^"]+)"/gm)) tieuDe.push(m[1]!);

  it("[UNH-CA-01] đối chứng: đọc thấy các tệp ca và ≥ 10 ca", () => {
    expect(tep.length).toBeGreaterThanOrEqual(4);
    expect(tieuDe.length).toBeGreaterThanOrEqual(10);
  });
  it("[UNH-CA-02] mọi ca mở đầu bằng [SRC-xx] và mã ca KHÔNG trùng nhau giữa các tệp", () => {
    const ma = tieuDe.map((t) => maCaTuTen(t));
    expect(ma.every((m) => m !== null), `tên sai khuôn: ${tieuDe.filter((t) => maCaTuTen(t) === null).join(" | ")}`).toBe(true);
    const trung = ma.filter((m, i) => ma.indexOf(m) !== i);
    expect(trung, "mã ca trùng").toEqual([]);
  });
});
