"use client";

// components/admin/nguon-hoa-hong/website/o-ten-mien.tsx — Ô nhập DANH SÁCH TÊN MIỀN được phép của một website (chip + ô thêm).
//
// Luật kiểm là `kiemTenMien` (lib/affiliate/website-hop-le.ts) — CÙNG hàm với máy chủ: tên miền nào ô này nhận thì máy chủ nhận, và ngược lại. Không có luật nào viết ở đây.
//  · Gõ rồi Enter hoặc bấm «Thêm»; dán nhiều tên miền cách nhau bằng dấu cách / phẩy / chấm phẩy cũng được. Mục hỏng ⇒ KHÔNG thêm gì (nguyên cả lượt), lỗi hiện CẠNH ô, kèm chính mục hỏng.
//  · Enter KHÔNG gửi biểu mẫu bao quanh (đã `preventDefault`); Esc không nuốt phím của Sheet bao quanh khi ô trống.
//  · Mỗi chip có nút «Bỏ» mang tên truy cập nêu rõ tên miền nào (trình đọc màn hình đọc được "Bỏ tên miền …").
//  · Khớp CHÍNH XÁC, không ký tự đại diện — dòng chú thích dưới ô nói thẳng điều đó để người khai không tưởng `quatang.edu.vn` bao luôn `www.quatang.edu.vn`.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { SO_TEN_MIEN_TOI_DA } from "@/lib/affiliate/ghi-website-dau-vao";
import { kiemTenMien } from "@/lib/affiliate/website-hop-le";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, LOI_O, NUT_NHO, O_NHAP } from "../classes";

export function OTenMien({
  id,
  value,
  onChange,
  loi,
  disabled = false,
}: {
  /** `id` của ô nhập (nhãn `<label htmlFor>` do nơi gọi dựng). */
  id: string;
  value: readonly string[];
  onChange: (ds: string[]) => void;
  /** Lỗi từ bên ngoài (kiểm biểu mẫu / máy chủ) gắn vào ô này. */
  loi?: string | null;
  disabled?: boolean;
}) {
  const [nhap, setNhap] = useState("");
  const [loiNhap, setLoiNhap] = useState<string | null>(null);
  const loiHienThi = loiNhap ?? loi ?? null;
  const idLoi = `${id}-loi`;
  const idMoTa = `${id}-mo-ta`;

  function them() {
    const mucs = nhap.split(/[\s,;]+/).filter((x) => x !== "");
    if (mucs.length === 0) {
      setLoiNhap("Gõ một tên miền, ví dụ quatang.edu.vn.");
      return;
    }
    const moi: string[] = [...value];
    for (const m of mucs) {
      const kq = kiemTenMien(m);
      if (!kq.ok) {
        setLoiNhap(`«${m.slice(0, 80)}»: ${kq.loi}`);
        return;
      }
      if (!moi.includes(kq.tenMien)) moi.push(kq.tenMien);
    }
    if (moi.length > SO_TEN_MIEN_TOI_DA) {
      setLoiNhap(`Tối đa ${SO_TEN_MIEN_TOI_DA} tên miền cho một website.`);
      return;
    }
    onChange(moi);
    setNhap("");
    setLoiNhap(null);
  }

  return (
    <div>
      {value.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">Chưa có tên miền nào. Thêm ít nhất một tên miền.</p>
      ) : (
        <ul aria-label="Các tên miền đã khai" className="mb-2 flex flex-wrap gap-2">
          {value.map((d) => (
            <li key={d} className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 py-1 pl-3 pr-1 font-mono text-sm text-foreground">
              <span className="break-all">{d}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x !== d))}
                aria-label={`Bỏ tên miền ${d}`}
                title="Bỏ tên miền này"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:h-7 md:w-7"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={nhap}
          disabled={disabled}
          placeholder="Ví dụ: quatang.edu.vn"
          onChange={(e) => {
            setNhap(e.target.value);
            setLoiNhap(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter trong ô là «Thêm», không phải «Lưu biểu mẫu».
              e.preventDefault();
              e.stopPropagation();
              them();
            }
          }}
          aria-invalid={loiHienThi ? true : undefined}
          aria-describedby={loiHienThi ? `${idMoTa} ${idLoi}` : idMoTa}
          className={O_NHAP}
        />
        <button type="button" disabled={disabled} onClick={them} className={cn(BTN_OUTLINE, NUT_NHO, "shrink-0")}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Thêm
        </button>
      </div>
      <p id={idMoTa} className="mt-1 text-xs text-muted-foreground">
        Khớp chính xác từng tên miền, không tính tên miền con: khai <span className="font-mono">quatang.edu.vn</span> không bao gồm <span className="font-mono">www.quatang.edu.vn</span> — khai riêng nếu cần.
      </p>
      {loiHienThi && (
        <p id={idLoi} role="alert" className={LOI_O}>
          {loiHienThi}
        </p>
      )}
    </div>
  );
}
