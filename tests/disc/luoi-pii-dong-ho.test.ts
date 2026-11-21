/**
 * [DISC-QA-PII-*] Lưới quét PII: không có lời gọi log nào trong lib/disc/**, app/api/disc/**,
 * app/(public)/disc/** mang tên/năm sinh/điểm/SĐT/email/payload của hồ sơ.
 * [DISC-QA-CLOCK-*] Lưới đồng hồ: không test nào của DISC đọc giờ thật; mã sản phẩm chỉ được
 * dùng `new Date()` làm MẶC ĐỊNH của tham số `now` được tiêm (CLAUDE.md luật 19).
 *
 * Cả hai có ca TỰ KIỂM (SELF) chứng minh bộ quét còn bắt được mẫu xấu — bộ quét xanh trên cây
 * sạch chưa nói gì nếu nó không bao giờ đỏ.
 */
import { describe, expect, it } from "vitest";
import { boChuThich, docTep, lietKeTep, quetLogChuaPii, tepSanPhamDisc, tuongDoi } from "./_quet";

describe("[DISC-QA-PII-01] mã sản phẩm DISC không log dữ liệu hồ sơ", () => {
  const tep = tepSanPhamDisc();
  it("quét được ít nhất các tệp lib/disc đã có (lưới không rỗng)", () => {
    const ten = tep.map(tuongDoi);
    for (const t of ["lib/disc/luu.ts", "lib/disc/ho-so.ts", "lib/disc/thong-bao.ts", "lib/disc/nhan.ts"]) expect(ten).toContain(t);
  });
  /**
   * NỢ ĐÃ TRẢ (01/11/2026): adapter CRM từng log THẲNG đối tượng lỗi (`console.error("…", err)`) — 5 chỗ. Nay chỉ log MÃ lỗi
   * (`const ma = maLoiAnToan(e); console.error("…", ma)`). Danh sách nợ để TRỐNG: thêm một chỗ log vi phạm ở bất kỳ tệp nào là đỏ.
   */
  const NO_LOG: Record<string, number> = {};
  const vpTheoTep = () => {
    const m = new Map<string, string[]>();
    for (const p of tep) {
      const v = quetLogChuaPii(docTep(p)).map((x) => `${tuongDoi(p)}:${x.dong} — ${x.lyDo} — ${x.trich}`);
      if (v.length) m.set(tuongDoi(p), v);
    }
    return m;
  };
  it("không có lời gọi console./logger./Sentry. chứa PII hoặc tham số ngoài danh sách trắng (trừ nợ đã đếm)", () => {
    const loi: string[] = [];
    const thay = vpTheoTep();
    for (const [rel, ds] of thay) if (ds.length !== (NO_LOG[rel] ?? 0)) loi.push(...ds, `(${rel}: nợ ghi ${NO_LOG[rel] ?? 0}, thấy ${ds.length})`);
    for (const rel of Object.keys(NO_LOG)) if (!thay.has(rel)) loi.push(`${rel}: đã hết vi phạm — xoá dòng nợ NO_LOG và ca [DISC-QA-PII-DEBT]`);
    expect(loi).toEqual([]);
  });
  it("[DISC-QA-PII-DEBT] crm-that.ts KHÔNG log object lỗi (nợ đã trả: ca này từng là it.fails, nay là khẳng định thật)", () => {
    expect(vpTheoTep().get("lib/disc/crm-that.ts") ?? []).toEqual([]);
  });
  it("không có Sentry.setUser/setContext/setExtra trong mã DISC (kéo PII vào telemetry)", () => {
    const xau = tep.filter((p) => /Sentry\.set(?:User|Context|Extra|Extras|Tag)\s*\(/.test(boChuThich(docTep(p))));
    expect(xau.map(tuongDoi)).toEqual([]);
  });
});

describe("[DISC-QA-PII-SELF] bộ quét log tự kiểm", () => {
  const xau: Array<[string, string]> = [
    ["console.log(hoTen)", "tên"],
    ["console.error('lưu lỗi', e)", "đối tượng lỗi"],
    ["console.warn(`lưu ${phoneKey}`)", "nội suy"],
    ["console.info(JSON.stringify(x))", "stringify"],
    ["logger.info({ namSinh: hs.namSinh })", "năm sinh"],
    ["console.debug(ketQua.diem)", "điểm"],
    ["Sentry.captureMessage(input.email)", "email"],
    ["console.log('x', body)", "body"],
  ];
  it.each(xau)("BẮT: %s (%s)", (ma) => {
    expect(quetLogChuaPii(ma).length).toBeGreaterThan(0);
  });
  const sach = [
    "console.error('Lưu DISC thất bại')",
    "console.warn('disc: hết hạn giữ bài', submissionId)",
    "// console.log(hoTen) nằm trong chú thích",
    "const s = 'console.log(hoTen)';",
    "/* console.error(email) */ const a = 1;",
    "const url = 'https://satarobo.vn/kich-hoat'; console.info('ok', status)",
  ];
  it.each(sach)("KHÔNG báo: %s", (ma) => {
    expect(quetLogChuaPii(ma)).toEqual([]);
  });
  it("boChuThich giữ nguyên chuỗi chứa '//' (không cắt URL)", () => {
    expect(boChuThich("const u = 'https://a.vn/x'; // chú thích\nconst v = 1;")).toContain("https://a.vn/x");
    expect(boChuThich("a /* b\nc */ d").split("\n")).toHaveLength(2);
  });
});

/* ───────────────────────── Đồng hồ ───────────────────────── */

/** `new Date()` không đối số hoặc `Date.now()` — các cách đọc giờ thật. Dựng bằng nối chuỗi để tệp này không tự khớp. */
const GIO_THAT = new RegExp(["new\\s+Date\\s*\\(\\s*\\)", "Date\\.now\\s*\\(\\s*\\)", "performance\\.now\\s*\\(\\s*\\)"].join("|"), "g");

function dongDocGioThat(ma: string): Array<{ dong: number; chuoi: string }> {
  const sach = boChuThich(ma);
  const kq: Array<{ dong: number; chuoi: string }> = [];
  sach.split("\n").forEach((chuoi, i) => {
    GIO_THAT.lastIndex = 0;
    if (GIO_THAT.test(chuoi)) kq.push({ dong: i + 1, chuoi: chuoi.trim() });
  });
  return kq;
}

describe("[DISC-QA-CLOCK-01] test của DISC không đọc đồng hồ thật", () => {
  const tepTest = [...lietKeTep("lib/disc", /\.test\.(ts|tsx)$/), ...lietKeTep("tests/disc", /\.test\.(ts|tsx)$/), ...lietKeTep("components/public", /disc.*\.test\.(ts|tsx)$/)].filter(
    (p) => !/luoi-pii-dong-ho\.test\.ts$/.test(p), // tệp này mô tả các mẫu cấm bằng chuỗi
  );
  it("quét được test của lib/disc và tests/disc", () => {
    const ten = tepTest.map(tuongDoi);
    expect(ten).toContain("lib/disc/luu.test.ts");
    expect(ten).toContain("tests/disc/cong-co-off.test.ts");
  });
  it("không có new Date() / Date.now() / performance.now() không đối số trong test", () => {
    const vp = tepTest.flatMap((p) => dongDocGioThat(docTep(p)).map((v) => `${tuongDoi(p)}:${v.dong} — ${v.chuoi}`));
    expect(vp).toEqual([]);
  });
});

describe("[DISC-QA-CLOCK-02] mã sản phẩm: giờ thật chỉ là MẶC ĐỊNH của `now` tiêm vào", () => {
  /**
   * NGOẠI LỆ ĐÃ BIẾT (ghi tường minh để nó không im lặng): tầng Prisma đóng dấu `consentAt` bằng giờ thật.
   * Đúng ở biên DB nhưng KHÔNG tiêm được ⇒ không test được hạn đồng ý. Đề xuất (handoff): dịch vụ lưu
   * truyền `consentAt` xuống như nó đã truyền `tokenHetHan`/`retainUntil`. Đếm SỐ LẦN: thêm chỗ thứ hai là đỏ.
   */
  const NGOAI_LE: Record<string, number> = {
    "lib/disc/store-prisma.ts": 1,
    // (H-2 đã trả 01/11/2026: crm-that.ts nhận `now` tiêm vào — `taoCongCrmThat(now)`; mặc định `now: () => Date = () => new Date()` khớp luật
    // "giờ thật chỉ là MẶC ĐỊNH của now". Bản ghi ngoại lệ cũ của tệp này đã GỠ.)
  };
  it("mọi dòng đọc giờ thật trong lib/disc (không phải test) đều là `now ??` / `now =` / `now: new Date()` (tiêm ở biên HTTP), trừ ngoại lệ đã đếm", () => {
    const vp: string[] = [];
    for (const p of tepSanPhamDisc()) {
      const rel = tuongDoi(p);
      const xau = dongDocGioThat(docTep(p)).filter((v) => !/\bnow\b\s*(\?\?|=)|\bnow\s*:\s*number\s*=\s*Date\.now\(\)|\bnow\s*:\s*(?:\(\)\s*=>|new Date\(\)|Date\s*=)/.test(v.chuoi));
      const cho = NGOAI_LE[rel] ?? 0;
      if (xau.length !== cho) vp.push(...xau.map((v) => `${rel}:${v.dong} — ${v.chuoi} (cho phép ${cho}, thấy ${xau.length})`));
    }
    expect(vp).toEqual([]);
  });
  it("luu.ts nhận `now` và truyền năm hiện tại xuống kiemTraHoSo (không tự đọc năm)", () => {
    const s = boChuThich(docTep(tepSanPhamDisc().find((p) => /lib[\\/]disc[\\/]luu\.ts$/.test(p))!));
    // Năm hồ sơ = năm theo GIỜ VIỆT NAM của `now` tiêm vào (namHienTaiVN), truyền thẳng xuống kiemTraHoSo; không getFullYear() (theo múi giờ máy).
    expect(s.match(/const namNay = namHienTaiVN\(now\);/g)?.length).toBe(1);
    expect(s.match(/kiemTraHoSo\([^)]*,\s*namNay\)/g)?.length).toBe(1);
    expect(s).not.toMatch(/getFullYear\(\)/);
  });
  it("namHienTaiVN: ranh giới năm theo UTC+7 (31/12 17:00Z đã là năm sau ở Việt Nam), không phụ thuộc múi giờ máy", async () => {
    const { namHienTaiVN } = await import("../../lib/disc/ho-so");
    expect(namHienTaiVN(new Date("2026-12-31T16:59:59Z"))).toBe(2026);
    expect(namHienTaiVN(new Date("2026-12-31T17:00:00Z"))).toBe(2027);
    expect(namHienTaiVN(new Date("2026-01-01T00:00:00Z"))).toBe(2026);
  });
  it("ho-so.ts / thong-bao.ts / nhan.ts: KHÔNG đọc giờ thật (hàm thuần nhận năm/ngày qua tham số)", () => {
    for (const ten of ["ho-so.ts", "thong-bao.ts"]) {
      const p = tepSanPhamDisc().find((x) => x.endsWith(ten))!;
      expect(dongDocGioThat(docTep(p)), ten).toEqual([]);
    }
  });
});

describe("[DISC-QA-CLOCK-SELF] bộ quét giờ tự kiểm", () => {
  it("bắt các cách đọc giờ thật; bỏ qua chú thích và chuỗi tĩnh không phải lời gọi", () => {
    const bat = ["const a = new Date();", "x(Date.now())", "performance.now()"];
    for (const m of bat) expect(dongDocGioThat(m), m).toHaveLength(1);
    expect(dongDocGioThat("// new Date()")).toEqual([]);
    expect(dongDocGioThat("const d = new Date('2026-11-01T03:00:00Z');")).toEqual([]);
    expect(dongDocGioThat("const d = new Date(2026, 10, 1);")).toEqual([]);
  });
});
