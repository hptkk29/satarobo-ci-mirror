// tests/_helpers/db-gate.ts — MỘT cổng duy nhất quyết định "bộ test có được đụng
// Postgres thật không".
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (04/09/2026) — sự cố mất DB
//
// `pnpm test:unit` gom cả các bộ chạm DB (`tests/chat`, `tests/nen`,
// `tests/lead-intake`, `tests/elearning`, `tests/inbox`). Chúng gọi
// `resetDb()` — TRUNCATE **mọi bảng** trong schema `public` với CASCADE. Cổng cũ chỉ
// hỏi "URL có trỏ localhost / có tên satarobo_test không", mà DB làm việc hằng ngày ở
// máy dev ĐÚNG LÀ `127.0.0.1/satarobo_test` ⇒ mỗi lần chạy `pnpm test:unit` là xoá
// sạch dữ liệu đang xem. Đã xảy ra thật: 250 học viên · 100 lớp · 609 buổi · 12 tài
// khoản `uat.*` bay hết, đăng nhập báo "sai tài khoản mật khẩu".
//
// Chốt của chủ dự án: **`pnpm test` không được gọi resetDb, không được truncate.**
//
// Nay phải CÓ CHỦ ĐÍCH: đặt `ALLOW_DB_RESET=1`. Cờ đó chỉ được bật ở
// `vitest.db.config.ts` — cấu hình mà các script `test:*-db` (CI gọi đúng chúng) dùng.
// Chạy `pnpm test:unit` trần thì các bộ này SKIP, không phải đỏ: chúng vốn đã thiết kế
// để skip khi vắng Postgres, nay skip thêm khi vắng cờ.
//
// ⚠️ Cổng địa chỉ CŨ vẫn giữ nguyên bên cạnh (localhost / satarobo_test / ci_test).
// Nó chặn trỏ nhầm Supabase; cờ mới chặn "đúng địa chỉ nhưng SAI LÚC". Bỏ vế nào cũng
// mở lại một trong hai đường mất dữ liệu.
// ─────────────────────────────────────────────────────────────────────────────

//
// ⚠️ 28/09/2026 — cổng địa chỉ từ chối TUNNEL VPS (127.0.0.1:5433 = DB PROD, :5435 = DB TEST
// của test.satarobo.vn, tên đúng là `satarobo_test`). Trước đó tunnel qua CẢ HAI vế cũ ("host
// 127.0.0.1" hoặc "tên satarobo_test") ⇒ `pnpm test:*-db` trỏ :5435 là xoá dữ liệu thật. Phép
// nhận diện sống ở MỘT chỗ: `lib/security/url-db-cuc-bo.ts` — đừng chép lại biểu thức ở đây.
// Tunnel bị từ chối VÔ ĐIỀU KIỆN, kể cả qua cửa hậu REMOTE: cửa đó sinh ra cho Supabase đã ngắt.
import { congTunnelVps, laDbCucBo, laTenDbTest, loiTunnelVps } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

/** URL ĐÃ CHE mật khẩu — dùng in lý do bỏ qua, không bao giờ in URL trần. */
export const DB_URL_CHE = DB_URL.replace(/:[^:@]*@/, ":***@") || "trống";

/** URL trỏ SSH tunnel tới DB trên VPS (dữ liệu THẬT) — không bao giờ được chạy. */
const LA_TUNNEL_VPS = congTunnelVps(DB_URL) !== null;

/** URL có trỏ Postgres test cục bộ không (chặn Supabase prod/dev + tunnel VPS). */
export const HAS_LOCAL_DB = !LA_TUNNEL_VPS && (laDbCucBo(DB_URL) || laTenDbTest(DB_URL));

/**
 * Người chạy ĐÃ nói rõ "được phép xoá DB này". Chỉ `vitest.db.config.ts` bật.
 * Không có cờ ⇒ mọi bộ chạm DB skip, và `resetDb()` từ chối chạy.
 */
