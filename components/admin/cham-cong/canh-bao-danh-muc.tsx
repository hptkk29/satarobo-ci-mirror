// components/admin/cham-cong/canh-bao-danh-muc.tsx — khối cảnh báo danh mục nền rỗng/hỏng.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY — sự cố 09/09/2026
//
// Đo prod: `TeachingCreditType` 0 dòng và `SessionCategory` 0 dòng, suốt từ lúc module lên.
// KHÔNG GÌ BÁO. Hệ quả của cái thứ nhất là công dạy = 0 cho MỌI giáo viên, im lặng — bảng
// rỗng ⇒ `loaiCua()` trả null ⇒ mọi buổi bị bỏ. Console sạch, không exception.
//
// Luật 1 áp cho dữ liệu nền: bảng rỗng + đường đọc còn sống = số 0 im lặng.
//
// ⚠️ NÓ KHÔNG CHẶN, chỉ NÓI. Chặn màn Cấu hình khi danh mục rỗng là khoá đúng cái cửa
// người ta cần vào để sửa.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐẶT Ở ĐÂU
//
// Render NGAY TRONG `ConfigTabs`, không phải rải ở từng page. `ConfigTabs` là LỐI VÀO DUY
// NHẤT của 6 màn danh mục (xem chú thích đầu file đó), nên đặt ở đây thì màn cấu hình thứ
// bảy được thêm sau này tự có cảnh báo — không có đường nào để quên.
//
// Màn Công dạy KHÔNG đi qua `ConfigTabs` (nó vào bằng `ModuleNav`) nên có thêm một chỗ
// render riêng ở `cong-day/page.tsx`. Đó là chỗ thứ hai và là chỗ CUỐI CÙNG — thêm nữa thì
// dùng `ConfigTabs`.
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { docSucKhoeDanhMuc } from "@/lib/cham-cong/suc-khoe-danh-muc-db";
import { coCanhBaoNang } from "@/lib/cham-cong/suc-khoe-danh-muc";

export async function CanhBaoDanhMuc({
  /** `centerId` của cơ sở VẬN HÀNH người này cấu hình được (đã bỏ Hội sở). */
  coSoVanHanhIds,
}: {
  coSoVanHanhIds: readonly string[];
}) {
  const ds = await docSucKhoeDanhMuc(coSoVanHanhIds);
  if (!ds.length) return null;

  const nang = coCanhBaoNang(ds);
  return (
    <Alert
      variant={nang ? "destructive" : "default"}
      className="mb-3"
      data-testid="canh-bao-danh-muc"
    >
      <TriangleAlert aria-hidden />
      <AlertTitle>
        {nang
          ? "Danh mục nền đang thiếu — có con số đang tính sai"
          : "Danh mục nền còn thiếu dữ liệu"}
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {ds.map((c) => (
            <li key={c.ma}>
              <span className="font-medium">{c.noi}</span>{" "}
              <span className="text-muted-foreground">{c.lam}</span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
