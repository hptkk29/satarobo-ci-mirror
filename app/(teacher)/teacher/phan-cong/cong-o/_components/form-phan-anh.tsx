"use client";

// Form phản ánh MỘT ô công "cần xem" (GĐ6). Giáo viên khai mốc giờ cần GHI THÊM (vào / ra) + lý do; duyệt xong lượt quét được ghi thêm
// — không sửa thẳng kết quả ô. Ô đang có phản ánh chờ ⇒ chỉ hiện trạng thái + nút Rút.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LY_DO_PHAN_ANH_TOI_THIEU, NHAN_TRANG_THAI_PHAN_ANH } from "@/lib/phan-cong/phan-anh";
import { guiPhanAnhAction, rutPhanAnhAction } from "../../_actions-phan-anh";

const NHAN_MOC = ["Vào 1", "Ra 1", "Vào 2", "Ra 2"];

export function FormPhanAnh({
  centerId,
  ngay,
  ca,
  phanAnh,
}: {
  centerId: string;
  ngay: string;
  ca: string;
  phanAnh: { id: string; status: string; decisionNote: string | null } | null;
}) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [moc, setMoc] = useState<string[]>(["", ""]);
  const [pending, start] = useTransition();

  if (phanAnh?.status === "CHO_DUYET") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-state-info-ink">Đã gửi — chờ duyệt</span>
        <button
          type="button"
          disabled={pending}
          className="text-sm text-muted-foreground underline disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await rutPhanAnhAction({ id: phanAnh.id });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success(r.message);
              router.refresh();
            })
          }
        >
          Rút phản ánh
        </button>
      </div>
    );
  }

  const daQuyet = phanAnh ? (
    <p className="text-xs text-muted-foreground">
      Phản ánh trước: {NHAN_TRANG_THAI_PHAN_ANH[phanAnh.status] ?? phanAnh.status}
      {phanAnh.decisionNote ? ` — ${phanAnh.decisionNote}` : ""}
    </p>
  ) : null;
  if (!mo) {
    return (
      <div className="space-y-1">
        {daQuyet}
        <button type="button" onClick={() => setMo(true)} className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
          Phản ánh ô này
        </button>
      </div>
    );
  }
  const duLyDo = lyDo.trim().length >= LY_DO_PHAN_ANH_TOI_THIEU;
  const coMoc = moc.some((m) => m);
  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await guiPhanAnhAction({ centerId, ngay, ca, lyDo, moc: moc.map((m) => m || null) });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(r.message);
          setMo(false);
          router.refresh();
        });
      }}
    >
      {daQuyet}
      <p className="text-xs text-muted-foreground">Ghi đúng giờ cần GHI THÊM (ví dụ chỉ thiếu giờ ra thì chỉ điền ô Ra).</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {moc.map((m, i) => (
          <label key={i} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {NHAN_MOC[i]}
            <input
              type="time"
              value={m}
              onChange={(e) => setMoc((cu) => cu.map((x, j) => (j === i ? e.target.value : x)))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      {moc.length < NHAN_MOC.length && (
        <button type="button" onClick={() => setMoc((cu) => [...cu, "", ""])} className="text-xs text-primary underline">
          Thêm một cặp vào–ra
        </button>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Lý do
        <textarea
          rows={2}
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
          placeholder="Ví dụ: máy quét lỗi lúc về, đã báo lễ tân"
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setMo(false)} className="h-9 rounded-md px-3 text-sm text-muted-foreground">
          Huỷ
        </button>
        <button
          type="submit"
          disabled={pending || !duLyDo || !coMoc}
          title={!coMoc ? "Điền ít nhất một mốc giờ" : !duLyDo ? `Ghi lý do ít nhất ${LY_DO_PHAN_ANH_TOI_THIEU} ký tự` : undefined}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Gửi phản ánh
        </button>
      </div>
    </form>
  );
}
