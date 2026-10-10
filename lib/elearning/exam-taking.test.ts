// @vitest-environment node
/**
 * EL-14d — làm bài thi.
 *
 * Bộ test đi theo hai câu, và câu THỨ NHẤT nặng hơn:
 *  1. Có chặn nhầm / chấm oan người học thật không? — mỗi con số ở đây đi thẳng
 *     vào hồ sơ nhân sự, và người bị chấm oan không có đường kháng nghị nào.
 *  2. Có cho qua người không đủ điều kiện không?
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import {
  cauHinhBatDauThi,
  cauHinhLuuCauTraLoi,
  cauHinhNopBai,
} from "@/lib/elearning/exam-taking";
import { cauHinhMoKhoaThi, moKhoaThiSchema } from "@/lib/elearning/exam-unlock";

const h = vi.hoisted(() => ({
  policy: vi.fn(async () => undefined),
  gate: vi.fn(() => null as { code: string; message: string } | null),
  rollup: vi.fn(async () => undefined),
}));
vi.mock("@/lib/elearning/policy-acceptance", () => ({
  assertPolicyAccepted: h.policy,
  PolicyNotAcceptedError: class extends Error {},
}));
vi.mock("@/lib/elearning/content-gate", () => ({ checkContentAccess: h.gate }));
vi.mock("@/lib/elearning/rollup", () => ({ cuonKhoaSauKhiXongBai: h.rollup }));

const NOW = new Date("2026-08-25T10:00:00.000Z");
const CAU_SINGLE = {
  id: "q1",
  type: "single" as const,
  question: "Bước nào trước?",
  options: ["A", "B"],
  correctIndex: 1,
};

type Ban = {
  enrollment: unknown;
  lesson: unknown;
  course: unknown;
  de: unknown;
  daThi: { attemptNo: number; status: string; submittedAt: Date | null }[];
  soMoKhoa: number;
  luot: unknown;
  eq: unknown;
  dsEq: unknown[];
  dsTraLoi: unknown[];
  baiTheoDe: unknown;
  tienDo: unknown;
  soLuotDaThi: number;
  timBai: ReturnType<typeof vi.fn<(a: unknown) => void>>;
  createLuot: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string; attemptNo: number }>>>;
  updateLuot: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  upsertTraLoi: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  upsertTienDo: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  createMoKhoa: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string }>>>;
};
let b: Ban;

const dbGia = () => {
  const api = {
    trnEnrollment: { findFirst: vi.fn(async () => b.enrollment) },
    trnLesson: {
      findFirst: vi.fn(async (a: unknown) => {
        b.timBai(a);
        return b.baiTheoDe ?? b.lesson;
      }),
    },
    trnCourse: { findUnique: vi.fn(async () => b.course) },
    trnExam: { findFirst: vi.fn(async () => b.de) },
    trnExamAttempt: {
      findMany: vi.fn(async () => b.daThi),
      findFirst: vi.fn(async () => b.luot),
      count: vi.fn(async () => b.soLuotDaThi),
      create: b.createLuot,
      update: b.updateLuot,
    },
    trnExamUnlock: { count: vi.fn(async () => b.soMoKhoa), create: b.createMoKhoa },
    trnExamQuestion: {
      findFirst: vi.fn(async () => b.eq),
      findMany: vi.fn(async () => b.dsEq),
    },
    trnExamAnswer: {
      findMany: vi.fn(async () => b.dsTraLoi),
      upsert: b.upsertTraLoi,
    },
    trnLessonProgress: {
      findUnique: vi.fn(async () => b.tienDo),
      upsert: b.upsertTienDo,
    },
  };
  return {
    ...api,
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(api),
  } as never;
};

const actor = { userId: "u1" } as never;

async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

afterEach(() => {
  vi.useRealTimers();
});

const batDau = (input: Record<string, unknown> = {}) =>
  cauHinhBatDauThi.handler({
    db: dbGia(),
    actor,
    input: { enrollmentId: "en1", lessonId: "les1", ...input },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠️ ĐÓNG BĂNG đồng hồ. Các action ở đây gọi `new Date()` thật (đúng — chúng là
  // đường ghi máy chủ, và đồng hồ trình duyệt sửa được). Nên test phải đóng băng
  // giờ, chứ không phải nới điều kiện cho khớp giờ chạy — nới là biến case "hết
  // giờ" thành case xanh/đỏ tuỳ lúc chạy CI.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.gate.mockReturnValue(null);
  b = {
    enrollment: {
      id: "en1",
      courseId: "c1",
      status: "IN_PROGRESS",
      centerId: "cs1",
      orgUnitId: "ou1",
      dueAt: null,
      assignmentId: "a1",
      assignment: { allowLate: false },
    },
    lesson: { id: "les1", kind: "QUIZ", examId: "de1" },
    course: {
      id: "c1",
      visibility: "INTERNAL",
      selfEnrollEnabled: false,
      securityLevel: "NORMAL",
      versions: [{ id: "v1" }],
    },
    de: {
      id: "de1",
      isActive: true,
      maxAttempts: 3,
      cooldownHours: 24,
      durationMin: 30,
      passScore: 2,
      maxScore: 4,
      _count: { questions: 2 },
    },
    daThi: [],
    soMoKhoa: 0,
    luot: {
      id: "lt1",
      examId: "de1",
      enrollmentId: "en1",
      status: "IN_PROGRESS",
      startedAt: NOW,
      attemptNo: 1,
      exam: { id: "de1", durationMin: 30, passScore: 2, maxScore: 4 },
    },
    eq: { id: "eq1" },
    dsEq: [],
    dsTraLoi: [],
    baiTheoDe: null,
    tienDo: null,
    soLuotDaThi: 3,
    timBai: vi.fn<(a: unknown) => void>(),
    createLuot: vi.fn(async (_a: unknown) => ({ id: "lt-moi", attemptNo: 1 })),
    updateLuot: vi.fn(async (_a: unknown) => ({})),
    upsertTraLoi: vi.fn(async (_a: unknown) => ({})),
    upsertTienDo: vi.fn(async (_a: unknown) => ({})),
    createMoKhoa: vi.fn(async (_a: unknown) => ({ id: "mk1" })),
  };
});

// ── 1. KHÔNG chặn nhầm người học thật ──────────────────────────────────────

describe("🔴 không chặn nhầm người học thật", () => {
  it("lượt ĐẦU TIÊN tuyệt đối ⇒ vào được", async () => {
    // Trạng thái khởi đầu (0 lượt, 0 mở khoá) là chỗ điều kiện biên hay sai nhất.
    const r = (await batDau()) as { data: { attemptNo: number } };
    expect(b.createLuot).toHaveBeenCalledTimes(1);
    expect(r.data.attemptNo).toBe(1);
  });

  it("lượt CUỐI còn lại ⇒ vẫn vào được", async () => {
    b.daThi = [
      { attemptNo: 1, status: "GRADED", submittedAt: new Date(NOW.getTime() - 90 * 3600_000) },
      { attemptNo: 2, status: "GRADED", submittedAt: new Date(NOW.getTime() - 48 * 3600_000) },
    ];
    await batDau();
    expect(b.createLuot).toHaveBeenCalledTimes(1);
  });

  it("🔴 TẢI LẠI TRANG không đốt một lượt", async () => {
    // Tạo lượt mới khi đang có lượt mở dở là lấy mất một lượt của người học chỉ vì
    // họ bấm F5 — và họ không có cách nào đòi lại.
    b.daThi = [{ attemptNo: 1, status: "IN_PROGRESS", submittedAt: null }];
    const r = (await batDau()) as { data: { attemptId: string } };
    expect(b.createLuot).not.toHaveBeenCalled();
    expect(r.data.attemptId).toBe("lt1");
  });

  it("đã ĐƯỢC MỞ KHOÁ ⇒ thêm đúng một lượt", async () => {
    b.daThi = [1, 2, 3].map((n) => ({
      attemptNo: n,
      status: "GRADED",
      submittedAt: new Date(NOW.getTime() - 90 * 3600_000),
    }));
    b.soMoKhoa = 1;
    await batDau();
    expect(b.createLuot).toHaveBeenCalledTimes(1);
  });

  it("đã gia hạn (dueAt lùi) ⇒ vào được", async () => {
    b.enrollment = {
      ...(b.enrollment as object),
      dueAt: new Date(NOW.getTime() + 86_400_000),
    };
    await batDau();
    expect(b.createLuot).toHaveBeenCalledTimes(1);
  });

  it("`allowLate` bật ⇒ quá hạn vẫn thi được", async () => {
    b.enrollment = {
      ...(b.enrollment as object),
      dueAt: new Date(NOW.getTime() - 86_400_000),
      assignment: { allowLate: true },
    };
    await batDau();
    expect(b.createLuot).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Chặn đúng thứ phải chặn ─────────────────────────────────────────────

describe("chặn đúng thứ phải chặn", () => {
  it("hết lượt ⇒ nói RÕ số lượt, không nói suông", async () => {
    b.daThi = [1, 2, 3].map((n) => ({
      attemptNo: n,
      status: "GRADED",
      submittedAt: new Date(NOW.getTime() - 90 * 3600_000),
    }));
    const e = await batLoi(batDau());
    expect(e.code).toBe("HET_LUOT_THI");
    expect(e.message).toContain("3");
    expect(b.createLuot).not.toHaveBeenCalled();
  });

  it("🔴 thời gian chờ đếm từ lúc NỘP, không từ lúc bắt đầu", async () => {
    // Đếm từ `startedAt` cho phép mở một lượt rồi bỏ đó để "đốt" thời gian chờ —
    // 24 giờ biến thành 0.
    b.daThi = [
      { attemptNo: 1, status: "GRADED", submittedAt: new Date(NOW.getTime() - 3600_000) },
    ];
    const e = await batLoi(batDau());
    expect(e.code).toBe("CHUA_HET_THOI_GIAN_CHO");
    expect(e.message).toContain("phút");
  });

  it("quá hạn ⇒ chặn BẮT ĐẦU", async () => {
    b.enrollment = {
      ...(b.enrollment as object),
      dueAt: new Date(NOW.getTime() - 86_400_000),
    };
    const e = await batLoi(batDau());
    expect(e.code).toBe("OVERDUE_LOCKED");
  });

  it("đề CHƯA kích hoạt ⇒ chặn", async () => {
    // Đề nháp chưa đóng băng bộ câu — cho thi là chấm trên một thang có thể đổi
    // sau lưng người học.
    b.de = { ...(b.de as object), isActive: false };
    const e = await batLoi(batDau());
    expect(e.code).toBe("DE_CHUA_KICH_HOAT");
  });

  it("bài chưa gắn đề ⇒ nói rõ phải báo ai", async () => {
    b.lesson = { id: "les1", kind: "QUIZ", examId: null };
    const e = await batLoi(batDau());
    expect(e.code).toBe("BAI_CHUA_CO_DE");
    expect(e.message).toContain("Đào tạo");
  });

  it("bài KHÔNG phải QUIZ ⇒ từ chối", async () => {
    b.lesson = { id: "les1", kind: "VIDEO", examId: null };
    const e = await batLoi(batDau());
    expect(e.code).toBe("WRONG_KIND");
  });

  it("lượt học không thuộc mình ⇒ NOT_FOUND", async () => {
    b.enrollment = null;
    const e = await batLoi(batDau());
    expect(e.code).toBe("NOT_FOUND");
  });

  it("bài KHÔNG thuộc khoá đã ghi danh ⇒ cùng lỗi NOT_FOUND", async () => {
    // Vế thứ hai của chống IDOR: có lượt ghi danh hợp lệ KHÔNG cho thi đề của
    // khoá khác.
    b.lesson = null;
    const e = await batLoi(batDau());
    expect(e.code).toBe("NOT_FOUND");
  });

  it("🔴 HAI TAB cùng bấm bắt đầu ⇒ tab thứ hai nhận lỗi ĐỌC ĐƯỢC", async () => {
    // `@@unique([examId, userId, attemptNo])` chặn hai lượt. Không bắt lỗi đó thì
    // tab thứ hai nhận màn hình 500 và người học tưởng hệ thống hỏng.
    b.createLuot = vi.fn(async () => {
      const e = new Error("Unique constraint failed") as Error & { code?: string };
      e.code = "P2002";
      throw e;
    });
    const e = await batLoi(batDau());
    expect(e.code).toBe("DANG_MO_LUOT_KHAC");
  });

  it("lượt thi mang ĐƠN VỊ của lượt ghi danh", async () => {
    await batDau();
    const arg = b.createLuot.mock.calls[0]![0] as {
      data: { centerId: string; orgUnitId: string; purgeAfter: Date };
    };
    expect(arg.data.centerId).toBe("cs1");
    expect(arg.data.orgUnitId).toBe("ou1");
    // `purgeAfter` NOT NULL, ghi cứng lúc INSERT.
    expect(arg.data.purgeAfter.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

// ── 3. Lưu dần từng câu ────────────────────────────────────────────────────

describe("lưu dần từng câu", () => {
  const luu = (input: Record<string, unknown> = {}) =>
    cauHinhLuuCauTraLoi.handler({
      db: dbGia(),
      actor,
      input: { attemptId: "lt1", examQuestionId: "eq1", chon: [1], ...input },
    } as never);

  it("lưu được câu đang làm", async () => {
    // Đây là lý do lưu dần: mất mạng mười giây không được biến thành mất cả bài.
    await luu();
    expect(b.upsertTraLoi).toHaveBeenCalledTimes(1);
  });

  it("lượt ĐÃ NỘP ⇒ không lưu thêm", async () => {
    b.luot = { ...(b.luot as object), status: "GRADED" };
    const e = await batLoi(luu());
    expect(e.code).toBe("LUOT_DA_DONG");
  });

  it("lượt của NGƯỜI KHÁC ⇒ NOT_FOUND", async () => {
    // Không khoá theo `userId` thì ai đoán được một id lượt đều ghi câu trả lời
    // vào bài của người khác.
    b.luot = null;
    const e = await batLoi(luu());
    expect(e.code).toBe("NOT_FOUND");
  });

  it("câu KHÔNG thuộc đề của lượt ⇒ từ chối", async () => {
    b.eq = null;
    const e = await batLoi(luu());
    expect(e.code).toBe("NOT_FOUND");
    expect(b.upsertTraLoi).not.toHaveBeenCalled();
  });

  it("🔴 HẾT GIỜ ⇒ không nhận câu MỚI, phần đã lưu vẫn còn", async () => {
    b.luot = {
      ...(b.luot as object),
      startedAt: new Date(NOW.getTime() - 3600_000),
    };
    const e = await batLoi(luu());
    expect(e.code).toBe("HET_GIO");
    expect(e.message).toContain("nộp bài");
  });
});

// ── 4. Nộp bài và chấm ─────────────────────────────────────────────────────

describe("nộp bài", () => {
  const dungDe = (loai: string[], diem = 2) => {
    b.dsEq = loai.map((t, i) => ({
      id: `eq${i + 1}`,
      points: diem,
      question: { type: t, contentJson: CAU_SINGLE },
    }));
  };
  const nop = () =>
    cauHinhNopBai.handler({
      db: dbGia(),
      actor,
      input: { attemptId: "lt1" },
    } as never);

  it("đề toàn câu chấm máy, trả lời đúng ⇒ GRADED và ĐẠT", async () => {
    dungDe(["SINGLE", "SINGLE"]);
    b.dsTraLoi = [
      { id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["1"] },
      { id: "a2", examQuestionId: "eq2", selectedChoiceIds: ["1"] },
    ];
    const r = (await nop()) as { data: { status: string; totalScore: number; passed: boolean } };
    expect(r.data.status).toBe("GRADED");
    expect(r.data.totalScore).toBe(4);
    expect(r.data.passed).toBe(true);
  });

  it("trả lời sai ⇒ 0 điểm câu đó, và TRƯỢT nếu dưới ngưỡng", async () => {
    dungDe(["SINGLE", "SINGLE"]);
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["0"] }];
    const r = (await nop()) as { data: { totalScore: number; passed: boolean } };
    expect(r.data.totalScore).toBe(0);
    expect(r.data.passed).toBe(false);
  });

  it("🔴 đề có câu CHẤM TAY ⇒ PENDING_GRADE, điểm và kết quả đều `null`", async () => {
    // Đóng thẳng sang GRADED là chốt điểm 0 và tính trượt cho người chưa ai đọc
    // bài — và lượt đó không nằm trong hàng chờ chấm của ai.
    dungDe(["SINGLE", "ESSAY"]);
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["1"] }];
    const r = (await nop()) as {
      data: { status: string; totalScore: null; passed: null; choChamTay: boolean };
    };
    expect(r.data.status).toBe("PENDING_GRADE");
    expect(r.data.totalScore).toBeNull();
    expect(r.data.passed).toBeNull();
    expect(r.data.choChamTay).toBe(true);
  });

  it("🔴 đề có câu chấm tay ⇒ KHÔNG ghi bài học là xong", async () => {
    dungDe(["SINGLE", "ESSAY"]);
    b.baiTheoDe = { id: "les1" };
    await nop();
    expect(b.upsertTienDo).not.toHaveBeenCalled();
    expect(h.rollup).not.toHaveBeenCalled();
  });

  it("ĐẠT ⇒ ghi bài học DONE và cuộn tiến độ khoá", async () => {
    dungDe(["SINGLE"], 4);
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["1"] }];
    b.baiTheoDe = { id: "les1" };
    await nop();
    expect(b.upsertTienDo).toHaveBeenCalledTimes(1);
    expect(h.rollup).toHaveBeenCalledTimes(1);
  });

  it("🔴 TRƯỢT ⇒ KHÔNG ghi bài là xong, và không có trạng thái 'trượt'", async () => {
    // Enum `TrnLessonProgressStatus` cố ý không có `FAILED`; bịa một trạng thái
    // thứ hai cho "chưa xong" là đẻ nguồn sự thật thứ hai cạnh `progressPercent`.
    dungDe(["SINGLE"], 4);
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["0"] }];
    b.baiTheoDe = { id: "les1" };
    await nop();
    expect(b.upsertTienDo).not.toHaveBeenCalled();
  });

  it("thi lại sau khi ĐÃ đạt ⇒ không cuộn lần hai", async () => {
    // Cuộn mỗi lần thi lại là ba câu đếm cho một việc đã xong.
    dungDe(["SINGLE"], 4);
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["1"] }];
    b.baiTheoDe = { id: "les1" };
    b.tienDo = { verifiedAt: new Date(NOW.getTime() - 86_400_000) };
    await nop();
    expect(h.rollup).not.toHaveBeenCalled();
  });

  it("🔴 câu BỎ TRỐNG được chấm 0, không làm hỏng cả lượt", async () => {
    dungDe(["SINGLE", "SINGLE"]);
    b.dsTraLoi = [];
    const r = (await nop()) as { data: { totalScore: number; status: string } };
    expect(r.data.status).toBe("GRADED");
    expect(r.data.totalScore).toBe(0);
  });

  it("nội dung câu HỎNG ⇒ chuyển người chấm, không cho 0 điểm", async () => {
    // Một bản ghi bẩn do người soạn để lại không được biến thành điểm 0 của người
    // học — họ không làm gì sai.
    b.dsEq = [{ id: "eq1", points: 2, question: { type: "SINGLE", contentJson: { rac: 1 } } }];
    const r = (await nop()) as { data: { status: string } };
    expect(r.data.status).toBe("PENDING_GRADE");
  });
});

// ── 5. Mở khoá thi lại ─────────────────────────────────────────────────────

describe("mở khoá thêm lượt thi", () => {
  const mo = (input: Record<string, unknown> = {}) =>
    cauHinhMoKhoaThi.handler({
      db: dbGia(),
      actor,
      input: {
        examId: "de1",
        userId: "u9",
        reason: "Mất điện giữa buổi thi, có xác nhận của quản lý",
        ...input,
      },
    } as never);

  it("hết lượt rồi ⇒ mở được, ghi lại số lượt tại thời điểm mở", async () => {
    await mo();
    const arg = b.createMoKhoa.mock.calls[0]![0] as {
      data: { previousAttemptCount: number; unlockedByUserId: string };
    };
    expect(arg.data.previousAttemptCount).toBe(3);
    // Ghi AI bấm, không ghi người được mở.
    expect(arg.data.unlockedByUserId).toBe("u1");
  });

  it("🔴 LÝ DO bắt buộc, và phải đủ dài", async () => {
    // Mở khoá không lý do thì lần sau không ai biết vì sao ngoại lệ đó từng được
    // cho, và nó thành tiền lệ không ai kiểm được.
    for (const r of ["", "ok", "   "]) {
      expect(moKhoaThiSchema.safeParse({ examId: "d", userId: "u", reason: r }).success, r).toBe(
        false,
      );
    }
  });

  it("người CHƯA hết lượt ⇒ từ chối, nói rõ tỉ số", async () => {
    // Mở khoá cho người vẫn thi được là để lại một dòng nhiễu trong hồ sơ của họ.
    b.soLuotDaThi = 1;
    const e = await batLoi(mo());
    expect(e.code).toBe("CHUA_HET_LUOT");
    expect(e.message).toContain("1/3");
    expect(b.createMoKhoa).not.toHaveBeenCalled();
  });

  it("đề ngoài phạm vi ⇒ NOT_FOUND", async () => {
    b.de = null;
    const e = await batLoi(mo());
    expect(e.code).toBe("NOT_FOUND");
  });

  it("audit KHÔNG mang lý do", async () => {
    // Lý do mở khoá thường nhắc tình huống cá nhân của người học; nhật ký audit
    // đọc được rộng hơn bảng này.
    const r = (await mo()) as { newValues: Record<string, unknown> };
    expect(JSON.stringify(r.newValues)).not.toContain("Mất điện");
  });

  it("dùng khoá quyền RIÊNG cho mở khoá", () => {
    expect(cauHinhMoKhoaThi.permission).toBe("elearning:exam:unlock");
  });
});

// ── 6. Quyền ───────────────────────────────────────────────────────────────

describe("khoá quyền của người học", () => {
  it("ba action làm bài dùng quyền HỌC", () => {
    for (const c of [cauHinhBatDauThi, cauHinhLuuCauTraLoi, cauHinhNopBai]) {
      expect(c.permission, c.name).toBe("elearning:lesson:learn");
    }
  });
});

// ── 8. Ba lỗi do vòng rà đối kháng tìm ra ──────────────────────────────────

describe("🔴 lượt ghi danh bị THU HỒI giữa lúc đang thi", () => {
  const nop = () =>
    cauHinhNopBai.handler({
      db: dbGia(),
      actor,
      input: { attemptId: "lt1" },
    } as never);

  it("thu hồi rồi ⇒ KHÔNG nộp được, không ghi gì", async () => {
    // Chuỗi cổng đầy đủ chỉ chạy ở `batDauThi`, nhưng một lượt thi sống tới 30
    // phút — và trong khoảng đó lượt ghi danh có thể bị thu hồi. Không kiểm lại
    // thì người đã bị thu hồi vẫn được chấm và vẫn được ghi "đã hoàn thành" vào
    // một khoá họ không còn thuộc về.
    b.enrollment = { ...(b.enrollment as object), status: "REVOKED" };
    const e = await batLoi(nop());
    expect(e.code).toBe("REVOKED");
    expect(b.updateLuot).not.toHaveBeenCalled();
  });

  it("lưu câu trả lời cũng bị chặn", async () => {
    b.enrollment = { ...(b.enrollment as object), status: "REVOKED" };
    const e = await batLoi(
      cauHinhLuuCauTraLoi.handler({
        db: dbGia(),
        actor,
        input: { attemptId: "lt1", examQuestionId: "eq1", chon: [1] },
      } as never),
    );
    expect(e.code).toBe("REVOKED");
    expect(b.upsertTraLoi).not.toHaveBeenCalled();
  });
});

describe("🔴 ghi 'đã xong' phải RÀNG BUỘC theo khoá của lượt ghi danh", () => {
  it("truy vấn tìm bài mang ràng buộc khoá", async () => {
    // `TrnLesson.examId` KHÔNG unique và một đề gắn được vào nhiều bài, nên
    // `findFirst` trần có thể trả bài của khoá khác — thậm chí cơ sở khác — và ghi
    // "đã hoàn thành" vào đúng bài đó. Người học thấy bài mình vừa thi vẫn chưa
    // xong, còn một người lạ ở khoá khác bỗng có một bài xong.
    b.dsEq = [
      { id: "eq1", points: 4, question: { type: "SINGLE", contentJson: CAU_SINGLE } },
    ];
    b.dsTraLoi = [{ id: "a1", examQuestionId: "eq1", selectedChoiceIds: ["1"] }];
    b.baiTheoDe = { id: "les1" };
    await cauHinhNopBai.handler({
      db: dbGia(),
      actor,
      input: { attemptId: "lt1" },
    } as never);
    const arg = b.timBai.mock.calls.at(-1)![0] as {
      where: { module?: { courseId?: string } };
    };
    expect(arg.where.module?.courseId).toBe("c1");
  });
});

