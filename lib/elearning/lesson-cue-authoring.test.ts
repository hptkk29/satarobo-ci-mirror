// @vitest-environment node
/**
 * EL-12c — soạn câu hỏi chèn giữa video.
 *
 * Hai nhóm case nặng nhất ở đây KHÔNG phải về câu hỏi:
 *  · CÁCH LY CƠ SỞ — `TrnLesson` không nằm trong `SCOPED_MODELS` và `scopedDb`
 *    không che đường ghi, nên nếu action không tự đi qua chuỗi cha thì người soạn
 *    ở CS1 chèn được câu hỏi vào bài của khoá riêng CS2, và KHÔNG GÌ BÁO.
 *  · ĐỔI ĐIỀU KIỆN DƯỚI CHÂN NGƯỜI ĐANG HỌC — thêm một câu hỏi chặn vào bài đã có
 *    người học dở làm bài đang 100% bỗng thành chưa xong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import {
  cauHinhThemCue,
  cauHinhXoaCue,
  themCueSchema,
} from "@/lib/elearning/lesson-cue-authoring";
import { CUE_TOI_DA } from "@/lib/elearning/lesson-cue";

const CAU = {
  id: "q1",
  type: "single" as const,
  question: "Bước nào làm trước?",
  options: ["A", "B", "C"],
  correctIndex: 1,
};

type Ban = {
  bai: unknown;
  khoa: unknown;
  cue: unknown;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  timKhoa: ReturnType<typeof vi.fn<(a: unknown) => void>>;
};

let b: Ban;

/** `scopedDb` giả — mọi lượt đọc khoá đi qua `timKhoa` để đếm được. */
const dbGia = () =>
  ({
    trnLesson: {
      findFirst: vi.fn(async () => b.bai),
      update: b.update,
    },
    trnCourse: {
      findFirst: vi.fn(async (a: unknown) => {
        b.timKhoa(a);
        return b.khoa;
      }),
    },
    trnLessonCue: {
      findFirst: vi.fn(async () => b.cue),
      create: b.create,
      delete: b.del,
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        trnLesson: { update: b.update },
        trnLessonCue: { create: b.create, delete: b.del },
      }),
  }) as never;

const actor = { userId: "u1" } as never;

/**
 * Chạy và LẤY LỖI. Viết `.catch((x) => x as ActionError)` thì kiểu trả về là hợp
 * của lỗi với kết quả thành công, nên `e.code` không biên dịch được — và cách sửa
 * cẩu thả là ép `as never`, tức mất luôn phần kiểm kiểu ở đúng chỗ cần nó.
 */
async function batLoi(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e;
    throw e;
  }
  throw new Error("phải ném ActionError");
}

const them = (input: Record<string, unknown> = {}) =>
  cauHinhThemCue.handler({
    db: dbGia(),
    actor,
    input: { lessonId: "les1", atSec: 30, cauHoi: CAU, ...input } as never,
  } as never);

beforeEach(() => {
  b = {
    bai: {
      id: "les1",
      kind: "VIDEO",
      durationSec: 600,
      cueCount: 0,
      module: { courseId: "c1" },
      _count: { progress: 0 },
    },
    khoa: { id: "c1" },
    cue: { id: "cue1", atSec: 30 },
    create: vi.fn(async () => ({ id: "cue-moi" })),
    update: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
    timKhoa: vi.fn<(a: unknown) => void>(),
  };
});

// ── 1. Cách ly cơ sở ────────────────────────────────────────────────────────

describe("🔴 cách ly cơ sở đi qua CHUỖI CHA", () => {
  it("có đọc KHOÁ qua scopedDb — đó chính là cổng cách ly", async () => {
    await them();
    expect(b.timKhoa).toHaveBeenCalledTimes(1);
    const arg = b.timKhoa.mock.calls[0]![0] as { where: { id: string } };
    expect(arg.where.id).toBe("c1");
  });

  it("khoá thuộc cơ sở KHÁC ⇒ từ chối, không tạo gì", async () => {
    // `scopedDb` lọc mất khoá ⇒ `findFirst` trả null. Không kiểm vế này thì hai
    // câu kiểm còn lại (bài có tồn tại không, có phải VIDEO không) vẫn xanh cho
    // một người ở cơ sở khác.
    b.khoa = null;
    await expect(them()).rejects.toBeInstanceOf(ActionError);
    expect(b.create).not.toHaveBeenCalled();
  });

  it("bài không tồn tại và bài của cơ sở khác trả CÙNG một lỗi", async () => {
    // Phân biệt hai thứ là nói cho người dò biết id nào có thật.
    b.bai = null;
    const e1 = await batLoi(them());
    b.bai = {
      id: "les1",
      kind: "VIDEO",
      durationSec: 600,
      cueCount: 0,
      module: { courseId: "c1" },
      _count: { progress: 0 },
    };
    b.khoa = null;
    const e2 = await batLoi(them());
    expect(e1.code).toBe(e2.code);
    expect(e1.message).toBe(e2.message);
  });

  it("XOÁ cũng phải qua cổng đó, và cue phải thuộc đúng bài", async () => {
    // Xoá thẳng theo `cueId` là xoá được cue của bài bất kỳ — cổng ở trên thành
    // trang trí.
    b.cue = null;
    await expect(
      cauHinhXoaCue.handler({
        db: dbGia(),
        actor,
        input: { lessonId: "les1", cueId: "cue-nguoi-khac" },
      } as never),
    ).rejects.toBeInstanceOf(ActionError);
    expect(b.del).not.toHaveBeenCalled();
  });
});

// ── 2. Không đổi luật dưới chân người đang học ─────────────────────────────

