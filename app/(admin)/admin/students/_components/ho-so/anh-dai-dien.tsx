"use client";

// Ảnh đại diện học viên (25/09/2026) — ô ảnh kiểu THẺ HỌC VIÊN (vuông bo góc, không tròn).
//
// Hai chế độ, một đường tải:
//   · `AnhDaiDienHoSo` — trang hồ sơ (đã có học viên): tải lên `POST /api/admin/students/
//     anh-dai-dien` rồi lưu NGAY bằng `datAnhDaiDienHocVien`. Ảnh KHÔNG nằm trong form hồ sơ
//     nên đổi ảnh không đụng các ô đang sửa dở.
//   · `ChonAnhKhiTao` — form tạo mới (chưa có id): tải lên rồi giữ URL trong ô ẩn
//     `avatarUrl`; `createStudent` ghi cùng lượt tạo.
//
// Dùng XHR thay `fetch` vì chỉ XHR báo TIẾN ĐỘ tải lên — ảnh chụp điện thoại 3–4MB qua
// 4G mất vài giây, một ô ảnh đứng im trong lúc đó trông như bấm hỏng.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/ui/initials";
import { cn } from "@/lib/utils";
import { datAnhDaiDienHocVien } from "../../[id]/_anh-dai-dien-actions";
import { NUT_CHU } from "./o-nhap";

/** Khớp trần của route (Vercel cắt body ~4,5MB) — chặn sớm thay vì chờ tải xong mới báo. */
const TOI_DA_BYTE = 4 * 1024 * 1024;
const LOAI_NHAN = ["image/jpeg", "image/png", "image/webp"];
/** Cùng danh sách với route — `image/*` sẽ cho chọn GIF/HEIC/SVG rồi mới bị từ chối. */
const ACCEPT = LOAI_NHAN.join(",");

type KetQuaTai = { ok: true; url: string } | { ok: false; error: string };

function kiemFile(file: File): string | null {
  if (file.size > TOI_DA_BYTE) return "Ảnh quá lớn — tối đa 4MB.";
  if (file.type && !LOAI_NHAN.includes(file.type)) return "Chỉ nhận ảnh JPG, PNG hoặc WEBP.";
  return null;
}

function taiAnhLen(file: File, onTienDo: (phanTram: number) => void): Promise<KetQuaTai> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/students/anh-dai-dien");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onTienDo(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const body = xhr.response as { url?: unknown; error?: unknown } | null;
      if (xhr.status >= 200 && xhr.status < 300 && typeof body?.url === "string") {
        resolve({ ok: true, url: body.url });
        return;
      }
      if (typeof body?.error === "string") {
        resolve({ ok: false, error: body.error });
        return;
      }
      // 413 của NỀN TẢNG (không phải của route) trả HTML, không có `error`.
      resolve({
        ok: false,
        error:
          xhr.status === 413
            ? "Ảnh quá lớn — tối đa 4MB."
            : `Không tải được ảnh (mã ${xhr.status}). Thử lại sau.`,
      });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Mất kết nối khi tải ảnh — thử lại." });
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

/** Khung ảnh + lớp phủ tiến độ. `size-16` trên điện thoại, `size-20` từ 640px. */
function KhungAnh({ url, ten, phanTram }: { url: string | null; ten: string; phanTram: number | null }) {
  return (
    <Avatar className="size-16 rounded-xl after:rounded-xl sm:size-20">
      {url && <AvatarImage src={url} alt={`Ảnh của ${ten}`} className="rounded-xl" />}
      <AvatarFallback className="rounded-xl bg-primary-soft text-lg font-bold text-primary-ink sm:text-xl">
        {initialsOf(ten, "HV")}
      </AvatarFallback>
      {phanTram !== null && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-card/85 text-xs font-semibold tabular-nums text-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          {phanTram}%
        </span>
      )}
    </Avatar>
  );
}

/** Nút chọn file phủ kín ô ảnh + huy hiệu máy ảnh LUÔN hiện (cảm ứng không có hover). */
function NutChonAnh({
  ten,
  url,
  phanTram,
  disabled,
  onChon,
  nhan,
}: {
  ten: string;
  url: string | null;
  phanTram: number | null;
  disabled: boolean;
  onChon: (file: File) => void;
  nhan: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label={nhan}
        className="group relative block shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
      >
        <KhungAnh url={url} ten={ten} phanTram={phanTram} />
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors group-hover:text-primary"
        >
          <Camera className="size-3.5" />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Xoá chọn để chọn lại ĐÚNG file đó (sau lỗi) vẫn phát sự kiện change.
          e.target.value = "";
          if (f) onChon(f);
        }}
      />
    </>
  );
}

/** Hai lần bấm mới gỡ — lần đầu đổi nhãn, 4 giây không bấm lại thì thôi. */
function useHaiLanBam(): [boolean, () => boolean] {
  const [cho, setCho] = useState(false);
  useEffect(() => {
    if (!cho) return;
    const t = window.setTimeout(() => setCho(false), 4000);
    return () => window.clearTimeout(t);
  }, [cho]);
  return [
    cho,
    () => {
      if (cho) {
        setCho(false);
        return true;
      }
      setCho(true);
      return false;
    },
  ];
}

