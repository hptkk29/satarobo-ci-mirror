"use client";

// components/admin/nguon-hoa-hong/website/thu-url.tsx — «THỬ URL»: dán một địa chỉ, biết NGAY nó có được phép gắn link giới thiệu không, và nếu không thì vì sao.
//
// Chạy CHÍNH `kiemUrlDuocPhep` (lib/affiliate/website-hop-le.ts) — hàm mà P1 gọi trước khi tạo link / chuyển hướng — trên dữ liệu website + trang đích ĐÃ CÓ trên trang.
// Địa chỉ dán vào CHỈ được kiểm ngay trong trình duyệt: không Server Action, không gọi mạng, không vào URL trang, không vào log. Đó là câu trả lời cho "đừng để người dùng dán địa chỉ có PII":
// dù họ lỡ dán địa chỉ có số điện thoại / email trong tham số, nó không đi đâu cả — và kết quả KHÔNG bao giờ in lại phần sau dấu ? hoặc #.
//  · Kết quả là vùng `role="status"` (đọc được bằng trình đọc màn hình): «ĐƯỢC PHÉP» kèm tên miền + đường dẫn + trang đích đã khớp, hoặc «KHÔNG ĐƯỢC PHÉP» kèm lý do cụ thể (câu tiếng Việt + mã máy).
//  · Nói thẳng điều dễ hiểu sai: tên miền con không khai thì không khớp; phần sau dấu ? và # bị bỏ.
//  · Sửa ô ⇒ kết quả cũ biến mất (không đứng đó nói về địa chỉ khác).
import { useId, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { NHAN_LY_DO, kiemUrlDuocPhep, type KetQuaUrl, type SiteDeKiem, type TrangDichDeKiem } from "@/lib/affiliate/website-hop-le";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, NHAN_O, NUT_NHO, O_NHAP } from "../classes";

export function ThuUrl({ site, trangDich }: { site: SiteDeKiem; trangDich: readonly TrangDichDeKiem[] }) {
  const id = useId();
  const [nhap, setNhap] = useState("");
  /** Địa chỉ ĐÃ bấm kiểm (đã cắt). Kết quả KHÔNG được lưu: nó được tính lại mỗi lần vẽ từ dữ liệu website HIỆN CÓ — thêm/tắt một trang đích hay ngừng website ngay khi Sheet đang mở thì
   *  kết quả đang hiện phải đổi theo, không đứng đó nói về danh sách của vài giây trước (đo 13/10: thêm trang đích xong, thử ngay, ra «chưa có trang đích» vì props chưa kịp tải lại). */
  const [daKiem, setDaKiem] = useState<string | null>(null);
  const kq: KetQuaUrl | null = daKiem === null ? null : kiemUrlDuocPhep(daKiem, site, trangDich);

  function kiem() {
    // Cắt khoảng trắng hai đầu là sự tiện lợi của MÀN HÌNH (dán thường kèm xuống dòng); hàm kiểm tự nó từ chối mọi khoảng trắng.
    setDaKiem(nhap.trim());
  }

  return (
    <section aria-labelledby={`${id}-tieu-de`} className="rounded-xl border border-border bg-card p-4">
      <h3 id={`${id}-tieu-de`} className="text-sm font-semibold text-foreground">
        Thử một địa chỉ
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Dán địa chỉ muốn gắn link giới thiệu để xem nó có được phép không. Chỉ kiểm ngay trên trình duyệt này — địa chỉ không được gửi đi hay lưu lại. Đừng dán địa chỉ có số điện thoại hay email.
      </p>
      <div className="mt-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-url`} className={NHAN_O}>
            Địa chỉ cần thử
          </label>
          <input
            id={`${id}-url`}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={nhap}
            maxLength={2200}
            placeholder="Ví dụ: https://quatang.edu.vn/khoa-robotics"
            onChange={(e) => {
              setNhap(e.target.value);
              setDaKiem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                kiem();
              }
            }}
            aria-describedby={`${id}-ket-qua`}
            className={O_NHAP}
          />
        </div>
        <button type="button" onClick={kiem} className={cn(BTN_OUTLINE, NUT_NHO, "mt-6 shrink-0")}>
          Kiểm tra
        </button>
      </div>

      <div id={`${id}-ket-qua`} role="status" aria-live="polite" className="mt-3">
        {kq === null ? null : kq.ok ? (
          <div className="flex items-start gap-3 rounded-lg bg-state-success-soft px-3 py-2.5 text-sm text-state-success-ink">
            <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">ĐƯỢC PHÉP</p>
              <p className="mt-1 break-all">
                Tên miền <span className="font-mono">{kq.host}</span> · đường dẫn <span className="font-mono">{kq.path}</span>
              </p>
              <p className="mt-0.5">
                Khớp trang đích <span className="font-mono">{kq.trangDichKhop}</span>. Phần sau dấu ? và # (nếu có) bị bỏ, không được lưu.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <CircleX aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">KHÔNG ĐƯỢC PHÉP</p>
              <p className="mt-1">{NHAN_LY_DO[kq.lyDo]}</p>
              <p className="mt-0.5 font-mono text-xs opacity-80">{kq.lyDo}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
