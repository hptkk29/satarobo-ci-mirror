import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE } from "@/lib/locations";
import { cn } from "@/lib/utils";

// components/public/cong-ty-block.tsx — KHỐI THÔNG TIN PHÁP NHÂN dùng chung cho 3 chân trang.
//
// ─────────────────────────────────────────────────────────────────────────────
// Nguồn: hướng dẫn BCT mục 2, in ĐÚNG 5 dòng dưới đây. Trước 21/09/2026 khối này chỉ có ở
// 1/3 chân trang và thiếu hẳn cơ quan cấp + ngày cấp (0 dòng trong toàn repo).
//
// ⚠️ Component này được dùng ở `components/legacy-luyenthirobosim/Footer.tsx` — file KHÔNG
//    dùng Tailwind, class đến từ `_styles/legacy.css` (global). Tailwind vẫn chạy ở đó vì
//    `app/globals.css` là global, nhưng MÀU thì mỗi chân trang một kiểu nền. Nên ở đây
//    KHÔNG đặt màu chữ — để thừa kế từ chân trang cha; chỉ dùng `opacity` cho dòng phụ.
//
// ⚠️ Ở chân trang luyenthirobosim phải đặt khối này làm PHẦN TỬ ANH EM của
//    `.footer-brand__desc`, KHÔNG đặt bên trong nó: `legacy.css:776` có
//    `.footer-brand__desc { display: none }` ở ≤480px ⇒ nhét vào trong là thông tin pháp
//    nhân biến mất trên điện thoại, đúng thứ hồ sơ đòi phải có.
// ─────────────────────────────────────────────────────────────────────────────

export function CongTyBlock({ className }: { className?: string }) {
  const c = SATA_ROBO_CONTACT;

  return (
    <div className={cn("space-y-1 text-xs leading-relaxed", className)}>
      <p className="font-semibold uppercase">{c.legalNameUpper}</p>
      <p className="opacity-80">
        Mã số doanh nghiệp: {c.businessCode} do {c.businessCodeIssuer} cấp ngày{" "}
        {c.businessCodeIssuedAt}
      </p>
      <p className="opacity-80">Địa chỉ: {c.address}</p>
      <p className="opacity-80">
        Số điện thoại:{" "}
        <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="hover:underline">
          {SATA_ROBO_PHONE.hien}
        </a>
      </p>
      <p className="opacity-80">
        Email:{" "}
        <a href={`mailto:${c.emails.general}`} className="hover:underline">
          {c.emails.general}
        </a>
      </p>
    </div>
  );
}
