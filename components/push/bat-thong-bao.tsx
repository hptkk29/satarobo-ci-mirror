"use client";

// Khối "Thông báo đẩy" trong cài đặt tài khoản — Web Push Đợt 3.
//
// Dùng CHUNG cho `/settings` (admin) và `/teacher/ho-so` (giáo viên), đúng tiền lệ của
// `change-password-dialog` — hai màn, một đường.
//
// Cố ý dùng thông báo NỘI TUYẾN thay vì toast: nội dung ở đây có thể là 5 bước hướng dẫn cài
// vào màn hình chính — thứ người dùng phải đọc chậm và làm theo, không phải thứ tự tắt sau
// vài giây. (`<Toaster />` có sẵn ở layout gốc nên toast dùng được ở cả hai site — chỉ là
// không hợp việc này.)

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  trangThaiManHinh,
  laThietBiIOS,
  NHAN,
  BUOC_CAI_IOS,
  type BoiCanhThietBi,
  type QuyenThongBao,
} from "@/lib/push/ui-state";
import { khoaVapidSangBytes, laKhoaVapidHopLeOClient } from "@/lib/push/client-key";
import { nhanHost } from "@/lib/push/ui-state";
import { bamEndpointOClient } from "@/lib/push/client-key";
import { datDaDongBo, datTatTay, xoaTatTay } from "@/lib/push/bo-nho-may";
import {
  dangKyThietBiAction,
  huyThietBiAction,
  huyThietBiTheoEndpointAction,
} from "@/app/(admin)/admin/settings/_push-actions";

export interface ThietBiView {
  id: string;
  /**
   * BĂM endpoint, KHÔNG phải endpoint (siết ở Đợt 5).
   *
   * Prop của component này được tuần tự hoá thẳng vào HTML trang, nên trả endpoint đầy đủ là
   * đặt một KHẢ NĂNG GỬI vào mã nguồn trang — và đó chính là đầu vào duy nhất mà kẻ muốn
   * chiếm đăng ký của người khác cần. So "máy này" bằng băm cho kết quả y hệt mà không lộ gì.
   */
  bam: string;
  /** Nhãn cắt `host/…6 ký tự cuối` — cho người đọc, không gửi lại được. */
  nhan: string;
  deviceLabel: string | null;
  userAgent: string | null;
  origin: string;
  displayMode: string | null;
  /** ISO. `null` = chưa nhận lần nào (đúng cho tới khi Đợt 4 lên). */
  lastSuccessAt: string | null;
  createdAt: string;
}

/** Tên gọn cho một máy, suy từ user-agent. Chỉ để người dùng nhận ra máy của mình. */
function tenMay(tb: ThietBiView): string {
  if (tb.deviceLabel) return tb.deviceLabel;
  const ua = tb.userAgent ?? "";
  const he = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad|Macintosh/.test(ua)
      ? "iPad / Mac"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : "Thiết bị";
  const tr = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return tr ? `${he} · ${tr}` : he;
}

