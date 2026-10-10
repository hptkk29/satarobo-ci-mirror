// @vitest-environment node
/**
 * EL-15c — chấm bài tập theo khung.
 *
 * Con số ra từ đây đi vào hồ sơ nhân sự. Hai hướng hỏng đều im lặng: chốt khi chưa
 * chấm đủ tiêu chí, và chấm bằng một khung khác với khung người học đã làm theo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import { cauHinhChamBaiTap, chamBaiTapSchema } from "@/lib/elearning/task-grading";

const h = vi.hoisted(() => ({
  ghiXong: vi.fn<() => Promise<unknown>>(async () => ({ ghi: true })),
}));
vi.mock("@/lib/elearning/lesson-done", () => ({ ghiXongBai: h.ghiXong }));

const MUC = (...d: number[]) => d.map((p, i) => ({ label: `Mức ${i + 1}`, points: p }));

type Ban = {
  luot: unknown;
  khung: unknown;
  upsert: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  update: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ count: number }>>>;
};
let b: Ban;

const dbGia = () => {
  const api = {
    trnSubmission: { findFirst: vi.fn(async () => b.luot), updateMany: b.update },
    trnRubric: { findFirst: vi.fn(async () => b.khung) },
    trnRubricScore: { upsert: b.upsert },
  };
  return {
    ...api,
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(api),
  } as never;
};

const actor = { userId: "gv1" } as never;

async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

const cham = (input: Record<string, unknown> = {}) =>
  cauHinhChamBaiTap.handler({
    db: dbGia(),
    actor,
    input: {
      submissionId: "s1",
      diem: [
        { criterionId: "tc1", levelIndex: 2 },
        { criterionId: "tc2", levelIndex: 2 },
      ],
      ...input,
    },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  b = {
    luot: {
      id: "s1",
      lessonId: "b1",
      enrollmentId: "en1",
      userId: "u1",
      attemptNo: 1,
      status: "SUBMITTED",
      rubricId: "k1",
    },
    khung: {
      id: "k1",
      passPoints: 80,
      totalPoints: 100,
      criteria: [
        { id: "tc1", label: "Mở đầu", levelsJson: MUC(0, 30, 60) },
        { id: "tc2", label: "Xử lý", levelsJson: MUC(0, 20, 40) },
      ],
    },
    upsert: vi.fn(async (_a: unknown) => ({})),
    update: vi.fn(async (_a: unknown) => ({ count: 1 })),
  };
});

describe("chấm đủ thì CHỐT", () => {
  it("cộng điểm theo MỨC đã chọn, kết luận đạt", async () => {
    const r = (await cham()) as { data: { totalScore: number; passed: boolean } };
    expect(r.data.totalScore).toBe(100);
    expect(r.data.passed).toBe(true);
  });

  it("dưới ngưỡng ⇒ chưa đạt", async () => {
    const r = (await cham({
      diem: [
        { criterionId: "tc1", levelIndex: 1 },
        { criterionId: "tc2", levelIndex: 1 },
      ],
    })) as { data: { totalScore: number; passed: boolean } };
    expect(r.data.totalScore).toBe(50);
    expect(r.data.passed).toBe(false);
  });

  it("🔴 CHÉP điểm của mức vào từng dòng, không join sống", async () => {
    // Join sống `levelsJson` thì sửa khung sau đó đổi HỒI TỐ điểm mọi bài đã chấm.
    await cham();
    const arg = b.upsert.mock.calls[0]![0] as {
      create: { points: number; levelIndex: number };
    };
    expect(arg.create.points).toBe(60);
    expect(arg.create.levelIndex).toBe(2);
  });

  it("ĐẠT ⇒ bài học lên xong, đi qua đường ghi dùng chung", async () => {
    await cham();
    expect(h.ghiXong).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG đạt ⇒ không ghi bài là xong", async () => {
    await cham({
      diem: [
        { criterionId: "tc1", levelIndex: 0 },
        { criterionId: "tc2", levelIndex: 0 },
      ],
    });
    expect(h.ghiXong).not.toHaveBeenCalled();
  });
});

describe("🔴 TRẢ VỀ để sửa", () => {
  it("ghi điểm từng tiêu chí nhưng KHÔNG chốt là đạt", async () => {
    // Người chấm đã đọc và đã cho điểm; giữ phần đó để lượt sau người học biết mình
    // yếu chỗ nào.
    const r = (await cham({ traVeSua: true })) as {
      data: { traVeSua: boolean; passed: boolean };
    };
    expect(r.data.traVeSua).toBe(true);
    expect(b.upsert).toHaveBeenCalledTimes(2);
    const arg = b.update.mock.calls[0]![0] as {
      data: { status: string; passed: boolean | null; score: number | null };
    };
    expect(arg.data.status).toBe("NEEDS_REVISION");
    // 🔴 `null`, KHÔNG phải `false`. `false` nghĩa là "đã chấm, trượt" — đóng sổ
    // trượt cho một bài chưa có kết quả cuối, và con số đó chạy vào báo cáo.
    expect(arg.data.passed).toBeNull();
    expect(arg.data.score).toBeNull();
  });

  it("và KHÔNG ghi bài là xong, kể cả khi đủ điểm", async () => {
    await cham({ traVeSua: true });
    expect(h.ghiXong).not.toHaveBeenCalled();
  });
});

describe("🔴 phải phủ ĐỦ tiêu chí", () => {
  it("thiếu một tiêu chí ⇒ từ chối, nói rõ còn mấy cái", async () => {
    // Chốt khi thiếu là cho điểm một phần bài mà chưa ai đọc.
    const e = await batLoi(cham({ diem: [{ criterionId: "tc1", levelIndex: 2 }] }));
    expect(e.code).toBe("CHUA_CHAM_DU");
    expect(e.message).toContain("1");
    expect(b.update).not.toHaveBeenCalled();
  });

  it("tiêu chí ngoài khung ⇒ từ chối", async () => {
    const e = await batLoi(
      cham({
        diem: [
          { criterionId: "tc1", levelIndex: 2 },
          { criterionId: "tc-la", levelIndex: 0 },
        ],
      }),
    );
    expect(e.code).toBe("TIEU_CHI_NGOAI_KHUNG");
  });

  it("mức KHÔNG tồn tại ⇒ từ chối", async () => {
    const e = await batLoi(
      cham({
        diem: [
          { criterionId: "tc1", levelIndex: 9 },
          { criterionId: "tc2", levelIndex: 0 },
        ],
      }),
    );
    expect(e.code).toBe("MUC_KHONG_CO");
  });

  it("gửi TRÙNG tiêu chí bị Zod chặn", () => {
    const r = chamBaiTapSchema.safeParse({
      submissionId: "s1",
      diem: [
        { criterionId: "tc1", levelIndex: 0 },
        { criterionId: "tc1", levelIndex: 2 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("🔴 khung đọc TỪ LƯỢT NỘP, không từ bài", () => {
  it("dùng `rubricId` đóng băng trên lượt nộp", async () => {
    // Cột trên bài sửa được bất cứ lúc nào; đọc nó ở đây là chấm bài cũ bằng thước
    // mới, và bảng điểm in lại ra số khác.
    const db = dbGia() as unknown as {
      trnRubric: { findFirst: ReturnType<typeof vi.fn> };
    };
    await cauHinhChamBaiTap.handler({
      db: db as never,
      actor,
      input: {
        submissionId: "s1",
        diem: [
          { criterionId: "tc1", levelIndex: 2 },
          { criterionId: "tc2", levelIndex: 2 },
        ],
      },
    } as never);
    const arg = db.trnRubric.findFirst.mock.calls[0]![0] as {
      where: { id: string };
    };
    expect(arg.where.id).toBe("k1");
  });

  it("lượt nộp KHÔNG có khung ⇒ từ chối, đừng chấm tay", async () => {
    b.luot = { ...(b.luot as object), rubricId: null };
    expect((await batLoi(cham())).code).toBe("LUOT_KHONG_CO_KHUNG");
  });

  it("tiêu chí HỎNG khuôn ⇒ từ chối, gọi tên tiêu chí", async () => {
    b.khung = {
      ...(b.khung as object),
      criteria: [
        { id: "tc1", label: "Mở đầu", levelsJson: MUC(0, 30, 60) },
        { id: "tc2", label: "Xử lý", levelsJson: { rac: 1 } },
      ],
    };
    const e = await batLoi(cham());
    expect(e.code).toBe("TIEU_CHI_HONG");
    expect(e.message).toContain("Xử lý");
  });
});

describe("🔴 hai người chấm cùng lúc", () => {
  it("ai tới trước thắng — điều kiện nằm TRONG `where`", async () => {
    await cham();
    const arg = b.update.mock.calls[0]![0] as {
      where: { id: string; status: string };
    };
    expect(arg.where.status).toBe("SUBMITTED");
  });

  it("người tới sau nhận báo, không ghi đè", async () => {
    b.update = vi.fn(async () => ({ count: 0 }));
    const e = await batLoi(cham());
    expect(e.code).toBe("DA_CO_NGUOI_CHAM");
    expect(h.ghiXong).not.toHaveBeenCalled();
  });
});

describe("chỉ chấm lượt ĐANG CHỜ", () => {
  it("đã chấm rồi ⇒ từ chối, nói rõ cần đường riêng", async () => {
    b.luot = { ...(b.luot as object), status: "GRADED" };
    const e = await batLoi(cham());
    expect(e.code).toBe("LUOT_KHONG_CHO_CHAM");
    expect(e.message).toContain("đường riêng");
  });

  it("ngoài phạm vi cơ sở ⇒ NOT_FOUND", async () => {
    b.luot = null;
    expect((await batLoi(cham())).code).toBe("NOT_FOUND");
  });
});

describe("ghi tiến độ hỏng KHÔNG nuốt mất lượt chấm", () => {
  it("báo cờ thay vì ném — điểm đã commit rồi", async () => {
    h.ghiXong.mockRejectedValueOnce(new Error("mất kết nối"));
    const r = (await cham()) as { data: { ghiTienDoLoi: boolean; totalScore: number } };
    expect(r.data.totalScore).toBe(100);
    expect(r.data.ghiTienDoLoi).toBe(true);
  });
});

describe("audit và khoá quyền", () => {
  it("KHÔNG ghi nhận xét vào audit", async () => {
    const r = (await cham({
      feedback: "Bài lan man, thiếu bước kiểm tra",
      diem: [
        { criterionId: "tc1", levelIndex: 2, note: "Thiếu ý 2" },
        { criterionId: "tc2", levelIndex: 2 },
      ],
    })) as { newValues: Record<string, unknown> };
    const s = JSON.stringify(r.newValues);
    expect(s).not.toContain("lan man");
    expect(s).not.toContain("Thiếu ý 2");
  });

  it("🔴 dùng LẠI `elearning:exam:grade` — không đẻ khoá thứ 18", () => {
    // Mô tả của khoá đó trong registry ghi nguyên văn "Chấm tay bài thi/BÀI TẬP
    // theo rubric", có từ EL-02.
    expect(cauHinhChamBaiTap.permission).toBe("elearning:exam:grade");
  });
});
