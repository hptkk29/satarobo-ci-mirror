// @vitest-environment node
/**
 * EL-10 — bất biến của đường phát media.
 *
 * Route này không test được bằng unit test thường (cần R2 + phiên đăng nhập),
 * nhưng ba thứ quan trọng nhất của nó lại là thứ ĐỌC ĐƯỢC TỪ NGUỒN — và cả ba
 * đều là lỗi đã có thật ở đường phát SCORM đang chạy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ROUTE = doc("app/api/elearning/media/[...khoa]/route.ts");
const SCORM = doc("app/api/scorm/asset/[...path]/route.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("TRUYỀN DÒNG, không nạp tệp vào RAM", () => {
  it("dùng `transformToWebStream`, KHÔNG `transformToByteArray`", () => {
    // Đường SCORM nạp nguyên tệp rồi mới trả. Với gói SCORM vài MB thì chịu được;
    // với video 200MB thì mỗi lượt xem đồng thời ngốn ~2× dung lượng và hàm chết.
    expect(chiMa(ROUTE)).toContain("transformToWebStream");
    expect(chiMa(ROUTE)).not.toContain("transformToByteArray");
  });

  it("không `Buffer.from` trên thân phản hồi", () => {
    expect(chiMa(ROUTE)).not.toContain("Buffer.from");
  });

  it("lỗi này CÓ THẬT ở đường SCORM — canh để không ai chép sang", () => {
    // Nếu ngày nào đó SCORM được vá thì case này đỏ, và đó là lúc xoá nó đi.
    expect(SCORM).toContain("transformToByteArray");
  });
});

describe("cache KHÔNG được sống lâu hơn vé", () => {
  it("route đặt `no-store`", () => {
    // Đường SCORM đặt `private, max-age=3600` trong khi vé sống 600s — tệp còn
    // phát được sau khi vé hết hạn, tức vé mất tác dụng đúng lúc nó cần có.
    expect(ROUTE).toContain('"Cache-Control": "no-store"');
    expect(chiMa(ROUTE)).not.toMatch(/max-age=\d+/);
  });
});

describe("ba hàng rào của đường phát", () => {
  it("đòi đăng nhập", () => {
    expect(ROUTE).toContain("UNAUTHENTICATED");
  });

  it("vé phải khớp CHÍNH tài khoản đang đăng nhập", () => {
    // Không kiểm thì một vé bị chia sẻ cho phép cả phòng xem bằng một lượt cấp.
    expect(ROUTE).toContain("ve.ve.userId !== session.user.id");
  });

  it("khoá tệp phải thuộc bài của vé", () => {
    // Khoá đến thẳng từ đường dẫn — không kiểm là đổi URL để đọc tệp bài khác.
    expect(ROUTE).toContain("khoaThuocBai");
  });
});

describe("cấu hình thiếu KHÔNG rơi về bucket công khai", () => {
  it("bắt lỗi cấu hình và trả 503, không dùng bucket khác", () => {
    expect(ROUTE).toContain("getElearningBucket");
    expect(ROUTE).toContain("STORAGE_UNCONFIGURED");
    expect(chiMa(ROUTE)).not.toContain("getR2Bucket");
    expect(chiMa(ROUTE)).not.toContain("resolveMediaUrl");
  });
});

describe("hỗ trợ Range đúng nghĩa", () => {
  it("khai `Accept-Ranges` và trả 206 khi có Range", () => {
    expect(ROUTE).toContain('"Accept-Ranges": "bytes"');
    expect(ROUTE).toContain("status: 206");
  });

  it("có nhánh 416 kèm `Content-Range`", () => {
    expect(ROUTE).toContain("status: 416");
    expect(ROUTE).toContain("Content-Range");
  });

  it("dùng bộ phân tích Range đã test, không tự tách chuỗi tại chỗ", () => {
    // Số học biên của Range đã có 19 case riêng; viết lại tại chỗ là tạo ra một
    // bản thứ hai không ai canh.
    expect(ROUTE).toContain("docRange");
    expect(ROUTE).toContain("rangeChoR2");
  });

  it("chặn trình duyệt đoán kiểu nội dung", () => {
    // Một tệp lạ được đoán thành HTML là một trang chạy trên chính origin này.
    expect(ROUTE).toContain("X-Content-Type-Options");
  });
});

describe("tuân luật route e-learning", () => {
  it("không `NextResponse.json` trần (luật EL-07/C23)", () => {
    expect(chiMa(ROUTE)).not.toContain("NextResponse.json");
    expect(ROUTE).toContain('from "@/lib/api/response"');
  });

  it("chạy trên runtime nodejs — cần cho luồng byte", () => {
    expect(ROUTE).toContain('runtime = "nodejs"');
  });
});
