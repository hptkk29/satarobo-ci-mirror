"use client";

// components/admin/scorm-lop-phu.tsx — lớp phủ trạng thái tải bài giảng, DÙNG CHUNG ScormPlayer (iframe) và PdfSlidePlayer.
// Chỉ trình bày: logic chuyển trạng thái ở scorm-trang-thai-tai.ts; nút "Tải lại trang" do NƠI GỌI nối (window.location.reload()).
//   • đang tải → role=status; sau HEN_CHAM_MS thêm nhắc "mạng yếu" + Tải lại trang + Ẩn thông báo (KHÔNG phải lỗi);
//   • lỗi → role=alert + tiêu đề/nội dung theo mã; nút chính theo `hanhDongThuLai`; MỌI nút cao ≥44px (h-11) cho ngón tay ở 375px.
import { AlertTriangle, Loader2 } from "lucide-react";
import { hanhDongThuLai, thongDiepLoi, type TrangThaiTai } from "@/components/admin/scorm-trang-thai-tai";

const NUT_CHINH =
  "inline-flex h-11 min-w-[44px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const NUT_PHU =
  "inline-flex h-11 min-w-[44px] items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted";

export function ScormLopPhu({
  trangThai,
  nhanDangTai,
  onThuLai,
  onTaiLaiTrang,
  onAnNhac,
}: {
  trangThai: TrangThaiTai;
  /** "Đang tải bài giảng…" (SCORM) / "Đang tải slide…" (PDF). */
  nhanDangTai: string;
  /** Nạp lại khung (người dùng bấm — KHÔNG bao giờ tự gọi). */
  onThuLai: () => void;
  /** Reload CẢ TRANG để cấp vé mới. */
  onTaiLaiTrang: () => void;
  onAnNhac: () => void;
}) {
  if (trangThai.loai === "san-sang") return null;
  if (trangThai.loai === "dang-tai" && trangThai.anNhac) return null;

  const khung = "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90 px-6 text-center";

  if (trangThai.loai === "loi" && trangThai.ma) {
    const d = thongDiepLoi(trangThai.ma);
    const taiTrang = hanhDongThuLai(trangThai.ma) === "tai-lai-trang";
    return (
      <div role="alert" className={khung} data-scorm-lop-phu="loi">
        <AlertTriangle className="h-8 w-8 text-state-danger-ink" aria-hidden />
        <p className="text-sm font-semibold text-foreground">{d.tieuDe}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{d.noiDung}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {taiTrang ? (
            <button type="button" onClick={onTaiLaiTrang} className={NUT_CHINH}>
              Tải lại trang
            </button>
          ) : (
            <>
              <button type="button" onClick={onThuLai} className={NUT_CHINH}>
                Thử lại
              </button>
              <button type="button" onClick={onTaiLaiTrang} className={NUT_PHU}>
                Tải lại trang
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className={khung} data-scorm-lop-phu="dang-tai">
      <Loader2 className="h-8 w-8 animate-spin text-primary-ink" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{nhanDangTai}</p>
      {trangThai.cham && (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">
            Mạng đang yếu nên bài tải lâu hơn bình thường. Bài giảng khá nặng — vui lòng chờ thêm, hoặc tải lại nếu quá lâu.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={onTaiLaiTrang} className={NUT_CHINH}>
              Tải lại
            </button>
            <button type="button" onClick={onAnNhac} className={NUT_PHU}>
              Ẩn thông báo
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Biểu ngữ "phiên hết hạn" (gia hạn vé thất bại thật): KHÔNG chặn nội dung đang mở — bài đã nạp vẫn dạy được. */
export function BieuNguPhienHetHan({ onTaiLaiTrang }: { onTaiLaiTrang: () => void }) {
  return (
    <div
      role="alert"
      data-scorm-phien="het-han"
      className="absolute inset-x-2 top-2 z-[12] flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-md"
    >
      <p className="min-w-0 flex-1 text-sm text-foreground">
        Phiên xem bài đã hết hạn. Nội dung đã mở vẫn dùng được, nhưng ảnh/video chưa tải có thể không hiện — hãy tải lại trang.
      </p>
      <button type="button" onClick={onTaiLaiTrang} className={NUT_CHINH}>
        Tải lại trang
      </button>
    </div>
  );
}
