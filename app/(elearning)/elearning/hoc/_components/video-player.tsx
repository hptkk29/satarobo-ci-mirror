"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThachThuc } from "@/lib/elearning/video-heartbeat-contract";
import {
  mayPhatTuYoutube,
  taoTrinhPhatYoutube,
  thongBaoLoiYoutube,
  LoiYoutube,
  type MayPhat,
  type YtPlayer,
} from "@/lib/elearning/youtube-iframe";
import { phatHienNhay } from "@/lib/elearning/youtube-nhay";
// Hàm THUẦN, không kéo theo mã chỉ-server — an toàn để import vào thành phần client.
import { seqKhoiDau, seqSauPhanHoi } from "@/lib/elearning/video-seq";

/**
 * EL-11 — TRÌNH PHÁT VIDEO BÀI HỌC.
 *
 * Tiêu thụ hợp đồng nhịp xem của EL-12a. Client chỉ ĐO và BÁO; mọi quyết định
 * "đã xem tới đâu" nằm ở server, và mọi con số gửi lên đều bị kẹp lại ở đó.
 *
 * ⚠️ Bốn cơ chế trong trình phát này là RÀO MỀM, không phải cổng:
 *  · khoá nút tốc độ · chặn tua · ẩn nút tải · chặn menu chuột phải
 * Tất cả đều sửa được từ bảng điều khiển trình duyệt. Chúng có mặt để người dùng
 * bình thường không vô tình làm sai, còn cổng thật nằm ở server. Đừng bao giờ
 * gỡ một kiểm tra ở server vì "trình phát đã chặn rồi".
 *
 * ⚠️ Hình mờ ĐỘNG (di chuyển theo chu kỳ) chứ không cố định một góc: hình mờ đứng
 * yên bị cắt khỏi khung hình trong vài giây, còn hình mờ chạy khắp khung thì cắt
 * xong mất luôn nội dung. Nó không chặn được việc quay màn hình — mục đích là làm
 * bản quay LỘ DANH TÍNH người quay.
 */

const NHIP_MS = 15_000;
const API = "/api/elearning/video-heartbeat";
/** Chu kỳ đổi vị trí hình mờ. */
const MO_MS = 7_000;

/**
 * ⚠️ NHẬP kiểu từ hợp đồng, KHÔNG khai lại ở đây. Bản khai tay cũ thiếu `luaChon`
 * và `chan`, và nó vẫn biên dịch xanh — đúng thứ hợp đồng sinh ra để chặn.
 */
type Phan = {
  ok: boolean;
  data?: {
    coveredSec: number;
    coveragePercent: number;
    status: string;
    /** `meta.seq` = số thứ tự server đang giữ — dùng để đồng bộ lại bộ đếm (`seqSauPhanHoi`). */
    meta?: { seq: number; denNhan?: number };
    thachThuc?: ThachThuc;
    saiRoi?: boolean;
  };
  error?: { code: string; message: string };
};

