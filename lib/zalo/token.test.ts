import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (server-only được alias sang stub rỗng trong vitest.config.ts)

// DB giả: 1 ô IntegrationConfig in-memory + $transaction (P4 — refresh có khoá).
let store: { settings: unknown } | null = null;
/** Ghi đè giá trị tx ĐỌC ĐƯỢC SAU KHI GIÀNH KHOÁ — mô phỏng instance khác vừa refresh. */
let txStoreOverride: { settings: unknown } | null = null;
/** Số lần tx.upsert ném lỗi — mô phỏng ghi DB hỏng sau khi Zalo đã xoay token. */
let txUpsertFailCount = 0;

function applyUpsert({
  update,
  create,
}: {
  update: { settings: unknown };
  create: { settings: unknown };
}) {
  store = { settings: store ? update.settings : create.settings };
  return store;
}

vi.mock("@/lib/db", () => ({
  db: {
    integrationConfig: {
      findUnique: vi.fn(async () => store),
      upsert: vi.fn(async (args: never) => applyUpsert(args)),
    },
    $transaction: vi.fn(async (fn: (tx: never) => Promise<unknown>) =>
      fn({
        // Khoá advisory. CỐ Ý chỉ mock $executeRaw: dùng $queryRaw cho
        // `pg_advisory_xact_lock()` (trả `void`) làm Prisma ném "Failed to
        // deserialize column of type 'void'" trên Postgres THẬT — bug prod
        // 31/07. Mock cũ trả [{}] nên che mất; nay quay lại $queryRaw là test
        // đỏ ngay ("not a function"). Ràng buộc thật nằm ở e2e a0
        // zalo-token-lock.spec.ts (chạy trên Postgres local).
        $executeRaw: vi.fn(async () => 1),
        integrationConfig: {
          findUnique: vi.fn(async () => txStoreOverride ?? store),
          upsert: vi.fn(async (args: never) => {
            if (txUpsertFailCount > 0) {
              txUpsertFailCount--;
              throw new Error("tx write fail");
            }
            return applyUpsert(args);
          }),
        },
      } as never),
    ),
  },
}));

import { getValidZaloAccessToken, refreshZaloToken, forceRefreshZaloToken } from "./token";

const NOW = 1_000_000_000_000;

function mockFetch(json: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => json }) as unknown as Response));
}

