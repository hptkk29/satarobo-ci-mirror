"use client";

// components/admin/nguon-hoa-hong/khoi-danh-muc-page.tsx — DANH MỤC PAGE: thêm / sửa phạm vi / tắt-bật một Page Facebook (`FacebookPageMapping`).
//
// Đứng TRÊN bảng "Page → nguồn": bảng đó chỉ gán nguồn cho Page đã có ở đây. CHỈ Quản trị tối cao (page tính cờ `coTheQuanLy`, máy chủ kiểm lại).
// Nói thật (luật 12):
//  · Khối này KHÔNG gán nguồn, KHÔNG đổi nguồn của lead đã có, KHÔNG đụng chính sách hoa hồng, KHÔNG bật cờ `nguon.pageMapping` — dòng chữ trong hộp
//    thoại nói đúng ba điều ấy; việc gán nguồn vẫn ở bảng bên dưới.
//  · Phạm vi `Hội sở` giữ nguyên hành vi Messenger CRM hiện tại; `Cơ sở` đổi phạm vi cách ly của hội thoại MỚI — hộp thoại nói trước.
//  · Page đã cấp cho Agent AI Lead mà chưa có trong danh mục hiện thành gợi ý một chạm (không phải nguồn dữ liệu thứ hai).
//  · 375px: danh sách là thẻ xếp dọc (không bảng), nút cao 44px; hộp thoại cuộn được.
// Hàm lưu được TIÊM (`luu`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { luuPageDanhMucAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/ui/status-pill";
import type { KetQuaLuuPageDanhMucAction } from "@/lib/nguon/ket-qua-action";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, NUT_NHO } from "./classes";

export type DongDanhMuc = { pageId: string; tenPage: string | null; phamVi: "HO" | "CENTER"; centerId: string | null; tenCoSo: string | null; dangTat: boolean };
export type GoiYPage = { pageId: string; agent: string; trongDanhMuc: boolean };
type Luu = (input: { pageId: string; pageName: string | null; phamVi: "HO" | "CENTER"; centerId: string | null; isActive: boolean; lyDo: string }) => Promise<KetQuaLuuPageDanhMucAction>;
const LUU_MAC_DINH: Luu = (input) => luuPageDanhMucAction(input);

type Nhap = { pageId: string; pageName: string; phamVi: "HO" | "CENTER"; centerId: string; isActive: boolean; lyDo: string; sua: boolean };
const TRONG: Nhap = { pageId: "", pageName: "", phamVi: "HO", centerId: "", isActive: true, lyDo: "", sua: false };

