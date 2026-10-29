// @vitest-environment node
/**
 * EL-15c — nộp bài tập.
 *
 * Hỏng ở đây rơi vào một người đang chờ hạn chót cứng: nộp không được thì họ trễ,
 * nộp được vào hồ sơ người khác thì hai người cùng sai.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import { cauHinhNopBaiTap, nopBaiTapSchema } from "@/lib/elearning/task-submit";
import { SLA_GRADE_DAYS } from "@/lib/elearning/metrics/constants";

const h = vi.hoisted(() => ({
  orgUnitId: vi.fn<(c: string | null) => Promise<string | null>>(async () => "ou1"),
  chinhSach: vi.fn<(u: string) => Promise<void>>(async () => undefined),
  congNoiDung: vi.fn<() => { message: string } | null>(() => null),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgUnitId }));
// Hai cổng bắt buộc của mọi đường ghi tiến độ (luật cứng #7). Mock để tệp này soi
// được phần LOGIC NỘP; phép kiểm rằng chúng ĐƯỢC GỌI nằm ở nhóm riêng bên dưới.
vi.mock("@/lib/elearning/policy-acceptance", () => ({
  assertPolicyAccepted: h.chinhSach,
}));
vi.mock("@/lib/elearning/content-gate", () => ({
  checkContentAccess: h.congNoiDung,
}));

// 2026-08-26 là thứ Tư (UTC).
const NOW = new Date("2026-08-26T09:00:00.000Z");

type Ban = {
  ghiDanh: unknown;
  bai: unknown;
  truoc: unknown;
  create: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string }>>>;
  updateGd: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  upsertTd: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
};
let b: Ban;

const dbGia = () =>
  ({
    trnEnrollment: {
      findFirst: vi.fn(async () => b.ghiDanh),
      updateMany: b.updateGd,
    },
    trnLesson: { findFirst: vi.fn(async () => b.bai) },
    trnCourse: {
      findFirst: vi.fn(async () => ({
        id: "c1",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        securityLevel: "NORMAL",
        versions: [{ id: "v1" }],
      })),
    },
    trnSubmission: {
      findFirst: vi.fn(async () => b.truoc),
      create: b.create,
    },
    trnLessonProgress: { upsert: b.upsertTd },
  }) as never;

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

const nop = (input: Record<string, unknown> = {}) =>
  cauHinhNopBaiTap.handler({
    db: dbGia(),
    actor,
    input: {
      enrollmentId: "en1",
      lessonId: "b1",
      contentText: "Bài làm của tôi",
      ...input,
    },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.orgUnitId.mockResolvedValue("ou1");
  h.chinhSach.mockResolvedValue(undefined);
  h.congNoiDung.mockReturnValue(null);
  b = {
    ghiDanh: {
      id: "en1",
      userId: "u1",
      courseId: "c1",
      status: "IN_PROGRESS",
      dueAt: new Date("2026-09-30T00:00:00.000Z"),
      centerId: "cs1",
      assignmentId: "a1",
      assignment: { allowLate: false },
    },
    bai: { id: "b1", kind: "TASK", rubricId: "k1" },
    truoc: null,
    create: vi.fn(async (_a: unknown) => ({ id: "s1" })),
    updateGd: vi.fn(async (_a: unknown) => ({ count: 1 })),
    upsertTd: vi.fn(async (_a: unknown) => ({})),
  };
});

describe("nộp lần đầu", () => {
  it("ghi lượt SUBMITTED, số thứ tự 1", async () => {
    const r = (await nop()) as { data: { attemptNo: number } };
    expect(r.data.attemptNo).toBe(1);
    const arg = b.create.mock.calls[0]![0] as {
      data: { status: string; attemptNo: number; rubricId: string };
    };
    expect(arg.data.status).toBe("SUBMITTED");
    expect(arg.data.attemptNo).toBe(1);
  });

  it("🔴 ĐÓNG BĂNG khung của bài vào lượt nộp", async () => {
    // Suy khung qua `TrnLesson.rubricId` lúc chấm là chấm bài cũ bằng thước mới nếu
    // Đào tạo đổi khung giữa chừng.
    await nop();
    const arg = b.create.mock.calls[0]![0] as { data: { rubricId: string } };
    expect(arg.data.rubricId).toBe("k1");
  });

  it("🔴 ghi `dueGradeAt` = nay + 3 NGÀY LÀM VIỆC", async () => {
    // Không có mốc này thì "nộp bài → có điểm trong 3 ngày làm việc" là thiện chí,
    // không phải cam kết đo được.
    const r = (await nop()) as { data: { dueGradeAt: Date } };
    expect(SLA_GRADE_DAYS).toBe(3);
    // T4 26/8 + 3 ngày làm = T5 27 · T6 28 · T2 31 ⇒ 31/8.
    expect(r.data.dueGradeAt.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("🔴 đánh dấu ĐÃ BẮT ĐẦU — chỉ một lần", async () => {
    // Không ghi thì người vừa nộp nằm trong nhóm CHƯA HỌC của báo cáo gửi quản lý
    // trực tiếp, trong lúc họ đang chờ NGƯỜI KHÁC.
    await nop();
    const arg = b.updateGd.mock.calls[0]![0] as {
      where: { startedAt: null };
      data: { startedAt: Date };
    };
    expect(arg.where.startedAt).toBeNull();
    expect(arg.data.startedAt).toEqual(NOW);
  });

  it("tiến độ bài lên ĐANG HỌC, chưa phải xong", async () => {
    // Xong là việc của đường CHẤM: ngưỡng khung là 80/100 và có nộp lại, nên
    // "nộp = xong" làm tỉ lệ hoàn thành nói dối.
    await nop();
    const arg = b.upsertTd.mock.calls[0]![0] as { create: { status: string } };
    expect(arg.create.status).toBe("IN_PROGRESS");
  });

  it("gọi `orgUnitIdForCenter` TƯỜNG MINH", async () => {
    await nop();
    expect(h.orgUnitId).toHaveBeenCalledWith("cs1");
  });
});

describe("🔴 chỉ CHÍNH CHỦ nộp được", () => {
  it("lượt học của người khác ⇒ từ chối", async () => {
    // `elearning:lesson:learn` là quyền "được học", KHÔNG phải "học thay người
    // khác" — thiếu bước này thì ai có quyền học cũng nộp vào hồ sơ người khác.
    b.ghiDanh = { ...(b.ghiDanh as object), userId: "u-khac" };
    const e = await batLoi(nop());
    expect(e.code).toBe("FORBIDDEN");
    expect(b.create).not.toHaveBeenCalled();
  });

  it("lượt học đã THU HỒI ⇒ từ chối", async () => {
    b.ghiDanh = { ...(b.ghiDanh as object), status: "REVOKED" };
    const e = await batLoi(nop());
    expect(e.code).toBe("REVOKED");
  });

  it("lượt học ngoài phạm vi cơ sở ⇒ NOT_FOUND", async () => {
    b.ghiDanh = null;
    expect((await batLoi(nop())).code).toBe("NOT_FOUND");
  });
});

describe("🔴 QUÁ HẠN thì khoá — cùng cổng với mọi đường ghi tiến độ", () => {
  it("hết hạn và không cho nộp trễ ⇒ chặn", async () => {
    // Miễn cho đường nộp là để một đường vòng qua hạn chót.
    b.ghiDanh = {
      ...(b.ghiDanh as object),
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const e = await batLoi(nop());
    expect(e.code).toBe("OVERDUE_LOCKED");
    expect(b.create).not.toHaveBeenCalled();
  });

  it("có cờ cho nộp trễ ⇒ vẫn nộp được", async () => {
    b.ghiDanh = {
      ...(b.ghiDanh as object),
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
      assignment: { allowLate: true },
    };
    await nop();
    expect(b.create).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG có lượt giao ⇒ fail-closed, không cho nộp trễ", async () => {
    b.ghiDanh = {
      ...(b.ghiDanh as object),
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
      assignmentId: null,
      assignment: null,
    };
    expect((await batLoi(nop())).code).toBe("OVERDUE_LOCKED");
  });
});

describe("🔴 nộp LẠI", () => {
  it("đang CHỜ CHẤM ⇒ từ chối", async () => {
    // Cho nộp là đẻ hai lượt cùng chờ, người chấm không biết đọc bản nào, và sổ bù
    // SLA của lượt trước mất mốc.
    b.truoc = { id: "s0", attemptNo: 1, status: "SUBMITTED", passed: null };
    const e = await batLoi(nop());
    expect(e.code).toBe("DANG_CHO_CHAM");
    expect(b.create).not.toHaveBeenCalled();
  });

  it("đã chấm và ĐẠT ⇒ từ chối, không cần nộp lại", async () => {
    b.truoc = { id: "s0", attemptNo: 1, status: "GRADED", passed: true };
    const e = await batLoi(nop());
    expect(e.code).toBe("DA_DAT_ROI");
  });

  it("🔴 đã chấm nhưng CHƯA ĐẠT ⇒ nộp lại ĐƯỢC", async () => {
    // Với ngưỡng 80/100 thì "chưa đạt" là ca THƯỜNG. Chặn nó là dựng ngõ cụt vĩnh
    // viễn cho đúng nhóm cần nộp lại nhất — và màn học vẫn mời "Nộp lại", tức bày
    // ra một lựa chọn mà máy chủ luôn từ chối.
    b.truoc = { id: "s0", attemptNo: 1, status: "GRADED", passed: false };
    const r = (await nop()) as { data: { attemptNo: number } };
    expect(r.data.attemptNo).toBe(2);
  });

  it("đã chấm mà `passed` còn null ⇒ vẫn nộp lại được, không kẹt", async () => {
    // `null` là "chưa kết luận"; coi nó như đã đạt là khoá người ta lại vì một cột
    // chưa ai điền.
    b.truoc = { id: "s0", attemptNo: 1, status: "GRADED", passed: null };
    const r = (await nop()) as { data: { attemptNo: number } };
    expect(r.data.attemptNo).toBe(2);
  });

  it("bị TRẢ VỀ SỬA ⇒ nộp lại được, số thứ tự TĂNG", async () => {
    // Dòng MỚI, không đè dòng cũ: đè là xoá sạch dấu vết lượt chấm trước.
    b.truoc = { id: "s0", attemptNo: 1, status: "NEEDS_REVISION", passed: false };
    const r = (await nop()) as { data: { attemptNo: number } };
    expect(r.data.attemptNo).toBe(2);
  });
});

describe("bài KHÔNG hợp lệ", () => {
  it("bài không phải TASK ⇒ từ chối", async () => {
    b.bai = { id: "b1", kind: "READ", rubricId: null };
    expect((await batLoi(nop())).code).toBe("WRONG_KIND");
  });

  it("🔴 bài chưa gắn khung ⇒ nói thẳng, đừng để lượt nộp treo", async () => {
    // Cổng xuất bản đã chặn, nhưng khoá cũ xuất bản trước cổng đó vẫn lọt.
    b.bai = { id: "b1", kind: "TASK", rubricId: null };
    expect((await batLoi(nop())).code).toBe("BAI_TAP_CHUA_CO_KHUNG");
  });

  it("bài của khoá KHÁC ⇒ NOT_FOUND", async () => {
    b.bai = null;
    expect((await batLoi(nop())).code).toBe("NOT_FOUND");
  });
});

describe("hai tab cùng bấm Nộp", () => {
  it("🔴 va khoá duy nhất ⇒ báo rõ, không để `P2002` thành lỗi 500 câm", async () => {
    b.create = vi.fn(async () => {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    });
    const e = await batLoi(nop());
    expect(e.code).toBe("DANG_NOP");
  });
});

describe("audit và khoá quyền", () => {
  it("KHÔNG ghi bài làm vào audit", async () => {
    // Bài làm là của một người; nhật ký audit đọc được rộng hơn màn chấm.
    const r = (await nop({ contentText: "Nội dung rất riêng tư" })) as {
      newValues: Record<string, unknown>;
    };
    expect(JSON.stringify(r.newValues)).not.toContain("riêng tư");
  });

  it("dùng khoá `elearning:lesson:learn`, không đẻ khoá mới", () => {
    expect(cauHinhNopBaiTap.permission).toBe("elearning:lesson:learn");
  });

  it("bài làm rỗng bị Zod chặn", () => {
    const r = nopBaiTapSchema.safeParse({
      enrollmentId: "en1",
      lessonId: "b1",
      contentText: "   ",
    });
    expect(r.success).toBe(false);
  });
});

describe("🔴 hai CỔNG bắt buộc của mọi đường ghi tiến độ (luật cứng #7)", () => {
  it("gọi cổng CHÍNH SÁCH trước khi ghi gì", async () => {
    // Điều kiện pháp lý, không phải bước UX — và bài nộp còn mang dữ liệu cá nhân
    // của BÊN THỨ BA (§13.3), nên bỏ cổng ở đúng đường thu thập nhiều dữ liệu nhất
    // là chỗ khó biện minh nhất.
    await nop();
    expect(h.chinhSach).toHaveBeenCalledWith("u1");
  });

  it("chưa chấp nhận chính sách ⇒ KHÔNG ghi gì", async () => {
    h.chinhSach.mockRejectedValueOnce(new Error("chưa chấp nhận"));
    await expect(nop()).rejects.toThrow();
    expect(b.create).not.toHaveBeenCalled();
  });

  it("gọi cổng NỘI DUNG — chuỗi 4 điều kiện ở máy chủ", async () => {
    await nop();
    expect(h.congNoiDung).toHaveBeenCalledTimes(1);
  });

  it("cổng nội dung từ chối ⇒ NOT_FOUND, không lộ khoá tồn tại", async () => {
    h.congNoiDung.mockReturnValueOnce({ message: "Không tìm thấy khoá học" });
    const e = await batLoi(nop());
    expect(e.code).toBe("NOT_FOUND");
    expect(b.create).not.toHaveBeenCalled();
  });
});
