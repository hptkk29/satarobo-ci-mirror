"use client";

// components/admin/nguon-hoa-hong/referrer-picker.tsx — ReferrerPicker: ô TÌM người giới thiệu (06 §5.1, §7).
//
// Chọn nguồn có người (phụ huynh / nhân sự / đối tác) thì ô này hiện NGAY dưới danh sách nguồn. Combobox tìm theo tên/mã/SĐT;
// kết quả LỌC THEO LOẠI hợp với nguồn (máy chủ lọc — `lib/nguon/tim-nguoi-gioi-thieu`). Danh sách nằm NGAY TRONG luồng trang,
// không phải popover nổi: trong Sheet và trên điện thoại một popover bị cắt/che bàn phím, còn danh sách trong luồng thì không.
//
// Hàm tìm được TIÊM vào (`tim`), mặc định gọi Server Action — để test dựng bằng hàm giả và để màn khác dùng lại.
//
// Phản hồi đến SAU khi người dùng đã gõ tiếp bị bỏ (bộ đếm `lanTim`): gõ "Lan" rồi "Lan Anh", kết quả của "Lan" về chậm
// không được đè lên danh sách của "Lan Anh".
//
// Bàn phím: ↑/↓ đổi dòng đang sáng · Enter chọn · Esc xoá ô. Là combobox ARIA đầy đủ (role, aria-activedescendant).
import { useId, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { timNguoiGioiThieuAction } from "@/app/(admin)/admin/leads/nguon-actions";
import {
  DO_DAI_TIM_TOI_THIEU,
  NHAN_LOAI_NGUOI,
  NHAN_VAI,
  type LoaiNguoi,
  type NguoiDaChon,
} from "@/lib/nguon/chon-nguon";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, FIELD, NUT_NHO, PILL } from "./classes";

export type KetQuaTim = { ok: true; ketQua: NguoiDaChon[] } | { ok: false; error: string };
export type HamTim = (loai: LoaiNguoi, q: string) => Promise<KetQuaTim>;

const TIM_MAC_DINH: HamTim = (loai, q) => timNguoiGioiThieuAction({ loai, q });

const DO_TRE_GO_MS = 250;

const GOI_Y_O_TIM: Record<LoaiNguoi, string> = {
  NHAN_SU: "Gõ tên hoặc mã nhân viên",
  PHU_HUYNH: "Gõ tên phụ huynh, tên bé hoặc mã học viên",
  DOI_TAC: "Gõ tên hoặc mã đối tác",
};

function khongKhop(loai: LoaiNguoi, q: string): string {
  switch (loai) {
    case "NHAN_SU":
      return `Không có nhân sự đang làm việc nào khớp “${q}”.`;
    case "PHU_HUYNH":
      return `Không có phụ huynh nào khớp “${q}” trong các cơ sở bạn được xem.`;
    case "DOI_TAC":
      return `Không có đối tác nào khớp “${q}”. Đối tác được tạo ở mục Cộng tác viên trước khi chọn được ở đây.`;
  }
}

type TrangThai = "ngoi" | "dang-tim" | "xong" | "loi";

