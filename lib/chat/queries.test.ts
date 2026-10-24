// @vitest-environment node
/**
 * US-08 + US-09 — TẦNG ĐỌC chat: phần THUẦN (không chạm DB).
 *
 * Viết TRƯỚC hiện thực (luật Nền Hệ thống #5). Phần chạm DB thật nằm ở
 * scripts/_zztest-chat-us08.ts (DB dev) vì Postgres local trong sandbox máy này
 * hay hỏng — xem .claude/rules/prisma-db.md.
 *
 * Trọng tâm pháp lý: **BR-30** (permissions.md — "Xem thành viên: PH thấy bản ẩn
 * liên hệ: không SĐT/email trong payload"). Không kiểm vài field biết trước mà
 * DUYỆT SÂU toàn bộ object trả về: bắt cả tên khoá nhạy cảm lẫn giá trị khớp
 * regex SĐT VN / email — kể cả khi lọt qua một đường không ai ngờ (vd `name`
 * của user thật là "PH 0905123456").
 */
import { describe, it, expect, vi } from "vitest";

// Singleton Prisma chỉ cần tồn tại để module import được — phần thuần không đụng DB.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  ARCHIVED_LABEL,
  ARCHIVED_PARENT_READ_DAYS,
  DELETED_MESSAGE_TEXT,
  archivedReadCutoff,
  buildPreview,
  compareConversations,
  decodeCursor,
  encodeCursor,
  isArchivedReadExpired,
  redactContactLike,
  shouldHideContacts,
  hidesContactOf,
  toMemberView,
  toMessageView,
} from "./queries";

// ─────────────────────────────────────────────────────────────────────────────
// Máy dò rò rỉ liên hệ — DUYỆT SÂU (BR-30 / TS-04.4).
// Cố ý viết lại độc lập với hiện thực: không import helper nào của queries.ts,
// để test không "đồng lõa" với bug của chính hàm mask.
// ─────────────────────────────────────────────────────────────────────────────
const CONTACT_KEY_RE = /phone|email|sdt|address|sđt/i;
/** SĐT VN: 0xx / +84xx / 84xx, đầu số 3/5/7/8/9, tổng 10 số (hoặc 84 + 9 số). */
const VN_PHONE_RE = /(?<![0-9])(?:\+?84|0)(?:3|5|7|8|9)[0-9]{8}(?![0-9])/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Trả về danh sách đường dẫn rò rỉ; rỗng = payload sạch. */
function findContactLeaks(value: unknown, path = "$", out: string[] = []): string[] {
  if (value === null || value === undefined) return out;
  if (value instanceof Date) return out;
  if (typeof value === "string") {
    if (VN_PHONE_RE.test(value)) out.push(`${path} = ${JSON.stringify(value)} (khớp SĐT VN)`);
    if (EMAIL_RE.test(value)) out.push(`${path} = ${JSON.stringify(value)} (khớp email)`);
    return out;
  }
  if (typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findContactLeaks(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CONTACT_KEY_RE.test(k)) out.push(`${path}.${k} (tên khoá nhạy cảm)`);
    findContactLeaks(v, `${path}.${k}`, out);
  }
  return out;
}

