import { LEGAL_INDEX_SLUG, legalUrlTuyetDoi } from "@/lib/legal-pages";
import { SATA_ROBO_CONTACT } from "@/lib/locations";
import { cn } from "@/lib/utils";

// components/public/dai-link-phap-ly.tsx — dải link pháp lý GỌN cho những bề mặt không có
// chân trang đầy đủ: cổng phụ huynh (`app/(portal)`) và nhóm đăng nhập/kích hoạt (`app/(auth)`).
//
// Vì sao cần: hồ sơ BCT đòi chính sách phải tới được từ nơi người mua đang đứng. Trước
// 21/09/2026 hai bề mặt này có **0 liên kết pháp lý** — `grep "chinh-sach"` trên
// `app/(portal)` + `components/portal` trả về 0 dòng, còn `app/(auth)/layout.tsx` chỉ có
// nền SVG + nút đổi sáng/tối. Riêng `/kich-hoat` là màn được CHỤP ẢNH trong file hướng dẫn.
//
// Cố ý KHÔNG liệt kê đủ 10 link ở đây: hai bề mặt này chật, và một lối vào trang mục lục
// (nơi in đủ 10 tên đúng) vừa đủ cho yêu cầu vừa không có chỗ cho tên trôi.
export function DaiLinkPhapLy({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-xs text-muted-foreground",
        className,
      )}
    >
      <span>© {new Date().getFullYear()} {SATA_ROBO_CONTACT.shortName}</span>
      {/* Link TUYỆT ĐỐI + thẻ mới (13/11/2026): dải này nằm trên host hocvien / trang đăng nhập, nơi đường tương đối bị viết lại thành
          `/portal/…` ⇒ 404 hoặc bị đá về /login. Xem `legalUrlTuyetDoi`. */}
      <a href={legalUrlTuyetDoi(LEGAL_INDEX_SLUG)} target="_blank" rel="noopener noreferrer" className="hover:underline">
        Chính sách của website
      </a>
      <a href={legalUrlTuyetDoi("chinh-sach-bao-mat")} target="_blank" rel="noopener noreferrer" className="hover:underline">
        Chính sách bảo mật
      </a>
    </div>
  );
}
