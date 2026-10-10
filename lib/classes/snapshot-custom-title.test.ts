/**
 * Khoá bằng test: `createSessionPlansForClass` **KHÔNG ghi `customTitle`**.
 *
 * Vì sao đáng một bộ test riêng (`docs/dieu-tra-lech-bai-hoc.md` §4.1): đường ghi này là
 * gốc của sự cố "lệch tên bài". Nó chép `Lesson.title` vào `ClassSessionPlan.customTitle`
 * lúc tạo lớp, tạo một bản sao ĐÔNG CỨNG không bao giờ tự đồng bộ khi giáo trình đổi tên.
 * Đo prod 08/09: 960/960 plan có `customTitle`, **0 dòng NULL** — ô dành cho người bị máy
 * bịt kín; 33 dòng trong đó đang che tên đúng bằng tên giáo trình cũ.
 *
 * Thêm lại một chữ `customTitle` vào `createMany` là dựng lại nguyên vẹn sự cố, nên ca
 * `[KHONG-GHI]` dưới đây bắt trực tiếp **đối số** truyền cho Prisma chứ không kiểm gián tiếp.
 *
 * Dùng mock thay vì Postgres thật để bộ này chạy trong `pnpm test:unit` — tức trong cổng
 * merge. Các bộ chạm DB (`test:*-db`) không nằm trong danh sách required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  mockDb: {
    classSessionPlan: {
      count: vi.fn(),
      createMany: vi.fn(),
    },
    curriculum: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: h.mockDb }));

import { createSessionPlansForClass } from "./snapshot";
import { deriveSessionTitle, deriveSessionLabel } from "@/lib/lms/session-project-name";

const BAI = [
  { id: "l1", title: "HP1 - Bàn Tay Ma Thuật" },
  { id: "l2", title: "HP1 - Đấu Trường Con Quay" },
  { id: "l3", title: "HP2 - Họa Sĩ Robot" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.mockDb.classSessionPlan.count.mockResolvedValue(0);
  h.mockDb.classSessionPlan.createMany.mockResolvedValue({ count: BAI.length });
  h.mockDb.curriculum.findUnique.mockResolvedValue({ lessons: BAI });
});

describe("createSessionPlansForClass — ô customTitle dành cho NGƯỜI", () => {
  it("[KHONG-GHI] không dòng nào mang customTitle", async () => {
    const n = await createSessionPlansForClass({
      classId: "c1",
      curriculumId: "cur1",
      version: 1,
    });
    expect(n).toBe(3);

    const arg = h.mockDb.classSessionPlan.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    };
    expect(arg.data).toHaveLength(3);
    for (const dong of arg.data) {
      // Vắng mặt HẲN, không phải `customTitle: null` — để cột giữ mặc định của schema.
      expect(dong).not.toHaveProperty("customTitle");
    }
  });

  it("vẫn nối đúng lessonId + đánh số seq/order như cũ", async () => {
    await createSessionPlansForClass({ classId: "c1", curriculumId: "cur1", version: 1 });
    const arg = h.mockDb.classSessionPlan.createMany.mock.calls[0]![0] as {
      data: { classId: string; seq: number; lessonId: string; order: number }[];
    };
    expect(arg.data).toEqual([
      { classId: "c1", seq: 1, lessonId: "l1", order: 0 },
      { classId: "c1", seq: 2, lessonId: "l2", order: 1 },
      { classId: "c1", seq: 3, lessonId: "l3", order: 2 },
    ]);
  });

  it("lớp ĐÃ có plan thì không ghi gì — giữ nguyên tính idempotent", async () => {
    h.mockDb.classSessionPlan.count.mockResolvedValue(48);
    const n = await createSessionPlansForClass({
      classId: "c1",
      curriculumId: "cur1",
      version: 1,
    });
    expect(n).toBe(48);
    expect(h.mockDb.classSessionPlan.createMany).not.toHaveBeenCalled();
  });

  it("giáo trình rỗng → không ghi, trả 0", async () => {
    h.mockDb.curriculum.findUnique.mockResolvedValue({ lessons: [] });
    expect(
      await createSessionPlansForClass({ classId: "c1", curriculumId: "cur1", version: 1 }),
    ).toBe(0);
    expect(h.mockDb.classSessionPlan.createMany).not.toHaveBeenCalled();
  });
});

describe("bỏ customTitle KHÔNG mất tên bài — Lesson.title là nấc kế", () => {
  it("plan không customTitle → tiêu đề vẫn ra tên bài trần", () => {
    expect(deriveSessionTitle({ planTitle: null, lessonTitle: "HP2 - Họa Sĩ Robot" })).toBe(
      "Họa Sĩ Robot",
    );
  });

  it("nhãn đầy đủ vẫn dựng được, và nay bám tên HIỆN HÀNH của giáo trình", () => {
    // Đây chính là điểm lợi: đổi tên bài trong giáo trình là nhãn đổi theo ngay,
    // không còn kẹt ở ảnh chụp lúc tạo lớp.
    expect(
      deriveSessionLabel({
        sessionNumber: 3,
        planTitle: null,
        lessonTitle: "HP2 - Họa Sĩ Robot",
        lessonOrder: 3,
      }),
    ).toBe("Buổi 3 - HP2 - Họa Sĩ Robot");
  });

  it("giáo vụ CÓ gõ tên riêng thì tên đó vẫn thắng — ô của người còn nguyên tác dụng", () => {
    expect(
      deriveSessionTitle({ planTitle: "Buổi bù: ôn thi", lessonTitle: "HP2 - Họa Sĩ Robot" }),
    ).toBe("Buổi bù: ôn thi");
  });
});
