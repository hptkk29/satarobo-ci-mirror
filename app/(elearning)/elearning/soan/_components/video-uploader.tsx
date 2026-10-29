"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { luuBaiVideoAction, xemTruocDoiNguonAction } from "../_actions";
import { HopXacNhanDoiNguon, thongBaoDaDoiVideo } from "./hop-xac-nhan-doi-nguon";
// Chỉ KIỂU — xoá sạch lúc biên dịch, không kéo mã chỉ-server vào thành phần client.
import type { LuuBaiVideoInput } from "@/lib/elearning/video-lesson";
import type { KetQuaXemTruoc } from "@/lib/elearning/video-doi-nguon";

/**
 * EL-10 — TẢI VIDEO CHO MỘT BÀI HỌC.
 *
 * Nối trọn chuỗi: mở lượt tải nhiều phần → PUT từng phần THẲNG lên R2 → hoàn tất
 * → máy chủ đọc header mp4 để lấy codec và thời lượng THẬT → lưu vào bài.
 *
 * ⚠️ Thanh tiến độ đếm theo SỐ PHẦN đã xong, không phải theo byte. Với tệp 200MB
 * qua mạng chậm thì lượt tải kéo dài nhiều phút; không có tiến độ thì người soạn
 * không biết nó còn chạy hay đã treo, và họ sẽ bấm lại — tạo ra lượt tải thứ hai.
 *
 * ⚠️ Nút HUỶ là bắt buộc, không phải tiện nghi. Bỏ lượt tải giữa chừng mà không
 * gọi `huy` để lại các phần đã tải trên R2 và R2 tính tiền chúng; cron đêm dọn
 * được, nhưng chỉ sau 24 giờ.
 */

type TrangThai = "cho" | "dang-tai" | "dang-xac-minh" | "cho-xac-nhan" | "dang-luu" | "xong";

type DauVaoLuu = LuuBaiVideoInput;

/** Mã lỗi của server buộc form xem trước LẠI (xem `video-doi-nguon-rule.ts`). */
const MA_XEM_TRUOC_LAI = new Set(["TAC_DONG_DA_DOI", "CAN_XAC_NHAN_TAC_DONG"]);

