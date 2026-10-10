// @vitest-environment node
/**
 * EL-14e — hàng chờ chấm.
 *
 * Màn này quyết định AI ĐƯỢC ĐỌC TRƯỚC. Xếp sai thứ tự không làm hỏng dữ liệu, nhưng
 * đẩy rủi ro quá hạn sang đúng người đã nộp sớm nhất.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { napHangCho, napLuotDeCham } from "@/lib/elearning/exam-grading-queue";
import { dungNoiDungCauHoi } from "@/lib/elearning/question-content-map";

const NGAY = (s: string) => new Date(`${s}T00:00:00.000Z`);
const BAY_GIO = NGAY("2026-08-25");

/** Nội dung câu trắc nghiệm ĐỌC ĐƯỢC — dựng qua chính đường ghi, không bịa tay. */
const NOI_DUNG_SINGLE = dungNoiDungCauHoi({
  questionId: "q1",
  type: "SINGLE",
  stem: "Chọn đáp án",
  choices: [
    { text: "Ngắt điện", isCorrect: false },
    { text: "Báo động rồi ngắt điện", isCorrect: true },
  ],
});

type Ban = {
  luot: unknown[];
  motLuot: unknown;
  nguoi: { id: string; name: string | null; email: string | null }[];
  cacCau: unknown[];
  traLoi: unknown[];
};
let b: Ban;
let dsArgs: { orderBy?: unknown; where?: unknown; take?: number };

const dbGia = () =>
  ({
    trnExamAttempt: {
      findMany: vi.fn(async (a: { orderBy?: unknown; where?: unknown; take?: number }) => {
        dsArgs = a;
        return b.luot;
      }),
      findFirst: vi.fn(async () => b.motLuot),
    },
    trnExamQuestion: { findMany: vi.fn(async () => b.cacCau) },
    trnExamAnswer: { findMany: vi.fn(async () => b.traLoi) },
    user: {
      findMany: vi.fn(async () => b.nguoi),
      findFirst: vi.fn(async () => b.nguoi[0] ?? null),
    },
  }) as never;

beforeEach(() => {
  b = {
    luot: [
      {
        id: "lt-cu",
        userId: "u1",
        attemptNo: 1,
        submittedAt: NGAY("2026-08-20"),
        exam: { title: "An toàn điện" },
      },
      {
        id: "lt-moi",
        userId: "u2",
        attemptNo: 2,
        submittedAt: NGAY("2026-08-25"),
        exam: { title: "An toàn điện" },
      },
    ],
    motLuot: {
      id: "lt1",
      examId: "de1",
      userId: "u1",
      attemptNo: 1,
      submittedAt: NGAY("2026-08-20"),
      exam: { title: "An toàn điện", passScore: 6, maxScore: 10 },
    },
    nguoi: [{ id: "u1", name: "Trần A", email: "a@x.vn" }],
    cacCau: [
      {
        id: "eq1",
        points: 4,
        orderIndex: 0,
        question: {
          stem: "Chọn đáp án",
          type: "SINGLE",
          contentJson: NOI_DUNG_SINGLE,
        },
      },
      {
        id: "eq2",
        points: 6,
        orderIndex: 1,
        question: {
          stem: "Trình bày các bước",
          type: "ESSAY",
          contentJson: null,
        },
      },
    ],
    traLoi: [
      {
        examQuestionId: "eq1",
        textAnswer: null,
        selectedChoiceIds: ["1"],
        score: 4,
        graderNote: null,
      },
      {
        examQuestionId: "eq2",
        textAnswer: "  Ngắt điện trước  ",
        selectedChoiceIds: [],
        score: null,
        graderNote: null,
      },
    ],
  };
});

