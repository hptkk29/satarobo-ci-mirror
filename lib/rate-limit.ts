// =============================================================================
// Rate limiter — Phase 5.1
// =============================================================================
//
// 2-tier strategy:
// - Production / multi-instance: Upstash Redis (REST) when env vars set
// - Dev / single-instance fallback: in-memory Map (current behaviour)
//
// Why: an in-memory Map's count is per-process — not global. With more than one
// app instance an attacker can land on a different instance each time and bypass
// the limit. Upstash keeps the counter in shared Redis so all instances see the
// same number.
//
// Usage in any API route:
//   const result = await rateLimit({ key: `leads:${ip}`, max: 5, windowMs: 60_000 });
//   if (!result.success) return NextResponse.json({error: 'rate-limited'}, {status: 429});
//
// ── Khi Upstash chết (đo 24–26/10/2026: host KV không còn trong DNS) ─────────────────
// `rateLimit()` KHÔNG BAO GIỜ ném và KHÔNG BAO GIỜ trở thành fail-closed vì Upstash: lỗi/timeout
// luôn rơi về bộ đếm trong bộ nhớ (hành vi cũ, giữ nguyên). Bản gia cố này chỉ bớt cái giá của
// việc rơi về đó, không đổi một giới hạn nào:
//   1. Mỗi lượt gọi Upstash có hạn chờ (mặc định 1,5 s) — trước đây không có.
//   2. Ngắt mạch: sau `UPSTASH_NGUONG_LOI` lỗi liên tiếp, bỏ qua Upstash `UPSTASH_NGAT_MACH_MS`
//      rồi thử lại bằng MỘT lượt thăm dò — hết 60–190 ms phí cho mỗi lượt gọi hỏng.
//   3. Log gộp: tối đa một dòng mỗi phút, nói NGUYÊN NHÂN đã phân loại (ENOTFOUND, timeout,
//      HTTP 401…), không bao giờ in khoá đếm (khoá chứa IP/email/userId) hay URL/token.
//   4. Bộ đếm bộ nhớ được dọn dần khoản hết hạn (trước đây chỉ lớn lên).
//   5. `getRateLimitStatus()` / `kiemTraUpstash()` nói THẬT Upstash có đang sống không —
//      `getRateLimitBackend()` chỉ nhìn biến môi trường nên báo "upstash" cả khi host đã chết.
//
// =============================================================================

type RateLimitArgs = {
  /** Unique identifier per actor — typically `${resource}:${ip}` */
  key: string;
  /** Max requests allowed within window */
  max: number;
  /** Window length in milliseconds */
  windowMs: number;
};

type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number; // Unix ms
};

// =============================================================================
// Hằng số gia cố (xem đầu tệp). Đổi một số ở đây = đổi cả test canh nó.
// =============================================================================

/** Hạn chờ mặc định cho MỘT lượt gọi Upstash. Ghi đè: `RATE_LIMIT_UPSTASH_TIMEOUT_MS` (kẹp 200–10000). */
export const UPSTASH_TIMEOUT_MAC_DINH_MS = 1500;
/** Số lỗi LIÊN TIẾP thì mở ngắt mạch. */
export const UPSTASH_NGUONG_LOI = 3;
/** Thời gian bỏ qua Upstash khi ngắt mạch đã mở. */
export const UPSTASH_NGAT_MACH_MS = 60_000;
/** Khoảng tối thiểu giữa hai dòng log lỗi Upstash. */
export const UPSTASH_GOM_LOG_MS = 60_000;
/** Số khoá bộ nhớ được rà (và xoá nếu hết hạn) sau mỗi lượt `rateLimitMemory`. */
const DON_BO_NHO_MOI_LUOT = 50;

