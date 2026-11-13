// @vitest-environment node
/**
 * EL-15b — màn dựng khung chấm.
 *
 * Khung chấm là THƯỚC ĐO của một bài thực hành đi vào hồ sơ nhân sự. Hai thứ phải
 * giữ ở tầng màn hình: đừng bày nút sửa cho một khung đã đóng băng, và đừng để
 * người soạn dựng xong một khung rồi không biết nó đi đâu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LOAI_BAI_DA_MO,
  LOAI_BAI_CHUA_MO,
} from "@/lib/elearning/lesson-kind";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DS = doc("app/(elearning)/elearning/khung-cham/page.tsx");
const MOT = doc("app/(elearning)/elearning/khung-cham/[rubricId]/page.tsx");
const FORM = doc("app/(elearning)/elearning/khung-cham/_components/new-rubric-form.tsx");
const BUILDER = doc(
  "app/(elearning)/elearning/khung-cham/_components/rubric-builder.tsx",
);
const ACTIONS = doc("app/(elearning)/elearning/khung-cham/_actions.ts");
const CHUONG_TRINH = doc("app/(elearning)/elearning/chuong-trinh/page.tsx");

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("gác cửa", () => {
  it("cả hai trang gọi `elearning:content:author`", () => {
    for (const [ten, src] of [
      ["danh sách", DS],
      ["một khung", MOT],
    ] as const) {
      expect(chiMa(src), ten).toContain('can(actor, "elearning:content:author")');
    }
  });

  it("kích hoạt gác bằng quyền XUẤT BẢN, không phải quyền soạn", () => {
    expect(chiMa(MOT)).toContain('can(actor, "elearning:content:publish")');
  });

  it("đọc qua `scopedDb` — không `db` trần", () => {
    for (const src of [DS, MOT]) {
      expect(chiMa(src)).toContain("scopedDb(actor)");
      expect(chiMa(src)).not.toMatch(/from "@\/lib\/db"/);
    }
  });

  it("🔴 KHÔNG đẻ khoá quyền thứ 18", () => {
    // Module chốt đúng 17 khoá. Một khoá mới phải qua `seed-prod-roles.yml` và ma
    // trận vai — đẻ thêm ở đây là dựng một quyền không ai được cấp.
    const khoa = [...chiMa(DS + MOT + ACTIONS).matchAll(/"(elearning:[a-z-]+:[a-z-]+)"/g)]
      .map((m) => m[1]!)
      .filter((k) => !k.startsWith("elearning:content:"));
    expect(khoa).toEqual([]);
  });
});

describe("🔴 khung ĐÃ KÍCH HOẠT thì chỉ đọc", () => {
  it("màn dựng khoá theo `status`, không theo 'đã chấm bài nào chưa'", () => {
    // Đợi tới bài đầu tiên mới khoá nghĩa là người soạn sửa được khung trong khoảng
    // giữa lúc phát cho người học và lúc người đầu tiên nộp — hai người cùng nộp
    // một bài bị chấm bằng hai thước.
    expect(chiMa(BUILDER)).toContain('props.status !== "DRAFT"');
  });

  it("không bày nút thêm/sửa/xoá khi đã khoá", () => {
    // Bày nút rồi để server từ chối là bắt người ta thao tác một vòng vô ích, và
    // dạy họ rằng thông báo lỗi là chuyện bình thường.
    expect(chiMa(BUILDER)).toContain("!khoa ?");
  });

  it("và nói VÌ SAO khoá, không chỉ khoá suông", () => {
    // Bắt một mẩu NGẮN: JSX ngắt dòng theo độ rộng, nên canh nguyên câu là dựng một
    // guard tự vỡ mỗi lần chạy prettier (quy ước 19).
    expect(BUILDER).toContain("làm lệch điểm");
  });
});

describe("nói TRƯỚC thay vì để server từ chối", () => {
  it("hiện tổng điểm tiêu chí so với thang, kèm LỆCH BAO NHIÊU", () => {
    // "Không khớp" bắt người soạn tự đi đếm tay từng tiêu chí.
    expect(chiMa(BUILDER)).toContain("Math.abs(tongDiem - props.totalPoints)");
  });

  it("chặn lưu khi mức không tăng dần, và nói rõ", () => {
    expect(chiMa(BUILDER)).toContain("tangDan");
    expect(BUILDER).toContain("tăng dần");
  });

  it("chặn lưu khi tiêu chí chỉ có một mức", () => {
    // Một mức là điểm cộng vô điều kiện: bài nào cũng được, và thang điểm nói dối.
    expect(chiMa(BUILDER)).toContain("duMuc");
  });

  it("form tạo khung chặn ngưỡng vượt thang ngay trên màn", () => {
    expect(chiMa(FORM)).toContain("nguongVuot");
  });

  it("🔴 nhãn nói rõ ngưỡng nhập bằng ĐIỂM, không phải %", () => {
    // Ô ghi "%" mà cột lưu số tuyệt đối là cách chắc chắn để một ngày có người nhập
    // 80 với ý "80%" trên thang 50.
    expect(FORM).toContain("không phải %");
  });

  it("người không có quyền xuất bản được NÓI ai bấm được", () => {
    // Ẩn nút mà không giải thích là để người soạn tưởng hệ thống hỏng.
    expect(BUILDER).toContain("nhờ người có quyền xuất bản");
  });
});

describe("🔴 đọc `levelsJson` qua Zod, không ép kiểu", () => {
  it("trang dựng parse bằng `dsMucSchema`", () => {
    // Cột khai `Json` nên TypeScript không nối bên GHI với bên ĐỌC — đúng chỗ chuỗi
    // đã đứt hai lần ở EL-14.
    expect(chiMa(MOT)).toContain("dsMucSchema.safeParse");
  });

  it("tiêu chí không đọc được ⇒ nói ra, không hiện ô trống trông như lỗi tải", () => {
    expect(MOT).toContain("không đọc được các mức");
  });
});

describe("màn mới phải có LỐI VÀO, và cửa chưa mở phải nói rõ", () => {
  it("màn chương trình dẫn tới khung chấm", () => {
    // Khu e-learning không có thanh điều hướng chung: trang không được trang nào
    // dẫn tới thì chỉ người viết nó biết đường.
    expect(chiMa(CHUONG_TRINH)).toContain('href="/elearning/khung-cham"');
  });

  it("danh sách khung có đường quay lại", () => {
    expect(chiMa(DS)).toContain('href="/elearning/chuong-trinh"');
    expect(chiMa(MOT)).toContain('href="/elearning/khung-cham"');
  });

  it("🔴 KHÔNG còn câu 'bài tập chấm tay chưa mở' — nó đã mở", () => {
    // Câu cảnh báo đó đúng ở PR trước và SAI ở PR này. Để nguyên là nói dối người
    // soạn theo chiều ngược lại: họ dựng khung xong rồi không đi gắn vào bài.
    expect(DS).not.toContain("chưa mở");
    // …và thay bằng câu chỉ đúng bước tiếp.
    expect(DS).toContain("Bài tập");
  });

  it("loại bài `TASK` nay ĐÃ MỞ — cùng PR có đủ nộp, chấm và bù hạn", () => {
    // Kiểm trên GIÁ TRỊ THẬT, không grep mã nguồn: một biểu thức chính quy soi chữ
    // sẽ xanh cả khi ai đó thêm `TASK` bằng một cách viết khác.
    expect(LOAI_BAI_DA_MO as readonly string[]).toContain("TASK");
    expect(LOAI_BAI_CHUA_MO.TASK).toBeUndefined();
  });
});
