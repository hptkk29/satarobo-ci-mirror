// @vitest-environment node
/**
 * 🔴 CỔNG XUẤT BẢN — kiểm ĐƯỜNG DÂY, không kiểm luật.
 *
 * Tệp này tồn tại vì một lỗi CHẶN ĐỨNG lọt qua toàn bộ CI: `docDanBai` khai
 * `examId`/`rubricId` trong `select` của Prisma, nhưng bước `.map()` dựng đối tượng
 * trả lại KHÔNG chép chúng. Vì `BaiTrongDanBai.examId?` khai OPTIONAL nên TypeScript
 * im lặng, `kiemDanBai` đọc `undefined`, và cổng `!b.examId` / `!b.rubricId` NỔ
 * VĨNH VIỄN — không khoá nào chứa bài `QUIZ` hay `TASK` rời được khỏi nháp, kể cả
 * khi cột trong DB đã có giá trị đúng.
 *
 * Vì sao CI cũ không bắt: `course-outline.test.ts` dựng `ChuongTrongDanBai` BẰNG
 * TAY (`kiemDanBai(chuong({ examId: "de1" }) as never)`), tức nó kiểm LUẬT trên một
 * dữ liệu mà `docDanBai` không bao giờ tạo ra. Còn test vòng đời chỉ dùng
 * `kind: "READ"`, loại duy nhất không có cột nối nào.
 *
 * ⇒ Ở đây kiểm ĐÚNG chỗ đứt: chạy `docDanBai` thật trên một db giả trả về bài đã
 * gắn đề/khung, rồi soi xem hai cột có đi tới `kiemDanBai` không. Cùng một lớp với
 * `question-content-map.test.ts` (writer → reader) ở EL-14.
 */
import { describe, it, expect, vi } from "vitest";
import { kiemDanBai, type ChuongTrongDanBai } from "@/lib/elearning/course-outline";
import { docDanBaiChoMan } from "@/lib/elearning/course-authoring";

/** Db giả: bài ĐÃ gắn đề và khung — đúng thứ `ganDeVaoBai`/`ganKhungVaoBai` ghi. */
const dbGia = (bai: Record<string, unknown>) =>
  ({
    trnCourse: {
      findFirst: vi.fn(async () => ({
        id: "c1",
        code: "K1",
        title: "Khoá",
        status: "DRAFT",
        sequential: false,
      })),
    },
    trnCourseVersion: {
      findFirst: vi.fn(async () => ({
        id: "v1",
        major: 1,
        minor: 0,
        status: "DRAFT",
      })),
      findMany: vi.fn(async () => []),
    },
    trnCourseVersionLesson: {
      findMany: vi.fn(async () => [{ lessonId: "b1", required: true }]),
    },
    trnModule: {
      findMany: vi.fn(async () => [
        {
          id: "m1",
          title: "Chương 1",
          lessons: [bai],
        },
      ]),
    },
  }) as never;

const BAI_NEN = {
  id: "b1",
  title: "Bài",
  kind: "READ",
  contentMd: "nội dung",
  captionKey: null,
  examId: null,
  rubricId: null,
};

async function danBai(bai: Record<string, unknown>): Promise<ChuongTrongDanBai[]> {
  const r = (await docDanBaiChoMan(dbGia({ ...BAI_NEN, ...bai }), "c1")) as {
    chuong: ChuongTrongDanBai[];
  };
  return r.chuong;
}

describe("🔴 `examId` đi được TỪ DB TỚI CỔNG", () => {
  it("bài QUIZ đã gắn đề ⇒ cổng KHÔNG nổ", async () => {
    // Đây là ca đã hỏng từ EL-14: cổng luôn báo "chưa gắn đề thi" cho một bài đã
    // gắn, và người soạn không có cách nào thoát ngoài việc bỏ bài khỏi khoá.
    const chuong = await danBai({ kind: "QUIZ", examId: "de1", contentMd: null });
    expect(chuong[0]!.lessons[0]!.examId).toBe("de1");
    const kq = kiemDanBai(chuong);
    expect(kq.loi.map((l) => l.code)).not.toContain("BAI_THI_CHUA_CO_DE");
  });

  it("bài QUIZ CHƯA gắn đề ⇒ cổng nổ đúng", async () => {
    // Vế còn lại: sửa cho hết đỏ mà làm cổng câm luôn thì tệ hơn lỗi ban đầu.
    const kq = kiemDanBai(await danBai({ kind: "QUIZ", contentMd: null }));
    expect(kq.loi.map((l) => l.code)).toContain("BAI_THI_CHUA_CO_DE");
  });
});

describe("🔴 `rubricId` đi được TỪ DB TỚI CỔNG", () => {
  it("bài TASK đã gắn khung ⇒ cổng KHÔNG nổ", async () => {
    const chuong = await danBai({ kind: "TASK", rubricId: "k1", contentMd: null });
    expect(chuong[0]!.lessons[0]!.rubricId).toBe("k1");
    const kq = kiemDanBai(chuong);
    expect(kq.loi.map((l) => l.code)).not.toContain("BAI_TAP_CHUA_CO_KHUNG");
  });

  it("bài TASK CHƯA gắn khung ⇒ cổng nổ đúng", async () => {
    const kq = kiemDanBai(await danBai({ kind: "TASK", contentMd: null }));
    expect(kq.loi.map((l) => l.code)).toContain("BAI_TAP_CHUA_CO_KHUNG");
  });
});

