/**
 * Bài VIDEO dùng link YouTube — lớp mỏng quanh YouTube IFrame Player API.
 *
 * CHỈ CHẠY Ở TRÌNH DUYỆT (nạp script `iframe_api`, đụng `window`). Mọi chỗ import tệp này
 * đều là component `"use client"`; đừng import nó từ server.
 *
 * Trình phát (`video-player.tsx`) vốn viết cho thẻ `<video>` và đọc/ghi bốn thứ trên nó:
 * `currentTime`, `playbackRate`, `paused/ended`, `pause()/play()`. `mayPhatTuYoutube` đặt
 * lên YouTube MỘT VỎ có đúng hình dạng đó — nhờ vậy toàn bộ logic nhịp xem, câu hỏi chèn,
 * chặn tua, trần tốc độ dùng chung cho cả hai nguồn và chỉ có MỘT bản.
 */

/** Phần của `HTMLVideoElement` mà trình phát thật sự dùng. */
export type MayPhat = Pick<
  HTMLVideoElement,
  "currentTime" | "playbackRate" | "paused" | "ended" | "pause" | "play"
>;

export type YtPlayer = {
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  setPlaybackRate(r: number): void;
  getAvailablePlaybackRates(): number[];
  /** -1 chưa bắt đầu · 0 hết · 1 đang phát · 2 tạm dừng · 3 đang tải đệm · 5 đã nạp. */
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(giay: number, choPhepTuaToi: boolean): void;
  destroy(): void;
};

type YtSuKien = { data: number };
type YtTuyChon = {
  videoId: string;
  host: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady?: () => void;
    onStateChange?: (e: YtSuKien) => void;
    onPlaybackRateChange?: (e: YtSuKien) => void;
    onError?: (e: YtSuKien) => void;
  };
};
type YtNamespace = { Player: new (el: HTMLElement, o: YtTuyChon) => YtPlayer };
type CuaSoYt = Window & { YT?: YtNamespace; onYouTubeIframeAPIReady?: () => void };

export const TRANG_THAI_YT = { HET: 0, DANG_PHAT: 1, TAM_DUNG: 2, DANG_TAI: 3 } as const;

/** Mã lỗi trình phát YouTube; `0` là mã RIÊNG của ta: không đọc được thời lượng. */
export class LoiYoutube extends Error {
  constructor(readonly ma: number) {
    super(`YouTube error ${ma}`);
    this.name = "LoiYoutube";
  }
}

/** Thông báo cho người đọc. `soan` chỉ cách khắc phục; `hoc` chỉ biết báo ai. */
export function thongBaoLoiYoutube(ma: number, vai: "soan" | "hoc"): string {
  if (vai === "hoc") {
    return ma === 0
      ? "Không tải được trình phát YouTube. Kiểm tra mạng, tắt trình chặn quảng cáo cho trang này rồi tải lại."
      : "Không phát được video này. Báo với phòng Đào tạo để kiểm tra lại link.";
  }
  switch (ma) {
    case 2:
      return "Link YouTube không hợp lệ.";
    // ⚠️ Đo bằng trình duyệt thật 27/10/2026: một mã video KHÔNG TỒN TẠI trả 101/150 chứ không phải
    // 100, và video Riêng tư cũng rơi vào 101/150. Nên câu cho 101/150 phải nói CẢ HAI nguyên nhân,
    // và câu cho 100 chỉ nói "không tìm thấy" — đừng khẳng định "Riêng tư" ở mã 100.
    case 100:
      return 'Không tìm thấy video này — link sai hoặc video đã bị xoá. Kiểm tra lại link; video cần ở chế độ "Không công khai" (Unlisted).';
    case 101:
    case 150:
      return 'Video không nhúng được: video đang ở chế độ "Riêng tư" hoặc chủ video đã tắt "Cho phép nhúng". Đặt video sang "Không công khai" (Unlisted), bật "Cho phép nhúng" trong YouTube Studio rồi thử lại.';
    case 5:
      return "Trình phát YouTube gặp lỗi. Thử lại sau ít phút.";
    default:
      return "Không đọc được thời lượng video (video phát trực tiếp?). Thử video khác.";
  }
}

const HAN_NAP_API_MS = 15_000;
let napApi: Promise<YtNamespace> | null = null;

/** Nạp `iframe_api` đúng MỘT lần cho cả trang, dù nhiều trình phát cùng hỏi. */
export function taiYoutubeApi(): Promise<YtNamespace> {
  const w = window as CuaSoYt;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (napApi) return napApi;

  napApi = new Promise<YtNamespace>((xong, hong) => {
    const han = setTimeout(() => {
      napApi = null;
      hong(new LoiYoutube(0));
    }, HAN_NAP_API_MS);

    // Có thể trang khác đã đặt móc này (vd. một trình phát khác) — gọi nối đuôi, đừng đè.
    const truoc = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      truoc?.();
      clearTimeout(han);
      if (w.YT?.Player) xong(w.YT);
      else {
        napApi = null;
        hong(new LoiYoutube(0));
      }
    };

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      clearTimeout(han);
      napApi = null;
      hong(new LoiYoutube(0));
    };
    document.head.appendChild(s);
  });
  return napApi;
}

