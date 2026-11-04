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
  upsert: vi.fn(async (_a: { update: Record<string, unknown> }) => ({})),
  updateMany: vi.fn(async (_a: { data: Record<string, unknown> }) => ({ count: 1 })),
  sessCreate: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
  sessUpdate: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
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
vi.mock("@/lib/db", () => ({
  db: {
    trnEnrollment: { findFirst: vi.fn(async () => h.enrollment) },
    trnLesson: { findFirst: vi.fn(async () => h.lesson) },
    trnCourse: { findUnique: vi.fn(async () => h.course) },
    trnLessonProgress: {
      findUnique: vi.fn(async () => h.progress),
      upsert: h.upsert,
      updateMany: h.updateMany,
    },
    trnVideoSession: {
      findFirst: vi.fn(async () => h.phien),
      create: h.sessCreate,
      update: h.sessUpdate,
    },
  },
}));

import { ghiNhipXem } from "@/lib/elearning/video-heartbeat";
import { kyVeMedia } from "@/lib/elearning/media-ticket";
import { idThachThuc, HAN_TRA_LOI_GIAY } from "@/lib/elearning/attention-check";
import { TOC_DO_TOI_DA } from "@/lib/elearning/video-heartbeat-contract";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const USER = "u1";
const LESSON = "les1";
const actor = { userId: USER } as never;

const nhip = (o: Record<string, unknown> = {}) =>
  ghiNhipXem({
    actor,
    ve: kyVeMedia({ lessonId: LESSON, userId: USER }, undefined, NOW.getTime()),
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
  h.lesson = { id: LESSON, kind: "VIDEO", durationSec: 600, cues: [] };
  h.course = {
    id: "c1",
    visibility: "INTERNAL",
    selfEnrollEnabled: false,
    securityLevel: "NORMAL",
    versions: [{ id: "v1" }],
  };
  h.progress = null;
  h.phien = null;
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
    h.phien = { id: "s1", maxPositionSec: 5 };
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
