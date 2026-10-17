// @vitest-environment node
/**
 * EL-06 — trang báo cáo R1 + đường xuất Excel.
 *
 * Ba thứ chỉ canh được ở tầng này:
 *   1. thông báo "có lượt học quá hạn" trỏ vào ĐÚNG trang này — thông báo dẫn tới
 *      404 là một cảnh báo thành ngõ cụt, và lần sau người ta không bấm nữa;
 *   2. XEM báo cáo và XUẤT file là hai quyền khác nhau;
 *   3. mẫu số 0 hiện "chưa đo được", không hiện 0%.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TRANG = doc("app/(elearning)/elearning/bao-cao/page.tsx");
const XUAT = doc("app/api/elearning/bao-cao-r1/route.ts");
const NOTIFY = doc("lib/elearning/_handlers/notify.ts");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("thông báo quá hạn phải trỏ tới trang CÓ THẬT", () => {
  it("handler dùng đúng đường dẫn của trang báo cáo", () => {
    expect(NOTIFY).toContain("/elearning/bao-cao");
  });
});

describe("xem và XUẤT là hai quyền khác nhau", () => {
  it("trang gác bằng `progress:view-all`", () => {
    expect(TRANG).toContain('can(actor, "elearning:progress:view-all")');
  });

  it("đường xuất gác RIÊNG bằng `report:export`", () => {
    // Xuất file là mang dữ liệu nhân sự RA KHỎI hệ thống, nơi không còn cách ly
    // cơ sở nào bảo vệ nó nữa.
    expect(XUAT).toContain('can(actor, "elearning:report:export")');
  });

  it("nút Xuất Excel chỉ hiện khi có quyền xuất", () => {
    expect(TRANG).toContain("duocXuat");
    expect(TRANG).toContain('can(actor, "elearning:report:export")');
  });
});

describe("đường xuất là hàng rào IDOR của chính nó", () => {
  it("đọc lượt giao qua `scopedDb`, không `@/lib/db` trần", () => {
    // `assignmentId` đến thẳng từ thanh địa chỉ: người cấp cơ sở không được xuất
    // lượt giao của cơ sở khác.
    expect(XUAT).toContain("scopedDb(actor)");
    expect(chiMa(XUAT)).not.toMatch(/from "@\/lib\/db"/);
  });

  it("không tìm thấy ⇒ 404, không trả file rỗng", () => {
    expect(XUAT).toContain('fail("NOT_FOUND"');
  });
});

describe("xuất file để lại dấu vết", () => {
  it("có watermark và một dòng AuditLog action EXPORT", () => {
    // Một lần xuất là một bản sao dữ liệu nhân sự nằm ngoài hệ thống. Không ghi
    // lại thì về sau không trả lời được "bản này của ai".
    expect(XUAT).toContain("exportWatermark");
    expect(XUAT).toContain('action: "EXPORT"');
  });
});

describe("mẫu số 0 nói rõ CHƯA ĐO ĐƯỢC", () => {
  it("trang không hiện 0% khi chưa có ai để đo", () => {
    // "0% tuân thủ" đọc thành thảm hoạ và sẽ có người đi hỏi tội, còn sự thật là
    // chưa có ai trong mẫu số.
    expect(TRANG).toContain("chưa đo được");
    expect(TRANG).toContain("tong.tyLeDungHan === null");
  });

  it("file Excel cũng vậy, không ghi 0", () => {
    expect(XUAT).toContain("chưa có ai để đo");
  });

  it("trang nói rõ ai bị loại khỏi mẫu số", () => {
    // Không nói thì người đọc thấy "đã giao 10, đúng hạn 8, tỉ lệ 100%" và tưởng
    // báo cáo tính sai.
    expect(TRANG).toContain("Ngoài mẫu số");
  });
});

describe("bảng dài phải phân trang", () => {
  it("bảng người học bọc `PhanTrangBang`", () => {
    expect(TRANG).toContain("PhanTrangBang");
  });
});
