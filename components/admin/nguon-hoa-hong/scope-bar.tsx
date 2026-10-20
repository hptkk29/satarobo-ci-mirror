// components/admin/nguon-hoa-hong/scope-bar.tsx — "tôi đang xem CƠ SỞ nào" + trần hoa hồng hiện hành (06 §4.2).
//
// Chip cơ sở dựng từ `scope.coSoCua(model)` — TẦM NHÌN scope, KHÔNG phải `can(action, { centerId })` (ca
// `[NHH-FE-09]`). Danh sách này đã bị cắt theo cơ sở người xem được thấy, nên QLCS CS1 không bao giờ thấy chip CS2.
//
// Trần: số ĐỌC TỪ setting `crm.commissionMaxTotalRate` do page truyền vào (không viết hằng 9% trong UI). Không
// có số ⇒ không vẽ dòng này (không đoán). Bốn tab hoa hồng truyền `tran`; tab Nguồn không (không liên quan).
//
// Chưa có chọn tháng: lựa chọn kỳ chỉ có nghĩa khi tab có dữ liệu theo kỳ (Sổ/Kỳ — PR9). Một nút ‹ › không
// đổi được gì là lời hứa suông (luật 12), nên không dựng sớm.
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "./classes";

/** 0,09 → "9%"; 0,085 → "8,5%". Làm tròn tới 2 chữ số thập phân của PHẦN TRĂM, dấu phẩy kiểu Việt. */
export function dinhDangTran(tran: number): string {
  const phanTram = Math.round(tran * 10000) / 100;
  return `${String(phanTram).replace(".", ",")}%`;
}

export function ScopeBar({
  basePath,
  coSo,
  dangChon,
  tatCaNhan,
  giu,
  tran,
}: {
  basePath: string;
  /** Không truyền ⇒ KHÔNG vẽ phần chip cơ sở (tab không theo cơ sở, vd Chính sách). Truyền `[]` ⇒ nói thẳng là chưa thấy cơ sở nào. */
  coSo?: { id: string; label: string }[];
  /** `id` đang chọn; null = "Tất cả cơ sở" (chỉ có nghĩa khi có `tatCaNhan`). */
  dangChon?: string | null;
  /** Có chip "Tất cả" (bỏ tham số cơ sở) — tab Nguồn dùng; tab một-cơ-sở-một-lúc thì không. */
  tatCaNhan?: string;
  /** Tham số khác của màn phải sống sót khi đổi cơ sở (`xem`, `van-de`…). `trang` KHÔNG giữ: đổi cơ sở là về trang 1. */
  giu?: TruyVan;
  tran?: number | null;
}) {
  const chip = (id: string | null) => hrefVoi(basePath, { ...giu, coSo: id, trang: null });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      {coSo === undefined ? null : coSo.length === 0 ? (
        <span className="text-sm text-muted-foreground">Tài khoản này chưa thấy cơ sở nào.</span>
      ) : (
        <>
          {tatCaNhan && (
            <Link
              href={chip(null)}
              aria-current={dangChon ? undefined : "page"}
              className={cn(CHIP, dangChon ? CHIP_IDLE : CHIP_ACTIVE)}
            >
              {tatCaNhan}
            </Link>
          )}
          {coSo.map((c) => (
            <Link
              key={c.id}
              href={chip(c.id)}
              aria-current={c.id === dangChon ? "page" : undefined}
              className={cn(CHIP, c.id === dangChon ? CHIP_ACTIVE : CHIP_IDLE)}
            >
              {c.label}
            </Link>
          ))}
        </>
      )}
      {typeof tran === "number" && (
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Trần hiện hành <b className="tabular-nums text-foreground">{dinhDangTran(tran)}</b>
          </span>
          <HelpHint label="Trần hoa hồng là gì">
            Tổng tỉ lệ hoa hồng của mọi vai trên một khoản thu không được vượt mức này (gồm cả giáo viên dạy
            Trial). Vượt trần là lỗi cấu hình: hệ thống không ghi dòng nào và không tự cắt. Quản trị hệ thống
            đổi mức này ở Cấu hình vận hành.
          </HelpHint>
        </div>
      )}
    </div>
  );
}
