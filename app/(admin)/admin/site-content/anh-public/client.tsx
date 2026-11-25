"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canhBaoDoNet, kichThuocXuat, tinhKhungCat } from "@/lib/pub-anh/ghi-de-thuan";
import { datLaiAnhPublicAction, luuAnhPublicAction } from "./actions";

export interface OAnhView {
  id: string;
  w: number;
  h: number;
  macDinh: string;
  nhomTrang: string[];
  /** Địa chỉ ảnh admin đã thay; không có = đang dùng ảnh mặc định. */
  daThay: string | null;
}

const TOI_DA_BYTE = 10 * 1024 * 1024;
const CHAP_NHAN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function docAnh(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function veKhung(canvas: HTMLCanvasElement, nguon: ImageBitmap, o: { w: number; h: number }, viTri: number, rongTo: number) {
  const cat = tinhKhungCat(nguon.width, nguon.height, o.w, o.h, viTri);
  canvas.width = rongTo;
  canvas.height = Math.round((rongTo * o.h) / o.w);
  const ctx = canvas.getContext("2d");
  if (!ctx) return cat;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(nguon, cat.sx, cat.sy, cat.sw, cat.sh, 0, 0, canvas.width, canvas.height);
  return cat;
}

function canvasThanhBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => {
        // Trình duyệt không mã hoá được WebP sẽ trả PNG — vẫn hợp lệ, chỉ nặng hơn.
        resolve(b);
      },
      "image/webp",
      0.86,
    );
  });
}

