// components/admin/nguon-hoa-hong/thong-tin-nguon.tsx — "Nguồn hiện tại" của MỘT lead, dạng danh sách định nghĩa (06 §5.6).
//
// MỘT mảnh dùng cho hai chỗ: khối "Nguồn" trên chi tiết lead và phần "Hiện tại" của Sheet "Gán nguồn" (luật 12b — hai nơi
// cùng nói một câu về cùng một lead). Không hook, không "use client": render được ở cả Server lẫn Client Component.
//
// Sáu mục theo 06 §5.6: Nguồn · Người giới thiệu · Cách xác định · Ngày ghi công · Còn hạn tới · Đường vào (cũ). Nhãn cột cố
// định 8rem, giá trị co giãn, số căn trái (đây là bản ghi một lead, không phải bảng số) — khuôn `<dl>` của ngăn "Vì sao" (06 §2.3).
//
// KHÔNG hiện hoa hồng của bất kỳ ai ở đây (PRD §56): đây là khối NGUỒN, không phải khối tiền.
import { StatusPill } from "@/components/admin/ui/status-pill";
import type { NguonHienTai, NguoiHienThi } from "@/lib/nguon/doc-gan-nguon";
import { NHAN_LY_DO, nhanCachXacDinh, nhanCanhBao } from "@/lib/nguon/nhan-hien-thi";
import { NHAN_NGUOI_LOAI_HIEN_THI } from "./nhan-nguon";
import { ngayVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";

const PILL_INK_CANH_BAO = "text-state-danger-ink";
const PILL_INK_THIEU = "text-state-warning-ink";

export function ThongTinNguon({
  nguon,
  duongVao,
  className,
}: {
  nguon: NguonHienTai;
  /** `Lead.source` — đường vào CŨ, chỉ để tham khảo. */
  duongVao: string | null;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm", className)}>
      <Muc nhan="Nguồn">
        <span className="font-medium text-foreground">{nguon.groupName}</span>
        {nguon.vanDe.length > 0 && (
          <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle">
            {nguon.vanDe.map((v) =>
              v === "CANH_BAO" ? (
                nguon.canhBao.map((ma) => (
                  <StatusPill key={ma} tone="danger" className={PILL_INK_CANH_BAO}>
                    {nhanCanhBao(ma)}
                  </StatusPill>
                ))
              ) : (
                <StatusPill key={v} tone="warning" className={PILL_INK_THIEU}>
                  {NHAN_LY_DO[v]}
                </StatusPill>
              ),
            )}
          </span>
        )}
        {nguon.khoa && <span className="ml-2 text-xs text-muted-foreground">Đã khoá (Page tự gán)</span>}
      </Muc>

      {nguon.giaiTrinh && <Muc nhan="Giải trình">{nguon.giaiTrinh}</Muc>}

      <Muc nhan="Người giới thiệu">
        <NguoiGioiThieu nguoi={nguon.nguoi} thieu={nguon.thieuNguoi} />
      </Muc>

      <Muc nhan="Cách xác định">{nhanCachXacDinh(nguon.cachXacDinh)}</Muc>

      <Muc nhan="Ngày ghi công">
        <span className="tabular-nums">{ngayVN(nguon.ngayGhiCong)}</span>
      </Muc>

      <Muc nhan="Còn hạn tới">
        <span className="tabular-nums">{ngayVN(nguon.hanGhiCong)}</span>
        {!nguon.conHanGhiCong && (
          <span className="ml-2 text-xs text-muted-foreground">
            Đã hết hạn ghi công — vẫn giữ nguồn, khoản thu mới không sinh hoa hồng thu hút
          </span>
        )}
      </Muc>

      <Muc nhan="Đường vào (cũ)">
        <span className="text-muted-foreground">{duongVao?.trim() ? duongVao : "—"}</span>
        {nguon.nhanGoc && <span className="ml-2 text-xs text-muted-foreground">nhãn cũ: {nguon.nhanGoc}</span>}
      </Muc>
    </dl>
  );
}

function Muc({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-xs font-semibold text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

function NguoiGioiThieu({ nguoi, thieu }: { nguoi: NguoiHienThi | null; thieu: boolean }) {
  if (nguoi) {
    const phu = [nguoi.ma, nguoi.moTa].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
    return (
      <>
        <span className="font-medium">{nguoi.ten}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {NHAN_NGUOI_LOAI_HIEN_THI[nguoi.loai]}
          {phu ? ` · ${phu}` : ""}
        </span>
      </>
    );
  }
  // Nhóm cần người mà chưa có (`referrerMissing`) KHÁC nhóm không cần người: hai câu, hai nghĩa.
  return thieu ? (
    <span className="text-state-warning-ink">Chưa có — nguồn này cần chọn người giới thiệu</span>
  ) : (
    <span className="text-muted-foreground">Không có</span>
  );
}
