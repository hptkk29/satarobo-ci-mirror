// @vitest-environment node
/**
 * P1·3 — cổng phân quyền ở tầng ROUTE / LAYOUT của khu E-learning (kiểm toán 23/10/2026).
 *
 * Trước đây: hai cron và route xuất R1 không có test mức route; layout khu E-learning không
 * kiểm phiên còn sống (admin / teacher / portal đều kiểm). Bộ này khoá lại hai thứ:
 *   1. HÀNH VI của hai cron: không Bearer / sai Bearer / thiếu CRON_SECRET ⇒ 401 và KHÔNG
 *      chạy việc nào; Bearer đúng + cờ OFF ⇒ bỏ qua; Bearer đúng + cờ ON ⇒ chạy đúng một lần.
 *   2. NGUỒN: layout dùng `checkSessionLiveness`; route xuất R1 dùng `requireLiveSession`
 *      (không `auth()` trần) — hai thứ này là SEC-M11, mất đi không test hành vi nào bắt được
 *      vì cần DB thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  enabled: true,
  nhacBat: true,
  runDem: vi.fn(async () => ({ chay: "dem" })),
  runReminders: vi.fn(async () => ({ chay: "nhac" })),
}));

vi.mock("@/lib/flags", () => ({
  isElearningEnabled: () => h.enabled,
  isElearningReminderEnabled: () => h.nhacBat,
}));
vi.mock("@/lib/elearning/cron-dem", () => ({ runElearningDem: h.runDem }));
vi.mock("@/lib/elearning/cron-reminders", () => ({ runElearningReminders: h.runReminders }));

import { GET as getDem } from "@/app/api/cron/elearning-dem/route";
import { GET as getReminders } from "@/app/api/cron/elearning-reminders/route";

// Giá trị CỐ Ý ngắn và entropy thấp: gitleaks của bước đẩy ảnh chụp sang gương chặn mọi chuỗi giống
// khoá thật (đã vấp ở lượt đầu của PR này), và test không cần bí mật thật để kiểm so sánh Bearer.
const MA_CRON = "ma-thu";
const goi = (authorization?: string) =>
  new NextRequest("http://localhost/api/cron/x", {
    headers: authorization === undefined ? {} : { authorization },
  });

const CRON = [
  { ten: "elearning-dem", get: getDem, run: h.runDem },
  { ten: "elearning-reminders", get: getReminders, run: h.runReminders },
] as const;

const envCu = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  h.enabled = true;
  h.nhacBat = true;
  process.env.CRON_SECRET = MA_CRON;
});
afterEach(() => {
  if (envCu === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = envCu;
});

for (const c of CRON) {
  describe(`cron ${c.ten} — cổng xác thực`, () => {
    it("không có header Authorization ⇒ 401 và KHÔNG chạy việc nào", async () => {
      const r = await c.get(goi());
      expect(r.status).toBe(401);
      expect(c.run).not.toHaveBeenCalled();
    });

    it("Bearer sai ⇒ 401, không chạy", async () => {
      const r = await c.get(goi("Bearer sai-bi-mat"));
      expect(r.status).toBe(401);
      expect(c.run).not.toHaveBeenCalled();
    });

    it("đúng bí mật nhưng thiếu tiền tố Bearer ⇒ 401", async () => {
      const r = await c.get(goi(MA_CRON));
      expect(r.status).toBe(401);
      expect(c.run).not.toHaveBeenCalled();
    });

    it("FAIL-CLOSED: CRON_SECRET không đặt + Bearer rỗng ⇒ vẫn 401", async () => {
      delete process.env.CRON_SECRET;
      for (const header of ["Bearer ", "Bearer undefined", "Bearer"]) {
        const r = await c.get(goi(header));
        expect(r.status, header).toBe(401);
      }
      expect(c.run).not.toHaveBeenCalled();
    });

    it("Bearer đúng + cờ OFF ⇒ 200 bỏ qua, KHÔNG chạy", async () => {
      h.enabled = false;
      const r = await c.get(goi(`Bearer ${MA_CRON}`));
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ data: { skipped: "flag OFF" } });
      expect(c.run).not.toHaveBeenCalled();
    });

    it("đối chứng dương: Bearer đúng + cờ ON ⇒ chạy đúng MỘT lần", async () => {
      const r = await c.get(goi(`Bearer ${MA_CRON}`));
      expect(r.status).toBe(200);
      expect(c.run).toHaveBeenCalledTimes(1);
    });
  });
}

describe("SEC-M11 — phiên phải còn SỐNG so với DB (chặn ở nguồn)", () => {
  const doc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const chiMa = (src: string) =>
    src
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

  it("layout khu E-learning gọi checkSessionLiveness và đá sang /dang-xuat khi chết", () => {
    const src = chiMa(doc("app/(elearning)/elearning/layout.tsx"));
    expect(src).toContain("checkSessionLiveness");
    expect(src).toMatch(/redirect\(`\/dang-xuat\?reason=\$\{liveness\.reason\}`\)/);
  });

  it("liveness đứng SAU cổng đăng nhập và TRƯỚC truy vấn hồ sơ nhân sự (rẻ → đắt)", () => {
    const src = chiMa(doc("app/(elearning)/elearning/layout.tsx"));
    const dangNhap = src.indexOf('redirect("/login")');
    const sinhDong = src.indexOf("checkSessionLiveness(");
    const hoSo = src.indexOf("sdb.employee.findFirst");
    expect(dangNhap).toBeGreaterThan(-1);
    expect(sinhDong).toBeGreaterThan(dangNhap);
    expect(hoSo).toBeGreaterThan(sinhDong);
  });

  it("route xuất Excel R1 dùng requireLiveSession, KHÔNG auth() trần", () => {
    const src = chiMa(doc("app/api/elearning/bao-cao-r1/route.ts"));
    expect(src).toContain("requireLiveSession()");
    expect(src).not.toMatch(/\bawait auth\(\)/);
  });

  it("route tải PDF chứng nhận dùng requireLiveSession, KHÔNG auth() trần", () => {
    // Bản PDF mang họ tên + mã nhân viên + lịch sử đào tạo của một con người, và nó rời hệ
    // thống ngay khi được tải: cùng hạng với export Excel R1. Tài khoản đã khoá / đổi
    // tokenVersion mà JWT còn hạn không được tải thêm tấm nào.
    const src = chiMa(doc("app/api/elearning/chung-nhan/route.ts"));
    expect(src).toContain("requireLiveSession()");
    expect(src).not.toMatch(/\bawait auth\(\)/);
  });
});

describe("🔴 cờ REMINDER — chỉ chặn cron NHẮC, không chặn cron đêm (đặc tả EL-06 mục 7)", () => {
  const bearer = `Bearer ${MA_CRON}`;

  it("REMINDER tắt (cờ chung ON) ⇒ route VẪN gọi cron nhưng truyền nhacBat=false — để nó chặn đúng việc NHẮC", async () => {
    // Trước: route return sớm {skipped} ⇒ cờ nhắc tắt cũng tắt luôn chốt chứng nhận hết hạn và giao lại vòng
    // (cùng khe cron). Nay cổng nằm TRONG `runElearningReminders` (xem lib/elearning/cron-reminders.test.ts).
    h.nhacBat = false;
    const r = await getReminders(goi(bearer));
    expect(r.status).toBe(200);
    expect(h.runReminders).toHaveBeenCalledTimes(1);
    expect(h.runReminders).toHaveBeenCalledWith(expect.any(Date), { nhacBat: false });
  });

  it("ĐỐI CHỨNG: REMINDER bật ⇒ chạy đúng một lần với nhacBat=true", async () => {
    const r = await getReminders(goi(bearer));
    expect(r.status).toBe(200);
    expect(h.runReminders).toHaveBeenCalledTimes(1);
    expect(h.runReminders).toHaveBeenCalledWith(expect.any(Date), { nhacBat: true });
  });

  it("REMINDER tắt KHÔNG làm cron đêm `elearning-dem` ngừng chạy", async () => {
    h.nhacBat = false;
    await getDem(goi(bearer));
    expect(h.runDem).toHaveBeenCalledTimes(1);
  });

  it("nguồn: cron nhắc dùng quaCuaSoBu để SKIPPED mốc quá 24h", () => {
    // Chỉ MÃ, không chú thích: lời giải thích bản vá cũng chứa tên hàm (luật 11).
    const src = readFileSync(join(process.cwd(), "lib/elearning/cron-reminders.ts"), "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(src).toContain("quaCuaSoBu(");
  });
});
