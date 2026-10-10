// lib/security/url-db-cuc-bo.ts — "chuỗi DB này có phải Postgres TRÊN MÁY không". THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO (28/09/2026)
//
// Mọi lớp chặn "chỉ được xoá / ghi DB local" của repo (resetDb → `assertTestDb`, `db-gate`,
// bộ test chấm công, seed demo, script vận hành) nhận diện local bằng host `127.0.0.1` /
// `localhost` — cộng thêm tên `satarobo_test` / `ci_test`.
//
// Từ 28/09/2026 DB prod/test chạy trên VPS và chỉ tới được qua SSH tunnel
// (docs/VPS-VAN-HANH.md, .github/actions/tunnel-vps):
//
//     127.0.0.1:5433 → DB PROD          127.0.0.1:5435 → DB TEST (test.satarobo.vn)
//
// ⇒ tunnel TRÔNG Y HỆT DB máy, và DB test trên VPS tên ĐÚNG LÀ `satarobo_test` ⇒ qua trọn mọi
// vế. Một lệnh `pnpm test:*-db` / Playwright với DATABASE_URL trỏ :5435 là TRUNCATE sạch dữ liệu
// của test.satarobo.vn ("đã suýt xảy ra 28/09" — cùng họ sự cố xoá DB 23/08, 26/08, 04/09).
//
// Tệp này là MỘT chỗ trả lời. Trước nó có 17 bản chép tay của cùng biểu thức — vá ở một bản
// thì 16 bản kia vẫn hở. `url-db-cuc-bo.test.ts` quét tests/ scripts/ prisma/ và đỏ khi có
// ai tự viết lại phép nhận diện.
//
// ⚠️ Nhận diện tunnel theo CỔNG, KHÔNG theo host: tunnel có thể mở ở `localhost` hay
// `127.0.0.1`, và cổng là thứ duy nhất tách được nó khỏi Postgres trên máy (luôn 5432).
// Đọc cổng theo lối "sai thì từ chối": bất kỳ `:5433`/`:5435` đứng trước `/ ? #` hoặc cuối
// chuỗi, hoặc tham số `port=`, đều tính — mật khẩu có ký tự lạ không che được cổng.

/** Cổng mà SSH tunnel tới VPS mở trên máy (khớp .github/actions/tunnel-vps). */
export const CONG_TUNNEL_VPS = {
  "5433": "DB PROD trên VPS",
  "5435": "DB TEST của test.satarobo.vn trên VPS",
} as const;

export type CongTunnelVps = keyof typeof CONG_TUNNEL_VPS;

/** Host là máy này (`localhost` / `127.0.0.1`) — ĐÚNG biểu thức các cổng cũ vẫn dùng. */
const HOST_MAY = /(@|\/\/)(localhost|127\.0\.0\.1)[:/]/;
const TEN_DB_TEST = /satarobo_test|ci_test/;

/** Cổng tunnel VPS mà chuỗi DB trỏ vào, hoặc `null` nếu không phải tunnel. */
export function congTunnelVps(url: string): CongTunnelVps | null {
  const s = url ?? "";
  const m =
    /:(5433|5435)(?=[/?#]|$)/.exec(s) ?? /[?&]port=(5433|5435)(?=[&#]|$)/.exec(s);
  return m ? (m[1] as CongTunnelVps) : null;
}

/** Chuỗi DB trỏ Postgres TRÊN MÁY NÀY — host local VÀ không phải cổng tunnel VPS. */
export function laDbCucBo(url: string): boolean {
  return HOST_MAY.test(url ?? "") && congTunnelVps(url) === null;
}

/**
 * Tên DB "trông như DB test" (`satarobo_test*`, `ci_test`).
 *
 * ⚠️ MỘT MÌNH nó KHÔNG đủ để cho xoá: DB test trên VPS tên đúng là `satarobo_test`. Luôn đi kèm
 * `congTunnelVps(url) === null` (hoặc `laDbCucBo`).
 */
export function laTenDbTest(url: string): boolean {
  return TEN_DB_TEST.test(url ?? "");
}

/**
 * Lời từ chối khi chuỗi DB trỏ tunnel VPS; `null` nếu không phải. KHÔNG in chuỗi kết nối
 * (có mật khẩu) — chỉ in cổng.
 */
export function loiTunnelVps(url: string): string | null {
  const cong = congTunnelVps(url);
  if (!cong) return null;
  return (
    `TỪ CHỐI: chuỗi DB dùng cổng ${cong} — đó là SSH tunnel tới ${CONG_TUNNEL_VPS[cong]} ` +
    `(${cong === "5433" ? "PROD" : "test.satarobo.vn"}), KHÔNG phải Postgres trên máy: "127.0.0.1" ` +
    `ở đây chỉ là đầu tunnel, dữ liệu phía sau là dữ liệu THẬT. Postgres trên máy chạy cổng 5432 — ` +
    `tạo DB riêng ở đó (xem docs/VPS-VAN-HANH.md).`
  );
}