const ENV_KEYS = ["ZALO_APP_ID", "ZALO_APP_SECRET", "ZALO_OA_REFRESH_TOKEN", "ZALO_OA_ACCESS_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  store = null;
  txStoreOverride = null;
  txUpsertFailCount = 0;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ZALO_APP_ID = "app123";
  process.env.ZALO_APP_SECRET = "secret123";
  process.env.ZALO_OA_REFRESH_TOKEN = "env-refresh";
  delete process.env.ZALO_OA_ACCESS_TOKEN;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("refreshZaloToken", () => {
  it("đổi refresh_token → lưu access+refresh mới, tính expiresAt từ expires_in", async () => {
    mockFetch({ access_token: "AT_new", refresh_token: "RT_new", expires_in: "3600" });
    const r = await refreshZaloToken("RT_old", NOW);
    expect(r).toEqual({ accessToken: "AT_new", refreshToken: "RT_new", expiresAt: NOW + 3600 * 1000 });
    // đã persist
    expect((store?.settings as { accessToken: string }).accessToken).toBe("AT_new");
  });

  it("thiếu app creds → null (không gọi mạng)", async () => {
    delete process.env.ZALO_APP_SECRET;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await refreshZaloToken("RT", NOW)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Zalo trả lỗi (không có access_token) → null, không lưu", async () => {
    mockFetch({ error: -14014, message: "refresh token expired" });
    expect(await refreshZaloToken("RT", NOW)).toBeNull();
    expect(store).toBeNull();
  });
});

describe("getValidZaloAccessToken", () => {
  it("token đã lưu còn hạn → trả luôn, KHÔNG gọi mạng", async () => {
    store = { settings: { accessToken: "AT_cached", refreshToken: "RT", expiresAt: NOW + 60 * 60 * 1000 } };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getValidZaloAccessToken(NOW)).toBe("AT_cached");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("token đã lưu gần hết hạn (trong buffer) → refresh", async () => {
    store = { settings: { accessToken: "AT_old", refreshToken: "RT_old", expiresAt: NOW + 60 * 1000 } };
    mockFetch({ access_token: "AT_fresh", refresh_token: "RT_fresh", expires_in: 3600 });
    expect(await getValidZaloAccessToken(NOW)).toBe("AT_fresh");
  });

  it("chưa có gì trong DB → seed bằng refresh_token từ env", async () => {
    mockFetch({ access_token: "AT_seed", refresh_token: "RT_seed", expires_in: 3600 });
    expect(await getValidZaloAccessToken(NOW)).toBe("AT_seed");
    expect((store?.settings as { refreshToken: string }).refreshToken).toBe("RT_seed");
  });

  it("refresh fail → fallback token tĩnh env", async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = "AT_static";
    mockFetch({ error: -1, message: "boom" });
    expect(await getValidZaloAccessToken(NOW)).toBe("AT_static");
  });

  it("không token, không refresh creds → null", async () => {
    delete process.env.ZALO_OA_REFRESH_TOKEN;
    delete process.env.ZALO_OA_ACCESS_TOKEN;
    expect(await getValidZaloAccessToken(NOW)).toBeNull();
  });
});

describe("forceRefreshZaloToken", () => {
  it("trả access_token mới khi refresh thành công", async () => {
    mockFetch({ access_token: "AT_forced", refresh_token: "RT_forced", expires_in: 3600 });
    expect(await forceRefreshZaloToken(NOW)).toBe("AT_forced");
  });

  it("không refresh_token → null", async () => {
    delete process.env.ZALO_OA_REFRESH_TOKEN;
    expect(await forceRefreshZaloToken(NOW)).toBeNull();
  });
});

describe("[AUTH-SDT-P4] khoá chống đua xoay vòng refresh_token", () => {
  it("sau khi giành khoá thấy token TƯƠI (instance khác vừa refresh) → dùng luôn, KHÔNG gọi Zalo", async () => {
    // Ngoài khoá đọc thấy bản CŨ sắp hết hạn; trong khoá đọc thấy bản MỚI còn hạn.
    store = { settings: { accessToken: "AT_stale", refreshToken: "RT_stale", expiresAt: NOW + 60_000 } };
    txStoreOverride = {
      settings: { accessToken: "AT_from_other", refreshToken: "RT_from_other", expiresAt: NOW + 3600_000 },
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await getValidZaloAccessToken(NOW)).toBe("AT_from_other");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dưới khoá, refresh_token ĐÃ LƯU trong DB được ưu tiên hơn tham số seed", async () => {
    store = { settings: { accessToken: "AT_old", refreshToken: "RT_db", expiresAt: NOW - 1 } };
    const fetchSpy = vi.fn(async () => ({
      json: async () => ({ access_token: "AT_n", refresh_token: "RT_n", expires_in: 3600 }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    await refreshZaloToken("RT_param_cu", NOW);
    const body = String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("refresh_token=RT_db");
    expect(body).not.toContain("RT_param_cu");
  });

  it("Zalo ĐÃ xoay nhưng ghi DB trong transaction thất bại → cứu bằng persist ngoài transaction", async () => {
    txUpsertFailCount = 1;
    mockFetch({ access_token: "AT_rescue", refresh_token: "RT_rescue", expires_in: 3600 });

    const r = await refreshZaloToken("RT_seed", NOW);
    expect(r?.accessToken).toBe("AT_rescue");
    // Token ĐÃ được lưu qua đường cứu — không mất refresh_token mới.
    expect((store?.settings as { refreshToken: string }).refreshToken).toBe("RT_rescue");
  });
});