describe("🔴 `youtubeId`/`youtubePhuDe` đi được TỪ DB TỚI CỔNG PHỤ ĐỀ", () => {
  // Cùng lớp với `examId`/`rubricId` ở trên: `select` có cột nhưng `.map()` dựng đối tượng
  // trả lại không chép ⇒ cổng đọc `undefined` ⇒ mọi bài YouTube của khoá bắt buộc bị chặn
  // "thiếu phụ đề" dù người soạn đã xác nhận. Ở đây cổng chạy trên đầu ra THẬT của `docDanBaiChoMan`.
  const VIDEO_YT = {
    kind: "VIDEO",
    contentMd: null,
    youtubeId: "aBcDeFgHiJk",
    youtubePhuDe: true,
    durationSec: 19,
  };

  async function kiemTheoKhoaBatBuoc(bai: Record<string, unknown>) {
    const db = dbGia({ ...BAI_NEN, ...bai }) as unknown as {
      trnCourse: { findFirst: ReturnType<typeof vi.fn> };
    };
    db.trnCourse.findFirst = vi.fn(async () => ({
      id: "c1",
      code: "K1",
      title: "Khoá",
      status: "DRAFT",
      programId: "p1",
      program: { natureTag: "MANDATORY" },
    }));
    const r = await docDanBaiChoMan(db as never, "c1");
    return { chuong: r.chuong, loi: r.kiem.loi.map((l) => l.code) };
  }

  it("bài YouTube đã xác nhận phụ đề ⇒ cổng KHÔNG nổ, và hai cột có mặt ở đầu ra", async () => {
    const { chuong, loi } = await kiemTheoKhoaBatBuoc(VIDEO_YT);
    expect(chuong[0]!.lessons[0]!.youtubeId).toBe("aBcDeFgHiJk");
    expect(chuong[0]!.lessons[0]!.youtubePhuDe).toBe(true);
    expect(loi).not.toContain("BAI_VIDEO_THIEU_PHU_DE");
  });

  it("bài YouTube CHƯA xác nhận ⇒ cổng nổ đúng", async () => {
    const { loi } = await kiemTheoKhoaBatBuoc({ ...VIDEO_YT, youtubePhuDe: false });
    expect(loi).toContain("BAI_VIDEO_THIEU_PHU_DE");
  });
});

describe("🔴 `videoKey`/`durationSec`/`youtubeId` đi được TỪ DB TỚI CỔNG NGUỒN VIDEO", () => {
  // Cùng lớp với `examId`/`rubricId`: `select` có cột nhưng `.map()` không chép ⇒ cổng đọc
  // `undefined` ⇒ MỌI bài video đã có nguồn bị chặn "chưa có video" và người soạn không có cách nào
  // hiểu vì sao. Cổng chạy trên đầu ra THẬT của `docDanBaiChoMan`.
  const maCong = async (bai: Record<string, unknown>) =>
    kiemDanBai(await danBai({ kind: "VIDEO", contentMd: null, ...bai })).loi.map((l) => l.code);

  it("bài MP4 đã có tệp + thời lượng ⇒ cổng KHÔNG nổ, và hai cột có mặt ở đầu ra", async () => {
    const chuong = await danBai({ kind: "VIDEO", contentMd: null, videoKey: "v/1.mp4", durationSec: 120 });
    expect(chuong[0]!.lessons[0]!.videoKey).toBe("v/1.mp4");
    expect(chuong[0]!.lessons[0]!.durationSec).toBe(120);
    expect(kiemDanBai(chuong).loi.map((l) => l.code)).not.toContain("BAI_VIDEO_CHUA_CO_NGUON");
  });

  it("bài YouTube đã có link + thời lượng ⇒ cổng KHÔNG nổ", async () => {
    expect(await maCong({ youtubeId: "aBcDeFgHiJk", durationSec: 19 })).not.toContain("BAI_VIDEO_CHUA_CO_NGUON");
  });

  it("bài video CHƯA có nguồn ⇒ cổng nổ đúng (vế còn lại — cổng câm tệ hơn lỗi ban đầu)", async () => {
    expect(await maCong({ durationSec: 120 })).toContain("BAI_VIDEO_CHUA_CO_NGUON");
  });

  it("bài video có nguồn mà CHƯA có thời lượng ⇒ cổng nổ", async () => {
    expect(await maCong({ videoKey: "v/1.mp4", durationSec: null })).toContain("BAI_VIDEO_CHUA_CO_NGUON");
  });
});

describe("khoá chỉ có bài ĐỌC vẫn xuất bản được", () => {
  it("không sinh lỗi cột nối nào", async () => {
    const kq = kiemDanBai(await danBai({}));
    expect(kq.loi.map((l) => l.code)).not.toContain("BAI_THI_CHUA_CO_DE");
    expect(kq.loi.map((l) => l.code)).not.toContain("BAI_TAP_CHUA_CO_KHUNG");
  });
});