function upstashTimeoutMs(): number {
  const raw = Number(process.env.RATE_LIMIT_UPSTASH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return UPSTASH_TIMEOUT_MAC_DINH_MS;
  return Math.min(10_000, Math.max(200, Math.floor(raw)));
}

// =============================================================================
// Trạng thái sức khoẻ Upstash — cấp TIẾN TRÌNH, đặt trên globalThis
// =============================================================================
//
// Next đóng gói mỗi điểm vào (route/trang) riêng, nên một biến cấp module có thể bị nhân bản
// theo số bundle (đã đo với `lib/scorm/dem-dia.ts`, xem `chungTienTrinh`). Nếu ngắt mạch và bộ
// gom log bị nhân bản thì mỗi bundle tự đếm lỗi riêng — dòng log nhiều gấp N và ngắt mạch mở
// chậm gấp N. Cố ý KHÔNG import từ `lib/scorm/*` để module chung này không kéo SCORM theo.
//
// ⚠️ `memoryStore` (bộ đếm giới hạn) thì CỐ Ý KHÔNG đưa lên đây ở PR này: làm vậy siết các
// giới hạn thật (hiện bị nhân bản theo bundle) mà chưa ai đo hệ quả.

type TrangThaiUpstash = {
  loiLienTiep: number;
  /** epoch ms; 0 = mạch đóng. */
  ngatDen: number;
  /** Có một lượt thăm dò đang bay (nửa mở) — các lượt khác bỏ qua Upstash. */
  dangTham: boolean;
  loiCuoiLuc: number | null;
  loiCuoiLyDo: string | null;
  thanhCongCuoiLuc: number | null;
  tongLoi: number;
  tongBoQua: number;
  logCuoiLuc: number;
  logDaGom: number;
};

const KHOA_TRANG_THAI = Symbol.for("satarobo.rate-limit.trang-thai-upstash");

function trangThai(): TrangThaiUpstash {
  const kho = globalThis as unknown as Record<symbol, TrangThaiUpstash | undefined>;
  let t = kho[KHOA_TRANG_THAI];
  if (!t) {
    t = {
      loiLienTiep: 0,
      ngatDen: 0,
      dangTham: false,
      loiCuoiLuc: null,
      loiCuoiLyDo: null,
      thanhCongCuoiLuc: null,
      tongLoi: 0,
      tongBoQua: 0,
      logCuoiLuc: 0,
      logDaGom: 0,
    };
    kho[KHOA_TRANG_THAI] = t;
  }
  return t;
}

class UpstashLoi extends Error {
  constructor(readonly lyDo: string) {
    super(lyDo);
    this.name = "UpstashLoi";
  }
}

/**
 * Phân loại lỗi thành một nhãn NGẮN, cố định — thứ DUY NHẤT được phép vào log và vào màn quản trị.
 * Không bao giờ trả `err.message` / `err.stack` / URL: lỗi của `fetch` có thể mang host, và lỗi
 * của lớp trên có thể mang chuỗi do người dùng gõ.
 */
function phanLoaiLoi(err: unknown): string {
  if (err instanceof UpstashLoi) return err.lyDo;
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,31}$/.test(code)) return code;
  return "loi-khac";
}

/** Có được gọi Upstash lượt này không? `"tham"` = lượt thăm dò duy nhất sau khi ngắt mạch hết hạn. */
function choPhepGoi(now: number): "di" | "tham" | "bo-qua" {
  const t = trangThai();
  if (t.loiLienTiep < UPSTASH_NGUONG_LOI) return "di";
  if (now < t.ngatDen) {
    t.tongBoQua++;
    return "bo-qua";
  }
  if (t.dangTham) {
    t.tongBoQua++;
    return "bo-qua";
  }
  t.dangTham = true;
  return "tham";
}

function ghiNhanThanhCong(now: number): void {
  const t = trangThai();
  const daLoi = t.loiLienTiep;
  t.loiLienTiep = 0;
  t.ngatDen = 0;
  t.dangTham = false;
  t.thanhCongCuoiLuc = now;
  if (daLoi > 0) {
    console.warn(`[rate-limit] Upstash recovered after ${daLoi} consecutive errors`);
  }
}

