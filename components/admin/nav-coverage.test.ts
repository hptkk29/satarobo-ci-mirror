/**
 * MÀN NÀO CŨNG PHẢI CÓ LỐI VÀO — không màn nào chỉ mở được bằng cách gõ URL.
 *
 * Vì sao cần test: rà 11/08/2026 tìm ra **8 màn admin có thật, có gate, có người cần
 * dùng** mà chưa bao giờ có nút bấm tới — trong đó có `/roles` (màn cấu hình vai trò,
 * trung tâm của RBAC v2) và `/compliance` (xoá ẩn danh theo NĐ13). Loại lỗi này không ai
 * phát hiện bằng cách dùng thử, vì người dùng không thể biết cái mình chưa từng thấy.
 * Nó cũng không đau ngay: màn vẫn chạy, chỉ là không ai vào được.
 *
 * Quét TĨNH nên màn thêm sau này cũng bị soi. Cách "sửa" khi test đỏ:
 *   · Màn thật, có người dùng  → thêm mục vào sidebar (hoặc nút bấm ở màn cha).
 *   · Màn dev/thử nghiệm/stub  → khai vào ALLOWLIST bên dưới KÈM LÝ DO.
 * Đừng xoá test.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ADMIN_DIR = path.join(ROOT, "app", "(admin)", "admin");

/** Route được phép không có mục menu — mỗi dòng phải nêu lý do. */
const ALLOWLIST: Record<string, string> = {
  "/hoc-ba":
    "01/10/2026 — chủ dự án gỡ mục menu: học bạ mở từ hồ sơ học viên (khối \"Nhận xét & học " +
    "bạ\", link `/hoc-ba?studentId=…` dạng template nên máy dò không thấy).",
  "/students/sap-het-khoa":
    "01/10/2026 — stub chuyển hướng sang /enrollments?tab=sap-het-khoa (chủ dự án gộp hai màn " +
    "thành hai tab). Giữ route vì thông báo tái tục CŨ trong DB mang href này.",
  "/de-xuat-giao-an":
    "01/10/2026 — stub chuyển hướng sang /curriculums: đề xuất nay xem ở tab Đề xuất của từng " +
    "giáo trình, danh sách giáo trình hiện số đề xuất đang mở. Giữ route để link đã lưu không 404.",
  "/course-prerequisites":
    "01/10/2026 — stub chuyển hướng sang /curriculums: khoá tiên quyết nay cấu hình ở tab Thiết " +
    "lập của giáo trình (cho khoá của giáo trình đó). `_actions.ts` ở đây vẫn là đường ghi.",
  "/teaching-materials":
    "01/10/2026 — chủ dự án gỡ mục menu: tài liệu lớp là việc của giáo viên (site GV có màn " +
    "Tài liệu riêng), admin không cần. Route giữ cho Đào tạo mở bằng URL khi cần tra.",
  "/orders/duyet":
    "25/09/2026 — chủ dự án chốt GỠ mục menu: hàng chờ duyệt nay là một KHỐI ở đầu màn " +
    "/orders (`orders/_components/khoi-cho-duyet.tsx`), hiện ngay khi có đơn chờ. Một mục " +
    "menu riêng chỉ dẫn được người ĐÃ BIẾT mình phải đi duyệt, mà đơn chờ duyệt là đơn " +
    "không xuất được mã QR — tín hiệu phải nằm ở nơi người ta làm việc hằng ngày. Route " +
    "giữ lại vì nó chỉ còn là một cú 307 về /orders?duyet=1, cho bookmark và thói quen gõ tay.",
  "/bao-cao/trial":
    "23/09/2026 — stub chuyển hướng sang /bao-cao/trial-sale (chủ dự án: xoá màn báo cáo " +
    "trial theo cơ sở, lấy màn theo Sale làm màn chính). Giữ đường cũ để link đã lưu không 404.",
  "/dashboard-qlcs":
    "27/08/2026 — chủ dự án chốt GỠ mục menu: bốn khối của màn này nay hiện THẲNG trong " +
    "/dashboard cho Quản lý cơ sở + Quản trị hệ thống (không phân tab), nên hai vai cần " +
    "nó thấy nội dung ngay khi đăng nhập, không phải qua menu. Route giữ lại vì đường dẫn " +
    "cũ đã gửi đi và PAGE_GATES vẫn gác nó. Gỡ hẳn route khi không còn liên kết nào trỏ tới.",
  "/leads/new":
    "03/09 — stub chuyển hướng sang /nhap-khach-hang (chủ dự án chốt: nút \"+ Thêm lead\" " +
    "nay trỏ thẳng sang đó). Biểu mẫu cũ tạo lead bằng `db.lead.create` trần, không qua " +
    "`ingestIntakeLead` nên thiếu chống trùng SĐT và tự chia. Giữ route vì /leads/[id] là " +
    "route động bên cạnh: xoá hẳn thì \"new\" rơi vào [id] và được hiểu là một id lead — " +
    "trang trả 200 rỗng thay vì 404. Cùng lý do với /leads/so-luot.",
  "/leads/so-luot":
    "30/08 — stub chuyển hướng sang /quan-ly-chia-lead. Giữ route vì /leads/[id] là " +
    "route động bên cạnh: xoá hẳn thì đường dẫn cũ rơi vào [id] và đi tra một lead " +
    "có id \"so-luot\".",
  "/leads/cau-hinh-chia": "30/08 — stub chuyển hướng sang /quan-ly-chia-lead. Cùng lý do với /leads/so-luot.",
  "/quan-ly-chia-lead/lich-su":
    "màn con của Quản lý chia lead — vào từ link trong tab Cấu hình pool. Không đặt " +
    "mục sidebar riêng: đây là chỗ tra khi có tranh cãi, không phải việc hằng ngày.",
  "/cham-cong/man-hinh":
    "màn hình QR để MỞ TRÊN TV tại quầy — vào từ nút \"Màn hình QR\" trên Bảng công ngày, href kèm " +
    "centerId động nên máy quét không thấy; không đặt mục sidebar vì đây không phải màn làm việc hằng ngày.",
  "/classes/kiem-tra-lich":
    "24/09/2026 — chủ dự án GỠ nút \"Kiểm tra lịch buổi\" khỏi màn /classes. Màn soát buổi " +
    "lệch ngày khai giảng GIỮ LẠI (nút \"Xếp lại\" dùng chung đường có audit với script " +
    "`scripts/audit-class-sessions.ts`, script in đường dẫn này ra) — vào bằng URL khi cần soát tay.",
  "/charts-test": "màn thử wrapper Recharts, chỉ dev dùng",
  "/design-system-preview": "bảng màu/typography, chỉ dev dùng",
  "/design-system-preview-v2": "bảng màu/typography bản 2, chỉ dev dùng",
  "/r2-test": "màn thử upload R2, chỉ dev dùng",
  "/parent-requests/bao-vang":
    "stub chuyển hướng sang /parent-requests (giữ cho link cũ không vỡ)",
  "/trials":
    "GĐ6 — stub chuyển hướng sang /lop-trial/lich-hen. Màn gộp vào Lớp Trial; route " +
    "GĐ6 — stub chuyển hướng sang /lop-trial. Màn gộp vào Lớp Trial; route " +
    "giữ lại vì thông báo CŨ trong DB mang href \"/trials\" và không sửa hồi tố được, " +
    "còn tài liệu hướng dẫn sinh tự động cũng trỏ tới đó. Gỡ khi đo được là không còn " +
    "thông báo nào trỏ tới, đừng gỡ theo lịch.",
  "/trial-classes":
    "GĐ6 — stub chuyển hướng sang /lop-trial. Cùng lý do với /trials; bản /trial-classes/[id] " +
    "còn giữ nguyên id khi chuyển để thông báo cũ không rơi về danh sách.",
  "/search": "vào bằng ô tìm kiếm trên topbar (<form action=\"/search\">), không phải mục menu",
  "/convert-conflicts":
    "vào từ khối cảnh báo trong form chuyển đổi (`convert-form.tsx`) khi gặp xung đột hồ sơ " +
    "phụ huynh — màn xử-lý-sự-cố, không phải việc hằng ngày, nên KHÔNG lên sidebar. " +
    "⚠️ 24/08/2026: đường dẫn nay truyền qua prop `conflictHref` (site Sale mount lại form " +
    "này và phải KHÔNG có liên kết, vì màn gộp hồ sơ là của khu quản trị). Máy dò của test " +
    "quét chuỗi `href=\"…\"` viết thường nên không thấy `conflictHref=\"…\"` — liên kết VẪN " +
    "hiện cho admin, chỉ là dò không ra. Nếu sau này thấy người dùng không tìm được màn này " +
    "thì chữa bằng mục menu thật, đừng chữa bằng cách nới máy dò.",
  "/thong-bao":
    "CỐ Ý không lên sidebar — ràng buộc cốt lõi của PRD hệ thông báo: chuông ở topbar là điểm " +
    "vào DUY NHẤT, thêm mục menu là phá chính tiền đề đó. Vào từ nút \"Xem tất cả thông báo\" ở " +
    "chân panel chuông. Nếu nghiệm thu cho thấy người dùng không tìm ra trang thì chữa bằng " +
    "onboarding hoặc menu avatar, TUYỆT ĐỐI không bằng cách thêm sidebar.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Route tĩnh của site admin (bỏ route động — vào từ danh sách cha). */
function adminRoutes(): string[] {
  return walk(ADMIN_DIR)
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => "/" + path.relative(ADMIN_DIR, path.dirname(f)).split(path.sep).join("/"))
    .map((r) => (r === "/." ? "/" : r))
    .filter((r) => !r.includes("["))
    .sort();
}

