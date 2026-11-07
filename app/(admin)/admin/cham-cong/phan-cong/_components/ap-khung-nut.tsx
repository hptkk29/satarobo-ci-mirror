"use client";
// Nút "Áp khung" của màn Phân công gộp (GĐ4): chép tuần đang xem (tuần mẫu) sang một khoảng ngày. BẮT BUỘC xem trước rồi mới áp thật:
// nút "Áp thật" chỉ mở khi lượt xem trước cuối cùng khớp đúng các ô đang chọn (đổi ô nào ⇒ phải xem trước lại).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { apKhungAction } from "../_actions-gop";

type KetQua = Extract<Awaited<ReturnType<typeof apKhungAction>>, { ok: true }>;

export function ApKhungNut({ centerId, tuanMau, tuDeXuat, denDeXuat, giaoVien }: { centerId: string; tuanMau: string; tuDeXuat: string; denDeXuat: string; giaoVien: { id: string; ten: string }[] }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [tu, setTu] = useState(tuDeXuat);
  const [den, setDen] = useState(denDeXuat);
  const [cheDo, setCheDo] = useState<"BO_SUNG" | "GHI_DE">("BO_SUNG");
  const [chon, setChon] = useState<string[] | null>(null);
  const [xem, setXem] = useState<{ khoa: string; kq: KetQua } | null>(null);
  const [dang, batDau] = useTransition();
  const khoa = JSON.stringify({ tu, den, cheDo, chon });
  const tenCua = new Map(giaoVien.map((g) => [g.id, g.ten]));

  const goi = (ghiThat: boolean) =>
    batDau(async () => {
      const r = await apKhungAction({ centerId, tuanMau, tu, den, cheDo, giaoVien: chon, ghiThat });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (ghiThat) {
        toast.success(r.message);
        setMo(false);
        setXem(null);
        router.refresh();
      } else setXem({ khoa, kq: r });
    });

  return (
    <>
      <button type="button" className={BTN_OUTLINE} onClick={() => setMo(true)}>
        Áp khung
      </button>
      <Dialog open={mo} onOpenChange={setMo}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Áp khung lịch</DialogTitle>
            <DialogDescription>
              Chép tuần {tuanMau.slice(8, 10)}/{tuanMau.slice(5, 7)} (tuần đang xem): ai trực ca nào, ai đứng chính / trợ giảng lớp nào — sang các tuần
              đích. Không chép học bù / Trial; ngày từ hôm nay trở về trước không đụng.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-muted-foreground">Áp từ ngày</span>
                <input type="date" value={tu} onChange={(e) => setTu(e.target.value)} className="min-h-10 rounded-md border border-border bg-background px-2" />
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">tới ngày</span>
                <input type="date" value={den} onChange={(e) => setDen(e.target.value)} className="min-h-10 rounded-md border border-border bg-background px-2" />
              </label>
            </div>
            <fieldset className="rounded-lg border border-border p-2">
              <legend className="px-1 text-xs text-muted-foreground">Cách áp</legend>
              <label className="mr-4 inline-flex min-h-10 items-center gap-2">
                <input type="radio" name="cheDo" checked={cheDo === "BO_SUNG"} onChange={() => setCheDo("BO_SUNG")} />
                Bổ sung (giữ trực đang có)
              </label>
              <label className="inline-flex min-h-10 items-center gap-2">
                <input type="radio" name="cheDo" checked={cheDo === "GHI_DE"} onChange={() => setCheDo("GHI_DE")} />
                Ghi đè (gỡ trực thừa)
              </label>
            </fieldset>
            <fieldset className="rounded-lg border border-border p-2">
              <legend className="px-1 text-xs text-muted-foreground">Giáo viên</legend>
              <label className="inline-flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={chon == null} onChange={(e) => setChon(e.target.checked ? null : [])} />
                Mọi người trong tuần mẫu
              </label>
              {chon != null && (
                <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
                  {giaoVien.map((g) => (
                    <label key={g.id} className="inline-flex min-h-9 items-center gap-2">
                      <input type="checkbox" checked={chon.includes(g.id)} onChange={(e) => setChon((c) => (e.target.checked ? [...(c ?? []), g.id] : (c ?? []).filter((x) => x !== g.id)))} />
                      {g.ten}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {xem && (
              <div className="rounded-lg bg-muted p-3" data-xem-truoc>
                <p className="font-medium">{xem.kq.message}</p>
                <ul className="mt-1 list-disc pl-5">
                  <li>Giao trực: {xem.kq.soBuoc.giaoTruc}</li>
                  <li>Gỡ trực: {xem.kq.soBuoc.goTruc}</li>
                  <li>Đặt người đứng chính / trợ giảng: {xem.kq.soBuoc.datNguoi}</li>
                  {xem.kq.boQuaNgay > 0 && <li>Bỏ qua {xem.kq.boQuaNgay} ngày (từ hôm nay trở về trước)</li>}
                  {xem.kq.tuan.length > 1 && <li>Ghi theo {xem.kq.tuan.length} tuần — mỗi tuần một lượt riêng; lỗi giữa chừng thì các tuần trước vẫn giữ.</li>}
                </ul>
                {xem.kq.xungDot.length > 0 && (
                  <p className="mt-2 text-state-warning-ink">
                    Không đổi {xem.kq.xungDot.length} buổi vì người mẫu đang giữ vai khác ở buổi đích:{" "}
                    {xem.kq.xungDot
                      .slice(0, 5)
                      .map((x) => `${tenCua.get(x.userId) ?? x.userId} ${x.ngay.slice(8, 10)}/${x.ngay.slice(5, 7)}`)
                      .join(", ")}
                    {xem.kq.xungDot.length > 5 ? "…" : ""}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={dang || (chon != null && chon.length === 0)} onClick={() => goi(false)} className={BTN_OUTLINE}>
                Xem trước
              </button>
              <button
                type="button"
                disabled={dang || !xem || xem.khoa !== khoa}
                onClick={() => goi(true)}
                className="min-h-10 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
                title={!xem || xem.khoa !== khoa ? "Bấm Xem trước với đúng lựa chọn này trước" : undefined}
              >
                Áp thật
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
