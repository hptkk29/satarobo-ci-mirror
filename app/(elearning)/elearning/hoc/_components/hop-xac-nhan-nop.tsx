"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NUT_CHINH, NUT_PHU } from "../../_components/ui/dieu-khien";

/**
 * Hộp xác nhận nộp bài thi: đã trả lời n/m, liệt kê câu CHƯA làm kèm "Mở câu N", đồng hồ còn lại, "Làm tiếp / Nộp bài".
 * Chỉ XÁC NHẬN — không chặn: nộp thiếu vẫn được (câu trống tính 0 điểm). Mọi nghiệp vụ nộp vẫn ở `nopBaiAction` (server là đồng hồ).
 */
export function HopXacNhanNop({
  mo,
  doiMo,
  soDaLam,
  tong,
  cauChuaLam,
  conLaiChu,
  dangNop,
  hetGio = false,
  moCau,
  nop,
}: {
  mo: boolean;
  doiMo: (mo: boolean) => void;
  soDaLam: number;
  tong: number;
  /** Số thứ tự (1-based) các câu chưa làm. */
  cauChuaLam: readonly number[];
  /** "14:20" — đồng hồ còn lại. */
  conLaiChu: string;
  dangNop: boolean;
  /**
   * Đồng hồ về 0: máy chủ chỉ còn nhận ÂN HẠN ngắn rồi từ chối lưu câu mới (`HET_GIO`) ⇒ KHÔNG mời "Mở câu N"/"Làm tiếp" (mời sửa
   * thứ máy chủ sẽ từ chối); chỉ còn nộp.
   */
  hetGio?: boolean;
  /** Đóng hộp và đưa người thi tới câu N. */
  moCau: (soThuTu: number) => void;
  nop: () => void;
}) {
  return (
    <Dialog open={mo} onOpenChange={doiMo}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nộp bài?</DialogTitle>
          <DialogDescription>
            Bạn đã trả lời <strong>{soDaLam}/{tong}</strong> câu · còn <span className="tabular-nums">{conLaiChu}</span>.
          </DialogDescription>
        </DialogHeader>
        {hetGio ? (
          <p role="alert" className="text-sm font-medium">
            Đã hết giờ — chỉ còn nộp bài. {cauChuaLam.length > 0 ? "Câu chưa làm sẽ tính 0 điểm." : ""}
          </p>
        ) : cauChuaLam.length > 0 ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Câu chưa làm sẽ tính 0 điểm:</p>
            <ul aria-label="Câu chưa làm" className="flex flex-wrap gap-2">
              {cauChuaLam.map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => moCau(n)}
                    className="inline-flex min-h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Mở câu {n}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          {hetGio ? null : (
            <button type="button" className={NUT_PHU} onClick={() => doiMo(false)}>
              Làm tiếp
            </button>
          )}
          <button type="button" className={NUT_CHINH} disabled={dangNop} onClick={nop}>
            {dangNop ? "Đang nộp…" : "Nộp bài"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
