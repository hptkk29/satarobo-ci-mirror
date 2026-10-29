"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { luuBaiVideoYoutubeAction, xemTruocDoiNguonAction } from "../_actions";
import { HopXacNhanDoiNguon, thongBaoDaDoiVideo } from "./hop-xac-nhan-doi-nguon";
import { tachMaYoutube, linkXemYoutube } from "@/lib/elearning/youtube-link";
import { VIDEO_MIN_SEC, YOUTUBE_MAX_SEC } from "@/lib/elearning/media-rules";
import {
  docThoiLuongYoutube,
  LoiYoutube,
  taoTrinhPhatYoutube,
  thongBaoLoiYoutube,
  type YtPlayer,
} from "@/lib/elearning/youtube-iframe";
// Chỉ KIỂU — xoá sạch lúc biên dịch, không kéo mã chỉ-server vào thành phần client.
import type { KetQuaXemTruoc } from "@/lib/elearning/video-doi-nguon";

/**
 * Bài VIDEO — DÁN LINK YOUTUBE (video "Không công khai") thay cho việc tải MP4 lên.
 *
 * Luồng: dán link → "Kiểm tra link" dựng thử trình phát NGAY TRONG trang để (1) người soạn
 * thấy video chạy được, (2) đọc THỜI LƯỢNG thật từ trình phát — đó là mẫu số của mọi phần
 * trăm "đã xem" — rồi mới "Lưu". Link Riêng tư / bị tắt nhúng / sai mã lộ ra ở bước kiểm
 * tra, không để tới lúc học viên mở bài mới biết.
 *
 * Bài ĐÃ CÓ nguồn: "Lưu" không lưu ngay mà XEM TRƯỚC tác động (server đếm người học bị ảnh hưởng và phát chuỗi xác nhận
 * ký), thu LÝ DO, rồi mới lưu kèm chuỗi đó. Server kiểm lại chuỗi trong giao dịch; nếu người học bị ảnh hưởng đã đổi từ lúc
 * xem trước (`TAC_DONG_DA_DOI`) form xem trước LẠI và xin xác nhận lại.
 *
 * ⚠️ Thời lượng do trình duyệt người soạn đọc rồi gửi lên: server không có cách đọc header
 * như với tệp MP4. Server vẫn kẹp trong khoảng hợp lý và TỰ tách lại mã từ link.
 */

type Buoc = "cho" | "dang-kiem" | "da-kiem" | "dang-luu";

/** Mã lỗi của server buộc form xem trước LẠI (xem `video-doi-nguon-rule.ts`). */
const MA_XEM_TRUOC_LAI = new Set(["TAC_DONG_DA_DOI", "CAN_XAC_NHAN_TAC_DONG"]);

function chuThoiLuong(giay: number): string {
  const p = Math.floor(giay / 60);
  const s = giay % 60;
  return p > 0 ? `${p} phút ${String(s).padStart(2, "0")} giây` : `${s} giây`;
}

