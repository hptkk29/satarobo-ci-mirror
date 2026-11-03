/**
 * LƯỚI GHIM giao diện thân các trang quản trị / báo cáo của khu học tập (đợt "Complete UX redesign").
 *
 * Vì sao cần: một trang chỉ được BỌC bằng thanh bên mới thì không phải là trang đã thiết kế lại. Trang đã làm lại phải
 * dùng khung chung (`TrangQuanTri` = đúng một `<main>`, bề rộng chuẩn) + `PageHeader` (đúng một `h1`) và không còn
 * lớp màu/viền kiểu cũ nằm ngoài bảng token. Test này canh để một trang mới (hoặc một lần sửa) không lặng lẽ quay
 * về khung riêng — chạy không cần DB, không cần trình duyệt.
 *
 * Nó KHÔNG thay cho ảnh chụp: nó chỉ chứng minh cấu trúc, không chứng minh trông đẹp.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const E = "app/(elearning)/elearning/";
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Trang đã làm lại thân (không tính trang đã làm ở đợt trước: tổng quan, khoá của tôi, chứng nhận của tôi, thông báo, đề cương, bài). */
const TRANG = [
  "chuong-trinh/page.tsx",
  "soan-khoa/page.tsx",
  "soan-khoa/[courseId]/page.tsx",
  "soan/[lessonId]/page.tsx",
  "kho-cau-hoi/page.tsx",
  "de-thi/page.tsx",
  "de-thi/[examId]/page.tsx",
  "khung-cham/page.tsx",
  "khung-cham/[rubricId]/page.tsx",
  "giao-bai/page.tsx",
  "cham-bai-tap/page.tsx",
  "cham-bai-tap/[submissionId]/page.tsx",
  "cham-bai/page.tsx",
  "cham-bai/[attemptId]/page.tsx",
  "yeu-cau/page.tsx",
  "tu-dong-hoa/page.tsx",
  "muc-danh-gia/page.tsx",
  "ma-tran/page.tsx",
  "bao-cao/page.tsx",
  "bao-cao/video/page.tsx",
  "bao-cao-r4/page.tsx",
  "bao-cao-r5/page.tsx",
  "bao-cao-r7/page.tsx",
  "chung-nhan/page.tsx",
  "du-lieu-cua-toi/page.tsx",
];

/** Thành phần client của các trang trên — không được còn lớp màu thô / viền kiểu cũ. */
const THANH_PHAN = [
  "chuong-trinh/_components/program-panel.tsx",
  "soan-khoa/_components/outline-editor.tsx",
  "soan-khoa/_components/equivalence-panel.tsx",
  "soan/_components/lesson-editor.tsx",
  "soan/_components/quiz-lesson-editor.tsx",
  "soan/_components/task-lesson-editor.tsx",
  "soan/_components/attendance-panel.tsx",
  "soan/_components/cue-editor.tsx",
  "kho-cau-hoi/_components/bank-list.tsx",
  "kho-cau-hoi/_components/question-form.tsx",
  "de-thi/_components/exam-builder.tsx",
  "de-thi/_components/new-exam-form.tsx",
  "de-thi/_components/unlock-panel.tsx",
  "khung-cham/_components/rubric-builder.tsx",
  "khung-cham/_components/new-rubric-form.tsx",
  "giao-bai/_components/assign-wizard.tsx",
  "giao-bai/_components/assignment-list.tsx",
  "cham-bai/_components/grading-form.tsx",
  "cham-bai-tap/_components/task-grading-form.tsx",
  "yeu-cau/_components/requirement-form.tsx",
  "yeu-cau/_components/close-button.tsx",
  "tu-dong-hoa/_components/rule-form.tsx",
  "tu-dong-hoa/_components/path-form.tsx",
  "tu-dong-hoa/_components/rule-toggle.tsx",
  "muc-danh-gia/_components/eval-link-form.tsx",
  "chung-nhan/_components/issue-button.tsx",
  "chung-nhan/_components/revoke-button.tsx",
  "bao-cao/video/_components/decide-flag.tsx",
  "du-lieu-cua-toi/_components/accept-policy-button.tsx",
  "du-lieu-cua-toi/_components/appeal-flag.tsx",
  "hoc/_components/exam-runner.tsx",
  "hoc/_components/task-submitter.tsx",
];

const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");

// Lớp màu/viền KIỂU CŨ đã bị thay bằng token (`state-*`, `border-border`, `bg-card`).
const CU = /(text|bg|border)-(red|amber|emerald|rose|green|yellow|orange|blue)-\d{2,3}\b|rounded-md border (p|px)-\d|"w-full rounded-md border px-2 py-1/;