export function VideoUploader(props: {
  lessonId: string;
  title: string;
  videoKeyHienCo: string | null;
  durationSecHienCo: number | null;
  /** Bài đã có MỘT nguồn nào đó (tệp hoặc link YouTube) — tải tệp mới là ĐỔI nội dung, không phải gắn lần đầu. */
  coNguonHienCo: boolean;
  /** Người soạn có quyền XUẤT BẢN nội dung (server hỏi cùng câu). Thiếu mà việc đổi đòi quyền đó ⇒ không vẽ ô chọn tệp. */
  coQuyenXuatBan: boolean;
  /** Khoá chứa bài đã xuất bản. */
  khoaDaXuatBan: boolean;
  /** Bài đã có hàng tiến độ của người học. */
  coNguoiHoc: boolean;
}) {
  const router = useRouter();
  const [trangThai, setTrangThai] = useState<TrangThai>(
    props.videoKeyHienCo ? "xong" : "cho",
  );
  // Thiếu quyền xuất bản mà bài thuộc khoá đã xuất bản / đã có người học ⇒ vô hiệu hoá (server vẫn là cổng thật).
  const biChan = props.coNguonHienCo && (props.khoaDaXuatBan || props.coNguoiHoc) && !props.coQuyenXuatBan;
  const [xong, setXong] = useState(0);
  const [tong, setTong] = useState(0);
  /**
   * Việc đổi video cần người soạn đọc tác động + ghi lý do (+ xác nhận khi khoá đã xuất bản / đã có người học): tệp ĐÃ tải và
   * ĐÃ kiểm xong, đầu vào lưu được giữ lại ở đây cùng BẢN XEM TRƯỚC do server dựng (số liệu + chuỗi xác nhận ký). Bấm xác nhận
   * là gửi lại ĐÚNG đầu vào đó kèm chuỗi — không tải lại tệp. Server là bên đếm tác động và ép xác nhận; đây chỉ là chỗ hiện.
   */
  const [canXacNhan, setCanXacNhan] = useState<{ xt: KetQuaXemTruoc; dauVao: DauVaoLuu } | null>(null);
  /**
   * 'Hộp xác nhận đang hiện' ở dạng REF, đồng bộ với state qua `datHop`: các nhánh `catch` chạy trong closure của kết xuất CŨ nên đọc
   * state `canXacNhan` là đọc giá trị đã lỗi thời — lỗi bị nuốt hoặc form kẹt ở 'cho-xac-nhan' mà không có hộp nào để thoát.
   */
  const hopRef = useRef<{ xt: KetQuaXemTruoc; dauVao: DauVaoLuu } | null>(null);
  const datHop = (v: { xt: KetQuaXemTruoc; dauVao: DauVaoLuu } | null) => {
    hopRef.current = v;
    setCanXacNhan(v);
  };
  /** Đếm lần xem trước: hộp xác nhận dựng MỚI mỗi lần (ô tick + lý do của lần trước không được mang sang số liệu mới). */
  const [lanXt, setLanXt] = useState(0);
  const [daDoiTap, setDaDoiTap] = useState(false);
  const [loiHop, setLoiHop] = useState<string | null>(null);
  /** Lý do đã gõ ở hộp trước: giữ lại khi hộp dựng MỚI (xem trước lại), không bắt gõ lại. */
  const [lyDoDaGo, setLyDoDaGo] = useState("");
  /**
   * Lượt tải nhiều phần đang mở — giữ ở `ref`, CỐ Ý không giữ ở `useState`.
   *
   * `tai()` chạy trọn trong MỘT lượt kết xuất. Một `setState` gọi ở giữa hàm chỉ
   * xếp lịch cho lượt kết xuất SAU, không đổi biến đã đóng gói trong chính lượt
   * gọi này — nên bản trước viết `if (dangHuy) await huy()` ở nhánh `catch` LUÔN
   * thấy `null`, và lệnh huỷ không bao giờ được gửi.
   *
   * Hỏng im lặng, chỉ thấy trên hoá đơn: các phần đã tải nằm lại R2 và R2 tính
   * tiền chúng, tới khi cron đêm dọn — sau 24 giờ.
   *
   * `ref` đọc được NGAY trong cùng lượt gọi. Không cần bản `state` song song:
   * nút Huỷ chỉ hiện theo `trangThai === "dang-tai"`, không đọc giá trị này.
   */
  const luotTaiRef = useRef<{ khoa: string; uploadId: string } | null>(null);

  const goi = async (than: Record<string, unknown>) => {
    const r = await fetch("/api/elearning/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(than),
    });
    const j = (await r.json()) as
      | { ok: true; data: Record<string, unknown> }
      | { ok: false; error: { message: string } };
    if (!j.ok) throw new Error(j.error.message);
    return j.data;
  };

  const huy = async () => {
    const luot = luotTaiRef.current;
    if (!luot) return;
    try {
      await goi({ buoc: "huy", ...luot });
      toast.success("Đã huỷ lượt tải");
    } catch {
      // Huỷ thất bại không phải việc của người soạn: cron đêm sẽ dọn.
      toast.message("Đã dừng tải — phần đã tải sẽ được dọn tự động");
    }
    luotTaiRef.current = null;
    setTrangThai("cho");
    setXong(0);
    setTong(0);
  };

  const tai = async (f: File) => {
    // Đọc thời lượng và kích thước khung ở client để chặn SỚM.
    // Đây KHÔNG phải con số cuối cùng — máy chủ đọc lại từ tệp sau khi tải xong.
    //
    // ⚠️ Chặn sớm không phải để tiện: một tệp 1080p hay một tệp 200MB cho 1 phút
    // bị từ chối SAU khi tải xong nghĩa là người soạn đã trả giá cả lượt tải 200MB
    // qua mạng văn phòng chỉ để biết tệp không đạt chuẩn.
    const tam = await docSieuDuLieu(f).catch(() => null);

    setTrangThai("dang-tai");
    setXong(0);
    try {
      const mo = (await goi({
        buoc: "tao",
        lessonId: props.lessonId,
        filename: f.name,
        mime: f.type || "video/mp4",
        sizeBytes: f.size,
        durationSec: tam?.giay ?? null,
        rong: tam?.rong ?? null,
        cao: tam?.cao ?? null,
      })) as { khoa: string; uploadId: string; soPhan: number; partSize: number };

      setTong(mo.soPhan);
      luotTaiRef.current = { khoa: mo.khoa, uploadId: mo.uploadId };

      const ky = (await goi({
        buoc: "ky-phan",
        khoa: mo.khoa,
        uploadId: mo.uploadId,
        soPhan: mo.soPhan,
      })) as { links: { partNumber: number; url: string }[] };

      // Tải TUẦN TỰ, không song song: mạng của người soạn thường là mạng văn
      // phòng dùng chung, và mở 25 kết nối cùng lúc làm chậm cả phòng.
      const parts: { partNumber: number; etag: string }[] = [];
      for (const l of ky.links) {
        const tu = (l.partNumber - 1) * mo.partSize;
        const khuc = f.slice(tu, Math.min(tu + mo.partSize, f.size));
        const res = await fetch(l.url, { method: "PUT", body: khuc });
        if (!res.ok) throw new Error(`Tải phần ${l.partNumber} thất bại`);
        const etag = res.headers.get("etag");
        if (!etag) throw new Error(`Phần ${l.partNumber} không nhận được mã xác nhận`);
        parts.push({ partNumber: l.partNumber, etag });
        setXong(l.partNumber);
      }

      await goi({
        buoc: "hoan-tat",
        khoa: mo.khoa,
        uploadId: mo.uploadId,
        parts,
      });
      luotTaiRef.current = null;

      // Xác minh THẬT: đọc header mp4 trên máy chủ. Đây là bước quyết định codec
      // và thời lượng ghi vào bài.
      setTrangThai("dang-xac-minh");
      const xm = (await fetch(
        `/api/elearning/media/xac-minh?khoa=${encodeURIComponent(mo.khoa)}&lessonId=${props.lessonId}`,
      ).then((r) => r.json())) as
        | {
            ok: true;
            data: {
              durationSec: number;
              rong: number | null;
              cao: number | null;
              videoCodec: string;
              brand: string;
              audioCodec: string | null;
            };
          }
        | { ok: false; error: { message: string } };
      if (!xm.ok) throw new Error(xm.error.message);

      const dauVao: DauVaoLuu = {
        lessonId: props.lessonId,
        title: props.title,
        videoKey: mo.khoa,
        durationSec: Math.round(xm.data.durationSec),
        codec: {
          videoCodec: xm.data.videoCodec as "avc1" | "hev1" | "khac",
          audioCodec: xm.data.audioCodec as "mp4a" | "khac" | null,
          brand: xm.data.brand,
        },
      };
      // Bài CHƯA có nguồn: gắn lần đầu, không có nội dung cũ nào để thay ⇒ lưu thẳng. Bài ĐÃ có nguồn: xem trước tác động.
      if (!props.coNguonHienCo) {
        await luuThat(dauVao);
      } else {
        await xemTruoc(dauVao, false);
      }
    } catch (e) {
      setTrangThai("cho");
      toast.error(e instanceof Error ? e.message : "Tải video thất bại");
      // Còn lượt tải dở thì huỷ ngay, đừng để nó nằm lại tính tiền.
      // Đọc REF chứ không đọc state — xem chú thích ở `luotTaiRef`.
      if (luotTaiRef.current) await huy();
    }
  };

  /**
   * Lưu thật. Có `xacNhan` ⇒ kèm chuỗi xác nhận ký + lý do (nội dung bài đã có nguồn thật sự đổi) và lúc đó hộp đang hiện.
   * ⚠️ Quyết định 'hộp đang hiện' lấy từ THAM SỐ `xacNhan`, KHÔNG từ state `canXacNhan`: hàm này có thể là bản của kết xuất cũ, và
   * state cũ làm lỗi bị nuốt / form kẹt ở trạng thái không có hộp nào để thoát.
   */
  const luuThat = async (dauVao: DauVaoLuu, xacNhan?: { token: string | null; lyDo: string }) => {
    setTrangThai("dang-luu");
    setLoiHop(null);
    const r = await luuBaiVideoAction(
      { ...dauVao, ...(xacNhan?.token ? { xacNhanToken: xacNhan.token } : {}) },
      xacNhan ? { reason: xacNhan.lyDo } : undefined,
    );
    if (!r.ok) {
      if (MA_XEM_TRUOC_LAI.has(r.error.code)) {
        // Người học bị ảnh hưởng đã đổi / chuỗi hết hạn / nguồn đã đổi: xem trước LẠI, không tin số liệu cũ.
        await xemTruoc(dauVao, r.error.code === "TAC_DONG_DA_DOI");
        if (r.error.code !== "TAC_DONG_DA_DOI") setLoiHop("Xác nhận trước đó đã hết hiệu lực (hết hạn hoặc nội dung bài đã đổi). Đọc lại số liệu rồi xác nhận lại.");
        return;
      }
      if (xacNhan) {
        setLoiHop(r.error.message);
        setTrangThai("cho-xac-nhan");
        return;
      }
      throw new Error(r.error.message);
    }
    datHop(null);
    setDaDoiTap(false);
    setTrangThai("xong");
    toast.success(xacNhan ? thongBaoDaDoiVideo(canXacNhan?.xt ?? null) : "Đã tải và gắn video vào bài");
    router.refresh();
  };

  /** Hỏi server tác động của việc đổi sang tệp này. Không đổi nội dung thật ⇒ lưu thẳng; đổi ⇒ hộp lý do + xác nhận. */
  const xemTruoc = async (dauVao: DauVaoLuu, laDoiTap: boolean) => {
    setTrangThai("dang-luu");
    const r = await xemTruocDoiNguonAction({
      lessonId: props.lessonId,
      loai: "TEP",
      videoKey: dauVao.videoKey,
      durationSec: dauVao.durationSec,
    });
    if (!r.ok) throw new Error(r.error.message);
    if (!r.data.doiNguon) {
      datHop(null);
      await luuThat(dauVao);
      return;
    }
    datHop({ xt: r.data, dauVao });
    setLanXt((n) => n + 1);
    setDaDoiTap(laDoiTap);
    setTrangThai("cho-xac-nhan");
  };

  /** Người soạn đã đọc tác động, ghi lý do (và tick xác nhận nếu cần) ⇒ gửi ĐÚNG đầu vào đã kiểm kèm chuỗi xác nhận. */
  const xacNhanDoi = async (lyDo: string) => {
    if (!canXacNhan) return;
    try {
      await luuThat(canXacNhan.dauVao, { token: canXacNhan.xt.xacNhanToken, lyDo });
    } catch (e) {
      // Hộp còn ⇒ về hộp để sửa/thử lại; hộp đã tắt (xem trước lại báo 'không còn đổi' rồi lưu thẳng lỗi) ⇒ về trạng thái nghỉ, không kẹt.
      setTrangThai(hopRef.current ? "cho-xac-nhan" : props.videoKeyHienCo ? "xong" : "cho");
      toast.error(e instanceof Error ? e.message : "Đổi video thất bại");
    }
  };

  const boDoi = () => {
    // Tệp đã tải lên R2 nhưng CHƯA gắn vào bài: bỏ ở đây là bỏ việc đổi, bài giữ video cũ.
    datHop(null);
    setDaDoiTap(false);
    setLoiHop(null);
    setLyDoDaGo("");
    setTrangThai(props.videoKeyHienCo ? "xong" : "cho");
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-foreground">Tệp video</h2>

      {props.videoKeyHienCo && trangThai !== "dang-tai" && (
        <p className="text-sm text-muted-foreground">
          Bài đang có video
          {props.durationSecHienCo
            ? ` · ${Math.round(props.durationSecHienCo / 60)} phút`
            : ""}
          . Tải tệp mới sẽ thay tệp cũ.
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

      {trangThai === "xong" && props.coNguonHienCo && !biChan && (
        <button
          type="button"
          data-testid="thay-tep-video"
          onClick={() => setTrangThai("cho")}
          className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Tải tệp mới thay thế
        </button>
      )}

      {trangThai === "cho" && !biChan && (
        <input
          type="file"
          accept="video/mp4"
          aria-label="Chọn tệp video MP4"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void tai(f);
          }}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary-foreground"
        />
      )}

      {trangThai === "dang-tai" && (
        <div className="space-y-1">
          <p className="text-sm">
            Đang tải phần {xong}/{tong}
          </p>
          <div
            role="progressbar"
            aria-valuenow={xong}
            aria-valuemin={0}
            aria-valuemax={tong}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${tong ? (xong / tong) * 100 : 0}%` }}
            />
          </div>
          <button
            type="button"
            onClick={huy}
            className="inline-flex min-h-8 items-center rounded text-sm font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Huỷ lượt tải
          </button>
        </div>
      )}

      {(trangThai === "cho-xac-nhan" || trangThai === "dang-luu") && canXacNhan && (
        <HopXacNhanDoiNguon
          key={lanXt}
          xt={canXacNhan.xt}
          dangLuu={trangThai === "dang-luu"}
          daDoiTapNguoiHoc={daDoiTap}
          loi={loiHop}
          lyDoBanDau={lyDoDaGo}
          onXacNhan={(lyDo) => {
            setLyDoDaGo(lyDo);
            void xacNhanDoi(lyDo);
          }}
          onHuy={boDoi}
        />
      )}

      {trangThai === "dang-xac-minh" && (
        <p className="text-sm">
          Đang kiểm tệp (đọc mã hoá và thời lượng thật)…
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        MP4 mã hoá H.264, tối đa 720p · 200MB · 15 phút, và không quá 13,3MB mỗi
        phút. Hệ thống không hạ cỡ hộ: tệp tải lên cũng chính là tệp người học tải
        về bằng dữ liệu di động. Phụ đề tiếng Việt là điều kiện xuất bản của khoá
        bắt buộc.
      </p>
    </section>
  );
}

/**
 * Đọc thời lượng và kích thước khung bằng thẻ `<video>` — chỉ để chặn sớm, không
 * phải bằng chứng.
 *
 * `videoWidth`/`videoHeight` có giá trị ngay khi `loadedmetadata` bắn; tệp trình
 * duyệt không giải mã được thì `onerror` bắn trước và ta không khai con số nào —
 * đúng hơn là khai bừa số 0.
 */
function docSieuDuLieu(
  f: File,
): Promise<{ giay: number | null; rong: number | null; cao: number | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        giay: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
        rong: v.videoWidth || null,
        cao: v.videoHeight || null,
      });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("không đọc được"));
    };
    v.src = url;
  });
}
