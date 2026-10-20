// app/(admin)/admin/nguon-hoa-hong/nguon/tao/page.tsx — TẠO NGUỒN MỚI (SPEC nguồn động §4): admin thêm nguồn thứ 10, 20, 50 bằng giao diện, không sửa mã.
//
// Trang đầy đủ (không Sheet) — biểu mẫu 14 ô cần chỗ rộng và không cần giữ danh sách ở sau lưng. Bốn trạng thái (DESIGN.md §5):
//   · đang tải  → `loading.tsx` (skeleton đúng hình biểu mẫu);
//   · lỗi       → `error.tsx` của module (một chỗ ở gốc segment);
//   · không quyền → `NoPermission` nêu TÊN khoá `sources:manage` + hỏi ai (đúng khoá mà `taoNguonAction` kiểm ở đầu hàm — luật 12).
// Module tắt KHÔNG có trạng thái riêng ở đây: `vaoTab("nguon")` đã 404 khi cờ nguồn tắt (cùng cờ `laQuanLyNguonBat`) — nhánh «chưa được bật» từng nằm ở đây là mã không bao giờ chạy (W4).
// Cổng THẬT của cờ nằm ở `taoNguonAction` (action vẫn tự kiểm cờ).
// Người chỉ có `sources:view` KHÔNG vào được biểu mẫu: thấy NoPermission thay vì một form mà bấm Lưu mới biết bị từ chối.
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { NguonForm } from "@/components/admin/nguon-hoa-hong/nguon-form";
import { NoPermission } from "@/components/admin/ui/states";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docFormTaoNguon } from "@/lib/nguon/doc-form-nguon";
import { coQuyenKichHoatChinhSach } from "@/lib/nguon/quyen-kich-hoat";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { vaoTab } from "../../_lib/vao-tab";

export const metadata = { title: "Tạo nguồn | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const PHU_DE = "Thêm một nguồn lead mới. Nguồn mới dùng được ngay ở ô chọn nguồn và ở bộ chọn của trình soạn chính sách khi đã kích hoạt.";

export default async function TaoNguonPage() {
  const { actor, scope } = await vaoTab("nguon");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/nguon"])) {
    return <ThieuQuyen tab="nguon" scope={scope} soHangCho={{}} />;
  }
  const soHangCho = await docSoHangChoTheoTab(actor, scope);

  if (!scope.has("sources:manage")) {
    return (
      <KhungModule tab="nguon" scope={scope} soHangCho={soHangCho} tieuDe="Tạo nguồn" phuDe={PHU_DE}>
        <NoPermission permission="sources:manage" what="trang tạo nguồn" askWho="Marketing Hội sở hoặc quản trị hệ thống" />
      </KhungModule>
    );
  }

  // «Kích hoạt ngay» nói thật: cần biết rule chủ-nguồn có chạy không (nguồn mới thiếu người phụ trách bị chặn) và người tạo có quyền kích hoạt không (nguồn có chủ bị trả tiền ngay).
  const [du, coQuyenKichHoat] = await Promise.all([docFormTaoNguon(actor), coQuyenKichHoatChinhSach()]);
  return (
    <KhungModule tab="nguon" scope={scope} soHangCho={soHangCho} tieuDe="Tạo nguồn" phuDe={PHU_DE}>
      <NguonForm cheDo="tao" donVi={du.donVi} thuTuGoiY={du.thuTuGoiY} cuaSoMacDinhNgay={du.cuaSoMacDinhNgay} boiCanhTao={{ ruleChuChay: du.ruleChuChay, coQuyenKichHoat }} />
    </KhungModule>
  );
}