function ghiNhanLoi(err: unknown, now: number): void {
  const t = trangThai();
  const lyDo = phanLoaiLoi(err);
  const daMoTruoc = t.loiLienTiep >= UPSTASH_NGUONG_LOI;
  t.loiLienTiep++;
  t.tongLoi++;
  t.loiCuoiLuc = now;
  t.loiCuoiLyDo = lyDo;
  t.dangTham = false;
  const machMo = t.loiLienTiep >= UPSTASH_NGUONG_LOI;
  if (machMo) t.ngatDen = now + UPSTASH_NGAT_MACH_MS;
  const vuaMo = machMo && !daMoTruoc;

  // Gom log: lỗi đầu tiên và lúc mạch vừa mở in ngay; sau đó tối đa một dòng mỗi
  // `UPSTASH_GOM_LOG_MS`, kèm số lượt gộp.
  t.logDaGom++;
  if (!vuaMo && t.logCuoiLuc !== 0 && now - t.logCuoiLuc < UPSTASH_GOM_LOG_MS) return;
  const gop = t.logDaGom;
  t.logDaGom = 0;
  t.logCuoiLuc = now;
  // ⚠️ Giữ nguyên tiền tố: màn /admin/tich-hop hướng dẫn tìm đúng chuỗi này.
  console.error(
    `[rate-limit] Upstash error, falling back to memory: ${lyDo} ` +
      `(${gop} error${gop > 1 ? "s" : ""} since last log${machMo ? `, circuit open ${UPSTASH_NGAT_MACH_MS / 1000}s` : ""})`,
  );
}

// =============================================================================
// Upstash Redis client (lazy-loaded)
// =============================================================================

let upstashClient: {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
} | null = null;

function getUpstash(): typeof upstashClient {
  if (upstashClient !== null) return upstashClient;

  // Vercel Marketplace Upstash integration sets KV_* names by default.
  // Standalone Upstash uses UPSTASH_* names. Support both — prefer UPSTASH_*
  // when explicitly set (e.g. local .env.local overrides), fall back to KV_*.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;

  upstashClient = {
    fetch: (path: string, init?: RequestInit) =>
      fetch(`${url}${path}`, {
        ...init,
        // Hạn chờ: không có nó, một host phân giải được mà TCP/TLS treo sẽ giữ lượt đăng nhập tới
        // mặc định của undici. Hết hạn ⇒ ném `TimeoutError` ⇒ rơi về bộ nhớ như mọi lỗi khác.
        signal: init?.signal ?? AbortSignal.timeout(upstashTimeoutMs()),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      }),
  };

  return upstashClient;
}

/**
 * Run one Redis command against the shared Upstash instance.
 *
 * Exported so other features (e.g. the e-learning play lock) can reuse the SAME
 * env-var resolution instead of re-deriving `UPSTASH_*` / `KV_*` in a second
 * place — two copies of that fallback chain is two things to keep in sync, and
 * the one that drifts fails silently by falling back to no-Redis.
 *
 * Returns `null` when Upstash is not configured or the call fails (kể cả khi ngắt mạch đang mở).
 * Callers MUST decide what "no shared store" means for them; this helper deliberately does
 * not pick fail-open or fail-closed on their behalf.
 */
