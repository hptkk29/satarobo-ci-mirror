// @vitest-environment node
/**
 * EL-08 — màn soạn khoá + màn chương trình.
 *
 * Đây là hai màn mà cổng nghiệm thu GĐ1 bấm giờ: *"Trưởng phòng Đào tạo tự tạo
 * trọn một khoá đầu-cuối trong ≤60 phút, 0 lần nhờ lập trình viên"*. Mỗi case
 * dưới đây canh một thứ mà nếu thiếu, người soạn sẽ phải đi hỏi ai đó.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SOAN = doc("app/(elearning)/elearning/soan-khoa/_components/outline-editor.tsx");
const TRANG_SOAN = doc("app/(elearning)/elearning/soan-khoa/[courseId]/page.tsx");
const TRANG_CT = doc("app/(elearning)/elearning/chuong-trinh/page.tsx");
const PANEL = doc("app/(elearning)/elearning/chuong-trinh/_components/program-panel.tsx");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("kéo thả phải có đường đi bằng BÀN PHÍM", () => {
  it("mỗi mục có nút Lên/Xuống, không chỉ kéo thả", () => {
    // Kéo thả không dùng được bằng bàn phím, và trên màn cảm ứng nó hay trượt.
    // Hai nút này là đường CHÍNH cho người dùng bàn phím, không phải dự phòng.
    expect(SOAN).toContain("Đưa chương lên trên");
    expect(SOAN).toContain("Đưa bài xuống dưới");
  });

  it("nút có nhãn cho trình đọc màn hình, không chỉ mũi tên", () => {
    // Một nút chỉ có "↑" thì trình đọc màn hình đọc ra "mũi tên lên" — không nói
    // được nó làm gì.
    expect(SOAN).toContain("aria-label={props.nhan}");
  });

  it("KHÔNG thêm thư viện kéo thả mới", () => {
    // Luật repo: không tự thêm thư viện UI. Dùng HTML5 drag-and-drop có sẵn.
    for (const lib of ["dnd-kit", "react-beautiful-dnd", "react-dnd", "sortablejs"]) {
      expect(chiMa(SOAN), lib).not.toContain(lib);
    }
    expect(SOAN).toContain("onDragStart");
    expect(SOAN).toContain("onDrop");
  });
});

describe("lỗi dàn bài hiện NGAY, không đợi bấm", () => {
  it("màn soạn nhận và hiện danh sách lỗi", () => {
    // Biết trước còn thiếu gì thì sửa một lượt; biết sau khi bấm thì đi qua từng
    // vòng một.
    expect(SOAN).toContain("loiDanBai");
    expect(SOAN).toContain("Còn {props.loiDanBai.length} việc phải làm");
  });

  it("nút Gửi duyệt bị khoá khi dàn bài còn lỗi", () => {
    expect(SOAN).toContain("props.loiDanBai.length > 0");
  });

  it("trang tính lỗi ở máy chủ, không để client tự đoán", () => {
    expect(TRANG_SOAN).toContain("docDanBaiChoMan");
  });

  it("bài ĐỌC chưa có nội dung được đánh dấu ngay trên dòng", () => {
    expect(SOAN).toContain("chưa có nội dung");
  });
});

describe("vòng đời: bốn bước riêng, không gộp", () => {
  it("có đủ Gửi duyệt · Duyệt · Xuất bản · Lưu trữ · Trả lại", () => {
    for (const hd of ["GUI_DUYET", "DUYET", "XUAT_BAN", "LUU_TRU", "TRA_LAI"]) {
      expect(chiMa(SOAN), hd).toContain(hd);
    }
  });

  it("nút chỉ hiện khi trạng thái cho phép", () => {
    // Hiện hết mọi nút rồi báo lỗi khi bấm là bắt người dùng học máy trạng thái
    // bằng cách thử.
    expect(SOAN).toContain("banDaDuyet");
    expect(SOAN).toContain("banDaPhat");
    expect(SOAN).toContain("hien={Boolean(");
  });

  it("nói rõ bản đã xuất bản không kéo về nháp được", () => {
    expect(SOAN).toContain("không kéo về nháp được");
  });

  it("mọi thao tác vòng đời đòi ghi chú thay đổi", () => {
    expect(SOAN).toContain("Ghi chú thay đổi (bắt buộc)");
    expect(SOAN).toContain("!lyDo.trim()");
  });
});

describe("màn chương trình — sáu nhóm thẻ và luật §8.1", () => {
  it("đủ sáu nhóm thẻ phân loại", () => {
    for (const t of [
      "primaryFunctionTag",
      "levelTags",
      "stageTag",
      "durationTag",
      "natureTag",
      "formatTag",
      "securityTag",
    ]) {
      expect(PANEL, t).toContain(t);
    }
  });

  it("chỉ cho chọn phiếu ĐÃ DUYỆT", () => {
    expect(TRANG_CT).toContain('p.status === "APPROVED"');
    expect(PANEL).toContain("Chỉ hiện phiếu ĐÃ DUYỆT");
  });

  it("không chọn phiếu ⇒ hiện ô lý do miễn", () => {
    // Đây là đường thoát duy nhất của §8.1; giấu nó đi thì người dùng kẹt ở một
    // lỗi không có cách sửa trên màn hình.
    expect(PANEL).toContain("Lý do miễn phiếu");
    expect(PANEL).toContain("{!f.needId &&");
  });

  it("khoá tuân thủ mới hiện ô số tháng hiệu lực", () => {
    expect(PANEL).toContain('f.natureTag === "MANDATORY_COMPLIANCE"');
  });

  it("chọn chức năng chính thì tự thêm vào tập chức năng", () => {
    // Máy chủ chặn nếu lệch. Bắt người dùng tự nhớ tick thêm một ô là tạo ra một
    // lỗi chỉ hiện sau khi bấm Lưu.
    expect(PANEL).toContain("f.functionTags.includes(v)");
  });

  it("tạo khoá xong nhảy thẳng sang màn soạn", () => {
    // Cổng nghiệm thu đo bằng đồng hồ — bắt người soạn tự đi tìm khoá vừa tạo là
    // bỏ thời gian vào chỗ không tạo ra gì.
    expect(PANEL).toContain("/elearning/soan-khoa/");
  });
});

describe("gác quyền và cách ly", () => {
  it("màn soạn gác `content:author`", () => {
    expect(TRANG_SOAN).toContain('can(actor, "elearning:content:author")');
  });

  it("lập chương trình chỉ hiện với `program:manage`", () => {
    expect(TRANG_CT).toContain('can(actor, "elearning:program:manage")');
    expect(PANEL).toContain("props.quanLy");
  });

  it("cả hai trang đi qua `scopedDb`, không `@/lib/db` trần", () => {
    for (const [ten, src] of [
      ["soạn khoá", TRANG_SOAN],
      ["chương trình", TRANG_CT],
    ] as const) {
      expect(src, ten).toContain("scopedDb(actor)");
      expect(chiMa(src), ten).not.toMatch(/from "@\/lib\/db"/);
    }
  });
});
