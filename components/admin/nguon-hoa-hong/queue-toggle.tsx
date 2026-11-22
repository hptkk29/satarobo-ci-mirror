// components/admin/nguon-hoa-hong/queue-toggle.tsx — công tắc "Cần xử lý (N) | Tất cả" dưới ScopeBar (06 §4.1).
//
// Mỗi tab MỞ RA ở hàng chờ của nó, không phải danh sách đầy đủ (luận đề "Hàng chờ trước sổ"). "Tất cả" nằm
// trên URL `?xem=tat-ca` — chia sẻ link, tải lại, nút Back đều đúng; mặc định (không tham số) là hàng chờ.
// Là hai `<Link>` chứ không phải `<button>`: đổi chế độ là điều hướng, không cần JS.
//
// N là số THẬT của hàng chờ (cùng hàm đếm với pill tab và route gốc — luật 12b), không bao giờ in khi không
// biết (`soCanXuLy` null ⇒ chỉ in "Cần xử lý").
import Link from "next/link";
import { cn } from "@/lib/utils";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";

export type CheDoXem = "can-xu-ly" | "tat-ca" | "page-mapping" | "khong-du-dieu-kien";

export const docCheDoXem = (raw: string | null): CheDoXem =>
  raw === "tat-ca" ? "tat-ca" : raw === "page-mapping" ? "page-mapping" : "can-xu-ly";

const MUC =
  "inline-flex h-8 items-center whitespace-nowrap px-2 text-sm sm:px-3 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export function QueueToggle({
  basePath,
  dangXem,
  soCanXuLy,
  giu,
  soPageChuaMap,
  khongDuDieuKien,
  anCanXuLy = false,
}: {
  basePath: string;
  dangXem: CheDoXem;
  soCanXuLy: number | null;
  /** Tham số khác phải sống sót (`coSo`). `van-de` + `trang` KHÔNG giữ: đổi chế độ là về đầu danh sách. */
  giu?: TruyVan;
  /**
   * Vắng (`undefined`) ⇒ KHÔNG vẽ chế độ "Page mapping" (các tab khác không có nó). Có mặt ⇒ vẽ; số Page chưa map (null = không
   * biết, chỉ in nhãn). Chế độ thứ ba này CHỈ thuộc tab Nguồn nên là tham số tuỳ chọn, không phải mặc định ngầm.
   */
  soPageChuaMap?: number | null;
  /**
   * Chế độ «Không đủ điều kiện» (Hướng G — chỉ tab Sổ): các khoản mà vai có chính sách nhưng KHÔNG phát sinh tiền. Vắng ⇒ không vẽ chế độ này. `so` = số dòng trong tầm nhìn
   * (null = không biết, chỉ in nhãn). Không dồn vào «Cần xử lý»: đó là kết quả tất định của luật cửa sổ, không phải việc ai phải làm.
   */
  khongDuDieuKien?: { so: number | null };
  /**
   * Không vẽ «Cần xử lý» (người chỉ có `view-self` không có hàng chờ — nút dẫn vào màn mà trang không mở cho họ là lời hứa suông, luật 12). Mặc định `false`: mọi nơi dùng cũ giữ nguyên.
   */
  anCanXuLy?: boolean;
}) {
  const href = (xem: CheDoXem) => hrefVoi(basePath, { ...giu, xem: xem === "can-xu-ly" ? null : xem });
  return (
    <nav
      aria-label="Chế độ xem"
      className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-card"
    >
      {!anCanXuLy && (
        <Link
          href={href("can-xu-ly")}
          aria-current={dangXem === "can-xu-ly" ? "page" : undefined}
          className={cn(
            MUC,
            dangXem === "can-xu-ly" ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted",
          )}
        >
          Cần xử lý
          {soCanXuLy !== null && <span className="ml-1 tabular-nums sm:ml-1.5">({soCanXuLy})</span>}
        </Link>
      )}
      <Link
        href={href("tat-ca")}
        aria-current={dangXem === "tat-ca" ? "page" : undefined}
        className={cn(
          MUC,
          !anCanXuLy && "border-l border-border",
          dangXem === "tat-ca" ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted",
        )}
      >
        Tất cả
      </Link>
      {khongDuDieuKien !== undefined && (
        <Link
          href={href("khong-du-dieu-kien")}
          aria-current={dangXem === "khong-du-dieu-kien" ? "page" : undefined}
          title="Khoản mà vai có chính sách nhưng không phát sinh hoa hồng (vd quá hạn ghi công)"
          className={cn(
            MUC,
            "border-l border-border",
            dangXem === "khong-du-dieu-kien" ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted",
          )}
        >
          Không đủ điều kiện
          {khongDuDieuKien.so !== null && <span className="ml-1 tabular-nums sm:ml-1.5">({khongDuDieuKien.so})</span>}
        </Link>
      )}
      {soPageChuaMap !== undefined && (
        <Link
          href={href("page-mapping")}
          aria-current={dangXem === "page-mapping" ? "page" : undefined}
          className={cn(
            MUC,
            "border-l border-border",
            dangXem === "page-mapping" ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted",
          )}
        >
          Page mapping
          {soPageChuaMap !== null && soPageChuaMap > 0 && <span className="ml-1 tabular-nums sm:ml-1.5">({soPageChuaMap})</span>}
        </Link>
      )}
    </nav>
  );
}
