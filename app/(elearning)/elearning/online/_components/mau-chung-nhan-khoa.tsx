"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, ExternalLink, ImagePlus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { duyetMauAction, taoBanMoiBoCucAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_NHO, NUT_PHU, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { dinhDangNgay } from "@/lib/elearning-online/hien-thi";
import { MAU_THU, NHAN_TRUONG, TRUONG_CN, type BoCuc, type TruongCn } from "@/lib/elearning-online/cn-mau";

export type BanMau = { id: string; version: number; status: "DRAFT" | "APPROVED" | "SUPERSEDED"; widthPx: number; heightPx: number; fieldsJson: unknown; soChungNhan: number; createdAt: string; approvedAt: string | null };
type CanhBao = { muc: string; thongBao: string };

const NHAN_TT = { DRAFT: ["Nháp", "warning"], APPROVED: ["Đang áp dụng", "success"], SUPERSEDED: ["Đã thay thế", "muted"] } as const;

/**
 * QoCN + QoCNXem — phôi chứng nhận Online của khoá. Phiên bản BẤT BIẾN: sửa vị trí chữ = tạo bản NHÁP mới; duyệt bản mới thay bản đang dùng.
 * Chứng nhận ĐÃ CẤP giữ nguyên bản đã dùng lúc cấp (không đổi theo phôi hiện hành).
 */
