// components/admin/cham-cong/config-tabs.tsx — hàng 2 của tab Cấu hình.
//
// Vì sao file này tồn tại: 6 màn danh mục (mã ca, khung ca, loại nghỉ, phân loại buổi, điểm chấm,
// ghi chú) rời
// sidebar khi rút 15 mục xuống 5. Sau đó ĐÂY LÀ LỐI VÀO DUY NHẤT của chúng — cả với người dùng
// lẫn với `components/admin/nav-coverage.test.ts`, vốn đếm chuỗi literal sau `href:` để biết route
// còn ai trỏ tới. Xoá một dòng ở dưới là route đó thành mồ côi và test đỏ.
//
// "Ngày lễ" là màn của module khác (`/holidays`) nhưng người xếp ca cần nó ngay tại đây, nên nó
// được gác bằng quyền của chính nó — có target `{ centerId }` vì `holidays:view` seed scope CENTER
// ở CENTER_MANAGER (`lib/auth/rbac-scope.test.ts` R1 cấm gọi trần).
import Link from "next/link";
import { cn } from "@/lib/utils";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopeHref, type ScopeCtx } from "@/lib/cham-cong/scope-href";
import { CanhBaoDanhMuc } from "./canh-bao-danh-muc";
import type { ModuleScope } from "@/lib/cham-cong/module-scope";

export type ConfigTabKey =
  | "danh-muc-ca"
  | "khung-ca"
  | "loai-nghi"
  | "phan-loai-buoi"
  | "diem-cham"
  | "ghi-chu"
  | "holidays";

const ITEM = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
const ITEM_ACTIVE = "bg-primary-soft font-semibold text-primary-ink";
const ITEM_IDLE = "text-muted-foreground hover:bg-muted";

/** Mã của khối Hội sở trong `ModuleScope` (`module-scope.ts` đặt cứng `code: "HO"`).
 *  So bằng `code` chứ không nhập `HO_CENTER_ID` để component vỏ không kéo theo cây `@/lib/db`. */
const HO_CODE = "HO";

export async function ConfigTabs({
  active,
  scope,
  ctx,
}: {
  active: ConfigTabKey;
  scope: ModuleScope;
  ctx: ScopeCtx;
}) {
  // Khối để hỏi quyền ngày lễ: khối đang xem, không có thì khối đầu tiên người này xem được.
  const centerId = ctx.coSo || scope.blocksWith("hr_attendance:view")[0]?.id || null;
  const canHolidays = centerId ? await checkPermission("holidays:view", { centerId }) : false;

  const canConfig = scope.any("hr_attendance:config");
  const canAssignOrView = scope.any("hr_attendance:assign") || scope.any("hr_attendance:view");
  // Điểm chấm công là chuyện của TỪNG CƠ SỞ — Hội sở không có quầy (Q-04), nên quyền config
  // ở khối HO không mở được màn này.
  const canDiemCham = scope
    .blocksWith("hr_attendance:config")
    .some((b) => b.code !== HO_CODE);

  const all: { key: ConfigTabKey; label: string; href: string; show: boolean }[] = [
    { key: "danh-muc-ca", label: "Mã ca", href: "/cham-cong/danh-muc-ca", show: canConfig },
    { key: "khung-ca", label: "Khung ca tuần", href: "/cham-cong/khung-ca", show: canAssignOrView },
    {
      key: "loai-nghi",
      label: "Loại nghỉ",
      href: "/cham-cong/loai-nghi",
      show: scope.any("hr_attendance:view") || canConfig,
    },
    {
      key: "phan-loai-buoi",
      label: "Phân loại buổi",
      href: "/cham-cong/phan-loai-buoi",
      show: scope.any("hr_attendance:view") || canConfig,
    },
    { key: "diem-cham", label: "Điểm chấm công", href: "/cham-cong/diem-cham", show: canDiemCham },
    { key: "ghi-chu", label: "Ghi chú lịch", href: "/cham-cong/ghi-chu", show: canAssignOrView },
    { key: "holidays", label: "Ngày lễ", href: "/holidays", show: canHolidays },
  ];
  const items = all.filter((i) => i.show);

  if (items.length === 0) return null;

  // Cơ sở VẬN HÀNH người này cấu hình được — Hội sở bỏ ra (Q-04: HO không có quầy nên
  // không có điểm chấm). Truyền vào để cảnh báo "thiếu điểm chấm" không nói cho người CS1
  // biết CS2 đang thiếu gì.
  const coSoVanHanhIds = scope
    .blocksWith("hr_attendance:config")
    .filter((b) => b.code !== HO_CODE)
    .map((b) => b.id);

  return (
    <>
      {/* Khối này KHÔNG CHẶN, chỉ nói. Đặt trong ConfigTabs vì đây là lối vào duy nhất của
          6 màn danh mục — màn thứ bảy thêm sau cũng tự có cảnh báo. Xem canh-bao-danh-muc.tsx */}
      <CanhBaoDanhMuc coSoVanHanhIds={coSoVanHanhIds} />
      <nav aria-label="Cấu hình chấm công" className="mb-4 flex flex-wrap gap-1">
      {items.map((i) => {
        const isActive = i.key === active;
        return (
          <Link
            key={i.key}
            href={scopeHref(i.href, ctx)}
            aria-current={isActive ? "page" : undefined}
            className={cn(ITEM, isActive ? ITEM_ACTIVE : ITEM_IDLE)}
          >
            {i.label}
          </Link>
        );
      })}
      </nav>
    </>
  );
}
