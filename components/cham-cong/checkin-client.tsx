"use client";

// components/cham-cong/checkin-client.tsx — MỘT nút "Chấm công" sau khi quét QR (vé 120s).
// DÙNG CHUNG cho site admin (`/cham-cong/checkin`) và site giáo viên (`/teacher/cham-cong/checkin`).
//
// ⚠️ MỘT NÚT, KHÔNG CÒN Check-in / Check-out (chủ dự án 06/10/2026): *"check in / check out người
// dùng dễ bấm nhầm … hệ thống tự biết khi nào là check in, khi nào là check out."* Hướng do MÁY
// CHỦ suy theo ca (`lib/cham-cong/suy-huong.ts`); màn này KHÔNG gửi hướng và KHÔNG tự đoán — sau
// khi ghi nó in ĐÚNG hướng + buổi + giờ máy chủ trả về (luật 12), kèm đường sửa (đơn chỉnh công).
// Cố ý KHÔNG có nút "đổi chiều": thêm nút ấy là đưa lại đúng lựa chọn dễ bấm nhầm vừa gỡ.
//
// Vì sao màn này khắt khe hơn màn admin thường: người dùng đang ĐỨNG Ở QUẦY, cầm điện thoại, vé chỉ
// sống 120 giây. Nút phải đủ to để bấm bằng ngón cái (h-16 = 64px, cả bề ngang màn 375px), đồng hồ
// vé phải đọc được từ xa, và mọi trạng thái "không bấm được" phải nói RÕ vì sao ngay tại chỗ.
//
// DỄ VỠ:
// 1. Thư mục `components/cham-cong/**` site GV mount ⇒ KHÔNG import `components/admin/**`, CHỈ token
//    `:root` (`.teacher-root` không có `--primary-soft`, `--primary-ink` ở `:root` là màu cam).
// 2. Vé dùng MỘT LẦN: bấm xong không quay lại được màn có nút — nên sau khi ghi phải nói giờ đã ghi
//    và chỉ đường đi tiếp, đừng để người ta bấm lại rồi nhận lỗi "vé đã dùng".
// 3. GPS CHẶN ở điểm đã khai toạ độ và đã bật định vị (đổi 07/09, đi cùng QR TĨNH: mã in ra ai
//    chụp cũng quét được, nên định vị là lớp bảo vệ còn lại duy nhất). Điểm CHƯA khai toạ độ vẫn
//    theo luật cũ — ghi nhận rồi gắn cờ. Việc chặn nằm ở MÁY CHỦ (`lib/cham-cong/timelog.ts`),
//    đừng chặn ở client: client chỉ hiển thị lỗi máy chủ trả về.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Fingerprint, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { recordCheckin } from "@/lib/attendance/checkin-action";
import { xinViTri } from "@/lib/cham-cong/xin-vi-tri";
import { NHAN_HUONG, cauDuDoan, type DuDoanHuong, type HuongLuot } from "@/lib/cham-cong/suy-huong";
import { ShiftCodeChip, type ShiftSource } from "@/components/cham-cong/ui/shift-code-chip";
import { PILL } from "@/components/cham-cong/ui/flag-chip";

/** Dải "Hôm nay" — dữ liệu PHẲNG do RSC đọc sẵn (giờ đã format theo +07 ở server). */
export type CheckinToday = {
  shiftCode: string | null;
  shiftName: string | null;
  shiftSource: ShiftSource | null;
  /** "07:45–11:30 · 14:00–17:45" hoặc "" khi mã ca không có khung giờ. */
  timeLabel: string;
  placeLabel: string | null;
  /** Đã có bản ghi công ngày hôm nay chưa (engine tính sau mỗi lượt quét vài phút). */
  hasRecord: boolean;
  /** "7h29" hoặc null. */
  workedLabel: string | null;
  units: number | null;
};

const BTN_CHAM =
  "flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60";

/** Lời đọc cho trình đọc màn hình — đổi theo NGƯỠNG, không phải mỗi giây (đọc 120 lần là tra tấn). */
function spokenTicket(left: number): string {
  if (left <= 0) return "Vé đã hết hạn, quét lại mã QR trên màn hình quầy.";
  if (left <= 10) return "Vé còn dưới 10 giây.";
  if (left <= 30) return "Vé còn dưới 30 giây.";
  return "Vé còn hiệu lực.";
}

