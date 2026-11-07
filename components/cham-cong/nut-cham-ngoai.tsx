"use client";

// MỘT nút "Chấm công" ngoài điểm chấm (phần A 15/09/2026; gộp hai nút làm một 06/10/2026).
//
// ĐỢT 5–6 ĐƠN TỪ (08/10/2026): dời từ site GV sang `components/cham-cong` để site admin dùng chung —
// người văn phòng làm từ xa / đi công tác theo ĐƠN ĐÃ DUYỆT cũng cần nút này. Trang chỉ vẽ nút khi
// `quyenChamNgoaiLucNay` trả có quyền — cùng hàm thuần với cổng của `chamCongTac` (luật 12).
// Thư mục dùng chung ⇒ chỉ token `:root`.
//
// ⚠️ MỘT NÚT (chủ dự án 06/10/2026): *"check in / check out người dùng dễ bấm nhầm … hệ thống
// tự biết khi nào là check in, khi nào là check out"* — và nút công tác "cũng thành 1 nút, cùng
// luật suy hướng". Hướng do MÁY CHỦ suy theo ca (`suyHuongHomNay`, CÙNG hàm với đường QR); nút
// này không gửi hướng. Sau khi ghi, in ĐÚNG hướng + buổi + giờ máy chủ trả về (luật 12) và chỉ
// đường sửa (đơn chỉnh công). Cố ý KHÔNG có nút "đổi chiều".
//
// `'use client'` vì cần đúng một thứ trình duyệt mới có: `navigator.geolocation`. Mọi quyết
// định (hôm nay có phải ngày công tác không, VÀO hay RA) do máy chủ tính.
//
// ⚠️ TOẠ ĐỘ XIN TẠI ĐÚNG LÚC BẤM, không sớm hơn. Không `watchPosition`, không xin quyền lúc
// mở trang: chốt của chủ dự án — "Toạ độ là DỮ LIỆU VỊ TRÍ CÁ NHÂN: chỉ ghi tại đúng thời
// điểm bấm, KHÔNG theo dõi nền."
//
// ⚠️ KHÔNG CHẶN khi không lấy được vị trí. "Người ở chỗ sóng kém mà không chấm được là hỏng
// đúng mục đích." Lấy được thì gửi kèm; không thì gửi null và server gắn cờ `THIEU_GPS`.
//
// ⚠️ NHƯNG PHẢI NÓI ĐÚNG VÌ SAO KHÔNG LẤY ĐƯỢC (sự cố 16/09/2026). Phân biệt nằm ở
// `lib/cham-cong/xin-vi-tri.ts`; ở đây chỉ in ra.
import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, Fingerprint, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { chamCongTac } from "@/lib/cham-cong/cong-tac-action";
import { NHAN_HUONG, cauDuDoan, type DuDoanHuong, type HuongLuot } from "@/lib/cham-cong/suy-huong";
import { xinViTri } from "@/lib/cham-cong/xin-vi-tri";

