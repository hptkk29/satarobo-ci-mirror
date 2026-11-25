// @vitest-environment node
/**
 * EL-12b — đường ghi nhịp xem.
 *
 * Đây là chỗ tám cơ chế chống học đối phó thật sự có hiệu lực hay không. Một cổng
 * đặt sai chỗ ở đây không văng lỗi — nó chỉ lặng lẽ ghi nhận giờ xem cho người
 * không xem, và bảng tuân thủ vẫn xanh.
 *
 * Các case dưới đây đi theo ba câu hỏi, không theo thứ tự hàm:
 *   1. Cổng có CHẶN đúng thứ phải chặn không?
 *   2. Cổng có chặn NHẦM người đang học thật không?
 *   3. Bị chặn rồi thì số liệu giám sát có được ghi lại không?
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  policy: vi.fn(async () => undefined),
  gate: vi.fn(() => null as { code: string; message: string } | null),
  rollup: vi.fn(async () => undefined),
  enrollment: null as unknown,
  lesson: null as unknown,
  course: null as unknown,
  progress: null as unknown,
  phien: null as unknown,
  /** Dòng ngân sách thời gian (`TrnVideoBudget`) đã lưu của (người, bài); `null` = chưa có. */
  budget: null as { tat: Date } | null,
  budgetUpsert: vi.fn(async (_a: { update: { tat: Date } }) => ({})),
  upsert: vi.fn(async (_a: { update: Record<string, unknown> }) => ({})),
  updateMany: vi.fn(async (_a: { data: Record<string, unknown> }) => ({ count: 1 })),
  sessCreate: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
  sessUpdate: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
  /** Khoá tư vấn của giao dịch — mock không chứng minh được nó KHOÁ, chỉ chứng minh nó ĐƯỢC GỌI (xem `[VNX-W1]`). */
  khoa: vi.fn(async (..._a: unknown[]) => 1),
  giaoDich: vi.fn(),
  /** Phiên bản nội dung mà khoá chia sẻ trên dòng bài đọc được TRONG giao dịch. */
  revBai: 1,
}));

vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-khong-dung-that",
}));
vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/elearning/policy-acceptance", () => ({
  assertPolicyAccepted: h.policy,
  PolicyNotAcceptedError: class extends Error {},
}));
vi.mock("@/lib/elearning/content-gate", () => ({ checkContentAccess: h.gate }));
vi.mock("@/lib/elearning/rollup", () => ({ cuonKhoaSauKhiXongBai: h.rollup }));
vi.mock("@/lib/db", () => {
  const d: Record<string, unknown> = {
    trnEnrollment: { findFirst: vi.fn(async () => h.enrollment) },
    trnLesson: { findFirst: vi.fn(async () => h.lesson) },
    trnCourse: { findUnique: vi.fn(async () => h.course) },
    trnLessonProgress: {
      findUnique: vi.fn(async () => h.progress),
      upsert: h.upsert,
      updateMany: h.updateMany,
    },
    trnVideoBudget: {
      findUnique: vi.fn(async () => h.budget),
      upsert: h.budgetUpsert,
    },
    trnVideoSession: {
      findFirst: vi.fn(async () => h.phien),
      create: h.sessCreate,
      update: h.sessUpdate,
    },
    $executeRaw: h.khoa,
    // `SELECT "mediaRevision" … FOR SHARE` trên dòng bài (đọc lại phiên bản trong khoá).
    $queryRaw: vi.fn(async () => [{ mediaRevision: h.revBai }]),
  };
  // Giao dịch mô phỏng: chạy callback với CHÍNH đối tượng mock. Đủ để đo hành vi của từng cổng; việc khoá thật
  // chỉ chứng minh được trên Postgres (`tests/elearning/video-nhip-xem-db.test.ts`).
  d.$transaction = async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
    h.giaoDich(opts);
    return fn(d);
  };
  return { db: d };
});

import { ghiNhipXem } from "@/lib/elearning/video-heartbeat";
import { kyVeMedia } from "@/lib/elearning/media-ticket";
import { idThachThuc, HAN_TRA_LOI_GIAY } from "@/lib/elearning/attention-check";
import { TOC_DO_TOI_DA } from "@/lib/elearning/video-heartbeat-contract";
import { dungSaiNoiDung } from "@/lib/elearning/video-time-budget";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const USER = "u1";
const LESSON = "les1";
const actor = { userId: USER } as never;

/**
 * Vé mặc định được phát 20 PHÚT trước `NOW`: người học đã mở trang từ lâu. Ngân sách thời gian thật neo vào lúc phát
 * vé (`video-time-budget.ts`) — vé phát đúng `NOW` thì nhịp tại `NOW` chỉ được ghi dung sai, đúng thứ cổng sinh ra để
 * chặn. Các ca về ngân sách tự chọn lúc phát vé (xem `[YT-LIMIT]`).
 */
const VE_MAC_DINH = NOW.getTime() - 20 * 60 * 1000;

const nhip = (o: Record<string, unknown> = {}) =>
  ghiNhipXem({
    actor,
    ve: kyVeMedia({ lessonId: LESSON, userId: USER }, undefined, VE_MAC_DINH),
    enrollmentId: "en1",
    lessonId: LESSON,
    tuSec: 0,
    denSec: 10,
    seq: 1,
    tocDo: 1,
    tabHien: true,
    viTriSec: 10,
    now: NOW,
    ...o,
  } as never);

/** Dữ liệu nền của một người đang học bình thường. */
beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockReturnValue(true);
  h.gate.mockReturnValue(null);
  h.enrollment = {
    id: "en1",
    courseId: "c1",
    status: "IN_PROGRESS",
    dueAt: null,
    assignmentId: "a1",
    assignment: { allowLate: false, blockSeek: true, maxPlaybackRate: 1.5 },
  };
  // ⚠️ `cues` phải có mặt: đường ghi `select` nó cùng câu truy vấn bài. Mock thiếu
  // trường là mock NÓI DỐI về hình dạng thật — và cái giá là một `TypeError` chỉ
  // hiện ra ở lượt chạy đầu tiên sau khi ai đó thêm trường.
  h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, mediaRevision: 1, cues: [] };
  h.revBai = 1;
  h.course = {
    id: "c1",
    visibility: "INTERNAL",
    selfEnrollEnabled: false,
    securityLevel: "NORMAL",
    versions: [{ id: "v1" }],
  };
  h.progress = null;
  h.phien = null;
  h.budget = null;
});