describe("hàng chờ xếp NGƯỜI CHỜ LÂU NHẤT lên trước", () => {
  it("hỏi DB theo `submittedAt` tăng dần, và chỉ lấy lượt đang chờ", async () => {
    // Xếp theo lượt nộp gần nhất là đẩy rủi ro quá hạn sang đúng người nộp sớm —
    // họ đã làm xong phần của mình rồi.
    await napHangCho(dbGia(), { bayGio: BAY_GIO });
    expect(dsArgs.orderBy).toEqual({ submittedAt: "asc" });
    expect(dsArgs.where).toEqual({ status: "PENDING_GRADE" });
  });

  it("đếm số ngày chờ", async () => {
    const { dong } = await napHangCho(dbGia(), { bayGio: BAY_GIO });
    expect(dong[0]!.soNgayCho).toBe(5);
    expect(dong[1]!.soNgayCho).toBe(0);
  });

  it("thiếu mốc nộp ⇒ `null`, KHÔNG biến mất khỏi danh sách", async () => {
    // Một dòng không xếp được vẫn phải nhìn thấy: lượt bị bỏ khỏi hàng chờ là lượt
    // không bao giờ được chấm.
    b.luot = [
      { id: "lt-x", userId: "u1", attemptNo: 1, submittedAt: null, exam: { title: "X" } },
    ];
    const { dong } = await napHangCho(dbGia(), { bayGio: BAY_GIO });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.soNgayCho).toBeNull();
  });

  it("thiếu tên ⇒ rơi về email rồi tới id, không ra ô trống", async () => {
    b.nguoi = [{ id: "u1", name: null, email: "a@x.vn" }];
    const { dong } = await napHangCho(dbGia(), { bayGio: BAY_GIO });
    expect(dong[0]!.tenNguoiHoc).toBe("a@x.vn");
    // `u2` không có trong bảng người ⇒ hiện id, không hiện rỗng.
    expect(dong[1]!.tenNguoiHoc).toBe("u2");
  });

  it("không có lượt nào ⇒ mảng rỗng, không hỏi thêm DB", async () => {
    b.luot = [];
    const db = dbGia() as unknown as { user: { findMany: ReturnType<typeof vi.fn> } };
    const r = await napHangCho(db as never, { bayGio: BAY_GIO });
    expect(r.dong).toEqual([]);
    expect(r.conNua).toBe(false);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("🔴 danh sách bị CẮT thì phải nói ra", () => {
  const dungLuot = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `lt${i}`,
      userId: "u1",
      attemptNo: 1,
      submittedAt: NGAY("2026-08-20"),
      exam: { title: "X" },
    }));

  it("còn bài ngoài trần ⇒ `conNua` bật, và danh sách cắt đúng trần", async () => {
    // Im lặng cắt là để người chấm đọc hết trang rồi tin là đã hết việc — trong khi
    // bài thứ 201 chính là bài chờ lâu nhất.
    b.luot = dungLuot(4);
    const r = await napHangCho(dbGia(), { bayGio: BAY_GIO, take: 3 });
    expect(r.dong).toHaveLength(3);
    expect(r.conNua).toBe(true);
  });

  it("vừa đủ trần ⇒ KHÔNG báo nhầm là còn nữa", async () => {
    b.luot = dungLuot(3);
    const r = await napHangCho(dbGia(), { bayGio: BAY_GIO, take: 3 });
    expect(r.dong).toHaveLength(3);
    expect(r.conNua).toBe(false);
  });

  it("hỏi DB DƯ một dòng để biết còn nữa, không đếm lần hai", async () => {
    // Một lượt `count` thứ hai chạy sau lượt đọc, nên hai con số có thể lệch nhau
    // ngay trong một lần tải trang.
    b.luot = dungLuot(2);
    await napHangCho(dbGia(), { bayGio: BAY_GIO, take: 3 });
    expect((dsArgs as { take?: number }).take).toBe(4);
  });
});

describe("mở một lượt để chấm", () => {
  it("giữ THỨ TỰ câu của đề", async () => {
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau.map((c) => c.examQuestionId)).toEqual(["eq1", "eq2"]);
  });

  it("đánh dấu câu nào ĐÃ CÓ ĐIỂM — câu đó chỉ đọc", async () => {
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[0]!.daCoDiem).toBe(true);
    expect(r!.cacCau[0]!.score).toBe(4);
    expect(r!.cacCau[1]!.daCoDiem).toBe(false);
    expect(r!.cacCau[1]!.score).toBeNull();
  });

  it("🔴 câu TRẮC NGHIỆM chưa có điểm vẫn mở cho chấm tay", async () => {
    // `chamMotCau` CỐ Ý để dành câu trắc nghiệm hỏng nội dung cho người. Nếu ở đây
    // suy "đã chấm" theo LOẠI thì câu đó bị dán nhãn "hệ thống đã chấm 0/N", khoá
    // không cho sửa, rồi số 0 vào hồ sơ nhân sự — người học trượt vì một câu KHÔNG
    // AI chấm.
    b.traLoi = [
      {
        examQuestionId: "eq1",
        textAnswer: null,
        selectedChoiceIds: ["1"],
        score: null,
        graderNote: null,
      },
    ];
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[0]!.daCoDiem).toBe(false);
    // …và nói rõ VÌ SAO một câu trắc nghiệm lại phải chấm tay.
    expect(r!.cacCau[0]!.mayKhongDocDuoc).toBe(true);
  });

  it("câu tự luận chưa chấm KHÔNG bị gắn cờ máy-không-đọc-được", async () => {
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[1]!.mayKhongDocDuoc).toBe(false);
  });

  it("🔴 bài làm trắc nghiệm hiện NHÃN lựa chọn, không phải chỉ số thô", async () => {
    // "1" không nói cho người chấm biết người học chọn gì, nên họ không soi được
    // điểm máy và khối chỉ-đọc thành nhiễu.
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[0]!.baiLam).toBe("Báo động rồi ngắt điện");
  });

  it("nội dung câu KHÔNG đọc được ⇒ rơi về chỉ số, không ném", async () => {
    b.cacCau = [
      {
        id: "eq1",
        points: 4,
        orderIndex: 0,
        question: { stem: "Chọn đáp án", type: "SINGLE", contentJson: { rac: 1 } },
      },
    ];
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[0]!.baiLam).toBe("1");
  });

  it("bài làm tự luận cắt khoảng trắng thừa", async () => {
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[1]!.baiLam).toBe("Ngắt điện trước");
  });

  it("🔴 câu KHÔNG có dòng trả lời hiện chữ `(bỏ trống)`", async () => {
    // Ô trắng trông y hệt lỗi tải dữ liệu; người chấm sẽ đi hỏi thay vì cho 0 điểm,
    // và lượt đứng lại thêm một ngày.
    b.traLoi = [];
    const r = await napLuotDeCham(dbGia(), "lt1");
    expect(r!.cacCau[0]!.baiLam).toBe("(bỏ trống)");
    expect(r!.cacCau[1]!.baiLam).toBe("(bỏ trống)");
  });

  it("chỉ trả bài dở dang khi lượt ĐANG CHỜ CHẤM", async () => {
    b.motLuot = null;
    expect(await napLuotDeCham(dbGia(), "lt1")).toBeNull();
  });
});