export function AnhPublicClient({ oAnh, nhom, coQuyenSua }: { oAnh: OAnhView[]; nhom: string[]; coQuyenSua: boolean }) {
  const router = useRouter();
  const [loc, setLoc] = useState<string>("Tất cả");
  const [chiDaThay, setChiDaThay] = useState(false);
  const [dangSua, setDangSua] = useState<OAnhView | null>(null);
  const [dangDatLai, startDatLai] = useTransition();

  const hienThi = useMemo(
    () => oAnh.filter((o) => (loc === "Tất cả" || o.nhomTrang.includes(loc)) && (!chiDaThay || o.daThay)),
    [oAnh, loc, chiDaThay],
  );
  const soDaThay = oAnh.filter((o) => o.daThay).length;

  const datLai = (o: OAnhView) => {
    if (!confirm("Đưa ảnh này về ảnh mặc định của trang?")) return;
    startDatLai(async () => {
      const r = await datLaiAnhPublicAction({ id: o.id });
      if (r.ok) {
        toast.success("Đã đưa về ảnh mặc định");
        router.refresh();
      } else toast.error(r.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lọc theo trang">
        {["Tất cả", ...nhom].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLoc(n)}
            aria-pressed={loc === n}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${loc === n ? "border-primary bg-primary-soft font-semibold text-primary" : "border-border text-foreground hover:bg-muted"}`}
          >
            {n}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={chiDaThay} onChange={(e) => setChiDaThay(e.target.checked)} />
          Chỉ ảnh đã thay ({soDaThay})
        </label>
      </div>

      {hienThi.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Không có ảnh nào khớp bộ lọc.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {hienThi.map((o) => (
            <li key={o.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex aspect-square items-center justify-center bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2">
                <img src={o.daThay ?? o.macDinh} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {o.w}×{o.h}
                  </span>
                  {o.daThay && <span className="rounded bg-primary-soft px-1.5 py-0.5 font-semibold text-primary">Đã thay</span>}
                </div>
                <p className="line-clamp-2 min-h-8 text-muted-foreground">{o.nhomTrang.length ? `Dùng ở: ${o.nhomTrang.join(", ")}` : "Chưa thấy chỗ dùng"}</p>
                {coQuyenSua && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => setDangSua(o)}>
                      Đổi ảnh
                    </Button>
                    {o.daThay && (
                      <Button type="button" size="sm" variant="outline" disabled={dangDatLai} onClick={() => datLai(o)}>
                        Về mặc định
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dangSua && (
        <HopDoiAnh
          key={dangSua.id}
          o={dangSua}
          onDong={() => setDangSua(null)}
          onXong={() => {
            setDangSua(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HopDoiAnh({ o, onDong, onXong }: { o: OAnhView; onDong: () => void; onXong: () => void }) {
  const [nguon, setNguon] = useState<ImageBitmap | null>(null);
  const [tenTep, setTenTep] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [viTri, setViTri] = useState(0.5);
  const [dangLuu, setDangLuu] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const oTepRef = useRef<HTMLInputElement | null>(null);

  const chonTep = useCallback(async (file: File | undefined) => {
    setLoi(null);
    if (!file) return;
    if (!CHAP_NHAN.includes(file.type)) return setLoi("Chỉ nhận ảnh JPG, PNG, WebP hoặc GIF.");
    if (file.size > TOI_DA_BYTE) return setLoi(`Tệp quá lớn (${(file.size / 1048576).toFixed(1)}MB). Tối đa 10MB.`);
    try {
      const bm = await docAnh(file);
      setNguon(bm);
      setTenTep(file.name);
      setViTri(0.5);
    } catch {
      setLoi("Không đọc được ảnh này. Hãy thử tệp khác.");
    }
  }, []);

  // Vẽ lại khung xem trước mỗi khi đổi ảnh / vị trí cắt.
  useEffect(() => {
    if (nguon && canvasRef.current) veKhung(canvasRef.current, nguon, o, viTri, 320);
  }, [nguon, o, viTri]);

  const cat = nguon ? tinhKhungCat(nguon.width, nguon.height, o.w, o.h, viTri) : null;
  const canhBao = cat ? canhBaoDoNet(o.w, o.h, cat) : null;
  const truotNgang = !!nguon && nguon.width / nguon.height > o.w / o.h;
  const coTheTruot = !!nguon && Math.abs(nguon.width / nguon.height - o.w / o.h) / (o.w / o.h) > 0.005;

  const luu = async () => {
    if (!nguon || !cat) return;
    setDangLuu(true);
    setLoi(null);
    try {
      const { w, h } = kichThuocXuat(o.w, o.h, cat);
      const cv = document.createElement("canvas");
      veKhung(cv, nguon, { w, h }, viTri, w);
      const blob = await canvasThanhBlob(cv);
      if (!blob) throw new Error("Không nén được ảnh");
      const duoi = blob.type === "image/webp" ? "webp" : "png";
      const form = new FormData();
      form.append("file", new File([blob], `anh-public-${o.id.slice(0, 8)}.${duoi}`, { type: blob.type }));
      form.append("category", "image");
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { publicUrl?: string; error?: string };
      if (!res.ok || !body.publicUrl) throw new Error(body.error ?? `Tải ảnh lên thất bại (HTTP ${res.status})`);
      const kq = await luuAnhPublicAction({ id: o.id, url: body.publicUrl, w: cv.width, h: cv.height });
      if (!kq.ok) throw new Error(kq.error);
      toast.success("Đã đổi ảnh — trang công khai sẽ cập nhật trong ít phút");
      onXong();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setDangLuu(false);
    }
  };

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && onDong()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Đổi ảnh</DialogTitle>
          <DialogDescription>
            Khung ảnh trên trang là {o.w}×{o.h}. Ảnh bạn chọn sẽ được cắt đúng khung này và nén gọn trước khi tải lên.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Ảnh hiện tại</p>
            <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/40 p-2">
              <img src={o.daThay ?? o.macDinh} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Ảnh mới (đúng khung trên trang)</p>
            <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 p-2">
              {nguon ? <canvas ref={canvasRef} className="max-h-full max-w-full" aria-label="Xem trước ảnh mới" /> : <span className="px-4 text-center text-xs text-muted-foreground">Chưa chọn ảnh</span>}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <input ref={oTepRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" aria-label="Chọn ảnh từ máy" onChange={(e) => void chonTep(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" onClick={() => oTepRef.current?.click()}>
            {nguon ? "Chọn ảnh khác" : "Chọn ảnh từ máy"}
          </Button>
          {nguon && (
            <p className="text-xs text-muted-foreground">
              {tenTep} — {nguon.width}×{nguon.height}px
            </p>
          )}
          {nguon && coTheTruot && (
            <label className="flex items-center gap-3 text-sm">
              <span className="shrink-0">{truotNgang ? "Dịch trái ↔ phải" : "Dịch lên ↕ xuống"}</span>
              <input type="range" min={0} max={100} value={Math.round(viTri * 100)} onChange={(e) => setViTri(Number(e.target.value) / 100)} className="w-full" />
            </label>
          )}
          {canhBao === "nho-hon-anh-cu" && (
            <p className="rounded-md bg-state-warning-soft p-2 text-xs text-state-warning-ink">Ảnh này nhỏ hơn ảnh hiện tại nên sẽ mờ hơn. Nên chọn ảnh gốc từ máy ảnh/điện thoại (cạnh dài từ 1600px).</p>
          )}
          {canhBao === "hoi-nho" && <p className="rounded-md bg-state-warning-soft p-2 text-xs text-state-warning-ink">Ảnh hơi nhỏ, có thể bị mờ trên màn hình sắc nét. Nên chọn ảnh có cạnh dài từ 1600px.</p>}
          {loi && (
            <p role="alert" className="rounded-md bg-state-danger-soft p-2 text-xs text-state-danger-ink">
              {loi}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDong} disabled={dangLuu}>
            Huỷ
          </Button>
          <Button type="button" onClick={() => void luu()} disabled={!nguon || dangLuu}>
            {dangLuu ? "Đang lưu…" : "Lưu ảnh mới"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
