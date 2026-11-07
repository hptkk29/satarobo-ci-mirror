"use client";

// components/admin/nguon-hoa-hong/source-picker.tsx — SourcePicker: chọn MỘT nguồn trong danh mục (06 §5.1).
//
// DROPDOWN GỌN có tìm kiếm (đảo bản radio 12/10/2026 — đặc tả Affiliate §4–7): đóng lại chỉ chiếm MỘT dòng, nên form nhập khách
// không còn dài thêm theo số nguồn. Danh mục MỞ (admin thêm nguồn thứ 9, 10, 50 bằng cấu hình), nên ô tìm không dấu là phần
// BẮT BUỘC, không trang trí. Hai cụm theo THUỘC TÍNH (`referrerRequirement`) vẫn giữ làm tiêu đề nhóm trong danh sách — hai nguồn
// «giới thiệu» khác nghĩa về tiền, nhóm tiêu đề + dòng phụ «Chọn nhân sự · Phải giải trình» là thứ giữ cho người nhập không nhầm.
//
// Danh sách nằm NGAY TRONG luồng trang, không phải popover nổi (cùng lý do với ReferrerPicker): trong Sheet «Gán nguồn» và trên điện
// thoại một popover bị cắt/che bàn phím, còn danh sách trong luồng thì không. Vì vậy KHÔNG dùng `components/ui/combobox.tsx` (Portal).
//
// Bàn phím: nút mở bằng Enter/Space/↓ · trong ô tìm ↑/↓ đổi dòng đang sáng, Enter chọn, Esc đóng (không đóng cả Sheet), Tab đóng.
// Là combobox ARIA đầy đủ (role, aria-expanded, aria-activedescendant).
//
// UNKNOWN / MANUAL_REVIEW / nguồn ngừng không có mặt: lọc ở `locNhomChon`, không ở đây. Giải trình KHÔNG nằm ở đây — `ChonNguonFields`
// chỉ vẽ ô giải trình SAU khi nguồn `requiresNote` đã được chọn.
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { gomTheoNguoi, loaiNguoiCuaNhom, locNhomTheoTuKhoa, type NhomChon } from "@/lib/nguon/chon-nguon";
import { cn } from "@/lib/utils";
import { FIELD } from "./classes";

/**
 * Dòng phụ dưới tên nguồn: nói điều người chọn sẽ phải làm TIẾP. Sự kiện không nói gì: chưa có danh mục sự kiện để chọn
 * (chưa có module), nên không hứa một ô chọn không tồn tại.
 */
function ghiChuNhom(n: NhomChon): string | null {
  const loai = loaiNguoiCuaNhom(n.referrerRequirement);
  const phan: string[] = [];
  if (loai) phan.push(`Chọn ${NHAN_NGUOI_NGAN[loai]}`);
  if (n.requiresNote) phan.push("Phải giải trình");
  return phan.length > 0 ? phan.join(" · ") : null;
}

/** Chữ NGẮN của việc phải làm tiếp — nằm cùng dòng với tên nguồn để cả danh sách vừa trong một màn hình. */
const NHAN_NGUOI_NGAN: Record<NonNullable<ReturnType<typeof loaiNguoiCuaNhom>>, string> = {
  NHAN_SU: "nhân sự",
  PHU_HUYNH: "phụ huynh",
  DOI_TAC: "đối tác",
};

const GOI_Y_NUT = "Chọn nguồn khách hàng";