describe("🔴 không đổi điều kiện hoàn thành dưới chân người đang học", () => {
  it("bài ĐÃ có người học ⇒ từ chối thêm câu hỏi CHẶN", async () => {
    // Bài đang 100% bỗng thành chưa xong, và họ phải quay lại xem một đoạn đã xem.
    b.bai = { ...(b.bai as object), _count: { progress: 7 } };
    const e = await batLoi(them());
    expect(e.message).toContain("7");
    expect(b.create).not.toHaveBeenCalled();
  });

  it("câu KHÔNG chặn thì vẫn thêm được", async () => {
    // Câu không chặn không đổi điều kiện hoàn thành của ai.
    b.bai = { ...(b.bai as object), _count: { progress: 7 } };
    await them({ blocking: false });
    expect(b.create).toHaveBeenCalledTimes(1);
  });

  it("bài chưa ai học ⇒ thêm bình thường", async () => {
    await them();
    expect(b.create).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Ràng buộc nội dung ───────────────────────────────────────────────────

describe("ràng buộc khi đặt câu hỏi", () => {
  it("bài KHÔNG phải video ⇒ từ chối", async () => {
    b.bai = { ...(b.bai as object), kind: "READ" };
    await expect(them()).rejects.toBeInstanceOf(ActionError);
  });

  it("bài chưa có tệp video ⇒ từ chối, nói rõ phải làm gì", async () => {
    // `atSec < null` không chặn được gì — cue sẽ nằm ở một giây có thể không bao
    // giờ tới, và bài đó không ai hoàn thành được.
    b.bai = { ...(b.bai as object), durationSec: null };
    const e = await batLoi(them());
    expect(e.message).toContain("tải video");
  });

  it("mốc VƯỢT thời lượng ⇒ từ chối", async () => {
    await batLoi(them({ atSec: 601 }));
    expect(b.create).not.toHaveBeenCalled();
  });

  it("mốc ĐÚNG BẰNG thời lượng cũng từ chối", async () => {
    // Video hết ở đúng giây đó ⇒ mốc không bao giờ tới.
    await expect(them({ atSec: 600 })).rejects.toBeInstanceOf(ActionError);
  });

  it("mốc 0 hoặc âm bị Zod chặn", () => {
    for (const atSec of [0, -5]) {
      const r = themCueSchema.safeParse({ lessonId: "l", atSec, cauHoi: CAU });
      expect(r.success, String(atSec)).toBe(false);
    }
  });

  it(`quá ${CUE_TOI_DA} câu ⇒ từ chối`, async () => {
    // Không có trần thì 30 câu trên một video 10 phút là hợp lệ về mặt máy; cộng
    // với chặn tua tới, người học không còn đường đi tiếp bình thường.
    b.bai = { ...(b.bai as object), cueCount: CUE_TOI_DA };
    await expect(them()).rejects.toBeInstanceOf(ActionError);
  });

  it("trùng giây ⇒ lỗi TIẾNG VIỆT, không phải P2002 thô", async () => {
    // `P2002` lọt ra ngoài là màn hình 500 và người soạn không biết mình vừa làm gì.
    // ⚠️ Mock phải giống lỗi THẬT của Prisma: mã nằm ở `e.code`, còn lời nhắn
    // KHÔNG chứa chuỗi "P2002". Bản đầu của case này ném một `Error` có chữ
    // "P2002" trong lời nhắn, nên nó XANH trên một nhánh `String(e).includes(...)`
    // không bao giờ chạy ngoài đời — test giả lập sai thì nó chỉ kiểm chính bản
    // giả lập đó.
    b.create = vi.fn(async () => {
      const e = new Error(
        "Unique constraint failed on the fields: (`atSec`)",
      ) as Error & { code?: string };
      e.code = "P2002";
      throw e;
    });
    const e = await batLoi(them());
    expect(e.message).toContain("giây này");
  });

  it("loại câu KHÔNG chấm được bị Zod chặn ngay ở tầng nhập", () => {
    const r = themCueSchema.safeParse({
      lessonId: "l",
      atSec: 30,
      cauHoi: { id: "q", type: "essay", question: "Trình bày" },
    });
    expect(r.success).toBe(false);
  });

  it("khoá lạ bị từ chối (`.strict()`)", () => {
    const r = themCueSchema.safeParse({
      lessonId: "l",
      atSec: 30,
      cauHoi: CAU,
      laLung: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ── 4. Sổ đếm ───────────────────────────────────────────────────────────────

describe("`cueCount` đi cùng transaction", () => {
  it("thêm ⇒ tăng 1, trong cùng transaction với lượt tạo", async () => {
    // Ngoài transaction thì một lỗi ở giữa để lại con số lệch, và không gì phát hiện.
    await them();
    expect(b.update).toHaveBeenCalledTimes(1);
    const arg = b.update.mock.calls[0]![0] as { data: { cueCount: unknown } };
    expect(arg.data.cueCount).toEqual({ increment: 1 });
  });

  it("xoá ⇒ giảm 1", async () => {
    await cauHinhXoaCue.handler({
      db: dbGia(),
      actor,
      input: { lessonId: "les1", cueId: "cue1" },
    } as never);
    const arg = b.update.mock.calls[0]![0] as { data: { cueCount: unknown } };
    expect(arg.data.cueCount).toEqual({ decrement: 1 });
    expect(b.del).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Quyền ────────────────────────────────────────────────────────────────

describe("khoá quyền", () => {
  it("dùng khoá CÓ THẬT, không mở khoá thứ 18", () => {
    // Khoá bịa ⇒ `can()` trả false với mọi vai kể cả SUPER_ADMIN, im lặng.
    expect(cauHinhThemCue.permission).toBe("elearning:content:author");
    expect(cauHinhXoaCue.permission).toBe("elearning:content:author");
  });
});