export const DB_RESET_ALLOWED =
  process.env.ALLOW_DB_RESET === "1" ||
  // Ngoài Vitest (Playwright E2E) giữ nguyên hành vi cũ — bộ gá đó dùng-rồi-bỏ,
  // CI dựng Postgres riêng cho nó. Cờ này sinh ra để chặn `pnpm test:unit`.
  process.env.VITEST !== "true";

/** Cửa hậu nghiệm thu tay trên DB từ xa — giữ nguyên hành vi cũ. */
export const ALLOW_REMOTE =
  DB_URL !== "" && !LA_TUNNEL_VPS && process.env.CHAT_DB_TEST_ALLOW_REMOTE === "1";

/** Điều kiện DUY NHẤT để một bộ test được chạy trên Postgres thật. */
export const RUN_DB_TESTS = (HAS_LOCAL_DB || ALLOW_REMOTE) && DB_RESET_ALLOWED;

/** Câu giải thích in ra khi bộ test bị bỏ qua — để người chạy biết cách bật. */
export const LY_DO_BO_QUA = LA_TUNNEL_VPS
  ? `${loiTunnelVps(DB_URL)} (Chuỗi đang dùng là tunnel VPS.)`
  : !HAS_LOCAL_DB && !ALLOW_REMOTE
  ? "DATABASE_URL không trỏ Postgres test cục bộ."
  : "Thiếu ALLOW_DB_RESET=1 — chạy `pnpm test:chat-db` (hoặc test:nen-db / test:lead-intake / test:elearning-db / test:inbox-db) thay vì `pnpm test:unit`.";

/**
 * TÊN database mà `@/lib/db` đang nối (`DATABASE_URL`) có phải DB DÙNG-ĐỂ-TEST không.
 *
 * Vì sao cần thêm cổng theo TÊN (TEST-09, 30/09/2026): `RUN_DB_TESTS` chỉ hỏi HOST
 * (`127.0.0.1`/`localhost`) — mà DB của dev server (`satarobo_local`) cũng nằm trên 127.0.0.1.
 * Bộ không gọi `resetDb()` (dọn theo tiền tố) nên cũng không đi qua `assertTestDb()` (cổng theo
 * tên của `tests/e2e/_helpers/seed.ts`); vậy mà một bộ như thế gọi hàm có tác dụng TOÀN BẢNG
 * (dọn bảng cũ, xử lý lại mọi `WebhookDelivery` tồn) thì trỏ nhầm vào `satarobo_local` là
 * xoá/xử lý dữ liệu ĐANG XEM. (Bộ sinh ra cổng này — `tests/goi-dien-db`, OmiCall — đã gỡ
 * 06/10/2026; cổng giữ cho mọi bộ dọn-theo-tiền-tố sau này.)
 *
 * Danh sách CHO PHÉP (không phải danh sách chặn): `satarobo_test*`, `ci_test*`, `satarobo_vitest*`.
 */
export function laDbDungDeTest(url: string = process.env.DATABASE_URL ?? ""): boolean {
  // Tunnel VPS (:5433 PROD / :5435 TEST) mang tên `satarobo_test` y như DB máy ⇒ cổng theo
  // TÊN phải từ chối nó TRƯỚC, không thì tên hợp lệ mở đường xoá dữ liệu thật.
  if (congTunnelVps(url) !== null) return false;
  const ten = /\/([^/?#]+)(?:[?#].*)?$/.exec(url)?.[1] ?? "";
  return /^(satarobo_test|ci_test|satarobo_vitest)/.test(ten);
}

/** Ném khi `DATABASE_URL` không trỏ một DB dùng-để-test theo TÊN — gọi ở đầu tệp test chạm DB. */
export function assertTenDbTest(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (laDbDungDeTest(url)) return;
  const ten = /\/([^/?#]+)(?:[?#].*)?$/.exec(url)?.[1] ?? "<không đọc được>";
  throw new Error(
    `[test] TỪ CHỐI chạy: DATABASE_URL trỏ database "${ten}" — bộ này có ca tác động TOÀN BẢNG. ` +
      `Chỉ chạy trên satarobo_test* / ci_test* / satarobo_vitest* (không bao giờ satarobo_local).`,
  );
}