/** Mọi đường dẫn xuất hiện trong href / push / replace / redirect / form action. */
function duongDanDuocTroToi(): Set<string> {
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter(
    (f) => /\.tsx?$/.test(f),
  );
  const out = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(
      /(?:href|action|push|replace|redirect)\(?\s*[=:]?\s*[`"']([^`"'$)]*)/g,
    )) {
      const raw = m[1];
      if (!raw.startsWith("/")) continue;
      const sach = raw.split("?")[0].replace(/\/$/, "");
      out.add(sach);
      out.add(sach.replace(/^\/admin/, ""));
    }
  }
  return out;
}

function hrefSidebar(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "components/admin/sidebar.tsx"), "utf8");
  return [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("Sidebar admin — mọi màn đều có lối vào", () => {
  it("không route tĩnh nào chỉ vào được bằng URL", () => {
    const trongSidebar = new Set(hrefSidebar());
    const duocTroToi = duongDanDuocTroToi();
    const moCoi = adminRoutes().filter(
      (r) =>
        !(r in ALLOWLIST) &&
        !trongSidebar.has(r) &&
        !trongSidebar.has(`/admin${r}`) &&
        !duocTroToi.has(r) &&
        !duocTroToi.has(`/admin${r}`),
    );
    expect(
      moCoi,
      `Màn admin không có lối vào (thêm mục sidebar, hoặc khai ALLOWLIST kèm lý do):\n  - ${moCoi.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  it("không mục nào bị lặp hai lần trong sidebar", () => {
    const dem = new Map<string, number>();
    for (const h of hrefSidebar()) dem.set(h, (dem.get(h) ?? 0) + 1);
    const trung = [...dem.entries()].filter(([, n]) => n > 1).map(([h, n]) => `${h} ×${n}`);
    expect(trung, `Mục lặp trong sidebar:\n  - ${trung.join("\n  - ")}\n`).toEqual([]);
  });

  it("ALLOWLIST không có dòng chết (route đã xoá hoặc đã được gắn menu)", () => {
    // Allowlist mà không ai dọn thì lần sau nó che mất lỗi thật.
    const routes = new Set(adminRoutes());
    const trongSidebar = new Set(hrefSidebar());
    const chet = Object.keys(ALLOWLIST).filter(
      (r) => !routes.has(r) || trongSidebar.has(r) || trongSidebar.has(`/admin${r}`),
    );
    expect(chet, `Dòng ALLOWLIST không còn cần thiết:\n  - ${chet.join("\n  - ")}\n`).toEqual([]);
  });

  it("mỗi dòng ALLOWLIST đều có lý do viết ra", () => {
    for (const [route, lyDo] of Object.entries(ALLOWLIST)) {
      expect(lyDo.trim().length, `${route} thiếu lý do`).toBeGreaterThan(10);
    }
  });
});
