// @vitest-environment node
/**
 * EL-04 — hàm thuần đo tiến độ bài đọc.
 *
 * Mọi case ở đây là case BIÊN hoặc case CHỐNG GIAN. Phần "chạy đúng ở giữa" không
 * cần test: nó không bao giờ sai. Chỗ sai là 89 vs 90, 29 vs 30, và một client
 * sửa đổi gửi 99999.
 */
import { describe, it, expect } from "vitest";
import {
  computeMinReadSeconds,
  capReadSeconds,
  isLessonDone,
  mergeSnapshot,
  MIN_READ_FLOOR,
  MIN_READ_CEIL,
  demoteH1,
} from "./reading";

const tu = (n: number) => Array.from({ length: n }, (_, i) => `tu${i}`).join(" ");

describe("computeMinReadSeconds", () => {
  it("bài ngắn ăn SÀN 30 giây", () => {
    expect(computeMinReadSeconds(tu(40))).toBe(MIN_READ_FLOOR);
  });

  it("sàn 30 BIND CHO MỌI bài ≤ 200 từ, không riêng bài dưới 60 từ", () => {
    // Đây là chỗ hiểu ví dụ thành luật. Viết `if (soTu < 60) return 30` thì bài
    // 100 từ ra 15 giây — THẤP HƠN CẢ SÀN, và không ai nhận ra vì nó vẫn "có ngưỡng".
    expect(computeMinReadSeconds(tu(100))).toBe(30);
    expect(computeMinReadSeconds(tu(199))).toBe(30);
    expect(computeMinReadSeconds(tu(200))).toBe(30);
    expect(computeMinReadSeconds(tu(201))).toBeGreaterThan(30);
  });

  it("bài vừa: 400 từ → 60 giây", () => {
    expect(computeMinReadSeconds(tu(400))).toBe(60);
  });

  it("bài rất dài ăn TRẦN 600 giây", () => {
    expect(computeMinReadSeconds(tu(6000))).toBe(MIN_READ_CEIL);
    expect(computeMinReadSeconds(tu(60000))).toBe(MIN_READ_CEIL);
  });

  it("KHÔNG đếm URL của ảnh/link là từ", () => {
    // Bài toàn ảnh mà ăn ngưỡng cao thì người đọc phải ngồi chờ trước một trang
    // chẳng có chữ nào — và họ sẽ mở tab khác, tức cơ chế đo tự phá chính nó.
    const toanAnh = Array.from(
      { length: 50 },
      (_, i) => `![](https://cdn.satarobo.vn/rat/dai/duong/dan/anh-${i}.png)`,
    ).join("\n");
    expect(computeMinReadSeconds(toanAnh)).toBe(MIN_READ_FLOOR);
  });

  it("link giữ phần CHỮ, bỏ phần URL", () => {
    const a = computeMinReadSeconds("[nhấn vào đây](https://rat-dai.example.com/x/y/z)");
    const b = computeMinReadSeconds("nhấn vào đây");
    expect(a).toBe(b);
  });

  it("khối mã không tính là nội dung đọc", () => {
    const co = "```\n" + tu(500) + "\n```";
    expect(computeMinReadSeconds(co)).toBe(MIN_READ_FLOOR);
  });
});

describe("capReadSeconds — chặn client bơm số", () => {
  it("client báo 99999 ⇒ cắt về db + 20", () => {
    expect(capReadSeconds({ client: 99999, db: 100 })).toBe(120);
  });

  it("nhịp bình thường đi qua nguyên vẹn", () => {
    expect(capReadSeconds({ client: 115, db: 100 })).toBe(115);
  });

  it("ĐƠN ĐIỆU: client báo thấp hơn DB ⇒ giữ giá trị DB", () => {
    // Tab thứ hai mở sau sẽ báo số nhỏ. Ghi đè thẳng là để thanh tiến độ chạy LÙI.
    expect(capReadSeconds({ client: 15, db: 100 })).toBe(100);
  });

  it("số âm không kéo tiến độ xuống", () => {
    expect(capReadSeconds({ client: -500, db: 100 })).toBe(100);
  });

  it("biên rộng hơn một nhịp — nhịp trễ mạng không bị cắt oan", () => {
    // Nhịp 15 giây; nếu biên đúng bằng 15 thì một nhịp tới trễ gộp hai chu kỳ sẽ
    // bị cắt, và tiến độ tụt dần so với thời gian thật.
    expect(capReadSeconds({ client: 118, db: 100 })).toBe(118);
  });
});