export function NutChamNgoai({
  daVao,
  daRa,
  duDoan,
  donChinhCongHref,
}: {
  /** Đơn chỉnh công của site đang mở (site GV: `/teacher/don-tu?type=TIMESHEET_FIX`). */
  donChinhCongHref: string;
  /** Giờ VN lượt VÀO đầu tiên hôm nay ("08:02"), null = chưa. Do RSC tính. */
  daVao: string | null;
  /** Giờ VN lượt RA cuối cùng hôm nay, null = chưa. */
  daRa: string | null;
  /**
   * DỰ ĐOÁN hướng lượt kế tiếp, trang tính lúc tải (`suyHuongHomNay`). Hướng THẬT do
   * `chamCongTac` suy lại lúc bấm. Bấm xong trang tự tải lại (revalidatePath) nên dự đoán cập
   * nhật theo. Không truyền ⇒ không hiện.
   */
  duDoan?: DuDoanHuong | null;
}) {
  const [dangChay, batDau] = useTransition();
  const [vuaGhi, setVuaGhi] = useState<{ huong: HuongLuot; nhanBuoi: string | null; gio: string; trung: boolean } | null>(null);
  // Toast tự tắt, mà `cachSua` là mấy bước phải làm theo — nên giữ lại một khối DÍNH trên màn
  // cho tới lượt bấm sau. Lời hướng dẫn biến mất trước khi người ta làm xong là vô dụng.
  const [loiViTri, setLoiViTri] = useState<string | null>(null);

  const bam = () => {
    batDau(async () => {
      const v = await xinViTri();
      // KHÔNG gửi `type` — máy chủ tự suy theo ca.
      const r = await chamCongTac({
        latitude: v.ok ? v.latitude : null,
        longitude: v.ok ? v.longitude : null,
        accuracyMeters: v.ok ? v.accuracyMeters : null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setVuaGhi({ huong: r.huong, nhanBuoi: r.nhanBuoi, gio: r.gio, trung: r.trung });
      const nhan = [`Đã ghi ${NHAN_HUONG[r.huong]}`, r.nhanBuoi, r.gio].filter(Boolean).join(" · ");
      if (v.ok) {
        setLoiViTri(null);
        toast.success(`${nhan}, có kèm vị trí.`);
      } else {
        // Lượt chấm VẪN ĐƯỢC GHI — nói điều đó trước, rồi mới tới lý do, kẻo người ta tưởng
        // hỏng và bấm lại. `duration` dài hơn mặc định vì `cachSua` là một câu phải đọc hết.
        toast.warning(`${nhan} — chưa kèm được vị trí. ${v.loi}`, {
          description: v.cachSua ?? undefined,
          duration: 12_000,
        });
        setLoiViTri(v.cachSua ? `${v.loi} ${v.cachSua}` : v.loi);
      }
      if (r.warning) toast.warning(r.warning);
    });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={bam}
        disabled={dangChay}
        // h-16 = 64px, cả bề ngang — giáo viên bấm trên điện thoại, tay thường đang bận.
        className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-lg font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {dangChay ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Fingerprint className="h-6 w-6" aria-hidden />}
        {dangChay ? "Đang ghi…" : "Chấm công"}
      </button>
      {duDoan && <p className="text-center text-sm font-semibold text-foreground">{cauDuDoan(duDoan)}</p>}
      <p className="text-center text-xs text-muted-foreground">
        Hệ thống tự biết lượt này là VÀO hay RA theo ca của bạn — chỉ cần bấm một lần.
        {duDoan && " Hướng ghi thật do máy chủ quyết lúc bạn bấm."}
      </p>

      {/* Nói ĐÚNG cái máy chủ vừa ghi — đây là chỗ duy nhất người bấm biết hệ thống hiểu
          lượt của mình là VÀO hay RA. `aria-live` để trình đọc màn hình cũng nghe được. */}
      {vuaGhi && (
        <div aria-live="polite" className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 shrink-0 text-state-success-ink" aria-hidden />
            {[`Đã ghi ${NHAN_HUONG[vuaGhi.huong]}`, vuaGhi.nhanBuoi, vuaGhi.gio].filter(Boolean).join(" · ")}
          </p>
          {vuaGhi.trung && (
            <p className="mt-1 text-xs text-muted-foreground">
              Bạn vừa chấm cách đây chưa tới vài phút — lượt này được lưu nhưng không tính thêm.
            </p>
          )}
          <p className="mt-1 text-xs">
            <Link href={donChinhCongHref} className="font-semibold text-foreground underline underline-offset-2">
              Ghi sai? Nộp đơn chỉnh công
            </Link>
          </p>
        </div>
      )}

      {loiViTri && (
        <p className="rounded-lg bg-state-warning-soft px-3 py-2 text-xs leading-relaxed text-state-warning-ink">
          <strong>Chưa kèm được vị trí.</strong> {loiViTri}
        </p>
      )}

      {/* Trạng thái hôm nay — nói THẲNG đã ghi gì, đừng để người ta bấm lại vì không chắc.
          Số do trang (RSC) đọc lúc tải; lượt vừa bấm hiện ở khối "Đã ghi" phía trên. */}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Vào hôm nay</dt>
          <dd className="font-semibold text-foreground tabular-nums">{daVao ?? "chưa có"}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Ra hôm nay</dt>
          <dd className="font-semibold text-foreground tabular-nums">{daRa ?? "chưa có"}</dd>
        </div>
      </dl>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Mỗi lần bấm, hệ thống lưu vị trí <strong>tại đúng thời điểm đó</strong> để Quản lý đối
          chiếu — không theo dõi ngoài lúc bấm. Không lấy được vị trí thì <strong>vẫn ghi nhận</strong>.
        </span>
      </p>
    </div>
  );
}