export function YoutubeLinkForm(props: {
  lessonId: string;
  title: string;
  /** Mã video đang gắn vào bài (nếu bài đang dùng YouTube). */
  youtubeIdHienCo: string | null;
  durationSecHienCo: number | null;
  coPhuDeHienCo: boolean;
  /** Bài đang có tệp MP4 tải lên — lưu link sẽ thay thế nó. */
  coTepHienCo: boolean;
  /** Người soạn có quyền XUẤT BẢN nội dung (server hỏi cùng câu). Thiếu mà việc đổi đòi quyền ⇒ form không vẽ nút lưu. */
  coQuyenXuatBan: boolean;
  /** Khoá chứa bài đã xuất bản. */
  khoaDaXuatBan: boolean;
  /** Bài đã có hàng tiến độ của người học. */
  coNguoiHoc: boolean;
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [buoc, setBuoc] = useState<Buoc>("cho");
  const [loiKiem, setLoiKiem] = useState<string | null>(null);
  const [yeuCau, setYeuCau] = useState<{ ma: string; lan: number } | null>(null);
  const [kq, setKq] = useState<{ ma: string; giay: number } | null>(null);
  const [coPhuDe, setCoPhuDe] = useState(props.coPhuDeHienCo);
  /**
   * Bản XEM TRƯỚC do server dựng cho đúng link + thời lượng đang chọn: số người học bị ảnh hưởng, câu nói thẳng tác động và
   * chuỗi xác nhận ký. `null` = chưa xem trước (hoặc đã bỏ).
   */
  const [xt, setXt] = useState<KetQuaXemTruoc | null>(null);
  /** Đếm lần xem trước: hộp xác nhận dựng MỚI mỗi lần (ô tick + lý do của lần trước không được mang sang số liệu mới). */
  const [lanXt, setLanXt] = useState(0);
  const [daDoiTap, setDaDoiTap] = useState(false);
  const [loiHop, setLoiHop] = useState<string | null>(null);
  /** Lý do đã gõ ở hộp trước: giữ lại khi hộp dựng MỚI (xem trước lại), không bắt gõ lại. */
  const [lyDoDaGo, setLyDoDaGo] = useState("");
  const khung = useRef<HTMLDivElement>(null);

  const coNguonHienCo = Boolean(props.youtubeIdHienCo) || props.coTepHienCo;
  // Thiếu quyền xuất bản mà bài thuộc khoá đã xuất bản / đã có người học ⇒ vô hiệu hoá (server vẫn là cổng thật).
  const biChan = coNguonHienCo && (props.khoaDaXuatBan || props.coNguoiHoc) && !props.coQuyenXuatBan;

  // Dựng trình phát thử mỗi khi có yêu cầu kiểm tra mới. Chạy trong effect (không trong
  // trình xử lý nút) vì khung chứa phải đã được React vẽ ra trước khi YouTube thay nó.
  useEffect(() => {
    const goc = khung.current;
    if (!yeuCau || !goc) return;
    const alvo = document.createElement("div");
    goc.replaceChildren(alvo);
    let huy = false;
    let player: YtPlayer | null = null;

    (async () => {
      try {
        // YouTube báo video Riêng tư / không có thật / tắt nhúng bằng `onError` SAU `onReady`,
        // nên lỗi phải được hứng ở đây và đưa cho bước chờ thời lượng — xem `docThoiLuongYoutube`.
        let maLoi: number | null = null;
        player = await taoTrinhPhatYoutube(alvo, {
          videoId: yeuCau.ma,
          onLoi: (m) => {
            maLoi = m;
          },
        });
        // Effect đã bị dọn trong lúc chờ (đổi link, lưu xong, StrictMode chạy effect hai lần):
        // lúc dọn `player` còn null nên không ai huỷ nó — huỷ ở đây, kẻo iframe mồ côi chạy tiếp.
        if (huy) {
          player.destroy();
          return;
        }
        const giay = await docThoiLuongYoutube(player, undefined, () => maLoi);
        if (huy) return;
        if (giay < VIDEO_MIN_SEC || giay > YOUTUBE_MAX_SEC) {
          setLoiKiem(
            giay < VIDEO_MIN_SEC
              ? `Video dưới ${VIDEO_MIN_SEC} giây gần như chắc chắn là dán nhầm link.`
              : `Video tối đa ${Math.round(YOUTUBE_MAX_SEC / 3600)} giờ. Video này ${chuThoiLuong(giay)} — tách thành nhiều bài.`,
          );
          setKq(null);
          setBuoc("cho");
          return;
        }
        setKq({ ma: yeuCau.ma, giay });
        setBuoc("da-kiem");
      } catch (e) {
        if (huy) return;
        setLoiKiem(thongBaoLoiYoutube(e instanceof LoiYoutube ? e.ma : 0, "soan"));
        setKq(null);
        setBuoc("cho");
      }
    })();

    return () => {
      huy = true;
      player?.destroy();
    };
  }, [yeuCau]);

  const kiem = () => {
    setLoiKiem(null);
    setKq(null);
    setXt(null); // bản xem trước thuộc về link CŨ — link mới thì xem trước lại từ đầu
    setDaDoiTap(false);
    setLoiHop(null);
    setLyDoDaGo("");
    const ma = tachMaYoutube(link);
    if (!ma) {
      setLoiKiem(
        "Đây không phải link một video YouTube. Dán link dạng youtu.be/… hoặc youtube.com/watch?v=…",
      );
      setBuoc("cho");
      return;
    }
    setBuoc("dang-kiem");
    setYeuCau((cu) => ({ ma, lan: (cu?.lan ?? 0) + 1 }));
  };

  /** Lưu thật. `xacNhan` có ⇒ đi kèm chuỗi xác nhận + lý do (bài đã có nguồn và nội dung thật sự đổi). */
  const luu = async (xacNhan?: { token: string | null; lyDo: string }) => {
    if (!kq) return;
    setBuoc("dang-luu");
    setLoiHop(null);
    try {
      const r = await luuBaiVideoYoutubeAction(
        {
          lessonId: props.lessonId,
          title: props.title,
          url: linkXemYoutube(kq.ma),
          durationSec: kq.giay,
          coPhuDe,
          ...(xacNhan?.token ? { xacNhanToken: xacNhan.token } : {}),
        },
        xacNhan ? { reason: xacNhan.lyDo } : undefined,
      );
      if (!r.ok) {
        if (MA_XEM_TRUOC_LAI.has(r.error.code)) {
          // Người học bị ảnh hưởng đã đổi / chuỗi hết hạn / nguồn đã đổi: xem trước LẠI, không tin số liệu cũ.
          await xemTruoc(r.error.code === "TAC_DONG_DA_DOI");
          // Mã thứ hai KHÔNG phải 'tập người học đổi' (hết hạn 15 phút, phiên bản/nguồn đã đổi…): hộp dựng mới trống mà không nói gì là khó hiểu.
          if (r.error.code !== "TAC_DONG_DA_DOI") setLoiHop("Xác nhận trước đó đã hết hiệu lực (hết hạn hoặc nội dung bài đã đổi). Đọc lại số liệu rồi xác nhận lại.");
          return;
        }
        // `xacNhan` (không phải `xt` của lần kết xuất cũ): hàm này có thể là bản của kết xuất TRƯỚC khi `xemTruoc` dựng lại hộp.
        if (xacNhan) {
          setLoiHop(r.error.message);
          setBuoc("da-kiem");
          return;
        }
        throw new Error(r.error.message);
      }
      toast.success(xacNhan ? thongBaoDaDoiVideo(xt) : "Đã gắn link YouTube vào bài");
      setXt(null);
      setDaDoiTap(false);
      setLink("");
      setKq(null);
      setYeuCau(null);
      setBuoc("cho");
      router.refresh();
    } catch (e) {
      setBuoc("da-kiem");
      toast.error(e instanceof Error ? e.message : "Lưu link thất bại");
    }
  };

  /** Hỏi server tác động của việc lưu link này. Không đổi nội dung thật ⇒ lưu thẳng; đổi ⇒ hiện hộp lý do + xác nhận. */
  const xemTruoc = async (laDoiTap = false) => {
    if (!kq) return;
    setBuoc("dang-luu");
    try {
      const r = await xemTruocDoiNguonAction({
        lessonId: props.lessonId,
        loai: "YOUTUBE",
        url: linkXemYoutube(kq.ma),
        durationSec: kq.giay,
      });
      if (!r.ok) throw new Error(r.error.message);
      if (!r.data.doiNguon) {
        setXt(null);
        await luu();
        return;
      }
      setXt(r.data);
      setLanXt((n) => n + 1);
      setDaDoiTap(laDoiTap);
      setBuoc("da-kiem");
    } catch (e) {
      setBuoc("da-kiem");
      toast.error(e instanceof Error ? e.message : "Không xem trước được tác động");
    }
  };

  const batDauLuu = () => {
    // Bài CHƯA có nguồn: gắn lần đầu, chưa có nội dung cũ nào để thay ⇒ lưu thẳng.
    if (!coNguonHienCo) void luu();
    else void xemTruoc();
  };

  const dangBan = buoc === "dang-kiem" || buoc === "dang-luu";

  return (
    <section
      aria-labelledby="yt-tieu-de"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="yt-tieu-de" className="text-base font-semibold text-foreground">
        Hoặc dán link YouTube
      </h2>

      {props.youtubeIdHienCo && (
        <p className="text-sm text-muted-foreground">
          Bài đang dùng link YouTube
          {props.durationSecHienCo
            ? ` · ${chuThoiLuong(props.durationSecHienCo)}`
            : ""}
          . Dán link khác để thay.
        </p>
      )}
      {props.coTepHienCo && (
        <p className="text-sm text-muted-foreground">
          Bài đang có tệp video tải lên — lưu link YouTube sẽ thay thế tệp đó.
        </p>
      )}

      {biChan && (
        <p role="note" data-testid="khong-du-quyen-doi-video" className="text-sm text-state-danger-ink">
          {props.khoaDaXuatBan
            ? "Khoá này đã xuất bản — đổi video của bài cần quyền xuất bản nội dung."
            : "Bài này đã có người học — đổi video cần quyền xuất bản nội dung."}{" "}
          Bạn chưa có quyền đó; nhờ phòng Đào tạo.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode="url"
          aria-label="Link YouTube"
          aria-invalid={loiKiem ? true : undefined}
          aria-describedby={loiKiem ? "yt-loi" : undefined}
          placeholder="https://youtu.be/…"
          value={link}
          disabled={dangBan || biChan}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !dangBan && !biChan && link.trim()) kiem();
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={kiem}
          disabled={dangBan || biChan || !link.trim()}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {buoc === "dang-kiem" ? "Đang kiểm tra…" : "Kiểm tra link"}
        </button>
      </div>

      {loiKiem && (
        <p id="yt-loi" role="alert" className="text-sm text-state-danger-ink">
          {loiKiem}
        </p>
      )}

      {/* Khung trình phát thử: chỉ hiện từ lúc bấm kiểm tra. Để TRỐNG — React không quản lý
          phần tử con, effect ở trên tự dựng vào đó. */}
      <div
        ref={khung}
        data-testid="yt-xem-thu"
        className={`aspect-video w-full max-w-xl overflow-hidden rounded-lg bg-black [&_iframe]:h-full [&_iframe]:w-full ${
          buoc === "cho" ? "hidden" : ""
        }`}
      />

      {buoc === "da-kiem" || buoc === "dang-luu" ? (
        kq && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Đọc được thời lượng:{" "}
              <strong data-testid="yt-thoi-luong">{chuThoiLuong(kq.giay)}</strong>. Đây là
              mẫu số để tính % mỗi nhân viên đã xem.
            </p>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={coPhuDe}
                disabled={buoc === "dang-luu" || xt != null}
                onChange={(e) => setCoPhuDe(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Video đã bật phụ đề tiếng Việt trên YouTube
                <span className="block text-muted-foreground">
                  Khoá bắt buộc chỉ xuất bản được khi mọi bài video có phụ đề. Hệ thống không
                  đọc được phụ đề bên YouTube nên tin vào xác nhận này.
                </span>
              </span>
            </label>
            {xt ? (
              <HopXacNhanDoiNguon
                key={lanXt}
                xt={xt}
                dangLuu={buoc === "dang-luu"}
                daDoiTapNguoiHoc={daDoiTap}
                loi={loiHop}
                lyDoBanDau={lyDoDaGo}
                onXacNhan={(lyDo) => {
                  setLyDoDaGo(lyDo);
                  void luu({ token: xt.xacNhanToken, lyDo });
                }}
                onHuy={() => {
                  setXt(null);
                  setDaDoiTap(false);
                  setLoiHop(null);
                  setLyDoDaGo("");
                }}
              />
            ) : (
              <button
                type="button"
                onClick={batDauLuu}
                disabled={buoc === "dang-luu" || biChan}
                className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {buoc === "dang-luu" ? "Đang xử lý…" : coNguonHienCo ? "Xem tác động và lưu link" : "Lưu link vào bài"}
              </button>
            )}
          </div>
        )
      ) : null}

      <p className="text-sm text-muted-foreground">
        Dùng chế độ <strong>Không công khai</strong> (Unlisted) — video không hiện trên kênh hay
        tìm kiếm nhưng nhúng được. Chế độ <strong>Riêng tư</strong> (Private) KHÔNG phát được
        trong hệ thống. Nhân viên xem ngay trong trang học và hệ thống ghi % thời lượng đã xem
        của từng người như với tệp tải lên. Ai có link vẫn mở được video trên YouTube; phần xem
        ngoài hệ thống không được tính.
      </p>
    </section>
  );
}
