// [CPT-*] — Cột "Phụ trách" của danh sách đơn = SALE PHỤ TRÁCH LEAD, không phải người
// bấm tạo đơn.
//
// ── VÌ SAO CÓ (02/10/2026) ───────────────────────────────────────────────────────────
// Chủ dự án: *"fix các đơn tôi tạo → sale phụ trách lead đó"*. Ca thật: 119 đơn nhập từ
// file Excel đều mang `createdById` của NGƯỜI NHẬP, nên cột "Người tạo" in **cùng một cái
// tên cho cả trang** và không ai biết khách đó thuộc sale nào.
//
// ⚠️ CỐ Ý KHÔNG ghi đè `Order.createdById`. Hai lý do, cả hai đo được:
//   · `createdById` là SỰ THẬT KIỂM TOÁN ("ai bấm tạo đơn này"). Ghi đè nó bằng người phụ
//     trách là làm nhật ký nói dối, và mất luôn khả năng truy đơn nào do lượt nhập liệu
//     sinh ra.
//   · Hoa hồng KHÔNG đọc cột đó: `lib/crm/convert-lead-v2.ts:629` chép
//     `Enrollment.saleId = lead.assignedToId` ngay lúc chốt, và chú thích
//     `commission-run.test.ts:40` nói rõ `assignedToId` là người ĐANG chăm (có thể đã đổi
//     sau), nên tiền dùng ẢNH CHỤP chứ không dùng giá trị sống.
// ⇒ Việc HIỂN THỊ, không phải việc sửa dữ liệu. Màn hình đọc giá trị sống; sổ tiền giữ ảnh
//   chụp. Hai câu hỏi khác nhau, hai nguồn khác nhau — lưới `[CPT-05]` ghim điều đó.
//
// ⚠️ Lưới ghim mã nguồn (mẫu CLAUDE.md): thứ cần khoá là "câu tra có LẤY `lead.assignedToId`
// không" và "ô hiển thị ưu tiên trường nào" — cả hai nằm trong một Server Action chạm DB +
// một nhánh JSX sâu trong bảng. Test hành vi phải giả lập `scopedDb` + `haiTrucTheoDon` +
// phân quyền, và sẽ đỏ vì mọi lý do khác trước khi đỏ vì lý do này.
//
// Luật 11: BỎ CHÚ THÍCH trước khi quét (chính khối trên chứa đủ chuỗi đang tìm), neo vào
// biểu thức, và khẳng định cả SỐ LẦN khớp.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const F_ACTION = "app/(admin)/admin/orders/_actions.ts";
const F_BANG = "app/(admin)/admin/orders/_components/orders-list-client.tsx";

/**
 * ⚠️ THỨ TỰ CÓ NGHĨA, đừng đảo [02/10/2026]. Bỏ khối trước là sai: một dấu mở khối nằm
 * bên trong một chú thích `//` sẽ mở ra một khối GIẢ và nuốt mã thật tới dấu đóng kế
 * tiếp — đo trên `payments/_actions.ts`: **4.771 ký tự** biến mất. Lưới khi đó soi một
 * bản mã THIẾU: yếu đi mà vẫn xanh.
 */
function boChuThich(s: string): string {
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const ACTION = boChuThich(readFileSync(resolve(process.cwd(), F_ACTION), "utf8"));
const BANG = boChuThich(readFileSync(resolve(process.cwd(), F_BANG), "utf8"));

describe("[CPT] cột Phụ trách = sale phụ trách lead", () => {
  it("[CPT-01] câu tra LẤY lead.assignedToId", () => {
    // Thiếu dòng này thì `salePhuTrachName` luôn null và cột lặng lẽ rơi về người tạo —
    // đúng hành vi cũ, không lỗi nào báo.
    expect(ACTION).toMatch(/lead:\s*\{\s*select:\s*\{\s*assignedToId:\s*true\s*\}\s*\}/);
  });

  it("[CPT-02] trả về salePhuTrachName suy từ lead.assignedToId", () => {
    expect(ACTION).toContain("salePhuTrachName");
    expect(ACTION).toMatch(/salePhuTrachName:\s*o\.lead\?\.assignedToId/);
  });

  it("[CPT-03] tra tên bằng MỘT lượt User — không thêm câu tra thứ hai", () => {
    // Trang đơn đã bị nhắc vì độ sâu tuần tự (CLAUDE.md: "trang admin chậm gần như luôn
    // là độ sâu tuần tự"). Id của sale phải gộp vào CÙNG tập với id người tạo.
    const i = ACTION.indexOf("const creatorIds");
    expect(i, "không còn `creatorIds` — đọc lại lưới này").toBeGreaterThan(-1);
    const khoi = ACTION.slice(i, ACTION.indexOf("];", i));
    expect(khoi, "id sale phải gộp vào cùng tập với id người tạo").toContain("assignedToId");
    // Đúng MỘT lượt `user.findMany` trong cả tệp cho đường danh sách.
    expect(ACTION.match(/sdb\.user\.findMany/g)?.length ?? 0).toBe(1);
  });

  it("[CPT-04] ô hiển thị ƯU TIÊN sale phụ trách, rơi về người tạo — KHÔNG ngược lại", () => {
    expect(BANG).toContain('data-nhan="Phụ trách"');
    // Thứ tự trong biểu thức `??` LÀ cái luật. Đảo lại là quay về hành vi cũ mà không ca
    // hành vi nào đỏ.
    expect(BANG).toMatch(/\{o\.salePhuTrachName \?\? o\.createdByName \?\?/);
    expect(BANG, "đảo thứ tự ⇒ cột lại in người nhập liệu").not.toMatch(
      /\{o\.createdByName \?\? o\.salePhuTrachName/,
    );
  });

  it("[CPT-05] KHÔNG ghi đè Order.createdById ở bất kỳ đâu trong đường danh sách", () => {
    // Vế này mới là vế giữ cho nhật ký kiểm toán không bị viết lại. Nếu ai đó "vá" bằng
    // cách gán createdById = assignedToId thì lưới phải đỏ.
    expect(ACTION).not.toMatch(/createdById:\s*[^,\n]*assignedToId/);
    expect(ACTION).not.toMatch(/createdById:\s*[^,\n]*salePhuTrach/);
  });

  it("[CPT-06] dòng phụ 'tạo bởi' CHỈ hiện khi hai người KHÁC nhau", () => {
    const i = BANG.indexOf("tạo bởi");
    expect(i, "mất dòng 'tạo bởi' ⇒ không còn truy được ai nhập liệu").toBeGreaterThan(-1);
    // Điều kiện phải so KHÁC NHAU; bỏ nó đi là in "tạo bởi X" ngay dưới chữ "X".
    expect(BANG).toContain("o.salePhuTrachName !== o.createdByName");
  });
});