export function AnhDaiDienHoSo({
  studentId,
  ten,
  url,
}: {
  studentId: string;
  ten: string;
  url: string | null;
}) {
  const router = useRouter();
  const [hienThi, setHienThi] = useState<string | null>(url);
  const [phanTram, setPhanTram] = useState<number | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangLuu, startLuu] = useTransition();
  const [choGo, bamGo] = useHaiLanBam();

  // Trang tải lại (router.refresh) mang URL mới từ server ⇒ đồng bộ ô hiển thị.
  useEffect(() => setHienThi(url), [url]);

  const ban = phanTram !== null || dangLuu;

  function luu(moi: string | null) {
    startLuu(async () => {
      // Lỗi MẠNG (action ném, không trả `{ ok:false }`) phải bắt tại đây: lời hứa bị từ chối
      // trong transition đi thẳng lên error boundary và thay CẢ trang hồ sơ bằng màn lỗi —
      // mất luôn chữ đang gõ dở trong form bên dưới (lượt rà đối kháng 25/09).
      let res: Awaited<ReturnType<typeof datAnhDaiDienHocVien>>;
      try {
        res = await datAnhDaiDienHocVien({ studentId, url: moi });
      } catch {
        setLoi("Mất kết nối — chưa lưu được ảnh. Thử lại.");
        return;
      }
      if (!res.ok) {
        setLoi(res.error);
        return;
      }
      setHienThi(moi);
      toast.success(moi ? "Đã đổi ảnh đại diện" : "Đã gỡ ảnh đại diện");
      router.refresh();
    });
  }

  async function chon(file: File) {
    setLoi(null);
    const saiFile = kiemFile(file);
    if (saiFile) {
      setLoi(saiFile);
      return;
    }
    setPhanTram(0);
    const kq = await taiAnhLen(file, setPhanTram);
    setPhanTram(null);
    if (!kq.ok) {
      setLoi(kq.error);
      return;
    }
    luu(kq.url);
  }

  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <NutChonAnh
        ten={ten}
        url={hienThi}
        phanTram={phanTram}
        disabled={ban}
        onChon={chon}
        nhan={hienThi ? `Đổi ảnh đại diện của ${ten}` : `Thêm ảnh đại diện cho ${ten}`}
      />
      {hienThi && (
        <button
          type="button"
          disabled={ban}
          onClick={() => {
            if (bamGo()) luu(null);
          }}
          className={cn(
            NUT_CHU,
            "mt-1 px-1",
            choGo
              ? "bg-state-danger-soft text-state-danger-ink"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {choGo ? "Bấm lần nữa" : "Gỡ ảnh"}
        </button>
      )}
      <p aria-live="polite" className="sr-only">
        {phanTram !== null ? `Đang tải ảnh ${phanTram}%` : dangLuu ? "Đang lưu ảnh" : ""}
      </p>
      {loi && (
        <p role="alert" className="w-full break-words text-center text-xs leading-snug text-state-danger-ink">
          {loi}
        </p>
      )}
    </div>
  );
}

/** Form TẠO MỚI: chưa có hồ sơ để lưu ngay ⇒ giữ URL trong ô ẩn `avatarUrl`. */
export function ChonAnhKhiTao({
  ten,
  onDangTai,
}: {
  ten: string;
  /**
   * Báo form cha ảnh ĐANG tải lên — form khoá nút "Tạo học viên" tới khi xong. Không có nó,
   * bấm tạo giữa chừng gửi `avatarUrl` rỗng, học viên tạo KHÔNG ảnh và ảnh tải xong thì rơi
   * mất, không một lời báo.
   */
  onDangTai: (dangTai: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [phanTram, setPhanTram] = useState<number | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  async function chon(file: File) {
    setLoi(null);
    const saiFile = kiemFile(file);
    if (saiFile) {
      setLoi(saiFile);
      return;
    }
    setPhanTram(0);
    onDangTai(true);
    let kq: Awaited<ReturnType<typeof taiAnhLen>>;
    try {
      kq = await taiAnhLen(file, setPhanTram);
    } finally {
      setPhanTram(null);
      onDangTai(false);
    }
    if (!kq.ok) {
      setLoi(kq.error);
      return;
    }
    setUrl(kq.url);
  }

  return (
    <div className="flex items-start gap-4">
      <input type="hidden" name="avatarUrl" value={url} />
      <NutChonAnh
        ten={ten || "Học viên"}
        url={url || null}
        phanTram={phanTram}
        disabled={phanTram !== null}
        onChon={chon}
        nhan={url ? "Đổi ảnh đại diện" : "Chọn ảnh đại diện"}
      />
      <div className="min-w-0 space-y-1 pt-1">
        <p className="text-sm font-semibold text-foreground">Ảnh đại diện</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ảnh chân dung JPG/PNG/WEBP, tối đa 4MB. Không bắt buộc — thêm sau ở hồ sơ cũng được.
        </p>
        {url && (
          <button
            type="button"
            onClick={() => setUrl("")}
            className={cn(NUT_CHU, "-ml-2 text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            Bỏ ảnh
          </button>
        )}
        <p aria-live="polite" className="sr-only">
          {phanTram !== null ? `Đang tải ảnh ${phanTram}%` : ""}
        </p>
        {loi && (
          <p role="alert" className="text-xs text-state-danger-ink">
            {loi}
          </p>
        )}
      </div>
    </div>
  );
}