// ── 1. Đường bình thường ───────────────────────────────────────────────────

describe("nhịp bình thường", () => {
  it("ghi được và trả tỉ lệ phủ", async () => {
    const r = await nhip();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 10 giây / 600 giây = 2 đoạn 5 giây.
    expect(r.data.coveredSec).toBe(10);
    expect(r.data.status).toBe("GHI_NHAN");
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("mở phiên xem MỚI khi chưa có phiên nào đang mở", async () => {
    await nhip();
    expect(h.sessCreate).toHaveBeenCalledTimes(1);
    const arg = h.sessCreate.mock.calls[0]![0] as unknown as { data: { purgeAfter: Date } };
    // `purgeAfter` NOT NULL, ghi cứng lúc INSERT — cron dọn tầng 2 đi bằng cột này.
    // Bỏ trống là migration đỏ; ghi sai là dữ liệu giám sát nằm lại vĩnh viễn.
    expect(arg.data.purgeAfter.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("nối vào phiên ĐANG MỞ thay vì đẻ dòng mới mỗi nhịp", async () => {
    // Không có ranh giới phiên thì bảng giám sát phình theo số nhịp — 15 giây một
    // dòng cho mỗi người đang xem.
    h.phien = { id: "s1", maxPositionSec: 5, startedAt: NOW, lastBeatAt: NOW, totalWatchSec: 0 };
    await nhip();
    expect(h.sessCreate).not.toHaveBeenCalled();
    expect(h.sessUpdate).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Vé phát ─────────────────────────────────────────────────────────────

describe("vé phát — chứng minh nhịp đến từ người ĐÃ MỞ trình phát", () => {
  it("không vé ⇒ TICKET_INVALID, và KHÔNG tốn câu truy vấn nào", async () => {
    // Vé đứng trước mọi lần chạm DB: nhịp bịa phải rẻ để từ chối, không thì chính
    // cổng chống gian lận thành đường làm nghẽn DB.
    const r = await nhip({ ve: "rac" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TICKET_INVALID");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("vé của NGƯỜI KHÁC ⇒ từ chối", async () => {
    const r = await nhip({ ve: kyVeMedia({ lessonId: LESSON, userId: "u2" }, undefined, NOW.getTime()) });
    expect(r.ok && "x").toBeFalsy();
    if (r.ok) return;
    expect(r.code).toBe("TICKET_INVALID");
  });

  it("vé của BÀI KHÁC ⇒ từ chối", async () => {
    // Không kiểm vế này thì một vé hợp lệ của bài 3 phút dùng được để khai giờ xem
    // cho bài 15 phút.
    const r = await nhip({ ve: kyVeMedia({ lessonId: "les-khac", userId: USER }, undefined, NOW.getTime()) });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("TICKET_INVALID");
  });

  it("vé HẾT HẠN ⇒ từ chối", async () => {
    const ve = kyVeMedia({ lessonId: LESSON, userId: USER }, 60, NOW.getTime());
    const r = await nhip({ ve, now: new Date(NOW.getTime() + 61_000) });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("TICKET_INVALID");
  });
});

// ── 3. Sở hữu và trạng thái ────────────────────────────────────────────────

describe("sở hữu — chống IDOR", () => {
  it("lượt học không thuộc mình ⇒ NOT_FOUND, KHÔNG phải một lỗi riêng", async () => {
    // Phân biệt "không tồn tại" với "không phải của bạn" là nói cho người dò biết
    // id nào có thật.
    h.enrollment = null;
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("NOT_FOUND");
  });

  it("bài KHÔNG thuộc khoá đã ghi danh ⇒ NOT_FOUND", async () => {
    h.lesson = null;
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("NOT_FOUND");
  });

  it("lượt học đã THU HỒI ⇒ REVOKED", async () => {
    h.enrollment = { ...(h.enrollment as object), status: "REVOKED" };
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("REVOKED");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("thiếu quyền ⇒ PERMISSION_DENIED", async () => {
    h.can.mockReturnValue(false);
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("PERMISSION_DENIED");
  });
});

// ── 4. Quá hạn ─────────────────────────────────────────────────────────────

describe("khoá sau hạn", () => {
  it("quá hạn mà không cho học muộn ⇒ DUE_PASSED, bitmap cũ KHÔNG bị đụng", async () => {
    // Hạn chót ngưng ghi nhận tiến độ MỚI; bằng chứng đã học vẫn là bằng chứng.
    h.enrollment = {
      ...(h.enrollment as object),
      dueAt: new Date(NOW.getTime() - 86_400_000),
    };
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("DUE_PASSED");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("cho học muộn ⇒ vẫn ghi", async () => {
    h.enrollment = {
      ...(h.enrollment as object),
      dueAt: new Date(NOW.getTime() - 86_400_000),
      assignment: { allowLate: true, blockSeek: true, maxPlaybackRate: 1.5 },
    };
    const r = await nhip();
    expect(r.ok).toBe(true);
  });
});

// ── 5. Trần tốc độ ─────────────────────────────────────────────────────────

describe("trần tốc độ phát — kiểm ở SERVER", () => {
  it("2x ⇒ RATE_TOO_HIGH", async () => {
    const r = await nhip({ tocDo: 2 });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("RATE_TOO_HIGH");
  });

  it("đúng trần thì cho", async () => {
    expect((await nhip({ tocDo: TOC_DO_TOI_DA })).ok).toBe(true);
  });

  it("trần lấy theo TỪNG lượt giao, không phải hằng số toàn hệ", async () => {
    // Lượt giao siết còn 1x thì 1.5x phải bị chặn — nếu không, cột
    // `maxPlaybackRate` trên `TrnAssignment` chỉ là trang trí.
    h.enrollment = {
      ...(h.enrollment as object),
      assignment: { allowLate: false, blockSeek: true, maxPlaybackRate: 1 },
    };
    const r = await nhip({ tocDo: 1.5 });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("RATE_TOO_HIGH");
  });
});

// ── 6. Chống xem song song ─────────────────────────────────────────────────

describe("chống xem song song", () => {
  it("khoá thuộc phiên khác ⇒ SESSION_SUPERSEDED", async () => {
    const r = await nhip({
      khoaPhat: { backend: "upstash", khoaThuocNguoiKhac: true },
    });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("SESSION_SUPERSEDED");
  });

  it("🔴 Redis chết ⇒ VẪN GHI (chốt 24/08)", async () => {
    // Một sự cố hạ tầng không được biến thành cả công ty ngừng học, nhất là khi
    // khoá tuân thủ có hạn chót cứng.
    const r = await nhip({
      khoaPhat: { backend: "memory", khoaThuocNguoiKhac: true },
    });
    expect(r.ok).toBe(true);
  });
});

// ── 7. Chặn tua tới ────────────────────────────────────────────────────────

describe("chặn tua tới", () => {
  const daXem = (o: Record<string, unknown> = {}) => {
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
      ...o,
    };
  };

  it("nhảy tới vùng CHƯA xem ⇒ SEEK_BLOCKED", async () => {
    daXem();
    const r = await nhip({ seq: 2, viTriSec: 500, tuSec: 495, denSec: 500 });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("SEEK_BLOCKED");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("bị chặn thì VẪN ĐẾM — đó là số liệu của báo cáo giám sát", async () => {
    // Từ chối mà không đếm là vứt đúng thứ EL-13 cần đo.
    daXem();
    await nhip({ seq: 2, viTriSec: 500, tuSec: 495, denSec: 500 });
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    const arg = h.updateMany.mock.calls[0]![0] as unknown as {
      data: { blockedSeekCount: unknown; seekCount: unknown };
    };
    expect(arg.data.blockedSeekCount).toEqual({ increment: 1 });
    expect(arg.data.seekCount).toEqual({ increment: 1 });
  });

  it("🔴 PHÁT LIÊN TỤC không bị chặn — con trỏ luôn chạy trước mốc đã ghi", async () => {
    // Case này bắt được bug đã có thật ở bản đầu: hàm so VỊ TRÍ CON TRỎ với
    // `maxPositionSec`, mà mốc đó chỉ cập nhật ở cuối mỗi nhịp. Với nhịp 15 giây
    // thì mọi nhịp bình thường đều trông như "nhảy tới 15 giây chưa xem", kể cả
    // nhịp ĐẦU TIÊN của mọi bài — người học không xem nổi một video nào, và lỗi
    // hiện ra là "khoá này không cho tua tới".
    daXem({ maxPositionSec: 100, coveredSec: 100 });
    const r = await nhip({ seq: 2, tuSec: 100, denSec: 115, viTriSec: 115 });
    expect(r.ok).toBe(true);
  });

  it("🔴 nhịp ĐẦU TIÊN của bài mới không bị chặn", async () => {
    // Chưa có dòng tiến độ ⇒ mốc là 0, còn con trỏ đã ở giây 10.
    h.progress = null;
    expect((await nhip({ tuSec: 0, denSec: 10, viTriSec: 10 })).ok).toBe(true);
  });

  it("tua LÙI không bị chặn — xem lại là hành vi học bình thường", async () => {
    daXem();
    expect((await nhip({ seq: 2, viTriSec: 20, tuSec: 15, denSec: 20 })).ok).toBe(true);
  });

  it("lượt giao TẮT chặn tua ⇒ nhảy đâu cũng được", async () => {
    daXem();
    h.enrollment = {
      ...(h.enrollment as object),
      assignment: { allowLate: false, blockSeek: false, maxPlaybackRate: 1.5 },
    };
    expect((await nhip({ seq: 2, viTriSec: 500, tuSec: 495, denSec: 500 })).ok).toBe(true);
  });
});

// ── 8. Nhịp đến muộn ───────────────────────────────────────────────────────

describe("nhịp đến muộn", () => {
  it("seq cũ ⇒ BO_QUA nhưng KHÔNG báo lỗi", async () => {
    // Với người học không có gì sai; một lỗi ở đây sẽ hiện lên giữa lúc họ đang xem.
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 9,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
    };
    const r = await nhip({ seq: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("BO_QUA");
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

// ── 9. Điểm kiểm tra tập trung ─────────────────────────────────────────────

describe("điểm kiểm tra tập trung", () => {
  it("câu đang treo QUÁ HẠN ⇒ PAUSED_ATTENTION và gỡ câu treo", async () => {
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 1,
      attnPendingAt: new Date(NOW.getTime() - (HAN_TRA_LOI_GIAY + 5) * 1000),
    };
    const r = await nhip({ seq: 2, tuSec: 100, denSec: 105, viTriSec: 105 });
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("PAUSED_ATTENTION");
    // Gỡ câu treo để người học xem tiếp được — không thì họ kẹt vĩnh viễn.
    const arg = h.updateMany.mock.calls[0]![0] as unknown as {
      data: { attnPendingAt: unknown };
    };
    expect(arg.data.attnPendingAt).toBeNull();
  });

  it("trả lời ĐÚNG câu đang treo ⇒ ghi tiếp bình thường", async () => {
    const hoiLuc = new Date(NOW.getTime() - 5000);
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 1,
      attnPendingAt: hoiLuc,
    };
    const r = await nhip({
      seq: 2,
      tuSec: 100,
      denSec: 105,
      viTriSec: 105,
      traLoiThachThuc: { id: idThachThuc(hoiLuc) },
    });
    expect(r.ok).toBe(true);
    const arg = h.upsert.mock.calls[0]![0] as unknown as {
      update: { attnPendingAt: unknown; attnPassedCount: unknown };
    };
    expect(arg.update.attnPendingAt).toBeNull();
    expect(arg.update.attnPassedCount).toEqual({ increment: 1 });
  });

  it("chưa trả lời và CÒN TRONG HẠN ⇒ chờ, chưa phạt", async () => {
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 1,
      attnPendingAt: new Date(NOW.getTime() - 2000),
    };
    const r = await nhip({ seq: 2, tuSec: 100, denSec: 105, viTriSec: 105 });
    if (r.ok) throw new Error("phải chờ");
    expect(r.code).toBe("PAUSED_ATTENTION");
    // Chưa phạt: không gỡ câu treo, để họ còn trả lời được.
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

// ── 10. Bài chưa có thời lượng ─────────────────────────────────────────────

describe("bài video chưa có thời lượng", () => {
  it("không có mẫu số ⇒ TỪ CHỐI, không ghi bừa", async () => {
    // Ghi bừa là đẻ ra một tỉ lệ phần trăm không dựa trên gì, rồi báo cáo tuân thủ
    // đứng lên chính con số đó.
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: null, cues: [] };
    const r = await nhip();
    if (r.ok) throw new Error("phải từ chối");
    expect(r.code).toBe("NOT_FOUND");
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

// ── 11. Câu hỏi chèn giữa video ────────────────────────────────────────────

describe("câu hỏi chèn giữa video", () => {
  const CAU = {
    id: "q1",
    type: "single" as const,
    question: "Bước nào làm trước?",
    options: ["A", "B", "C"],
    correctIndex: 1,
  };
  const cue = (o: Record<string, unknown> = {}) => ({
    id: "c1",
    atSec: 30,
    blocking: true,
    inlineJson: CAU,
    ...o,
  });

  const datCue = (cues: unknown[]) => {
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, cues };
  };

  const tienDo = (cueLogJson: unknown) => {
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
      cueLogJson,
    };
  };

  /**
   * Có lượt ghi nào chạm BITMAP không.
   *
   * ⚠️ Canh thứ này thay vì đếm số lượt `upsert`: sổ cue cũng đi qua `upsert` (nó
   * phải tạo được dòng tiến độ khi bài chưa có dòng nào), nên đếm lượt gọi là canh
   * nhầm thứ. Bất biến THẬT là: đang bị chặn thì KHÔNG được cộng phủ.
   */
  const coGhiBitmap = () =>
    h.upsert.mock.calls.some((c) => JSON.stringify(c[0]).includes("segmentBitmap"));

  const dangTreo = (soLanSai = 0, hoiLuc = NOW) => ({
    v: 1,
    treo: { cueId: "c1", hoiLuc: hoiLuc.toISOString(), soLanSai },
    xong: [],
  });

  it("chạm mốc ⇒ trả câu hỏi, ghi nhận TỚI mốc rồi dừng", async () => {
    // Ghi tới mốc là đúng: người học đã xem tới đó. Thoát sớm không ghi gì thì
    // đoạn đó bay mất vĩnh viễn VÀ `maxPositionSec` đứng yên — làm nhịp mang câu
    // trả lời bị chính cổng chặn-tua nuốt.
    datCue([cue()]);
    tienDo(null);
    // Người học đang ở giây 25 và xem tiếp tới 35; cue nằm ở 30.
    h.progress = { ...(h.progress as object), maxPositionSec: 25, coveredSec: 25 };
    const r = await nhip({ seq: 2, tuSec: 25, denSec: 35, viTriSec: 35 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("CHO_TRA_LOI");
    expect(r.data.thachThuc?.loai).toBe("CUE");
    expect(r.data.thachThuc?.atSec).toBe(30);
    expect(coGhiBitmap()).toBe(true);

    // Nhưng KHÔNG được ghi quá mốc: mốc đã xem phải kẹp ở giây 30, không phải 35.
    const arg = h.upsert.mock.calls[0]![0] as unknown as {
      update: { maxPositionSec: number };
    };
    expect(arg.update.maxPositionSec).toBe(30);
  });

  it("🔴 thân phản hồi KHÔNG mang đáp án đúng", async () => {
    // Kiểm trên JSON đã serialize, không trên object: đây là thứ thật sự đi qua
    // dây, và là thứ mở tab Network ra là thấy.
    datCue([cue()]);
    tienDo(null);
    const r = await nhip({ seq: 2, tuSec: 25, denSec: 35, viTriSec: 35 });
    const s = JSON.stringify(r);
    expect(s).not.toContain("correctIndex");
    expect(s).toContain("Bước nào làm trước");
  });

  it("🔴 câu ĐANG TREO mà nhịp không mang đáp án ⇒ gửi LẠI câu hỏi", async () => {
    // Không gửi lại thì tải lại trang là mất câu hỏi, video vẫn bị chặn, và người
    // học không còn gì để bấm — kẹt cứng, lối ra duy nhất là bỏ bài.
    datCue([cue()]);
    tienDo(dangTreo());
    const r = await nhip({ seq: 2, tuSec: 30, denSec: 45, viTriSec: 45 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thachThuc?.id).toBe("cue-c1");
    expect(coGhiBitmap()).toBe(false);
  });

  it("🔴 KHÔNG có đường bỏ qua bằng cách ngồi im", async () => {
    // Ổ nguy hiểm nhất: chép nhánh hết-hạn của điểm kiểm tra tập trung sang cue
    // thì "chờ 45 giây" trở thành đường qua MỌI câu hỏi — và mọi thứ vẫn trả 200
    // nên không ai thấy gì bất thường.
    datCue([cue()]);
    tienDo(dangTreo(0, new Date(NOW.getTime() - 3_600_000)));
    const r = await nhip({ seq: 2, tuSec: 30, denSec: 45, viTriSec: 45 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("CHO_TRA_LOI");
    expect(coGhiBitmap()).toBe(false);
  });

  it("trả lời SAI ⇒ 200 kèm chính câu đó, có cờ `saiRoi`", async () => {
    datCue([cue()]);
    tienDo(dangTreo());
    const r = await nhip({
      seq: 2,
      tuSec: 30,
      denSec: 45,
      viTriSec: 45,
      traLoiThachThuc: { id: "cue-c1", dapAn: "0" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.saiRoi).toBe(true);
    expect(r.data.thachThuc?.id).toBe("cue-c1");
  });

  it("trả lời ĐÚNG ⇒ đi tiếp và ghi tiến độ bình thường", async () => {
    datCue([cue()]);
    tienDo(dangTreo());
    const r = await nhip({
      seq: 2,
      tuSec: 30,
      denSec: 45,
      viTriSec: 45,
      traLoiThachThuc: { id: "cue-c1", dapAn: "1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("GHI_NHAN");
    expect(coGhiBitmap()).toBe(true);
  });

  it("🔴 trả lời bằng id của cơ chế TẬP TRUNG không mở được cue", async () => {
    // Hai loại thách thức đi chung một đường trả lời; không kiểm tiền tố thì câu
    // trả lời loại này được ghi nhận cho loại kia, và không cách nào phát hiện.
    datCue([cue()]);
    tienDo(dangTreo());
    const r = await nhip({
      seq: 2,
      tuSec: 30,
      denSec: 45,
      viTriSec: 45,
      traLoiThachThuc: { id: idThachThuc(NOW), dapAn: "1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("CHO_TRA_LOI");
  });

  it("cue ĐÃ XONG thì không hỏi lại — kể cả sau khi tải lại trang", async () => {
    datCue([cue()]);
    tienDo({ v: 1, treo: null, xong: [{ cueId: "c1", dung: true }] });
    const r = await nhip({ seq: 2, tuSec: 25, denSec: 35, viTriSec: 35 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("GHI_NHAN");
  });

  it("🔴 câu HỎNG KHUÔN không khoá cứng người học", async () => {
    // Một bản ghi bẩn do người soạn để lại không được phép nhốt người học ra khỏi
    // bài của họ — triệu chứng sẽ là video dừng câm, không câu hỏi, không lỗi.
    datCue([cue({ inlineJson: { type: "essay", question: "x" } })]);
    tienDo(null);
    const r = await nhip({ seq: 2, tuSec: 25, denSec: 35, viTriSec: 35 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("GHI_NHAN");
  });

  it("🔴 cue KHÔNG chạm sổ của cơ chế tập trung", async () => {
    // `attnAskedCount` chính là đầu vào của `nenHoiTapTrung`. Cue tăng nó thì video
    // nhiều cue sẽ gần như không bao giờ hỏi tập trung nữa — vô hiệu hoá im lặng
    // một cơ chế giám sát, và ô báo cáo "tập trung 5/5" thành con số bịa.
    datCue([cue()]);
    tienDo(dangTreo());
    await nhip({
      seq: 2,
      tuSec: 30,
      denSec: 45,
      viTriSec: 45,
      traLoiThachThuc: { id: "cue-c1", dapAn: "1" },
    });
    const moiLanGhi = [...h.updateMany.mock.calls, ...h.upsert.mock.calls]
      .map((c) => JSON.stringify(c[0]))
      .join(" ");
    expect(moiLanGhi).not.toContain("attnAskedCount");
    expect(moiLanGhi).not.toContain("attnPassedCount");
  });

  it("🔴 nhịp MANG CÂU TRẢ LỜI không được bị cổng chặn-tua nuốt", async () => {
    // Kịch bản thật, nhịp 15 giây, cue chặn ở giây 110:
    //  · nhịp trước kết ở giây 100 ⇒ `maxPositionSec` = 100
    //  · nhịp sau (100,115] chạm cue ⇒ bung câu hỏi
    //  · người học trả lời ⇒ nhịp mang đáp án có `tuSec` = 115
    // Nếu cổng chặn-tua so 115 với 100 thì câu trả lời KHÔNG BAO GIỜ tới được chỗ
    // chấm: mọi cue chặn khoá cứng bài học, và thông báo hiện ra là "khoá này
    // không cho tua tới" — không liên quan gì tới việc họ vừa làm.
    datCue([cue({ atSec: 110 })]);
    tienDo(dangTreo());
    const r = await nhip({
      seq: 3,
      tuSec: 115,
      denSec: 120,
      viTriSec: 120,
      traLoiThachThuc: { id: "cue-c1", dapAn: "1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("GHI_NHAN");
  });

  it("🔴 phủ TRƯỚC mốc cue phải được tính, và mốc đã xem phải nhích", async () => {
    // Thoát sớm ở cổng cue mà không ghi gì nghĩa là đoạn từ nhịp trước tới mốc cue
    // bay mất vĩnh viễn, và `maxPositionSec` đứng yên — chính là thứ làm nhịp trả
    // lời bị coi là tua trộm.
    datCue([cue({ atSec: 110 })]);
    tienDo(null);
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 100,
      contentSec: 600,
      maxPositionSec: 100,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
      cueLogJson: null,
    };
    const r = await nhip({ seq: 2, tuSec: 100, denSec: 115, viTriSec: 115 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thachThuc?.id).toBe("cue-c1");
    // Có ghi bitmap cho phần TRƯỚC mốc.
    expect(coGhiBitmap()).toBe(true);
    // Và tỉ lệ phủ trả về là số THẬT, không phải 0 — trả 0 làm thanh tiến độ trên
    // màn hình tụt về 0% mỗi lần câu hỏi bung ra.
    expect(r.data.coveredSec).toBeGreaterThan(0);
  });

  it("🔴 bài CHƯA có dòng tiến độ: cue vẫn phải ghi sổ được", async () => {
    // Người vừa mở bài đã chạm mốc cue ở nhịp đầu tiên. Không ghi được câu treo
    // thì nhịp sau `so.treo` vẫn null ⇒ câu trả lời của họ rơi vào hư không:
    // hoặc bị hỏi lại mãi (kẹt cứng), hoặc mốc trôi qua và cue bị BỎ QUA hẳn.
    datCue([cue()]);
    h.progress = null;
    // Phát liên tục từ đầu bài — nhịp đầu bắt đầu ở giây 0, không phải giữa chừng
    // (bắt đầu giữa chừng khi chưa xem gì CHÍNH LÀ một cú tua tới, và bị chặn ở
    // cổng trước).
    const r1 = await nhip({ seq: 1, tuSec: 0, denSec: 35, viTriSec: 35 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.data.thachThuc?.id).toBe("cue-c1");
    // Phải có một lượt ghi câu treo — không thì trạng thái không sống qua nhịp.
    const daGhi = [...h.upsert.mock.calls, ...h.updateMany.mock.calls]
      .map((c) => JSON.stringify(c[0]))
      .join(" ");
    expect(daGhi).toContain("cueLogJson");
  });

  it("bài KHÔNG có cue ⇒ hành vi không đổi, không thêm lượt ghi nào", async () => {
    datCue([]);
    tienDo(null);
    const r = await nhip({ seq: 2, tuSec: 25, denSec: 35, viTriSec: 35 });
    expect(r.ok).toBe(true);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

// ── [YT-TAIL] video ngắn, độ dài không chia hết cho 5 ─────────────────────

describe("[YT-TAIL] xem HẾT video 19 giây ⇒ phải hoàn thành, không kẹt ở 75%", () => {
  // Ca đo thật ở E2E YouTube: 19 giây xem trọn mà server chỉ ghi 15 giây (79%). Ngưỡng hoàn thành
  // là 95% nên người xem hết bài vẫn không hoàn thành được — với MỌI video dưới ~100 giây có
  // thời lượng không chia hết cho 5, MP4 lẫn YouTube.
  const daXem15 = () => {
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 19, cues: [] };
    h.progress = {
      segmentBitmap: Buffer.from([0b0000_0111]), // đoạn 0–5, 5–10, 10–15
      segmentSec: 5,
      coveredSec: 15,
      contentSec: 19,
      maxPositionSec: 15,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
    };
  };

  it("nhịp cuối 15→19 ⇒ 100%, 19 giây, đã hoàn thành", async () => {
    daXem15();
    const r = await nhip({ seq: 2, tuSec: 15, denSec: 19, viTriSec: 19 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.coveragePercent).toBe(100);
    expect(r.data.coveredSec).toBe(19);
    const upd = h.upsert.mock.calls[0]![0].update;
    expect(upd.status).toBe("DONE");
    expect(upd.coveredSec).toBe(19);
    expect(upd.completedAt).toBeInstanceOf(Date);
  });

  it("dừng ở giây 17 thì CHƯA hoàn thành — không nới thành 'gần hết là xong'", async () => {
    daXem15();
    const r = await nhip({ seq: 2, tuSec: 15, denSec: 17, viTriSec: 17 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.coveragePercent).toBe(75);
    expect(h.upsert.mock.calls[0]![0].update.status).toBe("IN_PROGRESS");
  });

  it("khai vị trí VƯỢT nội dung từ vùng chưa xem ⇒ không hoàn thành (bị chặn tua tới)", async () => {
    // Mới xem 5 giây rồi nhảy tới 17 và khai tới 5000: cổng chặn-tua phải chặn, và dù có lọt
    // thì phần "vượt" cũng không phải nội dung.
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 19, cues: [] };
    h.progress = {
      segmentBitmap: Buffer.from([0b0000_0001]),
      segmentSec: 5,
      coveredSec: 5,
      contentSec: 19,
      maxPositionSec: 5,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
    };
    const r = await nhip({ seq: 2, tuSec: 17, denSec: 5000, viTriSec: 5000 });
    expect(r.ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("lượt giao cho phép tua + khai vượt nội dung ⇒ chỉ ghi đoạn đuôi thật, không hoàn thành", async () => {
    h.enrollment = {
      id: "en1",
      courseId: "c1",
      status: "IN_PROGRESS",
      dueAt: null,
      assignmentId: "a1",
      assignment: { allowLate: false, blockSeek: false, maxPlaybackRate: 1.5 },
    };
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 19, cues: [] };
    h.progress = {
      segmentBitmap: Buffer.from([0b0000_0001]),
      segmentSec: 5,
      coveredSec: 5,
      contentSec: 19,
      maxPositionSec: 5,
      seq: 1,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
    };
    const r = await nhip({ seq: 2, tuSec: 17, denSec: 5000, viTriSec: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const upd = h.upsert.mock.calls[0]![0].update;
    expect(upd.coveredSec).toBe(9); // 5 (đã có) + 4 (đoạn đuôi 15–19), không phải 5000
    expect(upd.status).toBe("IN_PROGRESS");
  });
});

// ── [YT-LIMIT] server đối chiếu số giây khai với thời gian THẬT trôi qua ─────

describe("[YT-LIMIT] server đối chiếu số giây khai với thời gian THẬT trôi qua", () => {
  // Đo ngày 27/10/2026 khi rà đường ghi nhịp cho nguồn YouTube: server kiểm vé, chặn tua tới, trần mỗi nhịp, trần
  // tốc độ, câu hỏi chèn/tập trung — nhưng KHÔNG đối chiếu `denSec - tuSec` với thời gian thật giữa hai nhịp. Một
  // client viết tay có vé hợp lệ gửi liên tiếp 0→20, 20→40, 40→60 trong CÙNG MỘT GIÂY được cộng đủ 60 giây. Với
  // YouTube giới hạn này giống hệt MP4 (nhịp do trình duyệt khai, không phải do server đo).
  //
  // Ghim `it.fails` cũ (PR #1025) đã GỠ khi cổng ngân sách thời gian thật (`video-time-budget.ts`) vào: ca này giờ là
  // ca THƯỜNG, khẳng định bất biến. Mock không giữ trạng thái giữa hai lượt gọi, nên ca dưới tự nuôi lại tiến độ + mốc
  // ngân sách sau mỗi nhịp — đúng thứ DB thật làm. Bản Postgres thật của cùng ca: `[VNX-N1]`.
  type Tien = { segmentBitmap: unknown; coveredSec: number; maxPositionSec: number };

  /**
   * Gửi một chuỗi nhịp tại các thời điểm cho trước (giây kể từ `NOW`); trả `coveredSec` sau mỗi nhịp.
   * Vé được phát tại `NOW` (người học vừa mở trang) — trừ khi truyền `phatVe` (giây kể từ `NOW`).
   *
   * `tu` vắng mặt = trình phát ĐÚNG GIAO THỨC: bắt đầu từ điểm server báo đã nhận (`meta.denNhan`) hoặc điểm kết thúc
   * của nhịp trước. `tu` có mặt = client tự viết, không theo giao thức. Nhịp bị TỪ CHỐI (ví dụ tua tới) không đổi
   * tiến độ và được ghi lại bằng `loi`.
   */
  async function chay(nhips: { luc: number; seq: number; tu?: number; den: number }[], phatVe = 0) {
    // `as … | null` (không chú thích kiểu): chú thích + gán `null` làm TS thu hẹp biến thành `never` trong vòng lặp.
    let tien = null as Tien | null;
    let moc = 0;
    const ve = kyVeMedia({ lessonId: LESSON, userId: USER }, undefined, NOW.getTime() + phatVe * 1000);
    const ra: { covered: number; catThoiGian: boolean; denNhan?: number; loi?: string }[] = [];
    for (const n of nhips) {
      const luc = new Date(NOW.getTime() + n.luc * 1000);
      h.progress = tien
        ? { ...tien, segmentSec: 5, contentSec: 600, seq: n.seq - 1, verifiedAt: null, attnAskedCount: 0, attnPendingAt: null }
        : null;
      h.upsert.mockClear();
      h.budgetUpsert.mockClear();
      const r = await nhip({ seq: n.seq, tuSec: n.tu ?? moc, denSec: n.den, viTriSec: n.den, now: luc, ve });
      if (!r.ok) {
        ra.push({ covered: tien?.coveredSec ?? 0, catThoiGian: false, loi: r.code });
        continue;
      }
      moc = r.data.meta.denNhan ?? n.den;
      const up = h.upsert.mock.calls[0]![0] as unknown as { update: Tien };
      const tong: number = up.update.coveredSec;
      tien = { segmentBitmap: up.update.segmentBitmap, coveredSec: tong, maxPositionSec: up.update.maxPositionSec };
      // Nuôi lại mốc ngân sách đúng như DB: chỉ đổi khi nhịp có ghi gì.
      if (h.budgetUpsert.mock.calls.length > 0) h.budget = { tat: h.budgetUpsert.mock.calls[0]![0].update.tat };
      ra.push({ covered: tong, catThoiGian: r.data.biCatThoiGian === true, denNhan: r.data.meta.denNhan });
    }
    return ra;
  }

  it("ba nhịp 20 giây trong cùng một giây (10 giây sau khi mở trang) KHÔNG được cộng đủ 60 giây — tổng ≤ tốc độ × thời gian thật + dung sai", async () => {
    const kq = await chay([
      { luc: 10, seq: 1, den: 20 },
      { luc: 10, seq: 2, den: 40 },
      { luc: 10, seq: 3, den: 60 },
    ]);
    const tong = kq.at(-1)!.covered;
    expect(tong).toBeLessThan(60);
    // Bất biến: ≤ 1.5 × 10 giây + dung sai (3) = 18.
    expect(tong).toBeLessThanOrEqual(TOC_DO_TOI_DA * 10 + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(tong).toBeGreaterThan(0); // không "chặn tất cả"
    // Nhịp thứ ba gặp ngân sách đã cạn: không cộng thêm, và được báo là cắt vì THỜI GIAN.
    expect(kq[2]!.covered).toBe(kq[1]!.covered);
    expect(kq[2]!.catThoiGian).toBe(true);
    // Phần chưa nhận được báo lại để trình phát xin lại (không mất): điểm nhận ≤ điểm bắt đầu + ngân sách.
    expect(kq[2]!.denNhan).toBeDefined();
    expect(kq[2]!.denNhan!).toBeLessThan(60);
  });

  it("lượt giao KHOÁ tốc độ 1x ⇒ ngân sách chặt hơn, KHÔNG dùng mặc định 1.5x của hợp đồng", async () => {
    // Trần tốc độ của ngân sách là của LƯỢT GIAO (`maxPlaybackRate`); `tocDo` do client khai không được dùng — và nó
    // cũng không thể khai cao hơn trần (cổng RATE_TOO_HIGH), nên chỗ DUY NHẤT sai được là bỏ qua lượt giao.
    const nhips = [
      { luc: 10, seq: 1, den: 20 },
      { luc: 10, seq: 2, den: 40 },
      { luc: 10, seq: 3, den: 60 },
    ];
    const nhanh = (await chay(nhips)).at(-1)!.covered;
    (h.enrollment as { assignment: { maxPlaybackRate: number } }).assignment.maxPlaybackRate = 1;
    h.budget = null;
    const cham = (await chay(nhips)).at(-1)!.covered;
    expect(cham).toBeLessThanOrEqual(1 * 10 + dungSaiNoiDung(1));
    expect(cham).toBeLessThan(nhanh);
  });

  it("client TỰ VIẾT không theo giao thức (nhảy `tu` thẳng tới cuối khoảng trước) cũng không qua được: hoặc ngân sách cắt, hoặc cổng chặn-tua từ chối", async () => {
    const kq = await chay([
      { luc: 10, seq: 1, tu: 0, den: 20 },
      { luc: 10, seq: 2, tu: 20, den: 40 },
      { luc: 10, seq: 3, tu: 40, den: 60 },
    ]);
    expect(kq.at(-1)!.covered).toBeLessThanOrEqual(TOC_DO_TOI_DA * 10 + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(kq.slice(1).every((k) => k.loi === "SEEK_BLOCKED" || k.catThoiGian)).toBe(true);
  });

  it("video 19 giây: một nhịp khai 0→19 ngay sau khi mở trang KHÔNG hoàn thành được — dung sai không đủ mua cả bài", async () => {
    (h.lesson as { durationSec: number }).durationSec = 19;
    const kq = await chay([{ luc: 1, seq: 1, den: 19 }]);
    expect(kq[0]!.covered).toBeLessThan(19);
    const up = h.upsert.mock.calls[0]![0] as unknown as { update: { status: string } };
    expect(up.update.status).toBe("IN_PROGRESS");
  });

  it("ĐỐI CHỨNG: cùng ba nhịp nhưng cách nhau đúng nhịp thật (20/35/50 giây sau khi mở trang) ⇒ cộng ĐỦ 60 giây — không phạt người xem đúng nhịp", async () => {
    const kq = await chay([
      { luc: 20, seq: 1, den: 20 },
      { luc: 35, seq: 2, den: 40 },
      { luc: 50, seq: 3, den: 60 },
    ]);
    expect(kq.at(-1)!.covered).toBe(60);
    expect(kq.every((k) => !k.catThoiGian)).toBe(true);
    expect(kq.every((k) => k.denNhan === undefined)).toBe(true);
  });

  it("ĐỐI CHỨNG: video 19 giây xem hết ở 1.5x (nhịp tới sau 13 giây thật) ⇒ DONE", async () => {
    (h.lesson as { durationSec: number }).durationSec = 19;
    const kq = await chay([{ luc: 13, seq: 1, den: 19 }]);
    expect(kq[0]!.covered).toBe(19);
    const up = h.upsert.mock.calls[0]![0] as unknown as { update: { status: string } };
    expect(up.update.status).toBe("DONE");
  });

  it("vé CŨ không mua được ngân sách vô hạn: mở trang 10 phút trước rồi bắn 3 nhịp cùng giây ⇒ tối đa tốc độ × cửa sổ + dung sai", async () => {
    const kq = await chay(
      [
        { luc: 0, seq: 1, den: 25 },
        { luc: 0, seq: 2, den: 50 },
        { luc: 0, seq: 3, den: 75 },
      ],
      -600,
    );
    // Cửa sổ 30 giây × 1.5 + 3 = 48.
    expect(kq.at(-1)!.covered).toBeLessThanOrEqual(48);
    expect(kq.at(-1)!.covered).toBeGreaterThan(25);
  });
});

// ── [VPB] phiên bản nội dung (B1) ─────────────────────────────────────────────

describe("[VPB] phiên bản nội dung — vé mang `rev`, lượt đóng băng, hàng mới mang phiên bản hiện tại", () => {
  const veRev = (rev?: number) =>
    kyVeMedia({ lessonId: LESSON, userId: USER, ...(rev !== undefined ? { rev } : {}) }, undefined, VE_MAC_DINH);

  it("vé phiên bản 1, bài đang ở 1 ⇒ nhận nhịp", async () => {
    const r = await nhip({ ve: veRev(1) });
    expect(r.ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("vé KIỂU CŨ (không `rev`) coi là 1 ⇒ nhận khi bài ở 1, TỪ CHỐI khi bài đã ở 2", async () => {
    expect((await nhip({ ve: veRev() })).ok).toBe(true);
    h.revBai = 2;
    h.upsert.mockClear();
    const r = await nhip({ ve: veRev() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOI_DUNG_DA_DOI");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("🔴 bài đã đổi sang phiên bản 2 (đọc LẠI trong khoá) mà vé mang 1 ⇒ NOI_DUNG_DA_DOI, không ghi tiến độ/ngân sách/phiên", async () => {
    // `h.lesson.mediaRevision` (đọc NGOÀI giao dịch, bước 5) còn cũ = 1: chỉ lần đọc trong khoá mới thấy 2.
    h.revBai = 2;
    const r = await nhip({ ve: veRev(1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOI_DUNG_DA_DOI");
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.budgetUpsert).not.toHaveBeenCalled();
    expect(h.sessCreate).not.toHaveBeenCalled();
  });

  it("NOI_DUNG_DA_DOI là 409 (trình phát dừng và báo tải lại), không phải 403 (dừng hẳn)", async () => {
    const { HTTP_CUA_LOI, THONG_BAO_LOI } = await import("@/lib/elearning/video-heartbeat-contract");
    expect(HTTP_CUA_LOI.NOI_DUNG_DA_DOI).toBe(409);
    expect(THONG_BAO_LOI.NOI_DUNG_DA_DOI).toMatch(/tải lại/);
  });

  it("🔴 lượt có tiến độ ở phiên bản CŨ ⇒ KHONG_GHI: không upsert, không ngân sách, không phiên; trả số đã có", async () => {
    h.revBai = 2;
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, mediaRevision: 2, cues: [] };
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 600,
      contentSec: 600,
      maxPositionSec: 600,
      seq: 9,
      verifiedAt: NOW,
      attnAskedCount: 0,
      attnPendingAt: null,
      cueLogJson: null,
      mediaRevision: 1,
    };
    const r = await nhip({ ve: veRev(2), seq: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("KHONG_GHI");
    expect(r.data.coveredSec).toBe(600);
    expect(r.data.coveragePercent).toBe(100);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.budgetUpsert).not.toHaveBeenCalled();
    expect(h.sessCreate).not.toHaveBeenCalled();
    expect(h.sessUpdate).not.toHaveBeenCalled();
  });

  it("đối chứng: tiến độ cùng phiên bản với bài ⇒ ghi bình thường (đóng băng không chặn nhầm)", async () => {
    h.revBai = 2;
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, mediaRevision: 2, cues: [] };
    h.progress = {
      segmentBitmap: null,
      segmentSec: 5,
      coveredSec: 0,
      contentSec: 600,
      maxPositionSec: 0,
      seq: 0,
      verifiedAt: null,
      attnAskedCount: 0,
      attnPendingAt: null,
      cueLogJson: null,
      mediaRevision: 2,
    };
    const r = await nhip({ ve: veRev(2), seq: 1 });
    expect(r.ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("hàng tiến độ MỚI mang phiên bản HIỆN TẠI của bài (không phải mặc định cột)", async () => {
    h.revBai = 3;
    h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, mediaRevision: 3, cues: [] };
    await nhip({ ve: veRev(3) });
    const arg = h.upsert.mock.calls[0]![0] as unknown as { create: { mediaRevision: number } };
    expect(arg.create.mediaRevision).toBe(3);
  });
});