function ngayGon(iso: string | null): string {
  if (!iso) return "chưa nhận lần nào";
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/**
 * `nguoiDung` = `session.user.id`, BẮT BUỘC.
 *
 * Cờ "đã tắt tay" và mốc "đã đồng bộ" khoá theo NGƯỜI chứ không theo origin — trên máy dùng
 * chung, khoá theo origin nghĩa là một người bấm "Tắt" là bịt miệng mọi người còn lại dùng chung
 * trình duyệt đó, im lặng, trong khi màn hình vẫn hứa "thông báo sẽ tới máy này". Đọc khối đầu
 * `lib/push/bo-nho-may.ts` trước khi đổi chữ ký.
 */
export function BatThongBao({
  thietBi,
  nguoiDung,
}: {
  thietBi: ThietBiView[];
  nguoiDung: string;
}) {
  const [boiCanh, setBoiCanh] = useState<BoiCanhThietBi | null>(null);
  const [dangChay, setDangChay] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [xong, setXong] = useState<string | null>(null);
  const [bamMayNay, setBamMayNay] = useState<string | null>(null);
  // `thietBi` là prop từ Server Component — nó ĐÓNG BĂNG từ lượt tải trang. Không refresh thì
  // bật xong `daDangKy` vẫn false (danh sách cũ) ⇒ màn hình vẫn hiện nút "Bật thông báo" và
  // "Chưa có thiết bị nào" ngay cạnh dòng "Đã bật", và gỡ xong bấm lại lần hai sẽ ra chữ đỏ
  // cho một thao tác vừa THÀNH CÔNG.
  const router = useRouter();

  /** Đọc bối cảnh thiết bị. Chạy sau khi trang đã vẽ — mọi thứ dưới đây cần `window`. */
  const doBoiCanh = useCallback(async () => {
    const hoTroPush =
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof window !== "undefined" &&
      "PushManager" in window;

    // `Notification` có thể KHÔNG TỒN TẠI trên iOS Safari chưa cài — đọc trần là ReferenceError.
    const quyen: QuyenThongBao =
      typeof Notification === "undefined" ? "default" : (Notification.permission as QuyenThongBao);

    const dangStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    let ep: string | null = null;
    if (hoTroPush) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        ep = (await reg?.pushManager.getSubscription())?.endpoint ?? null;
      } catch {
        ep = null;
      }
    }
    // Băm ở CLIENT rồi so với băm server gửi xuống — server không còn gửi endpoint nào.
    const bam = ep ? await bamEndpointOClient(ep) : null;
    setBamMayNay(bam);
    setBoiCanh({
      hoTroPush,
      quyen,
      laIOS: laThietBiIOS({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
      }),
      dangStandalone,
      // "Máy này đã đăng ký" = trình duyệt CÓ subscription VÀ máy chủ có dòng tương ứng.
      // Thiếu vế thứ hai thì gỡ ở tab khác xong tab này vẫn báo "đang nhận".
      // `bam` null nghĩa là không băm được (không có `crypto.subtle` — chỉ xảy ra ngoài
      // secure context, mà Web Push vốn đã đòi secure context). Fail sang "chưa đăng ký":
      // mời bật lại một lần là vô hại, còn báo "đang nhận" khi không chắc là nói sai.
      daDangKy: !!bam && thietBi.some((t) => t.bam === bam),
    });
  }, [thietBi]);

  useEffect(() => {
    void doBoiCanh();
  }, [doBoiCanh]);

  async function bat() {
    setLoi(null);
    setXong(null);
    setDangChay(true);
    try {
      // Đọc khoá TRONG hàm, không ở module scope. `NEXT_PUBLIC_*` được nhúng lúc build nên cách
      // nào cũng chạy trên prod — nhưng đọc ở module scope thì `vi.stubEnv` VÔ TÁC DỤNG (module
      // đã nạp xong trước khi `beforeEach` chạy), và một cổng không test được là một cổng không
      // tồn tại. Đây là lý do nhánh này không có ca test nào cho tới Đợt 6.
      const khoaCongKhai = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!laKhoaVapidHopLeOClient(khoaCongKhai)) {
        setLoi("Hệ thống chưa cấu hình khoá thông báo. Báo quản trị viên giúp nhé.");
        return;
      }

      // ⚠️ DÒNG ĐẦU TIÊN của cú bấm. Xin quyền phải nằm trong user gesture; `await` một việc
      // khác trước có thể làm mất "user activation" trên Safari và trình duyệt lặng lẽ từ chối.
      const quyen = await Notification.requestPermission();
      if (quyen !== "granted") {
        setLoi(
          quyen === "denied"
            ? "Bạn đã chặn thông báo. Mở cài đặt quyền của trình duyệt cho địa chỉ này rồi thử lại."
            : "Chưa cấp quyền thông báo.",
        );
        await doBoiCanh();
        return;
      }

      // Đăng ký lại là idempotent — worker đã cài từ Đợt 2, gọi ở đây để không phụ thuộc thứ tự.
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const reg = await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Đăng ký cũ có thể được ký bằng khoá VAPID CŨ. Giữ lại là mọi lượt gửi trả 403
        // VapidPkHashMismatch mà không ai biết vì sao — huỷ rồi đăng ký lại bằng khoá hiện tại.
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: khoaVapidSangBytes(khoaCongKhai!),
      });

      const kq = await dangKyThietBiAction({
        subscription: sub.toJSON(),
        userAgent: navigator.userAgent,
        displayMode: window.matchMedia?.("(display-mode: standalone)").matches
          ? "standalone"
          : "browser",
      });
      if (!kq.ok) {
        setLoi(kq.error ?? "Không lưu được thiết bị.");
        return;
      }
      // Người dùng vừa CHỦ ĐỘNG bật ⇒ xoá cờ "đã tắt tay", để đường tự đăng ký lại của Đợt 6
      // (`lib/push/tu-dang-ky-lai.ts`) được phép chạy ở những lượt đăng nhập sau. Không xoá thì
      // họ bật hôm nay, đăng xuất, và mai không nhận gì nữa — đúng triệu chứng mà Đợt 6 vá.
      xoaTatTay(nguoiDung);
      // …và đặt luôn mốc "đã đồng bộ trong phiên tab này": hai đường (bấm tay / tự động) dùng
      // CHUNG một khái niệm, nên nếu không đặt ở đây thì lượt tải trang ngay sau cú bấm lại gọi
      // Server Action một lần nữa cho đúng cái vừa ghi xong.
      const bamMoi = await bamEndpointOClient(sub.endpoint);
      if (bamMoi) datDaDongBo(nguoiDung, bamMoi);
      setXong("Đã bật. Máy này đã được ghi vào danh sách nhận thông báo.");
      router.refresh();
      await doBoiCanh();
    } catch (err) {
      setLoi(err instanceof Error ? `Không bật được: ${err.message}` : "Không bật được thông báo.");
    } finally {
      setDangChay(false);
    }
  }

  async function tatMayNay() {
    setLoi(null);
    setXong(null);
    setDangChay(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        // Trình duyệt vốn đã không có đăng ký nào — không có gì để tắt, và nói "đã tắt" là
        // khai một việc không xảy ra. Nhưng Ý MUỐN thì đã rõ, nên vẫn cắm cờ: nếu không, đường
        // tự đăng ký lại có thể dựng lại đúng thứ họ vừa bấm để tắt.
        datTatTay(nguoiDung);
        setXong("Máy này vốn chưa bật thông báo.");
        await doBoiCanh();
        return;
      }
      // Gọi MÁY CHỦ TRƯỚC: `unsubscribe()` là không thể hoàn tác, nên nếu máy chủ từ chối
      // (phiên hết hạn) mà ta đã huỷ ở trình duyệt thì DB còn một dòng ACTIVE trỏ vào một
      // endpoint đã chết — engine Đợt 4 sẽ gửi vào đó tới khi push service trả 410.
      const kq = await huyThietBiTheoEndpointAction({ endpoint: sub.endpoint });
      if (!kq.ok) {
        setLoi(kq.error ?? "Không tắt được. Thử tải lại trang.");
        return;
      }
      await sub.unsubscribe().catch(() => undefined);
      // ⚠️ CẮM CỜ, và cắm nó ở ĐÂY là điều kiện để nút này còn nghĩa lý. Đường tự đăng ký lại
      // của Đợt 6 chạy ở MỌI lượt tải trang khi quyền còn `granted` — mà `unsubscribe()` không
      // rút quyền. Thiếu cờ thì người dùng bấm "Tắt", tải lại trang, và thiết bị hiện lại.
      //
      // Cờ theo ORIGIN (localStorage), không theo người: trên máy dùng chung, người đăng nhập
      // sau cũng phải bấm "Bật thông báo" một lần. Đó là chiều SAI AN TOÀN đã chọn — tự bật lại
      // thứ ai đó vừa tắt là kiểu lỗi khiến người ta chặn quyền ở cấp trình duyệt.
      datTatTay(nguoiDung);
      setXong("Đã tắt thông báo trên máy này.");
      router.refresh();
      await doBoiCanh();
    } catch (err) {
      setLoi(err instanceof Error ? `Không tắt được: ${err.message}` : "Không tắt được.");
    } finally {
      setDangChay(false);
    }
  }

  async function go(id: string) {
    setLoi(null);
    setXong(null);
    setDangChay(true);
    try {
      const kq = await huyThietBiAction({ id });
      if (!kq.ok) {
        setLoi(kq.error ?? "Không gỡ được thiết bị.");
      } else {
        // Gỡ ĐÚNG DÒNG CỦA MÁY NÀY thì cũng phải cắm cờ. Nút "Gỡ" chỉ thu hồi dòng trong DB,
        // không `unsubscribe()` (nó gỡ được cả máy khác, mà ta không với tới trình duyệt của
        // máy đó). Nên nếu bấm Gỡ trên chính máy đang ngồi mà không cắm cờ thì đường tự đăng ký
        // lại dựng dòng đó về ngay ở lượt tải kế — nút thành vô nghĩa.
        if (!!bamMayNay && thietBi.some((t) => t.id === id && t.bam === bamMayNay)) {
          datTatTay(nguoiDung);
        }
        setXong("Đã gỡ thiết bị.");
        router.refresh();
      }
      await doBoiCanh();
    } catch (err) {
      setLoi(err instanceof Error ? `Không gỡ được: ${err.message}` : "Không gỡ được.");
    } finally {
      setDangChay(false);
    }
  }

  // Chưa đo xong bối cảnh (SSR + lượt vẽ đầu): không đoán, không nhấp nháy sai trạng thái.
  if (!boiCanh) {
    return <p className="text-sm text-muted-foreground">Đang kiểm tra thiết bị…</p>;
  }

  const tt = trangThaiManHinh(boiCanh);
  const nhan = NHAN[tt];
  const dangSong = thietBi;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-foreground">{nhan.tieuDe}</p>
          <p className="mt-1 text-sm text-muted-foreground">{nhan.moTa}</p>
        </div>
        {tt === "CO_THE_BAT" && (
          <Button onClick={bat} disabled={dangChay}>
            {dangChay ? "Đang bật…" : "Bật thông báo"}
          </Button>
        )}
        {tt === "DA_BAT" && (
          <Button variant="outline" onClick={tatMayNay} disabled={dangChay}>
            {dangChay ? "Đang tắt…" : "Tắt trên máy này"}
          </Button>
        )}
      </div>

      {tt === "IOS_CHUA_CAI" && (
        <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
          {BUOC_CAI_IOS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ol>
      )}

      {loi && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{loi}</p>
      )}
      {xong && <p className="text-sm font-medium text-foreground">{xong}</p>}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Thiết bị nhận thông báo
        </p>
        {dangSong.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có thiết bị nào.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {dangSong.map((tb) => (
              <li key={tb.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {tenMay(tb)}
                    {!!bamMayNay && tb.bam === bamMayNay && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        máy này
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span title={tb.origin}>{nhanHost(tb.origin)}</span> ·{" "}
                    {/* Nhãn cắt của endpoint: thứ DUY NHẤT phân biệt được hai trình duyệt trông
                        giống hệt nhau qua `tenMay` (vd hai máy Chrome/Windows). KHÔNG phải
                        endpoint đầy đủ — xem `lib/push/thiet-bi.ts`. */}
                    <span className="font-mono">{tb.nhan}</span> · nhận gần nhất:{" "}
                    {ngayGon(tb.lastSuccessAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => go(tb.id)} disabled={dangChay}>
                  Gỡ
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