export function CheckinClient({
  ticketId,
  nonce,
  expiresAt,
  locationName,
  geofenceEnabled,
  today,
  afterHref,
  afterLabel,
  donHref,
  duDoan,
}: {
  ticketId: string;
  nonce: string;
  expiresAt: string;
  locationName: string;
  geofenceEnabled: boolean;
  today?: CheckinToday | null;
  /** Đường đi tiếp sau khi ghi xong. Không truyền ⇒ không hiện link (site GV có menu riêng). */
  afterHref?: string;
  afterLabel?: string;
  /**
   * Trang nộp đơn chỉnh công CỦA SITE ĐANG ĐỨNG (admin `/don-tu/cua-toi?type=TIMESHEET_FIX`,
   * GV `/teacher/don-tu?type=TIMESHEET_FIX`) — hai site khác đường dẫn nên trang gọi phải nói.
   * Không truyền ⇒ dòng "Ghi sai?" vẫn hiện nhưng là CHỮ, không phải link: một link đoán sai
   * site là link chết (luật 12), còn thiếu hẳn dòng ấy là người ghi sai không biết đường sửa.
   */
  donHref?: string;
  /**
   * DỰ ĐOÁN hướng lượt này, trang tính lúc tải (`suyHuongHomNay`). Chỉ để người bấm biết trước;
   * hướng THẬT do `recordCheckin` suy lại lúc bấm và in ở màn "Đã ghi …". Không truyền ⇒ không
   * hiện dòng dự đoán (không đoán ở client).
   */
  duDoan?: DuDoanHuong | null;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{
    huong: HuongLuot;
    nhanBuoi: string | null;
    gio: string;
    trung: boolean;
    warning?: string;
  } | null>(null);
  /** Vé đã bị tiêu ở một lượt gửi hỏng — không bấm lại được, phải quét mã mới. */
  const [veChet, setVeChet] = useState(false);
  // Lý do KHÔNG lấy được vị trí, giữ DÍNH trên màn. Toast tự tắt, mà `cachSua` là mấy bước
  // phải làm theo — lời hướng dẫn biến mất trước khi người ta làm xong thì vô dụng.
  const [loiViTri, setLoiViTri] = useState<string | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));

  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(id);
  }, [expiresAt]);

  // ⚠️ KHÔNG còn `getPosition` cục bộ ở đây (sự cố 16/09/2026).
  //
  // Bản cũ viết callback lỗi là `() => resolve(null)` — vứt sạch `GeolocationPositionError`,
  // nên "trang chưa chạy HTTPS", "trình duyệt đã chặn quyền cho trang này" và "máy không bắt
  // được tín hiệu" đều rơi về đúng một chữ `null`. Ba nguyên nhân ấy có ba cách sửa khác hẳn
  // nhau, và người dùng không có gì để lần ra.
  //
  // Phép xin vị trí + phân biệt lý do nay ở `lib/cham-cong/xin-vi-tri.ts`, dùng chung với
  // nút chấm công tác. MỘT bản, hai màn — đừng chép lại ở đây.

  function submit() {
    startTransition(async () => {
      const v = await xinViTri();
      setLoiViTri(v.ok ? null : v.cachSua ? `${v.loi} ${v.cachSua}` : v.loi);
      // KHÔNG gửi `type` — máy chủ tự suy theo ca.
      const res = await recordCheckin({
        ticketId,
        nonce,
        latitude: v.ok ? v.latitude : null,
        longitude: v.ok ? v.longitude : null,
        accuracyMeters: v.ok ? v.accuracyMeters : null,
      });
      if (res.ok) {
        // Giờ in ra là giờ MÁY CHỦ đã ghi (`res.gio`), không phải đồng hồ điện thoại — người ta
        // sẽ đem con số này đi so với bảng công.
        setDone({ huong: res.huong, nhanBuoi: res.nhanBuoi, gio: res.gio, trung: res.trung, warning: res.warning });
        const cau = [`Đã ghi ${NHAN_HUONG[res.huong]}`, res.nhanBuoi, res.gio].filter(Boolean).join(" · ");
        if (res.warning) toast.warning(res.warning);
        else toast.success(cau);
      } else {
        toast.error(res.error);
        // ⚠️ ĐẢO 16/09/2026 — CHỈ khoá nút khi vé THẬT SỰ chết.
        //
        // Bản cũ khoá nút ở MỌI lỗi, vì lúc ấy vé bị tiêu trước khi máy chủ kiểm vị trí nên
        // lỗi nào cũng làm vé chết thật. Nay máy chủ HOÀN VÉ ở nhánh từ chối
        // (`hoanVe` trong `checkin-action`), và trả `veConDung` để màn biết.
        //
        // Giữ nguyên lý do khoá của bản cũ cho ca vé chết thật: không khoá thì người bấm lại
        // sẽ nhận thông báo SAI — "vé này đã dùng, quét lại mã QR" — trong khi lý do thật là
        // vị trí. Cờ `veConDung` phân biệt đúng hai ca ấy.
        if (!res.veConDung) setVeChet(true);
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-state-success-soft text-state-success-ink">
          <CircleCheck className="h-7 w-7" aria-hidden />
        </span>
        {/* Nói ĐÚNG cái máy chủ đã ghi: hướng · buổi · giờ. Đây là chỗ duy nhất người bấm biết
            hệ thống hiểu lượt của mình là VÀO hay RA — nên nó phải to và nằm trên cùng. */}
        <p className="text-2xl font-bold text-foreground">Đã ghi {NHAN_HUONG[done.huong]}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
          {[done.nhanBuoi, done.gio].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{locationName}</p>
        {done.trung && (
          <p className="mt-3 rounded-lg bg-state-info-soft p-2.5 text-xs text-state-info-ink">
            Bạn vừa chấm cách đây chưa tới vài phút — lượt này được lưu nhưng không tính thêm.
          </p>
        )}
        {done.warning && (
          <p className="mt-3 rounded-lg bg-state-warning-soft p-2.5 text-xs text-state-warning-ink">{done.warning}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Vé dùng một lần. Muốn ghi lượt tiếp theo thì quét lại mã trên màn hình quầy.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {donHref ? (
            <Link href={donHref} className="font-semibold text-foreground underline underline-offset-2">
              Ghi sai? Nộp đơn chỉnh công
            </Link>
          ) : (
            <>Ghi sai? Nộp đơn chỉnh công ở mục Đơn từ.</>
          )}
        </p>
        {afterHref && (
          <Link
            href={afterHref}
            className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {afterLabel ?? "Xem tiếp"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    );
  }

  const expired = left <= 0 || veChet;
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hôm nay</p>
      <p className="mt-1 text-base font-semibold text-foreground">{locationName}</p>

      {today && (
        <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {today.shiftCode ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <ShiftCodeChip code={today.shiftCode} source={today.shiftSource ?? undefined} size="sm" />
              <span className="text-foreground">{today.shiftName}</span>
              {today.timeLabel && <span className="font-mono tabular-nums">{today.timeLabel}</span>}
              {today.placeLabel && <span>· {today.placeLabel}</span>}
            </p>
          ) : (
            <p>Hôm nay bạn không có ca nào được xếp — vẫn chấm được, Quản lý sẽ rà cờ &ldquo;ngoài lịch&rdquo;.</p>
          )}
          <p>
            {today.hasRecord ? (
              <>
                Đã ghi hôm nay: <strong className="tabular-nums text-foreground">{today.workedLabel ?? "—"}</strong>
                {today.units != null && <> · {today.units} công</>}
              </>
            ) : (
              "Chưa có lượt nào được ghi hôm nay."
            )}{" "}
            <span className="text-xs">(công ngày cập nhật vài phút sau mỗi lượt quét)</span>
          </p>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        <span className={cn(PILL, geofenceEnabled ? "bg-state-info-soft text-state-info-ink" : "bg-muted text-muted-foreground")}>
          {geofenceEnabled ? "Có kiểm định vị" : "Không kiểm định vị"}
        </span>
      </p>

      {/* Lý do KHÔNG lấy được vị trí — DÍNH trên màn, không phải toast.
          `aria-live` để người dùng trình đọc màn hình cũng nghe được: đây là hướng dẫn phải
          làm theo, không phải trang trí. Đặt ngay dưới nhãn "Có kiểm định vị" vì khi cơ sở
          BẬT kiểm định vị thì thiếu toạ độ là lý do lượt quét bị từ chối. */}
      {loiViTri && (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg bg-state-warning-soft px-3 py-2 text-left text-xs leading-relaxed text-state-warning-ink"
        >
          <strong>Chưa lấy được vị trí.</strong> {loiViTri}
        </p>
      )}

      <p aria-live="polite" aria-atomic className="mt-5 text-3xl font-bold tabular-nums text-foreground">
        <span aria-hidden>{expired ? "Vé đã hết hạn" : `Vé còn ${left} giây`}</span>
        <span className="sr-only">{spokenTicket(left)}</span>
      </p>

      {expired && (
        <p role="alert" className="mt-2 rounded-lg bg-state-danger-soft p-2.5 text-sm text-state-danger-ink">
          {veChet
            ? "Lượt vừa rồi không ghi được (xem thông báo ở trên). Vé đã dùng — quét lại mã QR tại quầy để thử lần nữa."
            : "Vé hết hạn — quét lại mã trên màn hình quầy."}
        </p>
      )}

      <div className="mt-4">
        <button type="button" onClick={submit} disabled={pending || expired} className={BTN_CHAM}>
          {pending ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Fingerprint className="h-6 w-6" aria-hidden />}
          {pending ? "Đang ghi…" : "Chấm công"}
        </button>
        {duDoan && (
          <p className="mt-2 text-center text-sm font-semibold text-foreground">{cauDuDoan(duDoan)}</p>
        )}
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Hệ thống tự biết lượt này là VÀO hay RA theo ca của bạn — chỉ cần bấm một lần.
          {duDoan && " Hướng ghi thật do máy chủ quyết lúc bạn bấm."}
        </p>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {geofenceEnabled
          ? "Bật định vị (GPS) khi được hỏi — cơ sở này KIỂM VỊ TRÍ: đứng ngoài phạm vi sẽ không chấm được. Máy định vị sai thì nộp đơn chỉnh công."
          : "Bật định vị (GPS) nếu được hỏi. Mỗi vé chỉ ghi được một lượt."}
      </p>
    </div>
  );
}
