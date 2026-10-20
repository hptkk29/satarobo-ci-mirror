/**
 * `db-gate.ts` — CỔNG quyết định "bộ test có được đụng Postgres thật không".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO FILE NÀY TỒN TẠI
 *
 * Đây là một trong những cổng NGUY HIỂM nhất của repo — nó đứng trước `resetDb()`, thứ
 * `TRUNCATE` mọi bảng trong `public`. Nó được dựng 04/09/2026 sau sự cố mất 250 học viên ·
 * 100 lớp · 609 buổi · 12 tài khoản UAT.
 *
 * Và cho tới 09/09/2026 nó **KHÔNG có test nào của chính nó** (luật 14).
 *
 * Hai nửa nghĩa vụ (luật 16), và nửa thứ hai mới là nửa dễ đọc sai:
 *
 *   · CHẶN sai lúc  ⇒ hỏng thì mất dữ liệu — ồn ào, có người thấy ngay;
 *   · CHO QUA đúng lúc ⇒ hỏng thì **mọi bộ test chạm DB skip hoặc đỏ hết**, và triệu chứng
 *     đó dễ bị đọc thành "CI hỏng" / "Postgres chết" / "test đang sửa dở". Tuần này ta vừa
 *     mất một buổi vì đúng hình dạng đó — 9 ca đỏ hoá ra chỉ là thiếu `NEXTAUTH_SECRET`.
 *
 * ⚠️ Module đọc `process.env` LÚC NHẬP và xuất ra hằng số. Nên mỗi ca phải `resetModules()`
 * rồi nhập lại — sửa `process.env` sau khi nhập thì không đổi được gì.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Gate = typeof import("./db-gate");

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test";
const CI = "postgresql://ci:ci@localhost:5432/ci_test";
const XA = "postgresql://postgres.abc:matkhau@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";

const KHOA = [
  "TEST_DATABASE_URL",
  "DATABASE_URL",
  "ALLOW_DB_RESET",
  "VITEST",
  "CHAT_DB_TEST_ALLOW_REMOTE",
] as const;

const GOC = new Map(KHOA.map((k) => [k, process.env[k]]));

/**
 * Nhập lại module với đúng bộ env của ca test.
 *
 * ⚠️ `undefined` phải là XOÁ HẲN biến, không phải đặt thành chuỗi rỗng. `db-gate` dùng
 * `??`, mà `""` KHÔNG nullish — đặt rỗng thì nó không rơi về `DATABASE_URL`. Bản đầu của
 * giá đỡ này đặt `""` và làm một ca đỏ vì lý do chẳng liên quan tới cổng.
 */
