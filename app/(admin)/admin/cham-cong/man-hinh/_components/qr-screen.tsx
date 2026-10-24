"use client";

// qr-screen.tsx — nguồn dữ liệu QR của màn quầy (dùng chung cho cả hai chế độ) + thẻ xem trước
// ở chế độ điều khiển. Chế độ trình chiếu nằm ở `kiosk-stage.tsx` và cũng đọc `useKioskQr`.
//
// ĐIỀU DỄ VỠ: bản cũ để MỘT lần poll rớt mạng là xoá luôn ảnh QR đang hiện và in chữ đỏ. Ở quầy,
// "không có QR" nghĩa là cả ca không ai chấm công được. Nên ở đây: giữ ảnh cuối cùng, poll hỏng
// thì chỉ treo dải cảnh báo.
//
// Từ 07/09/2026 mã là TĨNH — không hết hạn, và chính là tờ mã đang dán ở quầy. Nên toàn bộ bộ
// đếm ngược "mã mới sau Ns" và khái niệm `validUntil` đã gỡ: mã trên màn không bao giờ cũ đi, và
// một dòng đếm ngược sai là bảo người đứng ở quầy đứng đợi một cái không bao giờ tới. Vòng poll
// giữ lại CHỈ để tự hồi phục sau khi rớt mạng và để đổi ảnh sau khi admin thu hồi mã.
//
// KHÔNG import `lib/cham-cong/kiosk-token.ts` — file đó dùng `node:crypto`, không chạy ở trình duyệt.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QrCode, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { vnParts } from "@/lib/time/vn";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/cham-cong/classes";

/** Nhịp tự hồi phục sau rớt mạng, và để mã mới hiện lên sau khi admin thu hồi. */
const POLL_MS = 30_000;

const QR_ENDPOINT = "/api/admin/cham-cong/qr-token";

export type KioskFailKind = "AUTH" | "FORBIDDEN" | "NO_LOCATION" | "SERVER" | "NETWORK";

export type KioskSnapshot = {
  qrDataUrl: string;
  locationName: string;
  geofenceEnabled: boolean;
  fetchedAt: number;
};

export type KioskFail = { kind: KioskFailKind; message: string; at: number };

export type KioskQr = {
  /** `loading` chưa có gì · `live` mã tươi · `stale` poll lỗi nhưng mã còn hạn · `error` hết cách. */
  status: "loading" | "live" | "stale" | "error";
  snap: KioskSnapshot | null;
  fail: KioskFail | null;
  /** Đồng hồ (ms). 0 = chưa mount — cố ý, để render máy chủ và trình duyệt không lệch nhau. */
  nowMs: number;
  retry: () => void;
};

type QrTokenResponse = {
  qrDataUrl?: string;
  qrKeyVersion?: number;
  workLocation?: { name?: string; geofenceEnabled?: boolean } | null;
};

function kindOf(status: number): KioskFailKind {
  if (status === 401) return "AUTH";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NO_LOCATION";
  if (status >= 500) return "SERVER";
  return "NETWORK";
}

function messageOf(kind: KioskFailKind, serverText?: string): string {
  switch (kind) {
    case "AUTH":
      return "Phiên đăng nhập trên TV đã hết — đăng nhập lại để mã tiếp tục đổi.";
    case "FORBIDDEN":
      return "Tài khoản đang đăng nhập trên TV không còn quyền xem màn hình QR của cơ sở này.";
    case "NO_LOCATION":
      return serverText ?? "Cơ sở này chưa có điểm chấm công nên chưa dựng được mã QR.";
    case "SERVER":
      return "Máy chủ chưa cấu hình khoá ký mã (hoặc đang lỗi) — báo bộ phận kỹ thuật.";
    default:
      return "Mất kết nối tới máy chủ.";
  }
}

