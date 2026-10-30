/**
 * lib/nguon/di-tru-nguon-chay.ts — «ai/lượt chạy nào kích hoạt» lệnh GHI backfill quy nguồn, dựng từ biến môi trường MẶC ĐỊNH của GitHub Actions. THUẦN (không DB, không đồng hồ, không import).
 *
 * ── Vì sao KHÔNG chỉ `GITHUB_ACTOR` ─────────────────────────────────────────────────────────────────────────
 * Khi một lượt được CHẠY LẠI (Re-run), `GITHUB_ACTOR` vẫn là người dispatch lần ĐẦU; người bấm Re-run nằm ở `GITHUB_TRIGGERING_ACTOR` và `GITHUB_RUN_ATTEMPT` cho biết lần thứ mấy.
 * Chỉ ghi `GITHUB_ACTOR` thì khoản ghi PROD của lượt chạy lại bị gán cho người khác. Cả bốn đi vào audit `DI_TRU_NGUON`.
 *
 * Đây là các biến MẶC ĐỊNH của runner — workflow KHÔNG khai chúng trong `env` (và không được: GitHub không cho đặt đè `GITHUB_*`); lưới [DTG-W2] canh việc đó.
 * Không phải bằng chứng danh tính độc lập (chuỗi xác nhận và bốn số do CÙNG một người tự khai — giới hạn đã biết, 08 §11); là dấu vết để TRUY được.
 */

/** Ai/lượt chạy nào kích hoạt — vào audit; `null` từng trường khi chạy ngoài GitHub Actions (máy dev / test). */
export type NguonChayDiTru = {
  /** `GITHUB_ACTOR` — người dispatch lần ĐẦU của run này (KHÔNG đổi khi chạy lại). */
  actor: string | null;
  /** `GITHUB_TRIGGERING_ACTOR` — người bấm lượt chạy NÀY (khác `actor` khi có người chạy lại). */
  triggeringActor: string | null;
  /** `GITHUB_RUN_ID`. */
  runId: string | null;
  /** `GITHUB_RUN_ATTEMPT` — «1» là lần đầu, «2» trở đi là chạy lại. */
  runAttempt: string | null;
};

const TOI_DA = 100;

function vaoChuoi(v: string | undefined): string | null {
  return v !== undefined && v.trim() !== "" ? v.trim().slice(0, TOI_DA) : null;
}

/** Dựng `NguonChayDiTru` từ `process.env` (hoặc một bản giả trong test). Trường vắng ⇒ `null`, KHÔNG suy từ trường khác. */
export function nguonChayTuEnv(env: Readonly<Record<string, string | undefined>>): NguonChayDiTru {
  return {
    actor: vaoChuoi(env.GITHUB_ACTOR),
    triggeringActor: vaoChuoi(env.GITHUB_TRIGGERING_ACTOR),
    runId: vaoChuoi(env.GITHUB_RUN_ID),
    runAttempt: vaoChuoi(env.GITHUB_RUN_ATTEMPT),
  };
}