export function KhoiDanhMucPage({
  coTheQuanLy,
  danhMuc,
  goiY,
  coSo,
  luu = LUU_MAC_DINH,
}: {
  /** Quản trị tối cao — page tính, khối không đoán (luật 7: bắt buộc). */
  coTheQuanLy: boolean;
  danhMuc: DongDanhMuc[];
  goiY: GoiYPage[];
  coSo: { id: string; name: string }[];
  luu?: Luu;
}) {
  const router = useRouter();
  const [mo, datMo] = useState(false);
  const [nhap, datNhap] = useState<Nhap>(TRONG);
  const [loi, datLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const chuaCo = goiY.filter((g) => !g.trongDanhMuc);

  if (!coTheQuanLy) return null;

  function moHop(n: Partial<Nhap>) {
    datNhap({ ...TRONG, ...n });
    datLoi(null);
    datMo(true);
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    datLoi(null);
    batDau(async () => {
      const r = await luu({
        pageId: nhap.pageId.trim(),
        pageName: nhap.pageName.trim() === "" ? null : nhap.pageName.trim(),
        phamVi: nhap.phamVi,
        centerId: nhap.phamVi === "CENTER" ? nhap.centerId : null,
        isActive: nhap.isActive,
        lyDo: nhap.lyDo.trim(),
      });
      if (!r.ok) {
        datLoi(r.error);
        return;
      }
      datMo(false);
      if (r.hanhDong === "KHONG_DOI") toast.message("Không có gì thay đổi.");
      else toast.success(r.hanhDong === "THEM" ? "Đã thêm Page vào danh mục." : "Đã cập nhật Page.");
      for (const c of r.canhBao) toast.warning(c);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="dm-page-tieu-de" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dm-page-tieu-de" className="text-sm font-semibold text-foreground">
            Danh mục Page
          </h2>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            Page phải có ở đây thì mới gán được nguồn ở bảng bên dưới. Thêm Page mới không cần sửa mã. Khối này <b>không</b> gán nguồn, không đổi nguồn của lead đã có
            và không đổi chính sách hoa hồng.
          </p>
        </div>
        <button type="button" className={`${BTN_PRIMARY} ${NUT_NHO} gap-1.5`} onClick={() => moHop({})}>
          <Plus aria-hidden className="h-4 w-4" />
          Thêm Page
        </button>
      </div>

      {chuaCo.length > 0 ? (
        <div role="status" className="mt-3 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {chuaCo.length} Page đã cấp cho Agent AI Lead nhưng <b>chưa có trong danh mục</b> — hồ sơ AI trên Page đó chưa quy được nguồn.
            </span>
          </p>
          <ul className="mt-2 grid gap-2">
            {chuaCo.map((g) => (
              <li key={g.pageId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card/60 px-3 py-2">
                <span className="min-w-0 text-xs">
                  <code className="font-mono">{g.pageId}</code> · Agent: {g.agent}
                </span>
                <button type="button" className={`${BTN_OUTLINE} ${NUT_NHO}`} onClick={() => moHop({ pageId: g.pageId })}>
                  Thêm vào danh mục
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {danhMuc.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Danh mục đang trống.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {danhMuc.map((d) => (
            <li key={d.pageId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{d.tenPage ?? "(chưa đặt tên)"}</p>
                <p className="text-xs text-muted-foreground">
                  <code className="font-mono">{d.pageId}</code> · {d.phamVi === "HO" ? "Hội sở" : (d.tenCoSo ?? "Cơ sở")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={d.dangTat ? "muted" : "success"}>{d.dangTat ? "Đang tắt" : "Đang bật"}</StatusPill>
                <button
                  type="button"
                  className={`${BTN_OUTLINE} ${NUT_NHO}`}
                  onClick={() => moHop({ pageId: d.pageId, pageName: d.tenPage ?? "", phamVi: d.phamVi, centerId: d.centerId ?? "", isActive: !d.dangTat, sua: true })}
                >
                  Sửa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={mo} onOpenChange={(v) => (dang ? undefined : datMo(v))}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{nhap.sua ? "Sửa Page trong danh mục" : "Thêm Page vào danh mục"}</DialogTitle>
            <DialogDescription>Ghi nhật ký trước/sau kèm lý do. Không tự gán nguồn và không đổi lead đã có.</DialogDescription>
          </DialogHeader>
          <form onSubmit={gui} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Mã Page (pageId)</span>
              <input
                className={FIELD}
                value={nhap.pageId}
                readOnly={nhap.sua}
                required
                inputMode="text"
                autoComplete="off"
                onChange={(e) => datNhap({ ...nhap, pageId: e.target.value })}
                aria-describedby="dm-page-id-goiy"
              />
              <span id="dm-page-id-goiy" className="text-xs text-muted-foreground">
                Chữ, số, _ hoặc -, dài 5–64 ký tự. Không dùng mã Page mẫu của gói bàn giao.
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Tên Page (tuỳ chọn)</span>
              <input className={FIELD} value={nhap.pageName} maxLength={120} onChange={(e) => datNhap({ ...nhap, pageName: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Phạm vi</span>
              <select className={FIELD} value={nhap.phamVi} onChange={(e) => datNhap({ ...nhap, phamVi: e.target.value as "HO" | "CENTER" })}>
                <option value="HO">Hội sở (toàn hệ thống)</option>
                <option value="CENTER">Một cơ sở</option>
              </select>
            </label>
            {nhap.phamVi === "CENTER" ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Cơ sở</span>
                <select className={FIELD} value={nhap.centerId} required onChange={(e) => datNhap({ ...nhap, centerId: e.target.value })}>
                  <option value="">— Chọn cơ sở —</option>
                  {coSo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p role="note" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Phạm vi còn quyết cơ sở của hội thoại Messenger CRM <b>mới</b> trên Page này. <b>Hội sở</b> giữ nguyên hành vi hiện tại; chọn một cơ sở sẽ đổi phạm vi cách ly
                của hội thoại mới. Hội thoại và lead đã có không đổi.
              </span>
            </p>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={nhap.isActive} onChange={(e) => datNhap({ ...nhap, isActive: e.target.checked })} className="h-4 w-4" />
              <span>Page đang bật (tắt ⇒ webhook bỏ qua Page này)</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Lý do thay đổi (tối thiểu 10 ký tự)</span>
              <textarea className={FIELD} rows={2} maxLength={500} required value={nhap.lyDo} onChange={(e) => datNhap({ ...nhap, lyDo: e.target.value })} />
            </label>
            {loi ? (
              <p role="alert" className="rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
                {loi}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <button type="button" className={`${BTN_OUTLINE} ${NUT_NHO}`} disabled={dang} onClick={() => datMo(false)}>
                Huỷ
              </button>
              <button type="submit" className={`${BTN_PRIMARY} ${NUT_NHO} gap-1.5`} disabled={dang || nhap.lyDo.trim().length < 10 || nhap.pageId.trim().length < 5}>
                {dang ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
                {nhap.sua ? "Lưu thay đổi" : "Thêm vào danh mục"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
