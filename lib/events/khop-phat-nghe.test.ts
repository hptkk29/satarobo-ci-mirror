// Mọi DomainEvent được PHÁT phải có nơi NGHE — và ngược lại.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (rà luồng Trial vs BA, 03/09/2026)
//
// `lib/_handlers/r7-notifications.ts` có sẵn một handler đầy đủ: "con đã học thử
// xong → báo Sale phụ trách liên hệ chốt". Nó đăng ký nghe `lead.trialAttended`.
// **Không một chỗ nào trong repo phát sự kiện tên đó.** Đường điểm danh thật
// (`syncTrialProgress`) phát `lead.awaitingDecision`. Hai đầu lệch TÊN, nên suốt
// từ R7-17 tới nay Sale chưa từng nhận được tin ấy.
//
// Cái làm lỗi này sống lâu là nó **không có triệu chứng**: không lỗi, không log,
// không test đỏ. `getHandlers("lead.awaitingDecision")` trả mảng rỗng và
// dispatcher đóng sổ event thành DONE — đúng như thiết kế cho event không consumer.
// Hai tài liệu còn ghi nhầm là luồng này đang chạy
// (`Document/0-yeucau/0-tai-lieu-goc/luong-LMS.md` §13 "17/17 trigger";
// `docs/audit/LMS_R7_FE_BE_DB_EVENT_AUDIT.md` "đã có handler + emit").
//
// Nên vá riêng một cặp tên là chưa đủ — bộ test này khoá CẢ LỚP LỖI: quét nguồn,
// đối chiếu tập tên phát với tập tên nghe. Muốn để một bên trống thì phải KHAI
// vào danh sách dưới kèm lý do; im lặng thì test đỏ.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Quét nguồn tốn vài giây; bộ đầy đủ chạy song song nên phải nới hạn giờ. */
const HAN_QUET_CAY = 30_000;

/**
 * Sự kiện CỐ Ý chưa có consumer — phát để ghi sổ / cho consumer tương lai.
 * Thêm dòng ở đây là một quyết định, không phải thủ tục: nó nói "biết là không ai
 * nghe, vẫn muốn phát".
 */
const PHAT_KHONG_AI_NGHE: ReadonlyArray<[type: string, lyDo: string]> = [
  [
    "lead.trialInProgress",
    "Lead vừa vào 'Đang học thử'. Đổi trạng thái Kanban là đủ; chưa chốt nghiệp vụ nào " +
      "cần bắn tin cho ai ở mốc này (mốc đáng báo là 'đã học xong' — lead.awaitingDecision).",
  ],
  [
    "consent.granted",
    "Phụ huynh đồng ý điều khoản ảnh lớp. Ghi sổ để truy vết về sau; " +
      "đường hiển thị đọc thẳng StudentConsent chứ không chờ event.",
  ],
  [
    "elearning.assignment.created",
    "E-learning giao bài: thông báo do lib/elearning/_handlers/notify.ts bắn theo " +
      "elearning.enrollment.*, event này chỉ để ghi sổ vòng đời bài.",
  ],
  [
    "chat.announcement_created",
    "Điểm móc ĐẶT TRƯỚC cho US-14 (đẩy thông báo lớp), khai rõ ở đầu " +
      "lib/chat/announcements.ts. Cố ý phát vào outbox trước khi có consumer để US-14 " +
      "chỉ phải thêm một dòng on(...) mà không đụng đường ghi trong transaction.",
  ],
];

/**
 * Handler CỐ Ý nghe một tên chưa ai phát — giữ để tương thích ngược.
 */
const NGHE_KHONG_AI_PHAT: ReadonlyArray<[type: string, lyDo: string]> = [
  [
    "trial.schedule_changed",
    "⚠️ LỖI THẬT, KHÔNG PHẢI NGOẠI LỆ THIẾT KẾ — cổng này tự bắt được 04/09/2026. " +
      "`rescheduleTrialEnrollment` (lib/trial/service.ts) đổi buổi, ghi TrialReschedule và audit " +
      "nhưng KHÔNG phát sự kiện nào ⇒ Sale phụ trách không nhận được tin 'Đổi lịch học thử'. " +
      "Nhánh `test` CÓ dòng publishEvent này (dedupeKey kèm mốc dời để tránh P2002 trong " +
      "transaction); main thì không. Để lại đây có chủ đích: vá cần thêm 3 biến (leadId, buổi " +
      "cũ, mốc dời) và một lượt nghiệm thu riêng, không thuộc phạm vi PR này.",
  ],
  [
    "lead.trialAttended",
    "Tên NGHIỆP VỤ đúng cho mốc 'đã học thử xong'. Giữ để DomainEvent cũ trong DB " +
      "(nếu có) vẫn chạy được, và để producer mới có tên đúng mà dùng. Đường thật " +
      "hiện phát lead.awaitingDecision — cùng một handler nghe cả hai.",
  ],
];

// ── Quét nguồn ───────────────────────────────────────────────────────────────
function nguonRepo(): string[] {
  const bo = new Set([
    "node_modules",
    ".next",
    ".git",
    "Document",
    "docs",
    "prisma",
    "tests",
    "public",
    "scripts",
  ]);
  const ra: string[] = [];
  const di = (thuMuc: string) => {
    for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (m.name.startsWith(".") || bo.has(m.name)) continue;
      const p = path.join(thuMuc, m.name);
      if (m.isDirectory()) di(p);
      else if (/\.tsx?$/.test(m.name) && !/\.test\.tsx?$/.test(m.name)) ra.push(p);
    }
  };
  for (const goc of ["app", "lib"]) di(goc);
  return ra;
}

