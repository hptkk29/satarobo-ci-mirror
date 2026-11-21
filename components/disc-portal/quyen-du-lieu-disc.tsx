"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { xoaKetQuaDiscAction } from "@/app/(portal)/portal/disc/_actions";

/**
 * Quyền của chủ dữ liệu trên kết quả DISC (S-01): tải về · xoá. Xoá phải qua HAI bước: mở khung xác nhận, rồi tick
 * "tôi hiểu" mới bật nút xoá. Bước cuối gửi `xacNhan: "XOA"` — server TỰ kiểm, nên gọi thẳng action mà thiếu nó bị từ chối.
 * `idLuot` có ⇒ xoá riêng lần làm đó; không có ⇒ xoá toàn bộ kết quả của tài khoản.
 */
export function QuyenDuLieuDisc({ idLuot, choPhepTai = true }: { idLuot?: string; choPhepTai?: boolean }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [hieu, setHieu] = useState(false);
  const [dangXoa, batDau] = useTransition();
  const idHieu = useId();
  const pham = idLuot ? "lần làm này" : "tất cả kết quả DISC";

  function xoa() {
    batDau(async () => {
      const r = await xoaKetQuaDiscAction({ ...(idLuot ? { id: idLuot } : {}), xacNhan: "XOA" });
      if (r.ok) {
        toast.success("Đã xoá kết quả DISC");
        router.push("/portal/disc");
        router.refresh();
      } else {
        toast.error(r.error);
        setMo(false);
        setHieu(false);
      }
    });
  }

  return (
    <section aria-label="Dữ liệu của bạn" className="portal-v2 mt-6 rounded-2xl border border-border bg-card p-4" data-quyen-du-lieu>
      <h2 className="text-base font-bold text-foreground">Dữ liệu của bạn</h2>
      <p className="mt-1 text-sm text-muted-foreground">Bạn có thể tải về hoặc xoá kết quả DISC bất cứ lúc nào.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {choPhepTai && (
          <a
            href="/portal/disc/du-lieu-cua-toi"
            download="du-lieu-disc-cua-toi.json"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
            data-tai-du-lieu
          >
            <Download aria-hidden className="size-4" />
            Tải dữ liệu của tôi
          </a>
        )}
        {!mo && (
          <button
            type="button"
            onClick={() => setMo(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-destructive/40 bg-card px-3 text-sm font-semibold text-destructive hover:bg-destructive/5"
            data-mo-xoa
          >
            <Trash2 aria-hidden className="size-4" />
            Xoá {idLuot ? "lần làm này" : "kết quả của tôi"}
          </button>
        )}
      </div>
      {mo && (
        <div role="group" aria-labelledby={`${idHieu}-t`} className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3" data-khung-xac-nhan-xoa>
          <p id={`${idHieu}-t`} className="text-sm font-semibold text-foreground">
            Xoá {pham}?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Họ tên, năm sinh, điểm và email đã khai sẽ bị xoá vĩnh viễn và không thể khôi phục. Việc này cũng là rút lại đồng ý xử lý hồ sơ DISC. Hồ sơ liên hệ tư vấn (nếu có) do trung tâm quản lý riêng.
          </p>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={hieu} onChange={(e) => setHieu(e.target.checked)} className="mt-1 size-4" data-hieu-xoa />
            <span>Tôi hiểu và muốn xoá vĩnh viễn.</span>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!hieu || dangXoa}
              onClick={xoa}
              className="inline-flex min-h-11 items-center rounded-xl bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-50"
              data-xac-nhan-xoa
            >
              {dangXoa ? "Đang xoá…" : "Xoá vĩnh viễn"}
            </button>
            <button
              type="button"
              disabled={dangXoa}
              onClick={() => {
                setMo(false);
                setHieu(false);
              }}
              className="inline-flex min-h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground"
            >
              Giữ lại
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