describe("[TQT] thân trang quản trị dùng khung chung", () => {
  it.each(TRANG)("[TQT-01] %s dùng TrangQuanTri + PageHeader", (f) => {
    const s = chiMa(doc(E + f));
    // Đếm THẺ JSX, không đếm chữ: dòng `import` cũng chứa chữ "TrangQuanTri" nên gỡ hẳn lời dùng mà quên gỡ import thì
    // kiểm "có chứa chữ" vẫn xanh (đã cấy thử: 0 ca đỏ).
    const mo = (s.match(/<TrangQuanTri[\s>]/g) ?? []).length;
    const dong = (s.match(/<\/TrangQuanTri>/g) ?? []).length;
    expect(mo, "<TrangQuanTri>").toBeGreaterThan(0);
    expect(dong, "đóng/mở TrangQuanTri khớp nhau").toBe(mo);
    expect(s, "<PageHeader />").toMatch(/<PageHeader[\s/>]/);
  });

  it.each(TRANG)("[TQT-02] %s KHÔNG tự dựng <main> hay khung bề rộng riêng", (f) => {
    const s = chiMa(doc(E + f));
    expect(s).not.toContain("<main");
    expect(s).not.toMatch(/className="mx-auto (w-full )?max-w-/);
  });

  it.each([...TRANG, ...THANH_PHAN])("[TQT-03] %s không còn màu thô / viền kiểu cũ", (f) => {
    const s = chiMa(doc(E + f));
    expect(CU.test(s), `lớp cũ trong ${f}: ${s.match(CU)?.[0]}`).toBe(false);
  });

  it.each(TRANG)("[TQT-04] %s: trạng thái KHÔNG CÓ QUYỀN nói thiếu quyền nào (NoPermission) thay vì 403 trần", (f) => {
    const s = chiMa(doc(E + f));
    // Mọi trang này đều có cổng `can()`; nơi trả màn từ chối phải dùng NoPermission.
    // Ngoại lệ có chủ đích: Chương trình mở cho MỌI người học gửi đề nghị (`can()` chỉ chia khối quản lý), nên không có màn từ chối.
    if (f === "chuong-trinh/page.tsx") return;
    if (/can\(actor|loaiQuyenBaoCao/.test(s)) expect(s).toMatch(/<NoPermission[\s/>]/);
  });

  it("[TQT-05] bảng trong các trang này đều bọc PhanTrangBang (không đổ hết ra một trang)", () => {
    for (const f of TRANG) {
      const s = doc(E + f);
      if (s.includes("<table")) expect(s, f).toContain("<PhanTrangBang");
    }
  });
});

describe("[TQT] bộ chọn số dòng nói đúng trạng thái", () => {
  it.each(TRANG)("[TQT-07] %s: soDongMacDinh nằm trong các mức chọn được (10/20/50/100)", (f) => {
    // Mặc định ngoài danh sách (vd 25) làm ô "Hiển thị" báo 10 trong khi bảng vẽ 25 dòng — điều khiển nói sai trạng thái (luật 12).
    for (const m of doc(E + f).matchAll(/soDongMacDinh=\{(\d+)\}/g)) expect([10, 20, 50, 100], `${f}: ${m[1]}`).toContain(Number(m[1]));
  });
});

describe("[TQT] chọn NGƯỜI bằng danh sách, không bằng mã thô", () => {
  it.each(["chuong-trinh/_components/program-panel.tsx", "muc-danh-gia/_components/eval-link-form.tsx"])(
    "[TQT-08] %s dùng ChonNhanSu, không còn ô nhập userId",
    (f) => {
      const s = chiMa(doc(E + f));
      expect(s).toMatch(/<ChonNhanSu[\s>]/);
      // Ô gõ mã người là nơi gõ sai im lặng (mã lạ vẫn qua kiểm "không rỗng"); nhãn/placeholder nhắc `userId` là dấu hiệu quay lại.
      expect(s).not.toMatch(/\(userId\)|userId của|Mã người của/);
    },
  );
  it("[TQT-09] danh sách nhân sự nạp qua scopedDb của người xem, không qua `db` trần", () => {
    const s = chiMa(doc("lib/elearning/nhan-su-chon.ts"));
    expect(s).toContain("db: ScopedDb");
    expect(s).not.toMatch(/from "@\/lib\/db"/);
    for (const f of ["chuong-trinh/page.tsx", "muc-danh-gia/page.tsx"]) {
      expect(chiMa(doc(E + f)), f).toContain("napNhanSuChon(db)");
    }
    // chỉ NẠP khi có quyền lập chương trình — người chỉ gửi đề nghị không bị truy vấn danh sách nhân sự
    expect(chiMa(doc(E + "chuong-trinh/page.tsx"))).toMatch(/quanLy\s*\?\s*await napNhanSuChon\(db\)/);
  });
});

describe("[TQT] bảng token dùng chung tồn tại và đủ", () => {
  it("[TQT-06] điều khiển biểu mẫu dùng ô cao ≥ 40px và có vòng tiêu điểm", () => {
    const s = doc(E + "_components/ui/dieu-khien.ts");
    expect(s).toContain("h-10");
    expect(s).toContain("focus-visible:ring-2");
    expect(s).toContain("NUT_NGUY");
  });
});
