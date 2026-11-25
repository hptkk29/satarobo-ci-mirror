// Nút "Xuất Excel" cho các màn danh mục nhập-lại-được.
//
// Server Component và TỰ GÁC: nó tự hỏi `duocXuatCuaPhienHienTai(ma)` rồi trả `null` khi
// không được phép. Nhờ vậy mỗi màn chỉ thêm đúng một dòng `<NutXuat ma="co-so" />` và không
// có chỗ nào để quên cổng — khác hẳn việc truyền một prop `xuatDuoc` qua từng trang, nơi
// quên truyền thì `undefined` và nút biến mất mà không ai biết vì sao.
//
// ⚠️ `<a>` thường, KHÔNG `<Link>`: đây là tệp tải về, router của Next sẽ cố điều hướng rồi
// treo ở một trang trắng.
//
// Hình thức khớp nút "Import Excel" đứng cạnh (DESIGN.md §2): cùng `rounded-xl border-2`,
// cùng cỡ chữ. Hai nút cạnh nhau mà lệch bo góc là thứ mắt thấy ngay.
import { Download } from "lucide-react";
import { duocXuatCuaPhienHienTai } from "@/lib/export/quyen-xuat";
import { timManXuat } from "@/lib/export/danh-muc-xuat";

export async function NutXuat({ ma }: { ma: string }) {
  const man = timManXuat(ma);
  if (!man) return null;
  if (!(await duocXuatCuaPhienHienTai(ma))) return null;

  return (
    <a
      href={`/api/admin/xuat/${ma}`}
      // `title` nói tệp dùng được để nhập lại — người ta không đoán ra điều đó từ chữ
      // "Xuất Excel", và đó là giá trị chính của tệp này.
      title={`Tải về tệp Excel — sửa xong nhập lại được ngay ở ${man.man}/import`}
      className="inline-flex items-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-muted pointer-coarse:min-h-11"
    >
      <Download className="h-4 w-4" aria-hidden />
      Xuất Excel
    </a>
  );
}
