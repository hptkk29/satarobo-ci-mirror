// @vitest-environment node
/**
 * EL-14b — kho câu hỏi.
 *
 * Ba nhóm nặng nhất, không nhóm nào nói về giao diện:
 *  · **Câu KHÔNG ĐÁP ÁN NÀO đúng** — Zod kiểm từng trường riêng lẻ sẽ để lọt, và
 *    câu đó không ai trả lời đúng được, vĩnh viễn.
 *  · **Cách ly cơ sở ở đường GHI** — `scopedDb` không che write.
 *  · **Sửa câu đã vào đề** — làm lệch điểm của mọi lượt đã chấm, im lặng, và điểm
 *    đó nằm trong hồ sơ nhân sự.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import {
  taoCauHoiSchema,
  suaCauHoiSchema,
  coSoCuaCauHoi,
  cauHinhTaoCauHoi,
  cauHinhSuaCauHoi,
  cauHinhXoaCauHoi,
} from "@/lib/elearning/question-bank";

const h = vi.hoisted(() => ({
  orgUnitId: vi.fn(async (_c: string | null) => "ou1"),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgUnitId }));

const NEN = {
  bankPath: "/an-toan/pccc/",
  type: "SINGLE",
  stem: "Bình chữa cháy CO2 dùng cho đám cháy loại nào?",
  choices: [
    { text: "Loại A", isCorrect: false },
    { text: "Loại B, C", isCorrect: true },
  ],
};

type Ban = {
  cauHoi: unknown;
  daVaoDe: unknown;
  create: ReturnType<typeof vi.fn<(a: unknown) => Promise<{ id: string }>>>;
  update: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  createChoices: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  delChoices: ReturnType<typeof vi.fn<(a: unknown) => Promise<unknown>>>;
  timCauHoi: ReturnType<typeof vi.fn<(a: unknown) => void>>;
};
let b: Ban;

const dbGia = () =>
  ({
    trnQuestion: {
      findFirst: vi.fn(async (a: unknown) => {
        b.timCauHoi(a);
        return b.cauHoi;
      }),
      update: b.update,
    },
    trnExamQuestion: { findFirst: vi.fn(async () => b.daVaoDe) },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        trnQuestion: { create: b.create, update: b.update },
        trnChoice: { createMany: b.createChoices, deleteMany: b.delChoices },
      }),
  }) as never;

const actorCS1 = { userId: "u1", isHoLevel: false, visibleCenterIds: ["cs1"] } as never;
const actorHO = { userId: "u2", isHoLevel: true, visibleCenterIds: ["cs1", "cs2"] } as never;

const tao = (actor = actorCS1, input: Record<string, unknown> = {}) =>
  cauHinhTaoCauHoi.handler({
    db: dbGia(),
    actor,
    input: { ...NEN, ...input },
  } as never);

async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.orgUnitId.mockResolvedValue("ou1");
  b = {
    cauHoi: { id: "q1", bankPath: "/an-toan/pccc/", type: "SINGLE", centerId: "cs1" },
    daVaoDe: null,
    create: vi.fn(async (_a: unknown) => ({ id: "q-moi" })),
    update: vi.fn(async (_a: unknown) => ({})),
    createChoices: vi.fn(async (_a: unknown) => ({})),
    delChoices: vi.fn(async (_a: unknown) => ({})),
    timCauHoi: vi.fn<(a: unknown) => void>(),
  };
});

// ── 1. Câu không đáp án nào đúng ───────────────────────────────────────────

describe("🔴 không cho lưu câu KHÔNG ĐÁP ÁN NÀO đúng", () => {
  it("không đánh dấu đáp án nào ⇒ từ chối", () => {
    // Zod kiểm từng trường riêng lẻ sẽ để lọt: `choices` là mảng hợp lệ, `type` là
    // chuỗi hợp lệ. Phải có phép kiểm CHÉO. Câu lọt qua là câu không ai trả lời
    // đúng được — với một cổng chặn thì đó là khoá cứng vĩnh viễn.
    const r = taoCauHoiSchema.safeParse({
      ...NEN,
      choices: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: false },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("câu MỘT-đáp-án mà đánh dấu hai ý ⇒ từ chối", () => {
    // Người soạn tưởng cả hai đúng; hệ chấm đòi đúng một. Không chặn ở đây thì
    // người học chọn ý "đúng" thứ hai và bị chấm sai.
    const r = taoCauHoiSchema.safeParse({
      ...NEN,
      choices: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: true },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("câu NHIỀU-đáp-án thì đánh dấu nhiều ý là hợp lệ", () => {
    // Vế "đừng chặn nhầm".
    const r = taoCauHoiSchema.safeParse({
      ...NEN,
      type: "MULTIPLE",
      choices: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: true },
        { text: "C", isCorrect: false },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("câu Đúng/Sai phải có ĐÚNG hai lựa chọn", () => {
    const r = taoCauHoiSchema.safeParse({
      ...NEN,
      type: "TRUE_FALSE",
      choices: [
        { text: "Đúng", isCorrect: true },
        { text: "Sai", isCorrect: false },
        { text: "Không rõ", isCorrect: false },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("câu trắc nghiệm có ÍT HƠN hai lựa chọn ⇒ từ chối", () => {
    const r = taoCauHoiSchema.safeParse({
      ...NEN,
      choices: [{ text: "A", isCorrect: true }],
    });
    expect(r.success).toBe(false);
  });

  it("câu tự luận KHÔNG có lựa chọn — và có lựa chọn thì từ chối", () => {
    expect(
      taoCauHoiSchema.safeParse({ ...NEN, type: "ESSAY", choices: undefined }).success,
    ).toBe(true);
    expect(taoCauHoiSchema.safeParse({ ...NEN, type: "ESSAY" }).success).toBe(false);
  });

  it("luật kiểm chéo áp CHO CẢ đường SỬA, không chỉ đường tạo", () => {
    // Đường sửa chép tay lại luật là hai bản sẽ trôi khỏi nhau — và bản lỏng hơn
    // thành cửa sau.
    const r = suaCauHoiSchema.safeParse({
      ...NEN,
      questionId: "q1",
      choices: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: false },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ── 2. Loại câu và đường trong cây ─────────────────────────────────────────

describe("chỉ nhận loại DÙNG ĐƯỢC trong đề", () => {
  it("ba loại chấm máy + hai loại chấm tay đi qua", () => {
    for (const t of ["SINGLE", "MULTIPLE", "TRUE_FALSE"]) {
      expect(taoCauHoiSchema.safeParse({ ...NEN, type: t, choices: NEN.choices }).success, t).toBe(
        true,
      );
    }
    for (const t of ["SHORT_ANSWER", "ESSAY"]) {
      expect(
        taoCauHoiSchema.safeParse({ ...NEN, type: t, choices: undefined }).success,
        t,
      ).toBe(true);
    }
  });

  it("loại CHƯA MỞ bị từ chối ngay lúc soạn", () => {
    // Cho soạn là để người ta bỏ công viết những câu không bao giờ dùng được —
    // đúng cái bẫy "mở lựa chọn khi chưa có đường đi" vừa phải gỡ ở loại bài học.
    for (const t of ["FILL_BLANK", "MATCHING", "ORDERING", "CASE"]) {
      expect(taoCauHoiSchema.safeParse({ ...NEN, type: t }).success, t).toBe(false);
    }
  });
});

describe("đường trong cây phải chuẩn hoá", () => {
  it("dạng đúng đi qua", () => {
    for (const p of ["/an-toan/", "/an-toan/pccc/", "/a/b/c/"]) {
      expect(taoCauHoiSchema.safeParse({ ...NEN, bankPath: p }).success, p).toBe(true);
    }
  });

  it("thiếu gạch đầu/cuối, hoa, dấu cách ⇒ từ chối", () => {
    // `/an-toan/` và `an-toan` cùng tồn tại thì cây tách làm hai nhánh trông giống
    // hệt nhau, và người soạn không hiểu vì sao câu mới không nằm cùng chỗ câu cũ.
    for (const p of ["an-toan/", "/An-Toan/", "/an toan/", "//", "/an-toan"]) {
      expect(taoCauHoiSchema.safeParse({ ...NEN, bankPath: p }).success, p).toBe(false);
    }
  });
});

// ── 3. Cách ly cơ sở ở đường GHI ───────────────────────────────────────────

describe("🔴 cách ly cơ sở — `scopedDb` KHÔNG che đường ghi", () => {
  it("người cấp cơ sở ⇒ câu thuộc CƠ SỞ của họ", () => {
    expect(coSoCuaCauHoi(actorCS1)).toBe("cs1");
  });

  it("người Hội sở ⇒ câu DÙNG CHUNG (`null`), không phải cơ sở đầu tiên", () => {
    // `null` ở bảng này là giá trị THẬT ("cả công ty"), khác hẳn `TrnEnrollment`
    // nơi `null` nghĩa là chưa backfill.
    expect(coSoCuaCauHoi(actorHO)).toBeNull();
  });

  it("🔴 thấy NHIỀU cơ sở mà không phải Hội sở ⇒ TỪ CHỐI, không đoán", () => {
    // Đoán sai là gắn câu hỏi vào cơ sở khác, và nó biến mất khỏi tầm nhìn của
    // chính người vừa tạo.
    const la = { userId: "u3", isHoLevel: false, visibleCenterIds: ["cs1", "cs2"] } as never;
    expect(() => coSoCuaCauHoi(la)).toThrow(ActionError);
  });

  it("ghi kèm cơ sở VÀ đơn vị, gọi tường minh", async () => {
    await tao();
    expect(h.orgUnitId).toHaveBeenCalledWith("cs1");
    const arg = b.create.mock.calls[0]![0] as {
      data: { centerId: unknown; orgUnitId: unknown };
    };
    expect(arg.data.centerId).toBe("cs1");
    expect(arg.data.orgUnitId).toBe("ou1");
  });

  it("SỬA phải nạp câu QUA `scopedDb` — đó là cổng cách ly", async () => {
    // Bỏ bước đọc thì `update` theo `id` sửa được câu của cơ sở khác.
    await cauHinhSuaCauHoi.handler({
      db: dbGia(),
      actor: actorCS1,
      input: { ...NEN, questionId: "q1" },
    } as never);
    expect(b.timCauHoi).toHaveBeenCalledTimes(1);
  });

  it("câu của cơ sở khác ⇒ NOT_FOUND, không sửa gì", async () => {
    b.cauHoi = null;
    await batLoi(
      cauHinhSuaCauHoi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { ...NEN, questionId: "q-cua-cs2" },
      } as never),
    );
    expect(b.update).not.toHaveBeenCalled();
  });
});

// ── 4. Câu đã vào đề ───────────────────────────────────────────────────────

describe("🔴 câu ĐÃ nằm trong đề thì không sửa, không xoá", () => {
  it("sửa ⇒ từ chối, nói rõ phải làm gì", async () => {
    // Sửa nội dung hay đáp án của một câu đã có người thi làm LỆCH ĐIỂM của mọi
    // lượt đã chấm, im lặng — và điểm đó nằm trong hồ sơ nhân sự.
    b.daVaoDe = { id: "eq1" };
    const e = await batLoi(
      cauHinhSuaCauHoi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { ...NEN, questionId: "q1" },
      } as never),
    );
    expect(e.code).toBe("CAU_DA_VAO_DE");
    expect(e.message).toContain("nhân bản");
    expect(b.update).not.toHaveBeenCalled();
  });

  it("xoá ⇒ từ chối", async () => {
    b.daVaoDe = { id: "eq1" };
    const e = await batLoi(
      cauHinhXoaCauHoi.handler({
        db: dbGia(),
        actor: actorCS1,
        input: { questionId: "q1" },
      } as never),
    );
    expect(e.code).toBe("CAU_DA_VAO_DE");
  });

  it("chưa vào đề ⇒ xoá MỀM, không xoá cứng", async () => {
    // Xoá cứng là mất ngữ cảnh của lượt thi cũ trỏ tới nó.
    await cauHinhXoaCauHoi.handler({
      db: dbGia(),
      actor: actorCS1,
      input: { questionId: "q1" },
    } as never);
    const arg = b.update.mock.calls[0]![0] as { data: { deletedAt: unknown } };
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });
});

// ── 5. Lựa chọn ghi cùng transaction ───────────────────────────────────────

describe("lựa chọn ghi CÙNG transaction với câu hỏi", () => {
  it("tạo ⇒ ghi cả hai", async () => {
    // Tách ra thì một lỗi ở giữa để lại câu hỏi không lựa chọn nào — nó vẫn hiện
    // trong kho, vẫn thêm được vào đề, rồi mới nổ lúc người học mở ra.
    await tao();
    expect(b.create).toHaveBeenCalledTimes(1);
    expect(b.createChoices).toHaveBeenCalledTimes(1);
    const arg = b.createChoices.mock.calls[0]![0] as {
      data: { orderIndex: number }[];
    };
    expect(arg.data.map((x) => x.orderIndex)).toEqual([0, 1]);
  });

  it("sửa ⇒ THAY TRỌN bộ lựa chọn, không sửa từng dòng", async () => {
    // Sửa từng dòng thì `orderIndex` cũ còn sót và khoá duy nhất va nhau.
    await cauHinhSuaCauHoi.handler({
      db: dbGia(),
      actor: actorCS1,
      input: { ...NEN, questionId: "q1" },
    } as never);
    expect(b.delChoices).toHaveBeenCalledTimes(1);
    expect(b.createChoices).toHaveBeenCalledTimes(1);
  });

  it("câu tự luận ⇒ không ghi lựa chọn nào", async () => {
    await tao(actorCS1, { type: "ESSAY", choices: undefined });
    expect(b.createChoices).not.toHaveBeenCalled();
  });
});

// ── 6. Audit không rò nội dung ─────────────────────────────────────────────

describe("🔴 nhật ký audit KHÔNG mang đề bài hay đáp án", () => {
  it("chỉ ghi đường trong cây, loại câu và số lựa chọn", async () => {
    // Nhật ký audit đọc được rộng hơn kho câu hỏi; ghi đề bài vào đó là rò nội
    // dung qua đường vòng, và không ai nghĩ tới chỗ đó khi rà quyền.
    const r = (await tao()) as { newValues: Record<string, unknown> };
    const s = JSON.stringify(r.newValues);
    expect(s).not.toContain(NEN.stem);
    expect(s).not.toContain("isCorrect");
    expect(s).toContain("/an-toan/pccc/");
  });
});

// ── 7. Quyền ───────────────────────────────────────────────────────────────

describe("khoá quyền", () => {
  it("dùng khoá CÓ THẬT, không mở khoá thứ 18", () => {
    for (const c of [cauHinhTaoCauHoi, cauHinhSuaCauHoi, cauHinhXoaCauHoi]) {
      expect(c.permission, c.name).toBe("elearning:content:author");
    }
  });
});
