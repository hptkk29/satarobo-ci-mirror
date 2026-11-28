"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP } from "../../_components/ui/dieu-khien";
import { taoPromptPhoiChungNhan } from "@/lib/elearning-online/chung-nhan-prompt";

/**
 * Thẻ "Giấy chứng nhận của khoá" ở tab Cài đặt học tập (QoCN) — CHỈ phần CÓ THẬT: prompt phôi (QoCNPrompt).
 * Chưa có (và nói thẳng, không vẽ nút giả): tải phôi lên, đặt vị trí chữ, xem mẫu PDF, duyệt mẫu — cần kho ảnh + nơi lưu bố cục + PDF online (chờ Q1–Q7 và schema).
 */
export function ChungNhanKhoaThe({ tenKhoa }: { tenKhoa: string }) {
  const [mo, setMo] = useState(false);
  return (
    <section aria-label="Giấy chứng nhận của khoá" className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Giấy chứng nhận của khoá</h2>
        <button type="button" className={NUT_PHU} onClick={() => setMo(true)}>Prompt giấy chứng nhận</button>
      </header>
      <div className="grid gap-2 px-4 py-3 text-sm text-[color:var(--el-text2)]">
        <p>Chứng nhận được cấp tự động hoặc cấp tay (tab Chứng nhận) và có mã tra cứu công khai. <strong className="font-medium text-foreground">Mẫu riêng của khoá chưa dùng được</strong>: tải phôi, đặt vị trí chữ và xem mẫu PDF chờ quyết định mẫu chứng nhận (Q1–Q7) và nơi lưu phôi.</p>
        <p>Trong lúc chờ, dùng prompt để nhờ công cụ tạo ảnh vẽ phôi (A4 ngang 300 dpi, chừa trống các ô tên · khoá · kết quả · ngày/mã).</p>
      </div>
      <PromptHop tenKhoa={tenKhoa} mo={mo} onDong={() => setMo(false)} />
    </section>
  );
}

function PromptHop({ tenKhoa, mo, onDong }: { tenKhoa: string; mo: boolean; onDong: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [nguoiKy, setNguoiKy] = useState("");
  const [chucDanh, setChucDanh] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (mo && !d.open) d.showModal();
    if (!mo && d.open) d.close();
  }, [mo]);
  const prompt = taoPromptPhoiChungNhan({ tenKhoa, nguoiKy, chucDanh });
  const chep = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Đã sao chép prompt");
    } catch {
      toast.error("Trình duyệt không cho sao chép — bôi đen và chép tay");
    }
  };
  return (
    <dialog ref={ref} onClose={onDong} aria-label={`Prompt giấy chứng nhận · ${tenKhoa}`} className="w-[min(36rem,94vw)] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/40">
      <div className="flex flex-col gap-3 p-5">
        <h3 className="text-base font-semibold">Prompt giấy chứng nhận · {tenKhoa}</h3>
        <p className="text-sm text-[color:var(--el-text2)]">Dán prompt này vào công cụ tạo ảnh (ChatGPT, Gemini…). Ảnh trả về phải để trống các ô tên, khoá, kết quả, ngày và mã.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cnp-ky" className={NHAN_O}>Người ký (tuỳ chọn)</label>
            <input id="cnp-ky" className={O_NHAP} value={nguoiKy} onChange={(e) => setNguoiKy(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label htmlFor="cnp-cd" className={NHAN_O}>Chức danh (tuỳ chọn)</label>
            <input id="cnp-cd" className={O_NHAP} value={chucDanh} onChange={(e) => setChucDanh(e.target.value)} maxLength={80} />
          </div>
          <p className={`${GOI_Y_O} sm:col-span-2`}>Có cả hai thì prompt giữ chữ ký và dòng "Tên – Chức danh" ở góc dưới phải; để trống thì bỏ dòng đó.</p>
        </div>
        <pre tabIndex={0} aria-label="Nội dung prompt" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 font-mono text-[13px] leading-relaxed">{prompt}</pre>
        <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Thông số">
          <li className="rounded-full bg-muted px-2.5 py-1">Tên khoá đã điền sẵn</li>
          <li className="rounded-full bg-muted px-2.5 py-1">Đối tượng: học viên</li>
          <li className="rounded-full bg-muted px-2.5 py-1">A4 ngang 300 dpi</li>
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" className={NUT_PHU} onClick={onDong}>Đóng</button>
          <button type="button" className={NUT_CHINH} onClick={() => void chep()}>Sao chép prompt</button>
        </div>
      </div>
    </dialog>
  );
}