describe("máy dò rò rỉ (tự kiểm — test của test)", () => {
  it("bắt được khoá nhạy cảm, SĐT VN và email ở mọi độ sâu", () => {
    expect(findContactLeaks({ a: { b: [{ phone: null }] } })).toHaveLength(1);
    expect(findContactLeaks({ ten: "PH 0905123456" })).toHaveLength(1);
    expect(findContactLeaks({ x: ["a", "gv1@satarobo.vn"] })).toHaveLength(1);
    expect(findContactLeaks({ id: "clz9k2h4t0000abcd", n: 5, d: new Date() })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-08 AC2/AC4 — sắp xếp danh sách hội thoại.
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-08] compareConversations — lastMessageAt giảm dần, null xếp cuối", () => {
  const row = (id: string, iso: string | null) => ({
    conversationId: id,
    lastMessageAt: iso ? new Date(iso) : null,
  });

  it("mới nhất lên đầu, hội thoại chưa có tin nào xuống cuối", () => {
    const list = [
      row("c-cu", "2026-08-01T10:00:00.000Z"),
      row("c-chua-co-tin", null),
      row("c-moi", "2026-08-09T10:00:00.000Z"),
      row("c-giua", "2026-08-05T10:00:00.000Z"),
    ];
    expect([...list].sort(compareConversations).map((r) => r.conversationId)).toEqual([
      "c-moi",
      "c-giua",
      "c-cu",
      "c-chua-co-tin",
    ]);
  });

  it("nhiều hội thoại cùng lastMessageAt → thứ tự tất định theo id (không nhảy giữa 2 lần gọi)", () => {
    const same = "2026-08-09T10:00:00.000Z";
    const list = [row("c-c", same), row("c-a", same), row("c-b", same)];
    const once = [...list].sort(compareConversations).map((r) => r.conversationId);
    const twice = [...list].reverse().sort(compareConversations).map((r) => r.conversationId);
    expect(once).toEqual(["c-a", "c-b", "c-c"]);
    expect(twice).toEqual(once);
  });

  it("cả hai null → vẫn tất định theo id", () => {
    const list = [row("c-b", null), row("c-a", null)];
    expect([...list].sort(compareConversations).map((r) => r.conversationId)).toEqual(["c-a", "c-b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-09 AC1 — cursor (createdAt, id), KHÔNG OFFSET.
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-09] cursor — dựng/giải theo (createdAt, id)", () => {
  it("round-trip giữ nguyên mốc thời gian tới MILI-GIÂY", () => {
    const c = { createdAt: new Date("2026-08-09T10:00:00.123Z"), id: "m-42" };
    const back = decodeCursor(encodeCursor(c));
    expect(back?.id).toBe("m-42");
    expect(back?.createdAt.toISOString()).toBe("2026-08-09T10:00:00.123Z");
    expect(back?.createdAt.getTime()).toBe(c.createdAt.getTime());
  });

  it("hai tin TRÙNG createdAt tới mili-giây sinh 2 cursor KHÁC nhau (không sót/trùng ở ranh giới trang)", () => {
    const at = new Date("2026-08-09T10:00:00.123Z");
    expect(encodeCursor({ createdAt: at, id: "m-1" })).not.toBe(
      encodeCursor({ createdAt: at, id: "m-2" }),
    );
  });

  it("id chứa dấu phân cách vẫn giải đúng (không cắt nhầm)", () => {
    const c = { createdAt: new Date("2026-08-09T10:00:00.000Z"), id: "m|có|gạch" };
    expect(decodeCursor(encodeCursor(c))?.id).toBe("m|có|gạch");
  });

  it("null/rỗng/rác/ngày không hợp lệ → null (trang đầu), không ném lỗi", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("khong-phai-cursor")).toBeNull();
    expect(decodeCursor("khong-phai-ngay|m-1")).toBeNull();
    expect(decodeCursor("2026-08-09T10:00:00.000Z|")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-08 AC2 + US-12 AC3 — preview tin cuối / tin đã gỡ.
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-08] buildPreview — dòng tin cuối trong danh sách", () => {
  const base = {
    id: "m-1",
    kind: "CHAT" as const,
    senderId: "u-1",
    createdAt: new Date("2026-08-09T10:00:00.000Z"),
    deletedAt: null as Date | null,
  };

  it("không có tin nào → null", () => {
    expect(buildPreview(null)).toBeNull();
  });

  it("gộp xuống dòng thành một dòng + cắt bớt tin dài", () => {
    const p = buildPreview({ ...base, body: `Chào\ncả\tnhà ${"x".repeat(300)}` });
    expect(p?.text.includes("\n")).toBe(false);
    expect(p?.text.startsWith("Chào cả nhà")).toBe(true);
    expect(p?.text.length).toBeLessThanOrEqual(121); // 120 + dấu "…"
    expect(p?.text.endsWith("…")).toBe(true);
  });

  it("tin đã gỡ → 'Tin nhắn đã được gỡ', KHÔNG lộ body gốc ở bất kỳ đâu", () => {
    const secret = "Số tài khoản của tôi là 0123456789";
    const p = buildPreview({ ...base, body: secret, deletedAt: new Date() });
    expect(p?.deleted).toBe(true);
    expect(p?.text).toBe(DELETED_MESSAGE_TEXT);
    expect(JSON.stringify(p)).not.toContain(secret);
  });

  it("tin SYSTEM vẫn hiện nội dung (không avatar là việc của UI)", () => {
    const p = buildPreview({ ...base, kind: "SYSTEM", senderId: null, body: "Giáo viên A đã tham gia nhóm." });
    expect(p?.text).toBe("Giáo viên A đã tham gia nhóm.");
    expect(p?.deleted).toBe(false);
  });

  it("nhãn lưu trữ là hằng dùng chung", () => {
    expect(ARCHIVED_LABEL).toBe("Đã lưu trữ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-09 AC1 + US-12 AC3 — tin đã xoá mềm không bao giờ trả body.
// ─────────────────────────────────────────────────────────────────────────────
describe("[US-09] toMessageView — tin đã gỡ không rời DB", () => {
  const row = {
    id: "m-9",
    conversationId: "c-1",
    kind: "CHAT" as const,
    senderId: "u-1",
    body: "nội dung nhạy cảm cần giữ trong DB",
    replyToId: null,
    clientMsgId: "cli-1",
    createdAt: new Date("2026-08-09T10:00:00.000Z"),
    deletedAt: null as Date | null,
  };

  it("tin thường: body nguyên vẹn, deleted=false", () => {
    const v = toMessageView(row);
    expect(v.body).toBe(row.body);
    expect(v.deleted).toBe(false);
  });

  it("tin đã xoá mềm: body thay bằng text thay thế, deep-scan không thấy body gốc", () => {
    const v = toMessageView({ ...row, deletedAt: new Date("2026-08-09T10:05:00.000Z") });
    expect(v.deleted).toBe(true);
    expect(v.body).toBe(DELETED_MESSAGE_TEXT);
    expect(JSON.stringify(v)).not.toContain("nhạy cảm");
    // Cũng không rò lý do gỡ / người gỡ cho user thường.
    expect(Object.keys(v)).not.toContain("deletedReason");
    expect(Object.keys(v)).not.toContain("deletedById");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BR-30 — quyết định "ẩn hay không" nằm ở TẦNG QUERY, không phải UI.
// ─────────────────────────────────────────────────────────────────────────────
describe("[BR-30] shouldHideContacts — ai bị ẩn liên hệ", () => {
  it("PH (mọi đường nhận diện) → ẩn", () => {
    expect(shouldHideContacts({ role: "PARENT", roles: [] })).toBe(true);
    expect(shouldHideContacts({ role: "TEACHER", roles: ["TEACHER", "PARENT"] })).toBe(true);
    expect(shouldHideContacts({ role: null, roles: null, derivedFrom: "CLASS_STUDENT_PARENT" })).toBe(true);
  });

  it("GV / QLCS / Admin → thấy đầy đủ", () => {
    expect(shouldHideContacts({ role: "TEACHER", roles: ["TEACHER"], derivedFrom: "CLASS_TEACHER" })).toBe(false);
    expect(shouldHideContacts({ role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], derivedFrom: "CENTER_MANAGER" })).toBe(false);
    expect(shouldHideContacts({ role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] })).toBe(false);
  });

  it("không biết người xem là ai → ẩn (fail-closed)", () => {
    expect(shouldHideContacts({})).toBe(true);
    expect(shouldHideContacts({ role: null, roles: null })).toBe(true);
  });
});

describe("[BR-30] toMemberView — payload PH tuyệt đối không có liên hệ", () => {
  const gv = {
    userId: "u-gv1",
    role: "MODERATOR" as const,
    derivedFrom: "CLASS_TEACHER" as const,
    joinedAt: new Date("2026-08-01T00:00:00.000Z"),
    name: "Cô Lan",
    phone: "0905123456",
    email: "colan@satarobo.vn",
    childNames: [] as string[],
  };
  const ph = {
    userId: "u-ph2",
    role: "MEMBER" as const,
    derivedFrom: "CLASS_STUDENT_PARENT" as const,
    joinedAt: new Date("2026-08-02T00:00:00.000Z"),
    name: "Chị Hoa",
    phone: "0912345678",
    email: "hoa@example.com",
    childNames: ["Bé An", "Bé Bình"],
  };
  const ql = {
    userId: "u-ql1",
    role: "MEMBER" as const,
    derivedFrom: "CENTER_MANAGER" as const,
    joinedAt: new Date("2026-08-03T00:00:00.000Z"),
    name: "Anh Quản",
    phone: "0987654321",
    email: "ql1@satarobo.vn",
    childNames: [] as string[],
  };

  it("người xem là PH → duyệt sâu CẢ DANH SÁCH không còn một dấu vết liên hệ nào (kể cả của GV)", () => {
    const payload = [gv, ph, ql].map((m) => toMemberView(m, { hideContacts: true }));
    expect(findContactLeaks(payload)).toEqual([]);
    // và cũng không có trong chuỗi JSON thô
    const json = JSON.stringify(payload);
    expect(json).not.toContain("0905123456");
    expect(json).not.toContain("colan@satarobo.vn");
    expect(json).not.toContain("0912345678");
  });

  it("người xem là GV/QLCS/Admin → có đủ liên hệ", () => {
    const v = toMemberView(gv, { hideContacts: false });
    expect(v.contact).toEqual({ phone: "0905123456", email: "colan@satarobo.vn" });
    expect(findContactLeaks(v).length).toBeGreaterThan(0); // đúng kỳ vọng: bản đầy đủ CÓ liên hệ
  });

  it("vẫn đủ thông tin dùng được: tên hiển thị + vai + nhãn 'PH của <tên học viên>'", () => {
    const v = toMemberView(ph, { hideContacts: true });
    expect(v.displayName).toBe("Chị Hoa");
    expect(v.role).toBe("MEMBER");
    expect(v.roleLabel).toBe("PH của Bé An, Bé Bình");
    expect(toMemberView(gv, { hideContacts: true }).roleLabel).toBe("Giáo viên");
    expect(toMemberView(ql, { hideContacts: true }).roleLabel).toBe("Quản lý cơ sở");
  });

  it("PH chưa rõ con nào trong lớp → nhãn chung, không vỡ", () => {
    expect(toMemberView({ ...ph, childNames: [] }, { hideContacts: true }).roleLabel).toBe("Phụ huynh");
  });

  it("tên user THẬT chứa SĐT/email (data lead cũ) → vẫn bị che khi người xem là PH", () => {
    const bẩn = { ...ph, name: "PH 0905123456 - hoa@example.com", childNames: ["Bé An"] };
    const masked = toMemberView(bẩn, { hideContacts: true });
    expect(findContactLeaks(masked)).toEqual([]);
    expect(masked.displayName).not.toContain("0905123456");
    // Bản đầy đủ cho nhân viên thì giữ nguyên tên gốc.
    expect(toMemberView(bẩn, { hideContacts: false }).displayName).toBe("PH 0905123456 - hoa@example.com");
  });

  it("user chưa có tên → nhãn chung, KHÔNG rơi về SĐT/email làm tên (đường rò cũ của sync-membership)", () => {
    const v = toMemberView({ ...ph, name: null }, { hideContacts: true });
    expect(v.displayName).toBe("Thành viên");
    expect(findContactLeaks(v)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BR-04 — hạn đọc 90 ngày sau khi hội thoại chuyển ARCHIVED.
//
// permissions.md, "Trạng thái đè lên tất cả": ARCHIVED → "Đọc ✅ (PH hết hạn sau 90
// ngày — GV/QLCS/Admin không hết hạn)". TS-08 bước 2: "tua thời gian +91 ngày (mock
// clock) → ph1 đọc → 403; gv1, ql1, admin1 vẫn đọc được".
//
// MỌI mốc thời gian TIÊM VÀO qua tham số `now` — không đọc đồng hồ máy, nên test cho
// cùng kết quả ở mọi múi giờ và không bao giờ "hết hạn" theo ngày chạy CI.
// ─────────────────────────────────────────────────────────────────────────────
describe("[BR-04] isArchivedReadExpired — PH hết hạn 90 ngày, nhân viên thì không", () => {
  const NOW = new Date("2026-08-09T10:00:00.000Z");
  const ngayTruoc = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  const PH = "CLASS_STUDENT_PARENT";

  it("hằng số là 90 ngày và mốc cắt lùi đúng 90 ngày", () => {
    expect(ARCHIVED_PARENT_READ_DAYS).toBe(90);
    expect(archivedReadCutoff(NOW).toISOString()).toBe("2026-05-11T10:00:00.000Z");
  });

  it("hội thoại còn ACTIVE / LOCKED → không bao giờ hết hạn, kể cả với PH", () => {
    for (const status of ["ACTIVE", "LOCKED"]) {
      expect(
        isArchivedReadExpired({ status, archivedAt: ngayTruoc(999), derivedFrom: PH, now: NOW }),
      ).toBe(false);
    }
  });

  it("PH: ARCHIVED 89 ngày → còn đọc; 91 ngày → HẾT HẠN [TS-08]", () => {
    expect(
      isArchivedReadExpired({ status: "ARCHIVED", archivedAt: ngayTruoc(89), derivedFrom: PH, now: NOW }),
    ).toBe(false);
    expect(
      isArchivedReadExpired({ status: "ARCHIVED", archivedAt: ngayTruoc(91), derivedFrom: PH, now: NOW }),
    ).toBe(true);
  });

  it("biên ĐÚNG 90 ngày vẫn đọc được — 'hết hạn SAU 90 ngày', lệch 1 ngày là sai", () => {
    const at90 = ngayTruoc(90);
    expect(
      isArchivedReadExpired({ status: "ARCHIVED", archivedAt: at90, derivedFrom: PH, now: NOW }),
    ).toBe(false);
    // nhích thêm 1 mili-giây quá mốc → hết hạn
    expect(
      isArchivedReadExpired({
        status: "ARCHIVED",
        archivedAt: new Date(at90.getTime() - 1),
        derivedFrom: PH,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("GV / QLCS / participant thêm tay: KHÔNG hết hạn dù archive đã 10 năm", () => {
    for (const derivedFrom of ["CLASS_TEACHER", "CENTER_MANAGER", null]) {
      expect(
        isArchivedReadExpired({
          status: "ARCHIVED",
          archivedAt: ngayTruoc(3650),
          derivedFrom,
          now: NOW,
        }),
        `${derivedFrom} không được hết hạn`,
      ).toBe(false);
    }
  });

  it("archivedAt NULL (dữ liệu cũ / archive sửa tay) → KHÔNG hết hạn, không chặn nhầm PH", () => {
    expect(
      isArchivedReadExpired({ status: "ARCHIVED", archivedAt: null, derivedFrom: PH, now: NOW }),
    ).toBe(false);
  });

  it("kết quả chỉ phụ thuộc `now` TIÊM VÀO — cùng dữ liệu, 'now' khác cho kết quả khác", () => {
    const row = { status: "ARCHIVED", archivedAt: new Date("2026-01-01T00:00:00.000Z"), derivedFrom: PH };
    expect(isArchivedReadExpired({ ...row, now: new Date("2026-03-01T00:00:00.000Z") })).toBe(false);
    expect(isArchivedReadExpired({ ...row, now: new Date("2026-08-09T00:00:00.000Z") })).toBe(true);
  });
});

describe("[BR-30] redactContactLike", () => {
  it("che SĐT VN mọi dạng và email, giữ nguyên chữ còn lại", () => {
    expect(redactContactLike("gọi 0905123456 nhé")).toBe("gọi ••• nhé");
    expect(redactContactLike("+84905123456")).toBe("•••");
    expect(redactContactLike("mail a.b+c@sata-robo.vn ok")).toBe("mail ••• ok");
  });

  it("không đụng chuỗi bình thường (mã lớp, ngày tháng, id)", () => {
    expect(redactContactLike("Lớp Sata 1 - 2026")).toBe("Lớp Sata 1 - 2026");
    expect(redactContactLike("clz9k2h4t0000abcd")).toBe("clz9k2h4t0000abcd");
  });
});

describe("[BR-30] hidesContactOf — liên hệ của TỪNG thành viên (quyết định 09/08/2026)", () => {
  const nhomLop = "CLASS_GROUP";
  const nhanRieng = "DM_TEACHER_PARENT";
  const phMember = "CLASS_STUDENT_PARENT";

  it("GIÁO VIÊN KHÔNG thấy liên hệ phụ huynh trong nhóm lớp", () => {
    // Chủ dự án chốt 09/08: chat theo luật PII chung của repo (`canViewParentContact`),
    // vốn đã chặn giáo viên ở trang tiến độ lớp ("P0-3: chống lộ SĐT toàn lớp").
    // Trước đó module chat pin chiều ngược lại và hai luật cùng sống mà không ai thấy,
    // vì chưa màn hình nhân viên nào vẽ liên hệ ra. ĐỪNG vá ngược case này.
    expect(
      hidesContactOf({
        conversationType: nhomLop,
        viewer: { role: "TEACHER", roles: ["TEACHER"], derivedFrom: "CLASS_TEACHER" },
        memberDerivedFrom: phMember,
      }),
    ).toBe(true);
  });

  it("TRỢ GIẢNG cũng không thấy — cùng lý do với giáo viên", () => {
    expect(
      hidesContactOf({
        conversationType: nhomLop,
        viewer: { role: "ASSISTANT_TEACHER", roles: ["ASSISTANT_TEACHER"], derivedFrom: "CLASS_TEACHER" },
        memberDerivedFrom: phMember,
      }),
    ).toBe(true);
  });

  it("ĐỐI CHỨNG DƯƠNG — QLCS VẪN thấy (không được siết quá tay thành ẩn với tất cả)", () => {
    // Thiếu ca này thì một bản vá `return true` cũng làm cả khối trên xanh. Quản lý cơ sở
    // cần gọi phụ huynh về học phí/nghỉ học — chặn họ là hỏng vận hành chứ không phải an toàn.
    expect(
      hidesContactOf({
        conversationType: nhomLop,
        viewer: { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], derivedFrom: "CENTER_MANAGER" },
        memberDerivedFrom: phMember,
      }),
    ).toBe(false);
  });

  it("ĐỐI CHỨNG DƯƠNG — kế toán và sale vẫn thấy (đúng nhóm vai của luật PII chung)", () => {
    for (const role of ["ACCOUNTANT", "SALES_CSM", "SUPER_ADMIN"]) {
      expect(
        hidesContactOf({
          conversationType: nhomLop,
          viewer: { role, roles: [role], derivedFrom: "CENTER_MANAGER" },
          memberDerivedFrom: phMember,
        }),
      ).toBe(false);
    }
  });

  it("hội thoại 1-1: ẩn với MỌI người xem, kể cả vai được xem liên hệ", () => {
    // Bảng "1-1" của permissions.md không có dòng "Xem thành viên" nào; không ô nào cấp
    // thì mặc định là không — màn thành viên của 1-1 vốn chỉ có đúng hai người.
    expect(
      hidesContactOf({
        conversationType: nhanRieng,
        viewer: { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], derivedFrom: null },
        memberDerivedFrom: phMember,
      }),
    ).toBe(true);
  });

  it("phụ huynh không thấy liên hệ của ai (luật cũ, tầng 1 vẫn thắng)", () => {
    expect(
      hidesContactOf({
        conversationType: nhomLop,
        viewer: { role: "PARENT", roles: ["PARENT"], derivedFrom: phMember },
        memberDerivedFrom: "CLASS_TEACHER",
      }),
    ).toBe(true);
  });
});