export function SourcePicker({
  nhom,
  value,
  onChange,
  disabled = false,
  invalid,
  idPrefix,
  dangTai = false,
}: {
  nhom: readonly NhomChon[];
  /** `id` của nhóm đang chọn; null = chưa chọn. */
  value: string | null;
  onChange: (nhom: NhomChon) => void;
  disabled?: boolean;
  /** Câu lỗi đặt CẠNH ô chọn (lỗi server map về field `nguon`). */
  invalid?: string;
  idPrefix: string;
  /** Danh mục còn đang tải: ô khoá lại và nói «Đang tải…» thay vì hiện «chưa có nguồn nào». */
  dangTai?: boolean;
}) {
  const uid = useId();
  const idNut = `${idPrefix}-${uid}-nguon`;
  const idDs = `${idNut}-ds`;
  const idLoi = `${idNut}-loi`;
  const idTim = `${idNut}-tim`;
  const [mo, setMo] = useState(false);
  const [q, setQ] = useState("");
  const [sang, setSang] = useState(0);
  const nutRef = useRef<HTMLButtonElement>(null);
  const timRef = useRef<HTMLInputElement>(null);

  const chon = nhom.find((n) => n.id === value) ?? null;
  const daLoc = locNhomTheoTuKhoa(nhom, q);
  const { coNguoi, khongNguoi } = gomTheoNguoi(daLoc);
  // Thứ tự dòng trong danh sách = thứ tự đã gom; `sang` chỉ vào mảng phẳng này.
  const phang = [...coNguoi, ...khongNguoi];
  const sangDuoc = Math.min(sang, Math.max(phang.length - 1, 0));

  function moDs() {
    if (disabled) return;
    const i = phang.findIndex((n) => n.id === value);
    setSang(i >= 0 ? i : 0);
    setMo(true);
  }
  function dongDs(veNut: boolean) {
    setMo(false);
    setQ("");
    if (veNut) nutRef.current?.focus();
  }
  function chonNguon(n: NhomChon) {
    onChange(n);
    dongDs(true);
  }

  // Mở ra thì đưa focus vào ô tìm (gõ được ngay); `?.` vì ô có thể chưa gắn khi effect chạy trong test.
  useEffect(() => {
    if (mo) timRef.current?.focus();
  }, [mo]);
  // Dòng đang sáng luôn nằm trong tầm nhìn của danh sách cuộn. `?.(` : jsdom không có `scrollIntoView`.
  useEffect(() => {
    if (!mo) return;
    document.getElementById(`${idDs}-${sangDuoc}`)?.scrollIntoView?.({ block: "nearest" });
  }, [mo, sangDuoc, idDs]);

  if (nhom.length === 0 && !dangTai) {
    return (
      <div className="min-w-0">
        <p className="mb-1.5 text-sm font-medium text-foreground">Nguồn khách hàng</p>
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          Chưa có nguồn nào được bật để chọn. Liên hệ quản trị viên hệ thống.
        </p>
        {invalid && (
          <p id={idLoi} role="alert" className="mt-1 text-xs text-state-danger-ink">
            {invalid}
          </p>
        )}
      </div>
    );
  }

  const dong = (n: NhomChon, thuTu: number) => {
    const dangChon = n.id === value;
    const phu = ghiChuNhom(n);
    return (
      <li
        key={n.id}
        id={`${idDs}-${thuTu}`}
        role="option"
        aria-selected={dangChon}
        // mousedown + preventDefault: bấm vào dòng không làm ô tìm mất focus trước khi `click` kịp chọn.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chonNguon(n)}
        onMouseEnter={() => setSang(thuTu)}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2",
          thuTu === sangDuoc ? "bg-primary-soft" : "hover:bg-muted",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium text-foreground">{n.name}</span>
          {phu && <span className="text-xs text-muted-foreground">{phu}</span>}
        </span>
        <Check aria-hidden className={cn("h-4 w-4 shrink-0 text-primary", dangChon ? "opacity-100" : "opacity-0")} />
      </li>
    );
  };

  const cum = (tieuDe: string, ds: readonly NhomChon[], batDau: number) =>
    ds.length === 0 ? null : (
      <li role="presentation" key={tieuDe}>
        <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{tieuDe}</p>
        <ul role="group" aria-label={tieuDe}>
          {ds.map((n, i) => dong(n, batDau + i))}
        </ul>
      </li>
    );

  return (
    <div
      className="min-w-0"
      // Rời khỏi cả khối (Tab đi tiếp / bấm ra ngoài) ⇒ đóng. `relatedTarget` nằm TRONG khối (nút ↔ ô tìm) thì giữ mở.
      onBlur={(e) => {
        if (mo && !e.currentTarget.contains(e.relatedTarget as Node | null)) dongDs(false);
      }}
    >
      <label htmlFor={idNut} className="mb-1.5 block text-sm font-medium text-foreground">
        Nguồn khách hàng
      </label>
      <button
        ref={nutRef}
        id={idNut}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={mo}
        aria-controls={mo ? idDs : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? idLoi : undefined}
        disabled={disabled || dangTai}
        onClick={() => (mo ? dongDs(false) : moDs())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !mo) {
            e.preventDefault();
            moDs();
          }
        }}
        className={cn(FIELD, "flex items-center justify-between gap-2 text-left")}
      >
        {dangTai ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Đang tải danh sách nguồn…
          </span>
        ) : (
          <span className={cn("truncate", !chon && "text-muted-foreground")}>{chon ? chon.name : GOI_Y_NUT}</span>
        )}
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", mo && "rotate-180")} />
      </button>
      {invalid && (
        <p id={idLoi} role="alert" className="mt-1 text-xs text-state-danger-ink">
          {invalid}
        </p>
      )}

      {mo && (
        <div className="mt-1 rounded-lg border border-border bg-card shadow-sm">
          <div className="relative border-b border-border p-2">
            <Search aria-hidden className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={timRef}
              id={idTim}
              type="text"
              role="searchbox"
              aria-label="Tìm nguồn"
              aria-controls={idDs}
              aria-activedescendant={phang.length > 0 ? `${idDs}-${sangDuoc}` : undefined}
              autoComplete="off"
              value={q}
              placeholder="Tìm nguồn…"
              onChange={(e) => {
                setQ(e.target.value);
                setSang(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSang((s) => Math.min(s + 1, Math.max(phang.length - 1, 0)));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSang((s) => Math.max(s - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault(); // Enter ở đây là CHỌN, không phải gửi biểu mẫu
                  const n = phang[sangDuoc];
                  if (n) chonNguon(n);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation(); // Esc đóng danh sách trước, không đóng cả Sheet
                  dongDs(true);
                }
              }}
              className={cn(FIELD, "pl-9")}
            />
          </div>
          {/* Một vùng thông báo duy nhất cho đọc màn hình; thị giác thấy chính danh sách bên dưới. */}
          <p className="sr-only" role="status" aria-live="polite">
            {phang.length} nguồn
          </p>
          <ul
            id={idDs}
            role="listbox"
            aria-label="Danh sách nguồn khách hàng"
            // Bấm vào thanh cuộn / tiêu đề nhóm không được làm ô tìm mất focus (sẽ đóng danh sách).
            onMouseDown={(e) => e.preventDefault()}
            className="max-h-64 overflow-y-auto pb-1"
          >
            {cum("Có người giới thiệu", coNguoi, 0)}
            {cum("Không có người giới thiệu", khongNguoi, coNguoi.length)}
            {phang.length === 0 && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted-foreground">
                Không có nguồn nào khớp “{q.trim()}”.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