export type TuyChonTrinhPhat = {
  videoId: string;
  /** Tắt phím mũi tên tua của YouTube (rào mềm; chỉ khi lượt giao chặn tua). */
  chanTua?: boolean;
  onTrangThai?: (trangThai: number) => void;
  onDoiTocDo?: () => void;
  /** Lỗi XẢY RA SAU KHI trình phát đã sẵn sàng. Lỗi trước đó làm Promise bị từ chối. */
  onLoi?: (ma: number) => void;
};

/**
 * Dựng trình phát vào `host` (phần tử TRỐNG, do ta tự tạo — YouTube THAY NÓ bằng iframe,
 * nên không được là phần tử React đang quản lý) và chờ tới khi sẵn sàng.
 *
 * Dùng miền `youtube-nocookie.com`: không đặt cookie theo dõi trước khi người học bấm phát.
 */
export async function taoTrinhPhatYoutube(
  host: HTMLElement,
  o: TuyChonTrinhPhat,
): Promise<YtPlayer> {
  const YT = await taiYoutubeApi();
  return new Promise<YtPlayer>((xong, hong) => {
    let sanSang = false;
    const p = new YT.Player(host, {
      videoId: o.videoId,
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: {
        controls: 1,
        disablekb: o.chanTua ? 1 : 0,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
        cc_load_policy: 1,
        cc_lang_pref: "vi",
        hl: "vi",
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          sanSang = true;
          xong(p);
        },
        onStateChange: (e) => o.onTrangThai?.(e.data),
        onPlaybackRateChange: () => o.onDoiTocDo?.(),
        onError: (e) => {
          if (sanSang) o.onLoi?.(e.data);
          else hong(new LoiYoutube(e.data));
        },
      },
    });
  });
}

/**
 * Chờ tới khi YouTube báo được thời lượng. Vừa `onReady` thì `getDuration()` thường còn 0
 * (siêu dữ liệu chưa về); video phát trực tiếp thì mãi là 0 ⇒ coi là không đọc được.
 *
 * ⚠️ `loiHienTai` là bắt buộc để báo ĐÚNG nguyên nhân với video Riêng tư / không tồn tại /
 * tắt nhúng: YouTube bắn `onReady` TRƯỚC rồi mới bắn `onError` (100, 101, 150) — đo bằng
 * trình duyệt thật 27/10/2026. Không nghe lỗi ở đây thì cả ba đều chờ hết hạn rồi báo chung
 * một câu "không đọc được thời lượng", và người soạn không biết phải đổi sang Không công khai.
 */
export async function docThoiLuongYoutube(
  p: YtPlayer,
  hanMs = 10_000,
  loiHienTai?: () => number | null,
): Promise<number> {
  const bat = Date.now();
  while (Date.now() - bat < hanMs) {
    const loi = loiHienTai?.() ?? null;
    if (loi !== null) throw new LoiYoutube(loi);
    const d = p.getDuration();
    if (d > 0) return Math.round(d);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new LoiYoutube(loiHienTai?.() ?? 0);
}

/**
 * Vỏ `MayPhat` quanh trình phát YouTube.
 *
 * ⚠️ `playbackRate = r` KHÔNG đặt thẳng `r`: YouTube chỉ có vài nấc (…1, 1.25, 1.5, 1.75, 2)
 * và gặp số lạ thì làm tròn TỚI NẤC GẦN NHẤT, có thể lên trên trần. Trình phát lại nghe
 * `onPlaybackRateChange` rồi kẹp về trần ⇒ trần 1.2 làm YouTube nhảy 1.25 ⇒ kẹp ⇒ 1.25 ⇒
 * … vô hạn. Nên ta tự chọn nấc LỚN NHẤT KHÔNG VƯỢT `r`.
 */
export function mayPhatTuYoutube(p: YtPlayer): MayPhat {
  return {
    get currentTime() {
      return p.getCurrentTime();
    },
    set currentTime(giay: number) {
      p.seekTo(giay, true);
    },
    get playbackRate() {
      return p.getPlaybackRate();
    },
    set playbackRate(r: number) {
      p.setPlaybackRate(nacTocDoKhongVuot(p.getAvailablePlaybackRates(), r));
    },
    get paused() {
      const s = p.getPlayerState();
      return s !== TRANG_THAI_YT.DANG_PHAT && s !== TRANG_THAI_YT.DANG_TAI;
    },
    get ended() {
      return p.getPlayerState() === TRANG_THAI_YT.HET;
    },
    pause() {
      p.pauseVideo();
    },
    play() {
      p.playVideo();
      return Promise.resolve();
    },
  };
}

/** Nấc lớn nhất ≤ `r`; không có nấc nào thấp hơn thì lấy nấc thấp nhất. */
export function nacTocDoKhongVuot(cacNac: number[], r: number): number {
  const nac = [...cacNac].sort((a, b) => a - b);
  if (nac.length === 0) return r;
  const duoi = nac.filter((x) => x <= r + 1e-9);
  return duoi.length > 0 ? duoi[duoi.length - 1]! : nac[0]!;
}