/** Bỏ chú thích để tên nằm trong ví dụ/ghi chú không bị tính là mã thật. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `publishEvent("x"` / `publishEvent(\n  "x"` — tên phải là hằng chuỗi. */
const RE_PHAT = /publishEvent\(\s*"([^"]+)"/g;
/** `on("x", handler)` của registry. Chặn `\w(` phía trước để không dính `.on(`. */
const RE_NGHE = /(?<![.\w])on\(\s*"([^"]+)"\s*,/g;

/** Tên KHÔNG phải DomainEvent — registry demo và test fixture. */
const BO_QUA = new Set(["demo.ping", "broadcast", "x"]);

function quet(): { phat: Map<string, string[]>; nghe: Map<string, string[]> } {
  const phat = new Map<string, string[]>();
  const nghe = new Map<string, string[]>();
  const them = (m: Map<string, string[]>, k: string, f: string) => {
    if (BO_QUA.has(k)) return;
    m.set(k, [...(m.get(k) ?? []), f]);
  };
  for (const f of nguonRepo()) {
    const src = boChuThich(fs.readFileSync(f, "utf8"));
    if (!src.includes("publishEvent(") && !src.includes("on(")) continue;
    for (const m of src.matchAll(RE_PHAT)) them(phat, m[1]!, f);
    for (const m of src.matchAll(RE_NGHE)) them(nghe, m[1]!, f);
  }
  return { phat, nghe };
}

let _cache: ReturnType<typeof quet> | null = null;
const dl = () => (_cache ??= quet());

// ─────────────────────────────────────────────────────────────────────────────
describe("DomainEvent — hai đầu phải khớp tên", () => {
  it(
    "quét được cả hai phía (chốt chặn: regex hỏng thì mọi ca dưới xanh giả)",
    () => {
      const { phat, nghe } = dl();
      expect(phat.size).toBeGreaterThan(15);
      expect(nghe.size).toBeGreaterThan(15);
      // Cặp chắc chắn có thật ở cả hai đầu — nếu regex trượt, ca này đỏ trước.
      expect(phat.has("payment.confirmed")).toBe(true);
      expect(nghe.has("payment.confirmed")).toBe(true);
    },
    HAN_QUET_CAY,
  );

  it(
    "mọi sự kiện được PHÁT đều có nơi nghe (hoặc được khai là cố ý)",
    () => {
      const { phat, nghe } = dl();
      const khai = new Set(PHAT_KHONG_AI_NGHE.map(([t]) => t));
      const mocoi = [...phat.keys()].filter((t) => !nghe.has(t) && !khai.has(t));
      expect(
        mocoi,
        `Sự kiện phát ra mà KHÔNG AI NGHE: ${mocoi
          .map((t) => `${t} (${phat.get(t)!.join(", ")})`)
          .join(" · ")}\n` +
          "→ Hoặc đăng ký handler trong lib/events/register.ts, hoặc khai vào " +
          "PHAT_KHONG_AI_NGHE kèm lý do. Đây đúng là lỗi đã làm Sale không nhận được " +
          "tin 'đã học thử xong' suốt từ R7-17.",
      ).toEqual([]);
    },
    HAN_QUET_CAY,
  );

  it(
    "mọi handler ĐANG NGHE đều có nơi phát (hoặc được khai là cố ý)",
    () => {
      const { phat, nghe } = dl();
      const khai = new Set(NGHE_KHONG_AI_PHAT.map(([t]) => t));
      const chet = [...nghe.keys()].filter((t) => !phat.has(t) && !khai.has(t));
      expect(
        chet,
        `Handler nghe một tên KHÔNG AI PHÁT: ${chet
          .map((t) => `${t} (${nghe.get(t)!.join(", ")})`)
          .join(" · ")}\n` +
          "→ Handler chết. Sửa tên cho khớp producer, hoặc khai vào NGHE_KHONG_AI_PHAT.",
      ).toEqual([]);
    },
    HAN_QUET_CAY,
  );

  it(
    "danh sách khai ngoại lệ không được để lại rác",
    () => {
      const { phat, nghe } = dl();
      for (const [t, lyDo] of PHAT_KHONG_AI_NGHE) {
        expect(phat.has(t), `${t} đã khai là 'phát mà không ai nghe' nhưng không còn ai phát`).toBe(true);
        expect(nghe.has(t), `${t} nay ĐÃ có handler — bỏ khỏi PHAT_KHONG_AI_NGHE`).toBe(false);
        expect(lyDo.length, `${t} phải có lý do thật`).toBeGreaterThan(30);
      }
      for (const [t, lyDo] of NGHE_KHONG_AI_PHAT) {
        expect(nghe.has(t), `${t} đã khai là 'nghe mà không ai phát' nhưng không còn ai nghe`).toBe(true);
        expect(phat.has(t), `${t} nay ĐÃ có producer — bỏ khỏi NGHE_KHONG_AI_PHAT`).toBe(false);
        expect(lyDo.length, `${t} phải có lý do thật`).toBeGreaterThan(30);
      }
    },
    HAN_QUET_CAY,
  );

  it(
    "[vé 03/09] mốc 'đã học thử xong' PHẢI tới được Sale",
    () => {
      const { phat, nghe } = dl();
      // Producer thật nằm ở syncTrialProgress; consumer là handler R7-17.
      expect(phat.get("lead.awaitingDecision") ?? []).toContain(
        path.join("lib", "trial", "service.ts"),
      );
      expect(nghe.get("lead.awaitingDecision") ?? []).toContain(
        path.join("lib", "_handlers", "r7-notifications.ts"),
      );
    },
    HAN_QUET_CAY,
  );
});
