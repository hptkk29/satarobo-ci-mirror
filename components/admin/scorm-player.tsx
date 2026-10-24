"use client";

// components/admin/scorm-player.tsx — R7-12: player SCORM (iframe) trong khung SlideStage.
//   • iframe sandbox trỏ asset resolver (vé trong query) — KHÔNG nút tải.
//   • window.API = adapter SCORM 1.2 (delivery tracking GV) — seed resume + POST runtime.
//   • Chống quay lén (watermark/blur) + nút toàn màn hình: do SlideStage lo (dùng chung PDF).
// Mọi hiệu ứng bảo vệ FAIL-OPEN: lỗi JS không được chặn việc dạy học.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { mountScorm12Api, type ScormSeed } from "@/components/admin/scorm-api";
import { BieuNguPhienHetHan, ScormLopPhu } from "@/components/admin/scorm-lop-phu";
import {
  danhDauScorm,
  danhGiaTaiLieu,
  HEN_CHAM_MS,
  HEN_QUA_HAN_MS,
  lapTrangThaiTai,
  trangThaiTaiBanDau,
  type KetQuaTaiLieu,
  type MoTaTaiLieu,
} from "@/components/admin/scorm-trang-thai-tai";
import { SlideStage, type SlideStageFit } from "@/components/admin/slide-stage";
import { useGiaHanVeScorm } from "@/components/admin/use-gia-han-ve-scorm";
import { taoUrlAssetScorm } from "@/lib/scorm/asset-url";

interface ScormPlayerProps {
  launchTicket: string;
  /** href launch tương đối trong gói (vd "res/index.html"). */
  launchUrl: string;
  packageName: string;
  name: string;
  employeeCode: string;
  /** Gói + buổi để adapter POST /api/scorm/runtime (learner = GV, KHÔNG HV). */
  packageId: string;
  classSessionId: string | null;
  /** Dữ liệu resume từ ScormAttempt của GV (bookmark + suspend + trạng thái). */
  seed: ScormSeed;
  /** Nhãn trạng thái giảng hiện tại (resume) + lần mở gần nhất — hiển thị cho GV. */
  statusLabel?: string;
  lastAccessedLabel?: string;
  /** Chuyển tiếp cho SlideStage — site GV dùng "viewport" + lối thoát (xem SlideStageFit). */
  fit?: SlideStageFit;
  exitHref?: string;
}

/** Chu kỳ soi tài liệu trong iframe lúc đang tải (để bắt "First Content Visible" sớm hơn `load` và bắt trang lỗi dạng chữ). */
const CHU_KY_SOI_MS = 300;

/**
 * Đọc mô tả tài liệu đang nằm trong iframe. Trả null khi KHÔNG đọc được (trang lỗi của trình duyệt khác origin, bị chặn…) —
 * `danhGiaTaiLieu(null)` là "khong-doc", KHÔNG phải lỗi (fail-open). Chỉ lấy chữ của body khi tài liệu không phải HTML hoặc body nhỏ
 * (tối đa một phần tử con) để khỏi gom `textContent` của cả bài giảng mỗi 300ms.
 */
