// @vitest-environment node
/**
 * EL-05 — trình giao bài 4 bước.
 *
 * Luật 5 và luật 6 của §10.2 sống ở TẦNG GIAO DIỆN, không ở máy chủ: máy chủ đã
 * trả đủ tên rồi, nhưng nếu màn hình chỉ hiện con số thì cả hai luật coi như
 * không tồn tại. Nên đây là chỗ duy nhất canh được chúng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const WIZARD = doc("app/(elearning)/elearning/giao-bai/_components/assign-wizard.tsx");
const TRANG = doc("app/(elearning)/elearning/giao-bai/page.tsx");

/** Bỏ bình luận trước khi quét "không được chứa X" — ghi chú đáng giữ. */
const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("luật 5 — xem trước là DANH SÁCH TÊN, không phải con số", () => {
  it("có bảng liệt kê người, không chỉ hiện `tong`", () => {
    expect(WIZARD).toContain("BangNguoi");
    expect(WIZARD).toMatch(/fullName/);
    expect(WIZARD).toMatch(/employeeCode/);
  });

  it("xem trước chạy khi BẤM NÚT, không theo từng phím gõ", () => {
    // Mỗi lượt xem trước ghi một dòng AuditLog (nó đọc danh sách nhân sự theo
    // luật tuỳ ý). Chạy theo `useEffect` là làm ngập sổ audit.
    expect(chiMa(WIZARD)).toContain("onClick={xemTruoc}");
    expect(chiMa(WIZARD)).not.toContain("useEffect");
  });
});

describe("luật 6 — người thiếu cơ sở hiện ĐÍCH DANH", () => {
  it("có khối cảnh báo riêng, liệt kê từng người", () => {
    expect(WIZARD).toContain("KhoiCanhBao");
    expect(WIZARD).toContain("CHƯA CÓ CƠ SỞ");
  });

  it("khối cảnh báo nói việc phải làm, không chỉ nói có lỗi", () => {
    // "Một số nhân sự thiếu cơ sở" buộc người giao bài đi dò từng người và không
    // cho biết ai phải sửa.
    expect(WIZARD).toContain("Nhờ Nhân sự");
  });

  it("sau khi giao xong vẫn nhắc lại tên người chưa nhận được", () => {
    // Người bấm giao thường rời màn ngay. Chỉ báo ở bước xem trước là để lời cảnh
    // báo biến mất đúng lúc nó có ích nhất.
    expect(WIZARD).toContain("chưa có cơ sở nên chưa nhận được");
  });
});

describe("luật 4 — `Chưa khai` loại hợp đồng là MỘT LỰA CHỌN THẬT", () => {
  it("danh sách loại hợp đồng có mục Chưa khai", () => {
    // Prod có 3 người không khai loại hợp đồng. Thiếu mục này thì họ vô hình với
    // mọi luật lọc loại hợp đồng — và người giao bài không biết là đang sót.
    expect(WIZARD).toContain("CHUA_KHAI");
    expect(WIZARD).toContain("Chưa khai");
  });
});

describe("danh mục lấy từ DỮ LIỆU THẬT, không gõ cứng", () => {
  it("chức danh nạp bằng `distinct` trên `Employee.jobTitle`", () => {
    // `jobTitle` là chuỗi tự do: ô nhập tay trên nó là cách chắc chắn nhất để
    // tạo một luật không khớp ai.
    expect(TRANG).toContain('distinct: ["jobTitle"]');
  });

  it("phòng ban và cơ sở cũng nạp từ DB", () => {
    expect(TRANG).toContain("departmentDef.findMany");
    expect(TRANG).toContain("center.findMany");
  });

  it("trang đi qua `scopedDb(actor)`, không `@/lib/db` trần", () => {
    expect(TRANG).toContain("scopedDb(actor)");
    expect(chiMa(TRANG)).not.toMatch(/from "@\/lib\/db"/);
  });
});

describe("gác quyền ở TRANG, không chỉ ở action", () => {
  it("trang kiểm `elearning:assignment:create`", () => {
    // Để trang mở được rồi mới báo lỗi lúc bấm Xác nhận là bắt người ta điền
    // trọn bốn bước mới biết mình không có quyền.
    expect(TRANG).toContain('can(actor, "elearning:assignment:create")');
  });
});

describe("luật rỗng phải là lựa chọn CÓ CHỦ Ý", () => {
  it("không chọn điều kiện nào ⇒ gửi mảng luật RỖNG, không gửi `[{}]`", () => {
    // `[{}]` nghĩa là "mọi nhân sự đang làm việc" — một tập rất rộng, và nó phải
    // đến từ một lựa chọn có chủ ý chứ không phải từ việc quên chọn.
    expect(WIZARD).toContain("Object.keys(l).length ? [l] : []");
  });
});