async function nap(env: Partial<Record<(typeof KHOA)[number], string | undefined>>): Promise<Gate> {
  vi.resetModules();
  for (const k of KHOA) {
    if (!(k in env)) continue;
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (await import("./db-gate")) as Gate;
}

afterEach(() => {
  for (const [k, v] of GOC) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

describe("db-gate — nửa CHẶN", () => {
  it("URL trỏ Supabase (không local) ⇒ KHÔNG chạy, dù có cờ", async () => {
    // Cổng ĐỊA CHỈ. Đây là vế chặn "trỏ nhầm prod/dev".
    const g = await nap({ TEST_DATABASE_URL: XA, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.HAS_LOCAL_DB).toBe(false);
    expect(g.RUN_DB_TESTS).toBe(false);
    expect(g.LY_DO_BO_QUA).toContain("không trỏ Postgres test cục bộ");
  });

  it("URL local nhưng THIẾU cờ, đang chạy dưới Vitest ⇒ KHÔNG chạy", async () => {
    // Cổng CHỦ ĐÍCH. Đây là vế chặn "đúng địa chỉ nhưng SAI LÚC" — đúng ca đã xoá sạch
    // DB làm việc hôm 04/09 khi `pnpm test:unit` gom cả bộ chạm DB.
    const g = await nap({ TEST_DATABASE_URL: LOCAL, ALLOW_DB_RESET: undefined, VITEST: "true" });
    expect(g.HAS_LOCAL_DB).toBe(true);
    expect(g.DB_RESET_ALLOWED).toBe(false);
    expect(g.RUN_DB_TESTS).toBe(false);
    // Câu bỏ qua phải NÓI CÁCH BẬT, không chỉ nói "bị chặn" (luật 12).
    expect(g.LY_DO_BO_QUA).toContain("ALLOW_DB_RESET=1");
    expect(g.LY_DO_BO_QUA).toContain("test:chat-db");
  });

  it("cờ đặt sai giá trị (`true`, `yes`) KHÔNG được coi là bật", async () => {
    // Chỉ đúng chuỗi "1". Nhận bừa mọi giá trị truthy là mở lại cửa bằng một lần gõ nhầm.
    for (const v of ["true", "yes", "0", " 1"]) {
      const g = await nap({ TEST_DATABASE_URL: LOCAL, ALLOW_DB_RESET: v, VITEST: "true" });
      expect(g.DB_RESET_ALLOWED, `ALLOW_DB_RESET=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("KHÔNG in URL trần — mật khẩu phải bị che", async () => {
    // Câu bỏ qua đi vào log CI. Rò chuỗi kết nối ở đó là rò vĩnh viễn.
    const g = await nap({ TEST_DATABASE_URL: XA, VITEST: "true" });
    expect(g.DB_URL_CHE).not.toContain("matkhau");
    expect(g.DB_URL_CHE).toContain("***");
  });

  it("không có URL nào ⇒ KHÔNG chạy, và không nổ", async () => {
    const g = await nap({ TEST_DATABASE_URL: undefined, DATABASE_URL: undefined, VITEST: "true" });
    expect(g.RUN_DB_TESTS).toBe(false);
    expect(g.DB_URL_CHE).toBe("trống");
  });

  it("`TEST_DATABASE_URL` RỖNG không rơi về `DATABASE_URL` — đây là `??`, không phải `||`", async () => {
    // Ghi lại hành vi THẬT để lần đổi sau là có chủ đích. Đặt biến thành chuỗi rỗng KHÁC
    // hẳn không đặt: `"" ?? x` trả `""`. Ai xuất `TEST_DATABASE_URL=` trong shell rồi
    // tưởng nó rơi về `DATABASE_URL` sẽ thấy mọi bộ DB skip mà không hiểu vì sao.
    const g = await nap({ TEST_DATABASE_URL: "", DATABASE_URL: LOCAL, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.RUN_DB_TESTS).toBe(false);
    expect(g.DB_URL_CHE).toBe("trống");
  });

  it("cửa hậu REMOTE cần CẢ URL lẫn cờ riêng — cờ một mình không mở", async () => {
    const chiCo = await nap({ TEST_DATABASE_URL: undefined, DATABASE_URL: undefined, CHAT_DB_TEST_ALLOW_REMOTE: "1", VITEST: "true" });
    expect(chiCo.ALLOW_REMOTE, "URL rỗng thì cửa hậu KHÔNG mở").toBe(false);
  });
});

describe("db-gate — nửa CHO QUA (luật 16)", () => {
  // Không có mấy ca này thì một bản vá làm cổng chặn VÔ ĐIỀU KIỆN vẫn xanh, và mọi bộ
  // test chạm DB im lặng ngừng chạy — bộ test sẽ khen một hệ thống đã tắt.

  it("URL local + cờ đúng ⇒ CHẠY", async () => {
    const g = await nap({ TEST_DATABASE_URL: LOCAL, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.HAS_LOCAL_DB).toBe(true);
    expect(g.DB_RESET_ALLOWED).toBe(true);
    expect(g.RUN_DB_TESTS, "đây là đường mà `pnpm test:chat-db` đi").toBe(true);
  });

  it("`ci_test` cũng là DB test hợp lệ — CI dùng đúng tên đó", async () => {
    const g = await nap({ TEST_DATABASE_URL: CI, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.RUN_DB_TESTS).toBe(true);
  });

  it("NGOÀI Vitest (Playwright) ⇒ giữ hành vi cũ, không cần cờ", async () => {
    // Cờ sinh ra để chặn `pnpm test:unit`. Bộ Playwright dùng Postgres dùng-rồi-bỏ và
    // CI dựng container riêng cho nó — bắt nó khai cờ là chặn nhầm cả bộ E2E.
    const g = await nap({ TEST_DATABASE_URL: LOCAL, ALLOW_DB_RESET: undefined, VITEST: "false" });
    expect(g.DB_RESET_ALLOWED).toBe(true);
    expect(g.RUN_DB_TESTS).toBe(true);
  });

  it("`DATABASE_URL` dùng được khi không có `TEST_DATABASE_URL`", async () => {
    const g = await nap({ TEST_DATABASE_URL: undefined, DATABASE_URL: LOCAL, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.RUN_DB_TESTS).toBe(true);
  });

  it("cửa hậu REMOTE mở được khi có ĐỦ URL + cờ + quyền reset", async () => {
    const g = await nap({
      TEST_DATABASE_URL: XA,
      CHAT_DB_TEST_ALLOW_REMOTE: "1",
      ALLOW_DB_RESET: "1",
      VITEST: "true",
    });
    expect(g.ALLOW_REMOTE).toBe(true);
    expect(g.RUN_DB_TESTS, "nghiệm thu tay trên DB từ xa vẫn phải làm được").toBe(true);
  });
});

describe("[DBG-TEN] cổng theo TÊN database (TEST-09)", () => {
  it("[DBG-TEN-01] DB của dev server (satarobo_local) / satarobo_dev ⇒ TỪ CHỐI dù trên 127.0.0.1", async () => {
    const g = await nap({});
    expect(g.laDbDungDeTest("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_local")).toBe(false);
    expect(g.laDbDungDeTest("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_dev")).toBe(false);
    expect(g.laDbDungDeTest("postgresql://postgres:postgres@127.0.0.1:5432/postgres")).toBe(false);
    expect(g.laDbDungDeTest("")).toBe(false);
    // Tunnel VPS mang ĐÚNG tên satarobo_test — tên hợp lệ không được mở đường tới dữ liệu thật.
    expect(g.laDbDungDeTest("postgresql://satarobo_test:x@127.0.0.1:5435/satarobo_test")).toBe(false);
    expect(g.laDbDungDeTest("postgresql://satarobo:x@127.0.0.1:5433/satarobo_test")).toBe(false);
  });

  it("[DBG-TEN-02] DB test hợp lệ (kể cả DB riêng có hậu tố, và có query string) ⇒ cho qua", async () => {
    const g = await nap({});
    expect(g.laDbDungDeTest(LOCAL)).toBe(true);
    expect(g.laDbDungDeTest(CI)).toBe(true);
    expect(g.laDbDungDeTest("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test_suabe?schema=public")).toBe(true);
    expect(g.laDbDungDeTest("postgresql://postgres:postgres@127.0.0.1:5432/satarobo_vitest")).toBe(true);
  });

  it("[DBG-TEN-03] assertTenDbTest ném với satarobo_local, im với satarobo_test", async () => {
    const g = await nap({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/satarobo_local" });
    expect(() => g.assertTenDbTest()).toThrow(/satarobo_local/);
    const g2 = await nap({ DATABASE_URL: LOCAL });
    expect(() => g2.assertTenDbTest()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [DBG-TUN] 28/09/2026 — DB prod/test chuyển lên VPS, tới được qua SSH tunnel
// 127.0.0.1:5433 (PROD) / 127.0.0.1:5435 (TEST, tên `satarobo_test`). Cổng địa chỉ cũ hỏi
// "127.0.0.1 hoặc tên satarobo_test" ⇒ tunnel qua CẢ HAI vế ⇒ `pnpm test:*-db` trỏ :5435 là
// TRUNCATE dữ liệu của test.satarobo.vn (docs/VPS-VAN-HANH.md: "đã suýt xảy ra 28/09").
// ─────────────────────────────────────────────────────────────────────────────
describe("[DBG-TUN] tunnel VPS KHÔNG phải DB máy", () => {
  const TUNNEL_TEST = "postgresql://satarobo_test:matkhau@127.0.0.1:5435/satarobo_test";
  const TUNNEL_PROD = "postgresql://satarobo:matkhau@127.0.0.1:5433/satarobo";

  it("[DBG-TUN-01] cổng 5435 (DB test trên VPS) ⇒ KHÔNG chạy dù đủ cờ, lý do gọi tên tunnel", async () => {
    const g = await nap({ TEST_DATABASE_URL: TUNNEL_TEST, ALLOW_DB_RESET: "1", VITEST: "true" });
    expect(g.HAS_LOCAL_DB).toBe(false);
    expect(g.RUN_DB_TESTS).toBe(false);
    expect(g.LY_DO_BO_QUA).toContain("5435");
    expect(g.LY_DO_BO_QUA).toContain("tunnel");
    expect(g.LY_DO_BO_QUA).not.toContain("matkhau");
  });

  it("[DBG-TUN-02] cổng 5433 (DB PROD trên VPS) ⇒ KHÔNG chạy, kể cả ngoài Vitest", async () => {
    for (const vitest of ["true", "false"]) {
      const g = await nap({ TEST_DATABASE_URL: TUNNEL_PROD, ALLOW_DB_RESET: "1", VITEST: vitest });
      expect(g.RUN_DB_TESTS, `VITEST=${vitest}`).toBe(false);
      expect(g.LY_DO_BO_QUA).toContain("5433");
    }
  });

  it("[DBG-TUN-03] cửa hậu REMOTE cũng KHÔNG mở được tunnel", async () => {
    const g = await nap({
      TEST_DATABASE_URL: TUNNEL_TEST,
      CHAT_DB_TEST_ALLOW_REMOTE: "1",
      ALLOW_DB_RESET: "1",
      VITEST: "true",
    });
    expect(g.ALLOW_REMOTE).toBe(false);
    expect(g.RUN_DB_TESTS).toBe(false);
  });

  it("[DBG-TUN-04] đối chứng dương: cùng máy, cổng 5432 ⇒ CHẠY", async () => {
    const g = await nap({
      TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test_ipcaddy",
      ALLOW_DB_RESET: "1",
      VITEST: "true",
    });
    expect(g.HAS_LOCAL_DB).toBe(true);
    expect(g.RUN_DB_TESTS).toBe(true);
  });
});