/** "14:03" theo đồng hồ VN — không phụ thuộc timezone của máy đang mở TV. */
export function vnHhMm(ms: number): string {
  const p = vnParts(new Date(ms));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function useKioskQr(centerId: string): KioskQr {
  const [snap, setSnap] = useState<KioskSnapshot | null>(null);
  const [fail, setFail] = useState<KioskFail | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(async () => {
    try {
      // Màn TV chiếu CHÍNH tờ mã đang dán ở quầy. Chủ dự án chốt "chỉ dùng 1 QR" — chiếu một mã
      // khác với tờ giấy là hai mã, và người quét phải đoán cái nào còn dùng được.
      const res = await fetch(`${QR_ENDPOINT}?centerId=${encodeURIComponent(centerId)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const kind = kindOf(res.status);
        setFail({ kind, message: messageOf(kind, body?.error), at: Date.now() });
        return;
      }
      const data = (await res.json()) as QrTokenResponse;
      if (!data.qrDataUrl) {
        setFail({ kind: "SERVER", message: messageOf("SERVER"), at: Date.now() });
        return;
      }
      setSnap({
        qrDataUrl: data.qrDataUrl,
        locationName: data.workLocation?.name ?? "",
        geofenceEnabled: data.workLocation?.geofenceEnabled ?? false,
        fetchedAt: Date.now(),
      });
      setFail(null);
    } catch {
      setFail({ kind: "NETWORK", message: messageOf("NETWORK"), at: Date.now() });
    }
  }, [centerId]);

  // Đồng hồ 1 giây: nay CHỈ để in giờ trên TV. Mã tĩnh không hết hạn nên không còn gì đếm ngược.
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Poll giữ chạy KỂ CẢ khi đang lỗi — đó chính là đường tự hồi phục sau khi mạng về.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Mã tĩnh không hết hạn ⇒ có ảnh là còn dùng được, bất kể poll đang hỏng bao lâu. Chỉ rơi vào
  // `error` khi CHƯA BAO GIỜ lấy được ảnh nào — lúc đó ở quầy thật sự không có gì để quét.
  let status: KioskQr["status"];
  if (nowMs === 0 || (!snap && !fail)) status = "loading";
  else if (snap) status = fail ? "stale" : "live";
  else status = "error";

  return { status, snap, fail, nowMs, retry: () => void load() };
}

/** Dải cảnh báo mất kết nối. Mã tĩnh vẫn quét được bình thường — nói rõ để không ai hoảng. */
export function StaleBanner({
  fail,
  className,
}: {
  fail: KioskFail;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-center font-medium text-state-warning-ink",
        className,
      )}
    >
      <WifiOff aria-hidden className="h-4 w-4 shrink-0" />
      Mất kết nối {vnHhMm(fail.at)} — mã vẫn quét được bình thường
    </p>
  );
}

export function loginHrefFor(centerId: string): string {
  return `/login?callbackUrl=${encodeURIComponent(`/cham-cong/man-hinh?centerId=${centerId}`)}`;
}

export type KioskFailProps = {
  centerId: string;
  centerLabel: string;
  /** Ai cấp được `hr_attendance:view` — page truyền xuống, client không đọc bảng quyền. */
  askWho: string;
  /** Có `hr_attendance:config` tại cơ sở này thì mới mời người ta đi tạo điểm chấm. */
  canConfig: boolean;
};

/** Màn lỗi/rỗng dùng chung hai chế độ; chế độ trình chiếu bọc thêm lớp phóng chữ. */
export function KioskFailView({
  fail,
  onRetry,
  centerId,
  centerLabel,
  askWho,
  canConfig,
}: KioskFailProps & { fail: KioskFail | null; onRetry: () => void }) {
  const kind = fail?.kind ?? "NETWORK";
  const message = fail?.message ?? messageOf("NETWORK");

  if (kind === "FORBIDDEN") {
    return <NoPermission permission="hr_attendance:view" what="màn hình QR" askWho={askWho} />;
  }

  if (kind === "NO_LOCATION") {
    return (
      <EmptyState
        title={`${centerLabel} chưa có điểm chấm công`}
        description={
          canConfig
            ? "Mã QR dựng từ điểm chấm công của cơ sở. Tạo điểm rồi quay lại màn này."
            : "Mã QR dựng từ điểm chấm công của cơ sở. Báo Quản lý cơ sở tạo điểm giúp."
        }
        action={
          canConfig ? (
            <Link href="/cham-cong/diem-cham" className={BTN_PRIMARY}>
              Tạo điểm chấm công
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <ErrorState
      title={kind === "AUTH" ? "Phiên trên TV đã hết" : "Chưa lấy được mã QR"}
      description={message}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={onRetry} className={BTN_PRIMARY}>
            Thử lại
          </button>
          {kind === "AUTH" && (
            <Link href={loginHrefFor(centerId)} className={BTN_OUTLINE}>
              Đăng nhập lại
            </Link>
          )}
        </div>
      }
    />
  );
}

/**
 * Thẻ xem trước ở chế độ điều khiển — QR 240px, đủ để người ngồi bàn kiểm mã đang chạy.
 * Bản to cho TV nằm ở `kiosk-stage.tsx`.
 */
export function QrScreen(props: KioskFailProps) {
  const { centerId } = props;
  const qr = useKioskQr(centerId);

  if (qr.status === "error") {
    return <KioskFailView {...props} fail={qr.fail} onRetry={qr.retry} />;
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5">
      {qr.status === "loading" || !qr.snap ? (
        <Skeleton aria-busy aria-label="Đang tải mã QR…" className="aspect-square w-60 rounded-xl" />
      ) : (
        // `<img>` thuần, KHÔNG `next/image`: nguồn là data URL sinh tại chỗ — tối ưu ảnh vô nghĩa.
        <img
          src={qr.snap.qrDataUrl}
          alt="Mã QR chấm công"
          className="aspect-square w-60 rounded-xl border border-border bg-card p-2"
        />
      )}

      {qr.status === "stale" && qr.fail ? (
        <StaleBanner fail={qr.fail} className="w-full text-xs" />
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <QrCode aria-hidden className="h-3.5 w-3.5" />
          Mã cố định — cùng mã với tờ dán tại quầy
        </p>
      )}
    </div>
  );
}
