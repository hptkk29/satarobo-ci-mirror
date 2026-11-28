// @vitest-environment node
/**
 * EL-10 — bất biến của đường tải video nhiều phần.
 *
 * Đường này tốn tiền (băng thông + lưu trữ) và nhận đầu vào từ trình duyệt, nên
 * mọi thứ canh ở đây đều là "chỗ nào có thể bị lạm dụng hoặc hỏng im lặng".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ROUTE = readFileSync(
  join(ROOT, "app/api/elearning/media/upload/route.ts"),
  "utf8",
);

const chiMa = ROUTE.split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("bốn bước của giao thức, không thiếu bước HUỶ", () => {
  it("có đủ tạo · ký phần · hoàn tất · huỷ", () => {
    // Thiếu `Abort` thì mỗi lượt tải dở để lại các phần đã tải trên R2 vĩnh viễn
    // — tính tiền, và không có gì dọn.
    for (const c of [
      "CreateMultipartUploadCommand",
      "UploadPartCommand",
      "CompleteMultipartUploadCommand",
      "AbortMultipartUploadCommand",
    ]) {
      expect(chiMa, c).toContain(c);
    }
  });
});

describe("gác quyền và chống lạm dụng", () => {
  it("đòi đăng nhập và đòi quyền soạn nội dung", () => {
    expect(ROUTE).toContain("UNAUTHENTICATED");
    expect(ROUTE).toContain('can(actor, "elearning:content:author")');
  });

  it("có giới hạn tần suất — đây là đường tốn tiền", () => {
    expect(chiMa).toContain("rateLimit(");
    expect(ROUTE).toContain("RATE_LIMITED");
  });

  it("khoá theo NGƯỜI DÙNG, không theo IP", () => {
    // Cả văn phòng đi chung một IP; khoá theo IP là một người tải nhiều làm cả
    // phòng không tải được.
    expect(ROUTE).toContain("el-media-upload:${session.user.id}");
  });
});

describe("kiểm chuẩn nộp TRƯỚC khi mở lượt tải", () => {
  it("gọi `kiemChuanNopVideo` ở bước tạo", () => {
    // Mở lượt tải rồi mới từ chối nghĩa là tệp 200MB đã đi hết đường truyền của
    // người soạn trước khi họ biết nó không hợp lệ.
    expect(ROUTE).toContain("kiemChuanNopVideo");
  });

  it("nói rõ rằng đây CHƯA phải xác minh thật", () => {
    // Con số trình duyệt khai không phải bằng chứng; hiểu nhầm chỗ này là bỏ hẳn
    // bước đọc header mp4.
    expect(ROUTE).toContain("mp4-probe");
    expect(ROUTE).toContain("canXacMinh");
  });
});

describe("ghép phần đi qua hàm đã test, không ghép tại chỗ", () => {
  it("gọi `ghepPhan` trước khi Complete", () => {
    // Gửi phần sai thứ tự hoặc thiếu một phần ở giữa thì R2 vẫn ghép và trả về
    // một mp4 hợp lệ về cấu trúc nhưng hỏng nội dung — không lỗi nào nổ ra.
    expect(chiMa).toContain("ghepPhan(");
    const iGhep = chiMa.indexOf("ghepPhan(");
    const iComplete = chiMa.indexOf("CompleteMultipartUploadCommand({");
    expect(iGhep).toBeGreaterThan(0);
    expect(iComplete).toBeGreaterThan(iGhep);
  });

  it("dùng `chiaPhan` và `hanLinkKy`, không chôn con số trong route", () => {
    expect(chiMa).toContain("chiaPhan(");
    expect(chiMa).toContain("hanLinkKy(");
    // Đường SCORM hardcode 3600s và bỏ qua setting tương ứng — đừng lặp lại.
    expect(chiMa).not.toMatch(/expiresIn:\s*\d+/);
  });
});

describe("khoá tệp dựng bằng hàm chung", () => {
  it("gọi `khoaMedia`, không ghép chuỗi tại chỗ", () => {
    // Khoá ghép tay ở nhiều nơi là nhiều dạng khoá khác nhau, và luật vòng đời
    // theo tiền tố sẽ bỏ sót đúng những tệp ghép sai.
    expect(chiMa).toContain("khoaMedia(");
    expect(chiMa).not.toMatch(/`elearning\/master\//);
  });

  it("tên tệp gốc KHÔNG đi vào khoá", () => {
    expect(chiMa).not.toContain("input.filename}");
  });
});

describe("cấu hình thiếu KHÔNG rơi về bucket công khai", () => {
  it("dùng `getElearningBucket` và trả 503 khi chưa cấu hình", () => {
    expect(ROUTE).toContain("getElearningBucket");
    expect(ROUTE).toContain("STORAGE_UNCONFIGURED");
    expect(chiMa).not.toContain("getR2Bucket");
  });
});

describe("tuân luật route e-learning", () => {
  it("không `NextResponse.json` trần (luật EL-07/C23)", () => {
    expect(chiMa).not.toContain("NextResponse.json");
    expect(ROUTE).toContain('from "@/lib/api/response"');
  });

  it("mọi nhánh đầu vào đi qua zod `discriminatedUnion`", () => {
    // Nhận thân JSON tuỳ ý rồi tự phân nhánh bằng `if` là để lọt những tổ hợp
    // trường không ai nghĩ tới.
    expect(chiMa).toContain("discriminatedUnion");
    expect(chiMa).toContain("safeParse");
  });
});
