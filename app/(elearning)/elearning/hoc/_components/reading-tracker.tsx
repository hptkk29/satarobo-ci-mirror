"use client";

import { useEffect, useRef, useState } from "react";

/**
 * EL-04 — ĐO THỜI GIAN ĐỌC ở phía client.
 *
 * Client chỉ ĐO và BÁO. Mọi quyết định "đã đọc xong chưa" nằm ở server
 * (`lib/elearning/reading-progress.ts`) — con số client gửi lên đều bị kẹp lại.
 * Component này không được tin, và nó không cần được tin.
 */

const NHIP_MS = 15_000;
const API = "/api/elearning/reading-heartbeat";

export function ReadingTracker(props: {
  enrollmentId: string;
  lessonId: string;
  /** Số giây đã lưu ở server — để tab mở sau không bắt đầu lại từ 0. */
  readSecondsBanDau: number;
  scrollMaxPctBanDau: number;
  minReadSeconds: number;
  daXong: boolean;
}) {
  const giay = useRef(props.readSecondsBanDau);
  const cuon = useRef(props.scrollMaxPctBanDau);
  const seq = useRef(0);
  const [hienThi, setHienThi] = useState({
    giay: props.readSecondsBanDau,
    cuon: props.scrollMaxPctBanDau,
    xong: props.daXong,
  });

  // ── Đồng hồ ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      // ⚠️ Kiểm TRONG callback mỗi tick, KHÔNG chỉ dừng/chạy interval theo sự kiện
      // visibilitychange. Có trình duyệt vẫn chạy interval ở tab nền (bị bóp
      // xuống ~1 lần/phút), và có ca chuyển tab không bắn sự kiện đúng lúc — dừng
      // theo sự kiện thì thời gian tab nền vẫn được cộng, tức đo sai theo hướng
      // có lợi cho người bỏ tab đó rồi đi làm việc khác.
      if (document.visibilityState !== "visible") return;
      giay.current += 1;
      setHienThi((s) => ({ ...s, giay: giay.current }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Cuộn ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const doCuon = () => {
      const el = document.documentElement;
      const conLai = el.scrollHeight - el.clientHeight;
      // Bài NGẮN HƠN màn hình: không cuộn được, nên "đã cuộn hết" là đúng. Không
      // xử ca này thì mọi bài ngắn mắc kẹt ở 0% và không bao giờ hoàn thành được.
      const pct = conLai <= 0 ? 100 : Math.round((el.scrollTop / conLai) * 100);
      if (pct > cuon.current) {
        cuon.current = Math.min(100, pct);
        setHienThi((s) => ({ ...s, cuon: cuon.current }));
      }
    };
    doCuon();
    window.addEventListener("scroll", doCuon, { passive: true });
    window.addEventListener("resize", doCuon);
    return () => {
      window.removeEventListener("scroll", doCuon);
      window.removeEventListener("resize", doCuon);
    };
  }, []);

  // ── Gửi nhịp ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const goi = () => ({
      enrollmentId: props.enrollmentId,
      lessonId: props.lessonId,
      readSeconds: giay.current,
      scrollMaxPct: cuon.current,
      seq: ++seq.current,
    });

    const gui = async () => {
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(goi()),
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { snapshot: { readSeconds: number }; done: boolean };
        };
        if (json.ok && json.data) {
          // Nhận lại số ĐÃ KẸP từ server: nếu client đang cao hơn thì kéo về, để
          // thanh tiến độ trên màn hình khớp với thứ thật sự được ghi. Không làm
          // thì người dùng thấy "đã đủ" mà hệ thống vẫn coi là chưa.
          giay.current = Math.max(giay.current, json.data.snapshot.readSeconds);
          setHienThi({
            giay: json.data.snapshot.readSeconds,
            cuon: cuon.current,
            xong: json.data.done,
          });
        }
      } catch {
        // Mạng chập là chuyện thường giữa buổi đọc. Nhịp sau sẽ mang số luỹ kế
        // nên không mất gì — im lặng ở đây là đúng, báo lỗi mới là sai.
      }
    };

    const t = setInterval(gui, NHIP_MS);

    // Nhịp CUỐI lúc rời trang. `fetch` bị trình duyệt huỷ khi unload, nên phải
    // `sendBeacon` — đó cũng chính là lý do đường nhịp là Route Handler chứ không
    // phải Server Action.
    const chot = () => {
      const blob = new Blob([JSON.stringify(goi())], { type: "application/json" });
      navigator.sendBeacon(API, blob);
    };
    // `pagehide` chứ không `beforeunload`: trên iOS Safari `beforeunload` gần như
    // không bắn, và trang bị đưa vào bfcache thì cũng chỉ có `pagehide`.
    window.addEventListener("pagehide", chot);
    const doiTab = () => {
      if (document.visibilityState === "hidden") chot();
    };
    document.addEventListener("visibilitychange", doiTab);

    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", chot);
      document.removeEventListener("visibilitychange", doiTab);
    };
  }, [props.enrollmentId, props.lessonId]);

  const conThieu = Math.max(0, props.minReadSeconds - hienThi.giay);

  return (
    <div
      className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 text-sm backdrop-blur"
      // Vùng cập nhật liên tục: `polite` để trình đọc màn hình không cắt ngang
      // người dùng ở mỗi giây, nhưng vẫn thông báo khi trạng thái đổi.
      aria-live="polite"
    >
      {hienThi.xong ? (
        <span className="font-medium text-state-success-ink">
          ✓ Đã hoàn thành bài này
        </span>
      ) : (
        <span className="text-muted-foreground">
          Đã đọc {hienThi.giay}s
          {conThieu > 0 ? ` · còn ${conThieu}s` : " · đủ thời gian"}
          {hienThi.cuon < 90
            ? ` · đã xem ${hienThi.cuon}% bài, cần cuộn tới cuối`
            : " · đã xem hết bài"}
        </span>
      )}
    </div>
  );
}