export async function upstashCommand(cmd: string[]): Promise<unknown | null> {
  const client = getUpstash();
  if (!client) return null;
  const luot = choPhepGoi(Date.now());
  if (luot === "bo-qua") return null;
  try {
    const res = await client.fetch("/", {
      method: "POST",
      body: JSON.stringify(cmd),
    });
    if (!res.ok) throw new UpstashLoi(`HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown };
    ghiNhanThanhCong(Date.now());
    return data.result ?? null;
  } catch (err) {
    ghiNhanLoi(err, Date.now());
    return null;
  }
}

// =============================================================================
// In-memory fallback (legacy behavior)
// =============================================================================

const memoryStore = new Map<string, { count: number; resetAt: number }>();
let donBoNhoIter: IterableIterator<[string, { count: number; resetAt: number }]> | null = null;

/**
 * Dọn dần khoá hết hạn: mỗi lượt rà tối đa `DON_BO_NHO_MOI_LUOT` mục bằng một con trỏ giữ qua
 * các lượt (Map duyệt theo thứ tự chèn, xoá giữa chừng vẫn an toàn). Không timer ⇒ không giữ
 * tiến trình sống, không có lượt quét một phát hàng triệu khoá chặn event loop; phí mỗi lượt là
 * hằng số, và vì mỗi lượt thêm tối đa 1 khoá mà rà 50 nên việc dọn luôn đuổi kịp việc thêm.
 * Chỉ xoá mục `resetAt <= now` — đúng cái mà `rateLimitMemory` vốn đã coi là "không còn".
 */
function donKhoaHetHan(now: number): void {
  donBoNhoIter ??= memoryStore.entries();
  for (let i = 0; i < DON_BO_NHO_MOI_LUOT; i++) {
    const r = donBoNhoIter.next();
    if (r.done) {
      donBoNhoIter = null;
      return;
    }
    const [k, v] = r.value;
    if (v.resetAt <= now) memoryStore.delete(k);
  }
}

/** Số khoá đang giữ trong bộ đếm bộ nhớ (chẩn đoán). */
export function demKhoaBoNho(): number {
  return memoryStore.size;
}

function rateLimitMemory(args: RateLimitArgs): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(args.key);

  if (!entry || entry.resetAt <= now) {
    memoryStore.set(args.key, { count: 1, resetAt: now + args.windowMs });
    donKhoaHetHan(now);
    return { success: true, remaining: args.max - 1, resetAt: now + args.windowMs };
  }

  donKhoaHetHan(now);
  if (entry.count >= args.max) {
    return { success: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    success: true,
    remaining: args.max - entry.count,
    resetAt: entry.resetAt,
  };
}

// =============================================================================
// Upstash implementation (atomic pipeline INCR + EXPIRE NX)
// =============================================================================

async function rateLimitUpstash(args: RateLimitArgs): Promise<RateLimitResult> {
  const client = getUpstash();
  if (!client) return rateLimitMemory(args);

  // Ngắt mạch đang mở ⇒ đi thẳng bộ nhớ, không tốn một lượt DNS/TLS hỏng.
  if (choPhepGoi(Date.now()) === "bo-qua") return rateLimitMemory(args);

  const windowSec = Math.ceil(args.windowMs / 1000);
  const now = Date.now();

  try {
    // Pipeline: INCR + EXPIRE NX in 1 HTTP roundtrip.
    // EXPIRE with NX flag only sets TTL if the key has no TTL yet,
    // preventing concurrent instances from resetting the window mid-flight.
    const pipelineRes = await client.fetch("/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", args.key],
        ["EXPIRE", args.key, windowSec, "NX"],
      ]),
    });

    if (!pipelineRes.ok) {
      throw new UpstashLoi(`HTTP ${pipelineRes.status}`);
    }

    const data = (await pipelineRes.json()) as Array<{ result: number | string }>;
    const count = Number(data[0]?.result ?? 0);

    if (!Number.isFinite(count) || count <= 0) {
      throw new UpstashLoi("phan-hoi-la");
    }

    ghiNhanThanhCong(Date.now());
    const resetAt = now + windowSec * 1000;

    if (count > args.max) {
      return { success: false, remaining: 0, resetAt };
    }

    return {
      success: true,
      remaining: Math.max(0, args.max - count),
      resetAt,
    };
  } catch (err) {
    ghiNhanLoi(err, Date.now());
    return rateLimitMemory(args);
  }
}

// =============================================================================
// Public API
// =============================================================================

export async function rateLimit(args: RateLimitArgs): Promise<RateLimitResult> {
  if (getUpstash()) {
    return rateLimitUpstash(args);
  }
  return rateLimitMemory(args);
}

/**
 * Chỉ nói Upstash có ĐƯỢC CẤU HÌNH (có biến môi trường) hay không — KHÔNG nói nó có sống.
 * Trả `"upstash"` cả khi host đã chết (đo 24/10/2026). Muốn biết nó đang sống thì dùng
 * `getRateLimitStatus()` (rẻ, theo lượt gọi gần nhất) hoặc `kiemTraUpstash()` (thăm dò thật).
 */
export function getRateLimitBackend(): "upstash" | "memory" {
  return getUpstash() ? "upstash" : "memory";
}

/**
 * Trạng thái trung thực, theo kết quả các lượt gọi gần nhất của tiến trình này:
 * - `"memory"`: chưa cấu hình Upstash — bộ đếm theo tiến trình.
 * - `"upstash"`: đã cấu hình và lượt gần nhất (nếu có) thành công.
 * - `"upstash-loi"`: đã cấu hình NHƯNG lượt gần nhất lỗi — thực tế đang đếm trong bộ nhớ.
 * Chưa có lượt nào kể từ lúc khởi động thì vẫn là `"upstash"`: dùng `kiemTraUpstash()` nếu cần chắc.
 */
export type TrangThaiRateLimit = "memory" | "upstash" | "upstash-loi";

export function getRateLimitStatus(): TrangThaiRateLimit {
  if (!getUpstash()) return "memory";
  return trangThai().loiLienTiep > 0 ? "upstash-loi" : "upstash";
}

export type SucKhoeRateLimit = {
  trangThai: TrangThaiRateLimit;
  loiLienTiep: number;
  /** Nhãn đã phân loại (ENOTFOUND, timeout, HTTP 401…) — không bao giờ là thông điệp lỗi thô. */
  loiCuoiLyDo: string | null;
  loiCuoiLuc: number | null;
  thanhCongCuoiLuc: number | null;
  tongLoi: number;
  /** Số lượt bỏ qua Upstash vì ngắt mạch. */
  tongBoQua: number;
  ngatMachMo: boolean;
  khoaBoNho: number;
};

export function getRateLimitHealth(): SucKhoeRateLimit {
  const t = trangThai();
  return {
    trangThai: getRateLimitStatus(),
    loiLienTiep: t.loiLienTiep,
    loiCuoiLyDo: t.loiCuoiLyDo,
    loiCuoiLuc: t.loiCuoiLuc,
    thanhCongCuoiLuc: t.thanhCongCuoiLuc,
    tongLoi: t.tongLoi,
    tongBoQua: t.tongBoQua,
    ngatMachMo: t.loiLienTiep >= UPSTASH_NGUONG_LOI && Date.now() < t.ngatDen,
    khoaBoNho: memoryStore.size,
  };
}

export type KetQuaKiemTra =
  | { trangThai: "memory" }
  | { trangThai: "upstash"; ms: number }
  | { trangThai: "upstash-loi"; ms: number; lyDo: string };

/**
 * Thăm dò THẬT (`PING`) — dùng cho màn quản trị, KHÔNG dùng trên đường nóng. Đi qua cùng hàm
 * `fetch` có hạn chờ và cập nhật cùng bộ đếm lỗi, nhưng bỏ qua ngắt mạch: người vận hành vừa
 * sửa biến môi trường muốn thấy kết quả NGAY, không phải đợi hết 60 giây.
 */
export async function kiemTraUpstash(): Promise<KetQuaKiemTra> {
  const client = getUpstash();
  if (!client) return { trangThai: "memory" };
  const t0 = Date.now();
  try {
    const res = await client.fetch("/", { method: "POST", body: JSON.stringify(["PING"]) });
    if (!res.ok) throw new UpstashLoi(`HTTP ${res.status}`);
    const data = (await res.json()) as { result?: unknown };
    if (data.result !== "PONG") throw new UpstashLoi("phan-hoi-la");
    ghiNhanThanhCong(Date.now());
    return { trangThai: "upstash", ms: Date.now() - t0 };
  } catch (err) {
    ghiNhanLoi(err, Date.now());
    return { trangThai: "upstash-loi", ms: Date.now() - t0, lyDo: phanLoaiLoi(err) };
  }
}