export function docTaiLieuIframe(el: HTMLIFrameElement | null): MoTaTaiLieu | null {
  try {
    const doc = el?.contentDocument;
    if (!doc) return null;
    const contentType = doc.contentType ?? "";
    const khongPhaiHtml = Boolean(contentType) && !/html/i.test(contentType);
    const body = doc.body;
    const nho = !body || body.childElementCount <= 1;
    return {
      href: doc.location?.href ?? "",
      contentType,
      readyState: doc.readyState,
      vanBan: khongPhaiHtml || nho ? (body?.textContent ?? "").trim().slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}

export function ScormPlayer({
  launchTicket,
  launchUrl,
  packageName,
  name,
  employeeCode,
  packageId,
  classSessionId,
  seed,
  statusLabel,
  lastAccessedLabel,
  fit,
  exitHref,
}: ScormPlayerProps) {
  // URL mang MÃ GÓI (cache + cookie vé theo gói) — xem lib/scorm/asset-url.ts.
  const srcBanDau = taoUrlAssetScorm(packageId, launchUrl, launchTicket);

  // Trạng thái tải (24/10/2026): trước đây chỉ có một đồng hồ 12s + `onLoad`, nên không phân biệt được mạng chậm với vé hết hạn /
  // không có tệp / máy chủ lỗi, và một iframe nạp ra trang chữ "Forbidden" vẫn bắn `load` "thành công". Nay có máy trạng thái thuần
  // (scorm-trang-thai-tai.ts) ăn BẰNG CHỨNG: mã HTTP của một lần thăm dò launch URL (Range 0-0, song song với iframe) và nội dung thật
  // của iframe. "Chậm" chỉ là nhắc. Thử lại CHỈ do người dùng bấm — không tự reload (xem SO_LAN_TU_THU_LAI_TOI_DA).
  const [tt, dispatch] = useReducer(lapTrangThaiTai, undefined, () => trangThaiTaiBanDau());
  const [src, setSrc] = useState(srcBanDau);
  // CHỈ gắn <iframe> sau khi đã mount ở client. Đo 24/10/2026 trên bản production: iframe nằm sẵn trong HTML SSR + ranh giới Suspense (`loading.tsx`) ⇒
  // Next stream nội dung vào khối ẩn rồi CHUYỂN nó vào chỗ thật, và trình duyệt huỷ + nạp lại iframe bị chuyển ⇒ MỖI tệp của bài bị xin hai lần
  // (600 thay vì 300 yêu cầu ảnh, `index.html` 4 lần kể cả lượt thăm dò). Gắn sau mount thì chỉ nạp MỘT lần, và `onLoad` luôn được gắn trước khi nạp.
  const [daGanKhung, setDaGanKhung] = useState(false);
  useEffect(() => {
    setDaGanKhung(true);
  }, []);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const daCoNoiDung = useRef(false);

  // Gia hạn vé chủ động: ngồi yên >10 phút rồi lazy-load ảnh/video không còn ăn 403 câm. Cookie được route đặt lại ⇒ không nạp lại iframe.
  const ve = useGiaHanVeScorm({ ticket: launchTicket });

  const xuLyTaiLieu = useCallback((k: KetQuaTaiLieu) => {
    if ((k.kq === "dang-doc" || k.kq === "tot") && !daCoNoiDung.current) {
      daCoNoiDung.current = true;
      danhDauScorm("scorm:first-content");
    }
    dispatch({ loai: "tai-lieu", ketQua: k });
  }, []);

  const dangCho = tt.loai === "dang-tai";
  useEffect(() => {
    if (!dangCho) return;
    danhDauScorm("scorm:open");
    daCoNoiDung.current = false;
    const huy = new AbortController();
    let xong = false;
    const hen = [
      window.setTimeout(() => dispatch({ loai: "cham" }), HEN_CHAM_MS),
      window.setTimeout(() => dispatch({ loai: "qua-han" }), HEN_QUA_HAN_MS),
    ];

    // Thăm dò launch URL song song với iframe để biết MÃ HTTP thật (iframe không cho biết). Range 0-0: route hỗ trợ Range nên chỉ 1 byte.
    // Chỉ lỗi MẠNG (TypeError) mới là bằng chứng; mọi lỗi khác của bộ thăm dò (abort, trình duyệt từ chối…) = fail-open, bỏ qua.
    void (async () => {
      try {
        const res = await fetch(src, {
          headers: { Range: "bytes=0-0" },
          credentials: "same-origin",
          cache: "no-store",
          signal: huy.signal,
        });
        if (xong) return;
        dispatch({ loai: "tham-do", trangThaiHttp: res.status });
        try {
          void res.body?.cancel();
        } catch {
          /* fail-open */
        }
      } catch (e) {
        if (!xong && e instanceof TypeError) dispatch({ loai: "tham-do-mang" });
      }
    })();

    // Soi tài liệu trong iframe: `onLoad` có thể đã chạy TRƯỚC khi React gắn handler (iframe nằm sẵn trong HTML SSR) và `load` chỉ
    // báo sau khi nạp XONG — soi định kỳ cho "nội dung đầu tiên" sớm hơn và bắt trang lỗi dạng chữ ngay khi nó hiện.
    const soi = () => {
      const k = danhGiaTaiLieu(docTaiLieuIframe(iframeRef.current));
      // `khong-doc` chỉ tính ở sự kiện load (lúc đang điều hướng giữa chừng, tài liệu có thể tạm không đọc được).
      if (k.kq === "khong-doc") return;
      xuLyTaiLieu(k);
    };
    soi();
    const soiDinhKy = window.setInterval(soi, CHU_KY_SOI_MS);

    return () => {
      xong = true;
      huy.abort();
      hen.forEach((h) => window.clearTimeout(h));
      window.clearInterval(soiDinhKy);
    };
  }, [dangCho, tt.lanThu, src, xuLyTaiLieu]);

  // Dấu mốc cho QA/UAT (performance.mark): ready / error.
  useEffect(() => {
    if (tt.loai === "san-sang") danhDauScorm("scorm:ready");
    else if (tt.loai === "loi") danhDauScorm("scorm:error");
  }, [tt.loai, tt.lanThu, tt.ma]);

  // Thử lại do NGƯỜI DÙNG bấm: nạp lại khung với vé MỚI NHẤT (đã gia hạn) — không phải vé gắn trong trang lúc render.
  const thuLai = () => {
    daCoNoiDung.current = false;
    setSrc(taoUrlAssetScorm(packageId, launchUrl, ve.layVe()));
    dispatch({ loai: "thu-lai" });
  };

  // SCORM 1.2 API adapter: set window.API TRƯỚC khi iframe content chạy LMSInitialize.
  // Seed resume + POST runtime trên Commit/Finish/unload. learner = GV; KHÔNG ghi điểm HV.
  useEffect(() => {
    const teardown = mountScorm12Api({
      packageId,
      classSessionId,
      seed,
      learnerId: employeeCode || "",
      learnerName: name || "",
    });
    // Gói SCORM 2004 (API_1484_11): stub no-op fail-open (tracking chỉ làm cho 1.2).
    try {
      const w = window as unknown as Record<string, unknown>;
      if (!w.API_1484_11) {
        const noop = () => "true";
        const empty = () => "";
        w.API_1484_11 = {
          Initialize: noop,
          Terminate: noop,
          GetValue: empty,
          SetValue: noop,
          Commit: noop,
          GetLastError: () => "0",
          GetErrorString: empty,
          GetDiagnostic: empty,
        };
      }
    } catch {
      /* fail-open */
    }
    return teardown;
  }, [packageId, classSessionId, seed, employeeCode, name]);

  return (
    <SlideStage
      title={packageName}
      kindLabel="SCORM"
      name={name}
      employeeCode={employeeCode}
      statusLabel={statusLabel}
      lastAccessedLabel={lastAccessedLabel}
      fit={fit}
      exitHref={exitHref}
    >
      {/* Khung có dấu cho QA/UAT: data-scorm-state ∈ dang-tai|san-sang|loi, data-scorm-loi = mã lỗi (xem scorm-trang-thai-tai.ts). */}
      <div className="absolute inset-0" data-scorm-state={tt.loai} data-scorm-loi={tt.ma ?? undefined}>
        {daGanKhung && (
          <iframe
            key={tt.lanThu}
            ref={iframeRef}
            onLoad={(e) => xuLyTaiLieu(danhGiaTaiLieu(docTaiLieuIframe(e.currentTarget)))}
            title={packageName}
            src={src}
            className="absolute inset-0 h-full w-full bg-card"
            // KHÔNG allow-downloads → ẩn khả năng tải; allow-scripts/forms cho nội dung chạy.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        )}
        <ScormLopPhu
          trangThai={tt}
          nhanDangTai="Đang tải bài giảng…"
          onThuLai={thuLai}
          // Reload CẢ TRANG (cấp vé mới) — nạp lại iframe sẽ dùng lại vé có thể đã hết hạn.
          onTaiLaiTrang={() => window.location.reload()}
          onAnNhac={() => dispatch({ loai: "an-nhac" })}
        />
        {ve.phien.loai === "het-han" && <BieuNguPhienHetHan onTaiLaiTrang={() => window.location.reload()} />}
      </div>
    </SlideStage>
  );
}