export function VideoPlayer(props: {
  enrollmentId: string;
  lessonId: string;
  /** Khoá tệp trên R2 — đường phát dựng từ đây, không nhận URL sẵn. Trống khi bài dùng YouTube. */
  videoKey?: string | null;
  captionKey?: string | null;
  /**
   * Bài dùng link YouTube (không công khai): phát bằng trình phát nhúng ngay trong trang.
   * Loại trừ với `videoKey`. Mọi cơ chế đo/chặn bên dưới dùng chung cho cả hai nguồn —
   * trình phát YouTube được bọc thành `MayPhat` có hình dạng của thẻ `<video>`.
   */
  youtubeId?: string | null;
  /** Vé phát đã ký ở server. Hết hạn thì tải lại trang. */
  ve: string;
  /** Nhãn hình mờ — họ tên + email người đang xem. */
  nhanMo: string;
  durationSec: number;
  coveredSecBanDau: number;
  maxPositionSecBanDau: number;
  /**
   * `seq` server đã lưu cho tiến độ này (0 nếu chưa có). Bộ đếm nhịp đi TIẾP từ đây — khởi tạo từ 0 ở mỗi
   * lần tải trang làm k nhịp đầu của lượt xem mới bị server coi là "đến muộn" và rơi mất (xem `video-seq.ts`).
   */
  seqBanDau?: number;
  /**
   * Tiến độ của lượt này thuộc một phiên bản CŨ của bài (lượt đã hoàn thành/thu hồi trước khi bài đổi nguồn): xem được
   * nhưng nhịp không được ghi và chứng nhận không đổi. Nói thẳng ra để người học không tưởng mình đang được tính.
   */
  khongGhi?: boolean;
  chanTua: boolean;
  tocDoToiDa: number;
}) {
  /**
   * "Máy phát" đang dùng: chính thẻ `<video>` (ref ở JSX bên dưới) hoặc vỏ bọc quanh
   * trình phát YouTube. Mọi chỗ đọc vị trí / tốc độ / dừng-phát đi qua đây.
   */
  const vidRef = useRef<MayPhat | null>(null);
  /** Phần tử TRỐNG do React quản lý; trình phát YouTube dựng bên trong một con do ta tự tạo. */
  const ytHost = useRef<HTMLDivElement>(null);
  const seq = useRef(seqKhoiDau(props.seqBanDau));
  /** Mốc đã xem tới, dùng cho rào chặn tua ở client. */
  const bienDaXem = useRef(props.maxPositionSecBanDau);
  /** Điểm bắt đầu khoảng đang xem của nhịp hiện tại. */
  const batDau = useRef(props.maxPositionSecBanDau);
  const dangGui = useRef(false);

  const [phu, setPhu] = useState(props.coveredSecBanDau);
  /**
   * ⚠️ Bản `ref` song song với state.
   *
   * `guiNhip` là `useCallback` — nó đóng gói giá trị state của lượt kết xuất tạo
   * ra nó, nên đọc `thachThuc` trong đó luôn thấy giá trị CŨ. Đúng loại lỗi đã cắn
   * ở trình tải video (`video-uploader.tsx`), và ở đây nó biểu hiện thành: trả lời
   * đúng nhưng video không chạy tiếp.
   *
   * Hai bản đi cùng nhau qua `datThachThuc`, không bao giờ đặt riêng.
   */
  const thachThucRef = useRef<ThachThuc | null>(null);
  const [thachThuc, setThachThucState] = useState<ThachThuc | null>(null);
  const datThachThuc = useCallback((v: ThachThuc | null) => {
    thachThucRef.current = v;
    setThachThucState(v);
  }, []);
  const [saiRoi, setSaiRoi] = useState(false);
  const [dangChon, setDangChon] = useState<string[]>([]);
  const [dangGuiTraLoi, setDangGuiTraLoi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [moGoc, setMoGoc] = useState(0);

  const src = props.videoKey
    ? `/api/elearning/media/${props.videoKey}?ve=${encodeURIComponent(props.ve)}`
    : undefined;

  // ── Gửi nhịp ──────────────────────────────────────────────────────────────
  const guiNhip = useCallback(
    async (traLoi?: { id: string; dapAn?: string | null }) => {
      const v = vidRef.current;
      if (!v) return;
      // Chặn chồng nhịp: mạng chậm làm nhịp sau chồng lên nhịp trước, và cả hai
      // mang cùng `seq` ⇒ server bỏ một cái, đo hụt.
      if (dangGui.current) return;

      const den = v.currentTime;
      const tu = Math.min(batDau.current, den);
      if (den - tu < 1 && !traLoi) return;

      dangGui.current = true;
      seq.current += 1;
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ve: props.ve,
            enrollmentId: props.enrollmentId,
            lessonId: props.lessonId,
            tuSec: tu,
            denSec: den,
            seq: seq.current,
            tocDo: v.playbackRate,
            tabHien: document.visibilityState === "visible",
            viTriSec: den,
            ...(traLoi ? { traLoiThachThuc: traLoi } : {}),
          }),
        });
        const json = (await res.json()) as Phan;

        if (!res.ok || !json.ok) {
          const ma = json.error?.code ?? "LOI";
          // 409 = xử xong rồi xem tiếp được; 403 = dừng hẳn. Phân biệt được là nhờ
          // hợp đồng khai TƯỜNG MINH từng mã một.
          if (res.status === 409) {
            v.pause();
            setLoi(json.error?.message ?? "Tạm dừng ghi nhận");
            if (ma === "SEEK_BLOCKED") {
              // Kéo con trỏ về mốc đã xem — không thì người học ngồi ở chỗ mà mọi
              // nhịp tiếp theo đều bị từ chối, và họ không hiểu vì sao.
              v.currentTime = bienDaXem.current;
              batDau.current = bienDaXem.current;
            }
          } else {
            v.pause();
            setLoi(json.error?.message ?? "Không ghi nhận được tiến độ");
          }
          return;
        }

        setLoi(null);
        if (json.data) {
          setPhu(json.data.coveredSec);
          // Luôn đồng bộ bộ đếm với số server đang giữ — không bao giờ thấp hơn nó.
          seq.current = seqSauPhanHoi(seq.current, json.data.meta?.seq);
          // ⚠️ `BO_QUA` = server KHÔNG nhận nhịp này (trùng / đến muộn / số thứ tự đã bị tab khác dùng). Khác
          // hẳn "đã nhận": nếu nhích `batDau` thì khoảng vừa xem bị coi như đã gửi và rơi mất vĩnh viễn. Giữ
          // nguyên mốc để nhịp kế tiếp (mang số thứ tự đã đồng bộ ở trên) gửi lại đúng khoảng đó.
          const daNhan = json.data.status !== "BO_QUA";
          // ⚠️ Chỉ nhích mốc khi nhịp này KHÔNG bị chặn bởi một câu hỏi. Nhích vô
          // điều kiện là đẩy `batDau` vượt qua mốc câu hỏi, và nhịp mang câu trả
          // lời sẽ bị cổng chặn-tua của server từ chối.
          // `denNhan` = server mới nhận tới đây (ngân sách thời gian thật chưa đủ cho cả khoảng khai). Đặt mốc nhịp
          // sau tại đó để phần chưa nhận được XIN LẠI thay vì mất; vắng mặt = đã nhận trọn tới `den`.
          const denNhan = json.data.meta?.denNhan;
          const moc = daNhan && typeof denNhan === "number" && denNhan < den ? Math.max(tu, denNhan) : den;
          if (daNhan && !json.data.thachThuc) {
            bienDaXem.current = Math.max(bienDaXem.current, moc);
            batDau.current = moc;
          }
          if (!daNhan) {
            // `BO_QUA` không mang câu hỏi nào: coi nó là "server nói không còn câu nào treo" sẽ gỡ nhầm lớp phủ
            // của một câu đang treo thật. Không đụng gì tới lớp phủ ở đây.
          } else if (json.data.thachThuc) {
            const tt = json.data.thachThuc;
            datThachThuc(tt);
            setSaiRoi(Boolean(json.data.saiRoi));
            // Câu hỏi CHẶN thì dừng video. Câu không chặn chỉ hiện lên.
            if (tt.chan) v.pause();

            // ⚠️ TUA VỀ ĐÚNG MỐC câu hỏi, và kéo `batDau` về theo.
            //
            // Video bị dừng giữa một nhịp, nên con trỏ đã chạy quá mốc tới vài
            // giây. Không kéo về thì nhịp MANG CÂU TRẢ LỜI bắt đầu ở chỗ vượt mốc
            // đã ghi, và chính cổng chặn-tua của server nuốt mất câu trả lời —
            // người học kẹt cứng với thông báo "khoá này không cho tua tới".
            //
            // Tua về cũng đúng về nội dung: câu hỏi neo vào giây đó, và họ sẽ xem
            // tiếp từ đó sau khi trả lời.
            if (tt.atSec != null) {
              v.currentTime = tt.atSec;
              // Mốc về đúng chỗ server ĐÃ NHẬN (≤ mốc câu hỏi): nếu ngân sách giữ lại một phần thì khoảng chưa nhận
              // vẫn được xin lại sau khi trả lời, không bị bỏ qua vì con trỏ đã tua về mốc.
              const nhanToi = moc < tt.atSec ? moc : tt.atSec;
              batDau.current = Math.min(tt.atSec, Math.max(tu, nhanToi));
              bienDaXem.current = Math.max(bienDaXem.current, batDau.current);
            }
          } else {
            // Server nói không còn câu nào treo ⇒ gỡ lớp phủ và chạy tiếp. Đây là
            // đường DUY NHẤT xoá câu hỏi; client không tự quyết.
            const dangTreo = thachThucRef.current != null;
            datThachThuc(null);
            setSaiRoi(false);
            if (dangTreo) void v.play();
          }
        }
      } catch {
        // Mất mạng: KHÔNG báo lỗi, KHÔNG dừng phát. Nhịp sau sẽ mang cả khoảng
        // chưa gửi được, vì `batDau` chỉ nhích lên khi server đã nhận.
      } finally {
        dangGui.current = false;
      }
    },
    [props.ve, props.enrollmentId, props.lessonId, datThachThuc],
  );

  // ── Đồng hồ nhịp ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const v = vidRef.current;
      if (!v || v.paused || v.ended) return;
      // Kiểm TRONG callback mỗi tick, không chỉ bật/tắt theo `visibilitychange`:
      // có trình duyệt vẫn chạy interval ở tab nền, và có ca chuyển tab không bắn
      // sự kiện đúng lúc.
      if (document.visibilityState !== "visible") return;
      void guiNhip();
    }, NHIP_MS);
    return () => clearInterval(t);
  }, [guiNhip]);

  // ── Rời tab thì DỪNG PHÁT — và GỬI NỐT khoảng đã xem ──────────────────────
  // `guiNhip` đổi danh tính theo vé/lượt học, còn hiệu ứng này gắn một lần: giữ bản mới nhất trong ref để
  // `visibilitychange` luôn gọi đúng bản đang sống.
  const guiNhipRef = useRef(guiNhip);
  useEffect(() => {
    guiNhipRef.current = guiNhip;
  }, [guiNhip]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "visible") return;
      vidRef.current?.pause();
      // Tab bị ẩn rồi có thể bị trình duyệt loại bỏ mà KHÔNG bắn `pagehide` (điện thoại hay làm vậy), và khoảng
      // đã xem từ nhịp cuối tới lúc ẩn (≤ 15 giây) sẽ mất. Gửi nốt ngay lúc ẩn: server chỉ cộng phần nằm trong
      // ngân sách thời gian thật, và khoảng ngắn hơn 1 giây thì `guiNhip` tự bỏ qua.
      void guiNhipRef.current();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  // ── Nhịp cuối lúc rời trang ───────────────────────────────────────────────
  useEffect(() => {
    const onLeave = () => {
      const v = vidRef.current;
      if (!v) return;
      const den = v.currentTime;
      const tu = Math.min(batDau.current, den);
      if (den - tu < 1) return;
      seq.current += 1;
      // `sendBeacon` là cách DUY NHẤT gửi được lúc unload — trình duyệt huỷ mọi
      // `fetch` đang bay. Không có nó thì khoảng xem cuối cùng của mỗi phiên
      // luôn mất, và với người xem một mạch rồi đóng tab thì mất gần hết.
      navigator.sendBeacon(
        API,
        new Blob(
          [
            JSON.stringify({
              ve: props.ve,
              enrollmentId: props.enrollmentId,
              lessonId: props.lessonId,
              tuSec: tu,
              denSec: den,
              seq: seq.current,
              tocDo: v.playbackRate,
              tabHien: false,
              viTriSec: den,
            }),
          ],
          { type: "application/json" },
        ),
      );
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [props.ve, props.enrollmentId, props.lessonId]);

  // ── Hình mờ động ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setMoGoc((g) => (g + 1) % 4), MO_MS);
    return () => clearInterval(t);
  }, []);

  // ── Rào chặn tua ở client ─────────────────────────────────────────────────
  // `useCallback` (không phải hàm trần) vì vòng theo dõi của nguồn YouTube giữ chúng trong
  // một effect: hàm trần đổi danh tính mỗi lượt kết xuất ⇒ effect dựng lại trình phát.
  const onSeeking = useCallback(() => {
    const v = vidRef.current;
    if (!v || !props.chanTua) return;
    if (v.currentTime > bienDaXem.current + 2) {
      // Kéo về ngay — server vẫn là chỗ phán, nhưng để người học tua thoải mái rồi
      // mới báo lỗi là cho họ xem một đoạn sẽ không được tính.
      v.currentTime = bienDaXem.current;
      setLoi("Khoá này không cho tua tới phần chưa xem");
      return;
    }
    batDau.current = v.currentTime;
  }, [props.chanTua]);

  const onRateChange = useCallback(() => {
    const v = vidRef.current;
    if (!v) return;
    if (v.playbackRate > props.tocDoToiDa) v.playbackRate = props.tocDoToiDa;
  }, [props.tocDoToiDa]);

  // ── Nguồn YouTube ─────────────────────────────────────────────────────────
  // YouTube không bắn sự kiện `seeking`, nên vị trí được hỏi mỗi 500ms và so với vị trí
  // LẼ RA phải có (`phatHienNhay`); nhảy thì đi qua đúng `onSeeking` của thẻ `<video>`.
  // Còn lại (nhịp 15s, rời tab, `sendBeacon`, câu hỏi chèn) dùng nguyên các đoạn trên vì
  // `vidRef` đã là vỏ `MayPhat`.
  useEffect(() => {
    const ma = props.youtubeId;
    const goc = ytHost.current;
    if (!ma || !goc) return;

    // YouTube THAY phần tử được truyền bằng iframe. Đưa thẳng phần tử React quản lý vào
    // thì lúc gỡ trang React `removeChild` một nút đã không còn ⇒ NotFoundError.
    const alvo = document.createElement("div");
    goc.appendChild(alvo);

    let huy = false;
    let player: YtPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    taoTrinhPhatYoutube(alvo, {
      videoId: ma,
      chanTua: props.chanTua,
      // 2 = tạm dừng, 0 = hết: tương ứng `onPause` / `onEnded` của thẻ `<video>`.
      onTrangThai: (s) => {
        if (s === 2 || s === 0) void guiNhip();
      },
      onDoiTocDo: onRateChange,
      onLoi: (code) => setLoi(thongBaoLoiYoutube(code, "hoc")),
    })
      .then((p) => {
        if (huy) {
          p.destroy();
          return;
        }
        player = p;
        const may = mayPhatTuYoutube(p);
        vidRef.current = may;
        let truoc = may.currentTime;
        let truocMs = Date.now();
        timer = setInterval(() => {
          const v = vidRef.current;
          if (!v) return;
          const nay = v.currentTime;
          const nayMs = Date.now();
          const kieu = phatHienNhay({
            truoc,
            truocMs,
            nay,
            nayMs,
            tocDo: v.playbackRate,
            dangPhat: !v.paused,
          });
          truoc = nay;
          truocMs = nayMs;
          if (kieu) onSeeking();
        }, 500);
      })
      .catch((e: unknown) => {
        if (!huy) {
          setLoi(thongBaoLoiYoutube(e instanceof LoiYoutube ? e.ma : 0, "hoc"));
        }
      });

    return () => {
      huy = true;
      if (timer) clearInterval(timer);
      vidRef.current = null;
      player?.destroy();
    };
  }, [props.youtubeId, props.chanTua, guiNhip, onSeeking, onRateChange]);

  /**
   * Gửi câu trả lời.
   *
   * ⚠️ KHÔNG xoá câu hỏi trước khi server trả lời. Bản đầu của hàm này gọi
   * `setThachThuc(null)` rồi mới gửi — nên khi server từ chối, người học thấy một
   * video dừng cộng thanh báo lỗi mà KHÔNG CÒN CÂU HỎI NÀO trên màn hình: kẹt
   * cứng, lối ra duy nhất là tải lại trang. Server là bên quyết định câu hỏi còn
   * treo hay không, nên chỉ nó mới được xoá nó (nhịp thành công trả về không kèm
   * `thachThuc` là tín hiệu xoá).
   *
   * ⚠️ Cũng không gọi `play()` vô điều kiện. Bản đầu gọi ngay sau khi gửi, nên nếu
   * server vừa từ chối và dừng video thì dòng này bật lại nó — video chạy tiếp
   * trong khi mọi nhịp sau đều bị từ chối.
   */
  const traLoi = async () => {
    const tt = thachThuc;
    if (!tt || dangGuiTraLoi) return;
    setDangGuiTraLoi(true);
    try {
      await guiNhip({
        id: tt.id,
        // Câu chỉ xác nhận có mặt thì không có đáp án để gửi.
        dapAn: tt.luaChon.length > 0 ? dangChon.join(",") : undefined,
      });
    } finally {
      setDangGuiTraLoi(false);
      setDangChon([]);
    }
  };

  /** Bật/tắt một lựa chọn. Câu nhiều đáp án cho chọn nhiều; còn lại chỉ một. */
  const chon = (ma: string, nhieu: boolean) => {
    setDangChon((cu) =>
      nhieu
        ? cu.includes(ma)
          ? cu.filter((x) => x !== ma)
          : [...cu, ma].sort()
        : [ma],
    );
  };

  const pct = props.durationSec > 0 ? Math.round((phu / props.durationSec) * 100) : 0;
  const viTriMo = [
    "top-4 left-4",
    "top-4 right-4",
    "bottom-16 right-4",
    "bottom-16 left-4",
  ][moGoc];

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-black">
        {props.youtubeId ? (
          // Trình phát YouTube dựng vào phần tử con do effect tự tạo; phần tử này để TRỐNG.
          <div
            ref={ytHost}
            data-nguon="youtube"
            className="aspect-video w-full [&_iframe]:h-full [&_iframe]:w-full"
          />
        ) : (
          <video
            ref={(el) => {
              vidRef.current = el;
            }}
            src={src}
            controls
            playsInline
            preload="metadata"
            // Ẩn nút tải và chặn hình-trong-hình: cả hai đều là đường mang tệp ra
            // ngoài khung có hình mờ.
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            onSeeking={onSeeking}
            onRateChange={onRateChange}
            onPause={() => void guiNhip()}
            onEnded={() => void guiNhip()}
            className="aspect-video w-full"
          >
            {props.captionKey ? (
              <track
                kind="captions"
                srcLang="vi"
                label="Tiếng Việt"
                default
                src={`/api/elearning/media/${props.captionKey}?ve=${encodeURIComponent(props.ve)}`}
              />
            ) : null}
          </video>
        )}

        {/* Hình mờ nằm NGOÀI thẻ video và `pointer-events-none` — trong thẻ thì
            trình duyệt không vẽ, còn bắt chuột thì nó chặn mất nút điều khiển. */}
        <div
          className={`pointer-events-none absolute ${viTriMo} select-none rounded bg-black/30 px-2 py-1 text-[11px] text-white/70 transition-all duration-1000`}
        >
          {props.nhanMo}
        </div>

        {thachThuc ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
            <div className="max-w-sm rounded-lg bg-background p-5">
              <p className="text-sm font-medium">{thachThuc.cauHoi}</p>

              {/* Câu có lựa chọn = câu hỏi chèn giữa video. Câu không có lựa chọn
                  = điểm kiểm tra tập trung, chỉ cần một nút xác nhận có mặt. */}
              {thachThuc.luaChon.length > 0 ? (
                <div className="mt-3 space-y-1.5 text-left">
                  {thachThuc.luaChon.map((lc) => {
                    // ⚠️ Đọc CỜ từ hợp đồng, không suy từ số lựa chọn. Bản đầu
                    // suy bằng `luaChon.length > 2`, nên một câu MỘT-đáp-án có 3
                    // lựa chọn trở lên biến thành ô tích nhiều: người học tích hai
                    // ý, client gửi "0,2", và câu họ trả lời đúng bị chấm sai.
                    const chonNhieu = thachThuc.chonNhieu === true;
                    const dangBat = dangChon.includes(lc.ma);
                    return (
                      <button
                        key={lc.ma}
                        type="button"
                        onClick={() => chon(lc.ma, chonNhieu)}
                        className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          dangBat ? "border-primary bg-primary/10 font-medium" : ""
                        }`}
                      >
                        {lc.nhan}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* Sai thì nói SAI và cho làm lại tại chỗ — không khoá, không trừ gì.
                  Khoá lại là nhốt người học ra khỏi một bài có hạn chót cứng, mà
                  họ không có đường kháng nghị nào. */}
              {saiRoi ? (
                <p className="mt-3 text-sm font-medium text-state-warning-ink">
                  Chưa đúng — chọn lại rồi gửi tiếp.
                </p>
              ) : null}

              <button
                type="button"
                disabled={
                  dangGuiTraLoi ||
                  (thachThuc.luaChon.length > 0 && dangChon.length === 0)
                }
                onClick={() => void traLoi()}
                className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {dangGuiTraLoi
                  ? "Đang gửi…"
                  : thachThuc.luaChon.length > 0
                    ? "Gửi câu trả lời"
                    : "Tôi vẫn đang xem"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Đã xem {Math.round(phu / 60)} / {Math.round(props.durationSec / 60)} phút ·{" "}
          {pct}%
        </span>
        {pct >= 95 ? (
          <span className="font-medium text-state-success-ink">Đã hoàn thành</span>
        ) : null}
      </div>

      {props.khongGhi ? (
        <p role="note" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Bạn đã hoàn thành khoá này trước khi video của bài được thay. Bạn vẫn xem được, nhưng lượt xem này không được ghi
          nhận và không ảnh hưởng tới kết quả hay chứng nhận của bạn.
        </p>
      ) : null}

      {loi ? (
        <p role="alert" className="rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm text-foreground">{loi}</p>
      ) : null}
    </div>
  );
}