describe("isLessonDone — VÀ, không phải HOẶC", () => {
  const nen = { minReadSeconds: 30 };

  it("đủ giờ nhưng cuộn 89% ⇒ CHƯA xong", () => {
    expect(isLessonDone({ ...nen, readSeconds: 300, scrollMaxPct: 89 })).toBe(false);
  });

  it("đủ giờ và cuộn đúng 90% ⇒ xong", () => {
    expect(isLessonDone({ ...nen, readSeconds: 30, scrollMaxPct: 90 })).toBe(true);
  });

  it("cuộn hết nhưng mới 29 giây ⇒ CHƯA xong", () => {
    expect(isLessonDone({ ...nen, readSeconds: 29, scrollMaxPct: 100 })).toBe(false);
  });

  it("đúng 30 giây, đúng 90% ⇒ xong (biên là >=, không phải >)", () => {
    expect(isLessonDone({ ...nen, readSeconds: 30, scrollMaxPct: 90 })).toBe(true);
  });

  it("31 giây / 91% ⇒ xong", () => {
    expect(isLessonDone({ ...nen, readSeconds: 31, scrollMaxPct: 91 })).toBe(true);
  });
});

describe("mergeSnapshot — hai tab không làm tiến độ chạy lùi", () => {
  it("tab mở sau báo số nhỏ ⇒ giữ số lớn", () => {
    expect(
      mergeSnapshot({ readSeconds: 100, scrollMaxPct: 80 }, { readSeconds: 15, scrollMaxPct: 5 }),
    ).toEqual({ readSeconds: 100, scrollMaxPct: 80 });
  });

  it("số mới lớn hơn thì nhận", () => {
    expect(
      mergeSnapshot({ readSeconds: 100, scrollMaxPct: 80 }, { readSeconds: 130, scrollMaxPct: 95 }),
    ).toEqual({ readSeconds: 130, scrollMaxPct: 95 });
  });

  it("scrollMaxPct kẹp trần 100 — client báo 250 không thành 250", () => {
    expect(
      mergeSnapshot({ readSeconds: 0, scrollMaxPct: 0 }, { readSeconds: 0, scrollMaxPct: 250 })
        .scrollMaxPct,
    ).toBe(100);
  });

  it("scrollMaxPct âm không kéo xuống dưới 0", () => {
    expect(
      mergeSnapshot({ readSeconds: 0, scrollMaxPct: 40 }, { readSeconds: 0, scrollMaxPct: -30 })
        .scrollMaxPct,
    ).toBe(40);
  });
});

describe("demoteH1 — chống mất nội dung câm ở renderer chung", () => {
  it("hạ # thành ## để không bị `h1: () => null` nuốt", () => {
    // Người soạn gõ `# Phần 1`, renderer chung trả về RỖNG, và không có thông báo
    // nào giải thích. Đây là mất nội dung câm, không phải lỗi trình bày.
    expect(demoteH1("# Phần 1\nnội dung")).toBe("## Phần 1\nnội dung");
  });

  it("không đụng ## và ###", () => {
    expect(demoteH1("## Đã là cấp 2\n### cấp 3")).toBe("## Đã là cấp 2\n### cấp 3");
  });

  it("KHÔNG đụng `#` trong khối mã", () => {
    // `# cài đặt` trong ví dụ shell là chú thích, không phải tiêu đề. Hạ cấp nó là
    // sửa nội dung người ta viết.
    const md = "# Tiêu đề\n\n```bash\n# cài đặt\npnpm i\n```";
    const r = demoteH1(md);
    expect(r).toContain("## Tiêu đề");
    expect(r).toContain("# cài đặt");
    expect(r).not.toContain("## cài đặt");
  });

  it("không đụng `#` giữa dòng (thẻ hashtag)", () => {
    expect(demoteH1("xem thêm #robotics")).toBe("xem thêm #robotics");
  });
});