export function MauChungNhanKhoa({ courseId, mau, duocSua }: { courseId: string; mau: BanMau[]; duocSua: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [canhBao, setCanhBao] = useState<CanhBao[]>([]);
  const [chinh, setChinh] = useState<string | null>(null);
  const oTep = useRef<HTMLInputElement>(null);

  const tai = () => {
    const f = oTep.current?.files?.[0];
    if (!f) return void toast.error("Chọn tệp phôi (PNG hoặc JPEG) trước");
    chuyen(async () => {
      const fd = new FormData();
      fd.set("courseId", courseId);
      fd.set("phoi", f);
      const res = await fetch("/api/elearning/online/chung-nhan/phoi", { method: "POST", body: fd });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { version: number; canhBao: CanhBao[] }; error?: { message: string } } | null;
      if (!res.ok || !j?.data) return void toast.error(j?.error?.message ?? "Không tải được phôi");
      toast.success(`Đã tải phôi — bản nháp ${j.data.version}`);
      setCanhBao(j.data.canhBao);
      if (oTep.current) oTep.current.value = "";
      router.refresh();
    });
  };

  const active = mau.find((m) => m.status === "APPROVED");
  return (
    <section aria-label="Phôi chứng nhận của khoá" className="flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 className="text-[15px] font-medium">Phôi giấy chứng nhận của khoá</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {active ? `Đang áp dụng bản ${active.version}. ` : "Chưa có phôi riêng — chứng nhận dùng khuôn mặc định của Sata Robo. "}
            Mỗi chứng nhận giữ đúng bản phôi lúc được cấp; đổi phôi chỉ áp cho chứng nhận cấp sau.
          </p>
        </div>
        {duocSua ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="cn-phoi" className={NHAN_O}>Phôi (PNG/JPEG, khổ A4 ngang, ≥ 2000px)</label>
              <input id="cn-phoi" ref={oTep} type="file" accept="image/png,image/jpeg" className={`${O_NHAP} pt-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[13px]`} />
            </div>
            <button type="button" className={NUT_PHU} disabled={dangChay} onClick={tai}><ImagePlus className="h-4 w-4" aria-hidden />Tải phôi lên</button>
          </div>
        ) : null}
      </header>

      {canhBao.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-[10px] bg-state-warning-soft px-4 py-3 text-[13px] text-state-warning-ink" aria-label="Kết quả kiểm tra phôi">
          {canhBao.map((c, i) => <li key={i}>{c.muc === "LOI" ? "Lỗi: " : "Lưu ý: "}{c.thongBao}</li>)}
        </ul>
      ) : null}

      {mau.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">Chưa có phôi nào. Dùng ô “Phôi” phía trên; cần phôi có chừa trống 4 vùng chữ (xem “Tạo prompt phôi” ở tab Cài đặt).</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mau.map((m) => (
            <li key={m.id} className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">v{m.version}</span>
                <TrangThaiBadge sac={NHAN_TT[m.status][1]}>{NHAN_TT[m.status][0]}</TrangThaiBadge>
                <span className="text-[13px] text-muted-foreground">{m.widthPx}×{m.heightPx}px · tạo {dinhDangNgay(m.createdAt)} · {m.soChungNhan} chứng nhận đã cấp theo bản này</span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  {MAU_THU.map((t, i) => (
                    <a key={t.ten} className={NUT_NHO} href={`/api/elearning/online/chung-nhan/phoi/${m.id}/xem-thu?mau=${i}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" aria-hidden />Xem thử · {t.ten}</a>
                  ))}
                  {duocSua ? <button type="button" className={NUT_NHO} onClick={() => setChinh(chinh === m.id ? null : m.id)}><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />Chỉnh vị trí chữ</button> : null}
                  {duocSua && m.status === "DRAFT" ? (
                    <button
                      type="button"
                      className={NUT_CHINH}
                      disabled={dangChay}
                      onClick={() =>
                        chuyen(async () => {
                          const r = await duyetMauAction({ templateId: m.id });
                          if (!r.ok) return void toast.error(r.error.message);
                          toast.success("Đã duyệt — áp dụng cho chứng nhận cấp từ bây giờ");
                          router.refresh();
                        })
                      }
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden />Duyệt mẫu này
                    </button>
                  ) : null}
                </span>
              </div>
              {chinh === m.id ? <FormBoCuc key={m.id} ban={m} dangChay={dangChay} onLuu={(f) => chuyen(async () => {
                const r = await taoBanMoiBoCucAction({ templateId: m.id, fields: f as Record<string, unknown> });
                if (!r.ok) return void toast.error(r.error.message);
                toast.success(`Đã lưu thành bản nháp ${r.data.version}`);
                setCanhBao(r.data.canhBao);
                setChinh(null);
                router.refresh();
              })} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CAC_O: [keyof BoCuc[TruongCn], string][] = [["x", "x (%)"], ["y", "y (%)"], ["w", "rộng (%)"], ["h", "cao (%)"], ["fontPct", "cỡ chữ (% trang)"], ["maxLines", "số dòng tối đa"]];

function FormBoCuc({ ban, dangChay, onLuu }: { ban: BanMau; dangChay: boolean; onLuu: (f: BoCuc) => void }) {
  const [bc, setBc] = useState<BoCuc>(ban.fieldsJson as BoCuc);
  const dat = (t: TruongCn, k: string, v: unknown) => setBc({ ...bc, [t]: { ...bc[t], [k]: v } });
  return (
    <form
      className="flex flex-col gap-4 border-t border-border bg-muted/40 px-4 py-4"
      aria-label={`Chỉnh vị trí chữ bản ${ban.version}`}
      onSubmit={(e) => {
        e.preventDefault();
        onLuu(bc);
      }}
    >
      <p className={GOI_Y_O}>Toạ độ tính theo % trang; bốn khung phải nằm trong lề an toàn 5% và không chồng nhau. Lưu sẽ tạo BẢN NHÁP MỚI (bản này không bị sửa).</p>
      {TRUONG_CN.map((t) => (
        <fieldset key={t} className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <legend className="mb-1 text-[13px] font-medium">{NHAN_TRUONG[t]}</legend>
          {CAC_O.map(([k, nhan]) => (
            <div key={k}>
              <label htmlFor={`bc-${t}-${k}`} className={NHAN_O}>{nhan}</label>
              <input id={`bc-${t}-${k}`} inputMode="decimal" className={O_NHAP} value={String(bc[t][k])} onChange={(e) => dat(t, k, e.target.value.trim() === "" ? NaN : Number(e.target.value.replace(",", ".")))} />
            </div>
          ))}
          <div>
            <label htmlFor={`bc-${t}-align`} className={NHAN_O}>căn lề</label>
            <select id={`bc-${t}-align`} className={O_CHON} value={bc[t].align} onChange={(e) => dat(t, "align", e.target.value)}>
              <option value="left">Trái</option><option value="center">Giữa</option><option value="right">Phải</option>
            </select>
          </div>
          <div>
            <label htmlFor={`bc-${t}-color`} className={NHAN_O}>màu chữ</label>
            <input id={`bc-${t}-color`} className={O_NHAP} value={bc[t].color} onChange={(e) => dat(t, "color", e.target.value)} placeholder="#5B2A86" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={bc[t].bold} onChange={(e) => dat(t, "bold", e.target.checked)} />In đậm</label>
        </fieldset>
      ))}
      <div><button type="submit" className={NUT_CHINH} disabled={dangChay}>Lưu thành bản nháp mới</button></div>
    </form>
  );
}
