"use client";

// THỬ TÍNH trên dữ liệu thật — khối thứ hai của bước 6 (04 §14, 06 §5.2). CHỈ ĐỌC: chạy `thuTinhAction`, không ghi gì, không làm mới trang.
//
// Bốn trạng thái (DESIGN.md §5), mỗi cái có hình riêng:
//   · loading  — khung bảng xám đúng hình kết quả (không spinner giữa trang); có thể mất vài chục giây với khoảng dài, nên nói ra
//   · rỗng     — "chưa chạy" (hướng dẫn việc cần làm) và "chạy xong mà không có khoản nào" (nói thẳng, không bảng 0đ giả)
//   · lỗi      — role=alert, nói vấn đề + cách thử lại; lỗi ngày hiện CẠNH ô
//   · không quyền — KHÔNG vẽ nút (lời hứa suông), nêu tên quyền
// Nút do `quyetDinhNutThuTinh` quyết (lib/hoa-hong/mo-phong-ui.ts): không quyền / không phải bản nháp ⇒ không nút; chưa lưu / sửa dở ⇒ nút TẮT kèm lý do cạnh nút.
import { Loader2, Play } from "lucide-react";
import { useId, useState } from "react";

import { BTN_PRIMARY, LOI_O, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { Skeleton } from "@/components/ui/skeleton";
import { kiemKhoang } from "@/lib/hoa-hong/mo-phong";
import type { QuyetDinhNutThuTinh, ThamSoThuTinh, TrangThaiThuTinh } from "@/lib/hoa-hong/mo-phong-ui";

/** Ô đang nhập: `orgUnitId` "" = toàn bộ phạm vi của người bấm. */
export type ThamNhapThuTinh = { tuNgay: string; denNgay: string; orgUnitId: string };

import type { DuLieuSoanClient } from "./kieu-soan";
import { KhoiKetQuaThuTinh } from "./thu-tinh-ket-qua";

export type PropsThuTinhThat = {
  quyetDinh: QuyetDinhNutThuTinh;
  coSo: DuLieuSoanClient["coSo"];
  /** Tham số đang nhập — giữ ở trình soạn để đổi bước rồi quay lại không mất. Khoảng khởi đầu do MÁY CHỦ tính (client không đọc đồng hồ chọn ngày). */
  tham: ThamNhapThuTinh;
  onTham: (p: Partial<ThamNhapThuTinh>) => void;
  trangThai: TrangThaiThuTinh;
  /** Kết quả đang hiện có còn đúng với bản đang soạn không. */
  ketQuaCu: boolean;
  onChay: (t: ThamSoThuTinh) => void;
  /** Người xem có quyền SỬA ô trần (`settings:edit`) — chuyển xuống cảnh báo vượt trần. BẮT BUỘC. */
  coQuyenSuaTran: boolean;
};

function KhungCho() {
  return (
    <div role="status" aria-busy="true" aria-label="Đang thử tính…" className="grid gap-4">
      <p className="text-sm text-muted-foreground">Đang tính trên dữ liệu thật. Khoảng dài có thể mất vài chục giây — bạn có thể đổi bước, kết quả sẽ giữ ở đây.</p>
      <div className="border-y border-border">
        <div className="flex h-10 items-center gap-8 border-b border-border bg-muted/40 px-3">
          {[24, 20, 20, 20].map((w, i) => (
            <Skeleton key={i} className="h-3" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        {[0, 1, 2, 3].map((r) => (
          <div key={r} className="flex h-11 items-center gap-8 border-b border-border/60 px-3 last:border-0">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThuTinhThat({ quyetDinh, coSo, tham, onTham, trangThai, ketQuaCu, onChay, coQuyenSuaTran }: PropsThuTinhThat) {
  const idTu = useId();
  const idDen = useId();
  const idDv = useId();
  const idLyDo = useId();
  const { tuNgay, denNgay, orgUnitId } = tham;
  const [daBam, setDaBam] = useState(false);

  const dangChay = trangThai.kieu === "dang-chay";
  // Lỗi khoảng kiểm CLIENT (cùng hàm với máy chủ) và chỉ hiện sau lần bấm đầu — không la lên khi người ta còn đang gõ ngày.
  const loiKhoang = kiemKhoang(tuNgay, denNgay);
  const loiTu = daBam && loiKhoang !== null && loiKhoang.startsWith("Ngày bắt đầu") ? loiKhoang : null;
  const loiDen = daBam && loiKhoang !== null && loiTu === null ? loiKhoang : null;

  function chay(e: React.FormEvent) {
    e.preventDefault();
    setDaBam(true);
    if (!quyetDinh.bamDuoc || dangChay || loiKhoang) return;
    onChay({ tuNgay, denNgay, orgUnitId: orgUnitId === "" ? null : orgUnitId });
  }

  return (
    <section aria-labelledby="thu-tinh-that" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h3 id="thu-tinh-that" className="text-sm font-semibold text-foreground">
          Thử tính trên dữ liệu thật
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          So chính sách đang chạy hôm nay với bản nháp này, trên các khoản thực thu của khoảng bạn chọn. Chỉ đọc: không ghi sổ, không gửi gì cho ai.
        </p>
      </div>

      {quyetDinh.ve ? (
        <form onSubmit={chay} noValidate className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={idTu} className={NHAN_O}>
              Từ ngày
            </label>
            <input id={idTu} type="date" value={tuNgay} onChange={(e) => onTham({ tuNgay: e.target.value })} aria-invalid={loiTu ? true : undefined} aria-describedby={loiTu ? `${idTu}-loi` : undefined} className={O_NHAP} />
            {loiTu && (
              <p id={`${idTu}-loi`} role="alert" className={LOI_O}>
                {loiTu}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <label htmlFor={idDen} className={NHAN_O}>
              Đến ngày
            </label>
            <input id={idDen} type="date" value={denNgay} onChange={(e) => onTham({ denNgay: e.target.value })} aria-invalid={loiDen ? true : undefined} aria-describedby={loiDen ? `${idDen}-loi` : undefined} className={O_NHAP} />
            {loiDen && (
              <p id={`${idDen}-loi`} role="alert" className={LOI_O}>
                {loiDen}
              </p>
            )}
          </div>
          <div className="min-w-0 sm:col-span-2">
            <label htmlFor={idDv} className={NHAN_O}>
              Phạm vi
            </label>
            <select id={idDv} value={orgUnitId} onChange={(e) => onTham({ orgUnitId: e.target.value })} className={O_NHAP}>
              <option value="">Toàn bộ phạm vi của tôi</option>
              {coSo.map((c) => (
                <option key={c.orgUnitId} value={c.orgUnitId}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={!quyetDinh.bamDuoc || dangChay} aria-describedby={quyetDinh.lyDo ? idLyDo : undefined} className={BTN_PRIMARY}>
              {dangChay ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4" />}
              {dangChay ? "Đang thử tính…" : "Chạy thử"}
            </button>
          </div>
        </form>
      ) : null}

      {quyetDinh.lyDo && (
        <p id={idLyDo} className="text-sm text-muted-foreground">
          {quyetDinh.lyDo}
        </p>
      )}

      <div aria-live="polite" className="min-w-0">
        {trangThai.kieu === "dang-chay" && <KhungCho />}
        {trangThai.kieu === "loi" && (
          <div role="alert" className="rounded-lg border border-state-danger-ink/40 bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
            <p className="font-medium">Không thử tính được.</p>
            <p className="mt-1">{trangThai.chung}</p>
          </div>
        )}
        {trangThai.kieu === "chua" && quyetDinh.bamDuoc && (
          <p className="border-y border-border px-3 py-4 text-sm text-muted-foreground">Chưa chạy. Chọn khoảng ngày rồi bấm “Chạy thử” để xem chính sách này đổi hoa hồng bao nhiêu trên khoản thu thật, chia theo vai, nguồn và cơ sở.</p>
        )}
        {trangThai.kieu === "xong" && <KhoiKetQuaThuTinh ketQua={trangThai.ketQua} chayLuc={trangThai.chayLuc} cu={ketQuaCu} coQuyenSuaTran={coQuyenSuaTran} />}
      </div>
    </section>
  );
}