export function ReferrerPicker({
  loai,
  value,
  onChange,
  tim = TIM_MAC_DINH,
  disabled = false,
  invalid,
  idPrefix,
  nhan,
  anVai = false,
}: {
  loai: LoaiNguoi;
  value: NguoiDaChon | null;
  onChange: (nguoi: NguoiDaChon | null) => void;
  tim?: HamTim;
  disabled?: boolean;
  /** Câu lỗi đặt CẠNH ô (lỗi server map về field `thamChieu`). */
  invalid?: string;
  /** Tiền tố id để hai bộ chọn trên cùng trang không đụng nhau. */
  idPrefix: string;
  /** Nhãn ô thay cho «Nhân sự giới thiệu» / «Phụ huynh giới thiệu»… — dùng khi cùng bộ chọn phục vụ việc KHÁC giới thiệu (vd. «Người phụ trách nguồn»). */
  nhan?: string;
  /** Ẩn pill vai ngữ nghĩa (Sale/Quản lý/Giáo viên…) — vai chỉ có nghĩa với NGƯỜI GIỚI THIỆU, không với người phụ trách nguồn. */
  anVai?: boolean;
}) {
  const tenLoai = nhan ?? NHAN_LOAI_NGUOI[loai];
  const uid = useId();
  const idO = `${idPrefix}-${uid}-tim`;
  const idDs = `${idPrefix}-${uid}-ds`;
  const idLoi = `${idPrefix}-${uid}-loi`;
  const [q, setQ] = useState("");
  const [ketQua, setKetQua] = useState<NguoiDaChon[]>([]);
  const [trang, setTrang] = useState<TrangThai>("ngoi");
  const [loiTim, setLoiTim] = useState("");
  const [sang, setSang] = useState(0);
  const lanTim = useRef(0);
  const dsRef = useRef<HTMLUListElement>(null);
  // Focus KHÔNG được rơi về <body> khi phần tử đang giữ nó bị gỡ khỏi cây (chọn xong → ô tìm biến mất; bấm Đổi → nút biến mất):
  // người dùng bàn phím sẽ mất chỗ ngay trong Sheet modal. Cờ đặt ở thao tác, ref callback của phần tử MỚI nhận focus khi gắn vào.
  const focusVaoDoi = useRef(false);
  const focusVaoO = useRef(false);
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rời màn thì huỷ hẹn giờ — không để một lượt tìm bắn ra sau khi ô đã biến mất.
  useEffect(
    () => () => {
      if (hen.current) clearTimeout(hen.current);
      lanTim.current += 1;
    },
    [],
  );

  async function chay(gia: string) {
    const lan = ++lanTim.current;
    setTrang("dang-tim");
    let r: KetQuaTim;
    try {
      r = await tim(loai, gia);
    } catch {
      r = { ok: false, error: "Không tìm được lúc này. Thử lại sau ít giây." };
    }
    if (lan !== lanTim.current) return; // đã có lượt gõ mới hơn
    if (!r.ok) {
      setLoiTim(r.error);
      setTrang("loi");
      return;
    }
    setKetQua(r.ketQua);
    setSang(0);
    setTrang("xong");
    // Ô tìm thường nằm ở CUỐI biểu mẫu dài: danh sách vừa hiện dễ nằm dưới mép Sheet. Kéo vào tầm nhìn, không cướp focus.
    // `?.(` cả hai lần: jsdom không có `scrollIntoView`, và callback rAF nổ SAU khi ca test đã kết thúc ⇒ "Unhandled Error"
    // làm `vitest run` thoát mã 1 dù mọi ca xanh (CI 26/09 — cùng lỗi với `student-form.tsx`).
    requestAnimationFrame(() => dsRef.current?.scrollIntoView?.({ block: "nearest" }));
  }

  function goPhim(giaTri: string) {
    setQ(giaTri);
    if (hen.current) clearTimeout(hen.current);
    const gon = giaTri.trim();
    if (gon.length < DO_DAI_TIM_TOI_THIEU) {
      lanTim.current += 1; // lượt đang bay (nếu có) thành cũ
      setKetQua([]);
      setTrang("ngoi");
      return;
    }
    hen.current = setTimeout(() => void chay(gon), DO_TRE_GO_MS);
  }

  function chon(n: NguoiDaChon) {
    focusVaoDoi.current = true;
    onChange(n);
    setQ("");
    setKetQua([]);
    setTrang("ngoi");
  }

  // ── Đã chọn: một dòng tóm tắt + nút Đổi ─────────────────────────────────────────────────────────
  if (value) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-foreground">{tenLoai}</p>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={value.ten}>
              {value.ten}
            </p>
            <p className="truncate text-xs text-muted-foreground">{metaNguoi(value)}</p>
          </div>
          {value.loai === "NHAN_SU" && !anVai && <span className={cn(PILL, "bg-muted text-muted-foreground")}>{NHAN_VAI[value.vai]}</span>}
          <button
            type="button"
            ref={(el) => {
              if (el && focusVaoDoi.current) {
                focusVaoDoi.current = false;
                el.focus();
              }
            }}
            onClick={() => {
              focusVaoO.current = true;
              onChange(null);
            }}
            disabled={disabled}
            className={cn(BTN_OUTLINE, NUT_NHO)}
            aria-label={`Đổi ${tenLoai.toLowerCase()}, đang chọn ${value.ten}`}
          >
            Đổi
          </button>
        </div>
        {invalid && (
          <p id={idLoi} role="alert" className="mt-1 text-xs text-state-danger-ink">
            {invalid}
          </p>
        )}
      </div>
    );
  }

  // ── Chưa chọn: ô tìm + danh sách ─────────────────────────────────────────────────────────────────
  const moDs = trang === "xong" && ketQua.length > 0;
  return (
    <div>
      <label htmlFor={idO} className="mb-1 block text-sm font-medium text-foreground">
        {tenLoai}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={idO}
          ref={(el) => {
            if (el && focusVaoO.current) {
              focusVaoO.current = false;
              el.focus();
            }
          }}
          type="text"
          role="combobox"
          aria-expanded={moDs}
          aria-controls={idDs}
          aria-autocomplete="list"
          aria-activedescendant={moDs ? `${idDs}-${sang}` : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? idLoi : undefined}
          autoComplete="off"
          value={q}
          disabled={disabled}
          placeholder={GOI_Y_O_TIM[loai]}
          onChange={(e) => goPhim(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && moDs) {
              e.preventDefault();
              setSang((s) => Math.min(s + 1, ketQua.length - 1));
            } else if (e.key === "ArrowUp" && moDs) {
              e.preventDefault();
              setSang((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault(); // Enter ở đây là CHỌN, không phải gửi biểu mẫu
              const n = ketQua[sang];
              // Chỉ chọn khi danh sách ĐANG MỞ: trong lúc "đang tìm" `ketQua` còn của lượt gõ trước — chọn từ đó là chọn người cũ.
              if (moDs && n) chon(n);
            } else if (e.key === "Escape" && q !== "") {
              e.preventDefault();
              e.stopPropagation(); // Esc xoá ô trước, không đóng cả Sheet
              goPhim("");
            }
          }}
          className={cn(FIELD, "pl-9 pr-9")}
        />
        {trang === "dang-tim" && (
          <Loader2 aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {q !== "" && trang !== "dang-tim" && (
          <button
            type="button"
            onClick={() => goPhim("")}
            aria-label="Xoá ô tìm"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>

      {invalid && (
        <p id={idLoi} role="alert" className="mt-1 text-xs text-state-danger-ink">
          {invalid}
        </p>
      )}

      {/* Một vùng thông báo duy nhất cho đọc màn hình; thị giác thấy chính danh sách bên dưới. */}
      <p className="sr-only" role="status" aria-live="polite">
        {trang === "dang-tim" ? "Đang tìm" : trang === "xong" ? `${ketQua.length} kết quả` : ""}
      </p>

      {trang === "ngoi" && q.trim().length < DO_DAI_TIM_TOI_THIEU && (
        <p className="mt-1 text-xs text-muted-foreground">Gõ ít nhất {DO_DAI_TIM_TOI_THIEU} ký tự để tìm.</p>
      )}
      {trang === "loi" && (
        <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          <span>{loiTim}</span>
          <button type="button" onClick={() => void chay(q.trim())} className={cn(BTN_OUTLINE, NUT_NHO)}>
            Thử lại
          </button>
        </div>
      )}
      {trang === "xong" && ketQua.length === 0 && (
        <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{khongKhop(loai, q.trim())}</p>
      )}
      {moDs && (
        <ul
          ref={dsRef}
          id={idDs}
          role="listbox"
          aria-label={`Kết quả tìm ${tenLoai.toLowerCase()}`}
          className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card"
        >
          {ketQua.map((n, i) => (
            <li
              key={khoaNguoi(n)}
              id={`${idDs}-${i}`}
              role="option"
              aria-selected={i === sang}
              // mousedown + preventDefault: bấm vào dòng không làm ô tìm mất focus trước khi `click` kịp chọn.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chon(n)}
              onMouseEnter={() => setSang(i)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2",
                i === sang ? "bg-primary-soft" : "hover:bg-muted",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" title={n.ten}>
                  {n.ten}
                </p>
                <p className="truncate text-xs text-muted-foreground">{metaNguoi(n)}</p>
              </div>
              {n.loai === "NHAN_SU" && !anVai && <span className={cn(PILL, "bg-muted text-muted-foreground")}>{NHAN_VAI[n.vai]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function khoaNguoi(n: NguoiDaChon): string {
  switch (n.loai) {
    case "NHAN_SU":
      return `ns:${n.employeeId}`;
    case "PHU_HUYNH":
      return `ph:${n.studentId}`;
    case "DOI_TAC":
      return `dt:${n.affiliateId}`;
  }
}

/** Dòng phụ dưới tên: mã · cơ sở · mô tả. Chỉ ghép phần có giá trị. */
export function metaNguoi(n: NguoiDaChon): string {
  const phan = n.loai === "PHU_HUYNH" ? [n.moTa, n.ma] : [n.ma];
  return phan.filter((x): x is string => !!x && x.trim() !== "").join(" · ");
}
