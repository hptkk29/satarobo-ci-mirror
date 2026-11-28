"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { chamSanPhamAction, chamTayAction, docLuotDeChamAction, yeuCauNopLaiAction } from "../_actions";
import { NHAN_O, NUT_CHINH, NUT_NGUY, NUT_PHU, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { dinhDangNgay } from "@/lib/elearning-online/hien-thi";

export type LuotCho = { id: string; soLuot: number; nopLuc: string | null; tenHocVien: string; tenDe: string };

type SanPhamCham = {
  questionId: string;
  stem: string;
  toiDa: number;
  bai: { id: string; status: "SUBMITTED" | "GRADED" | "RESUBMIT_REQUESTED"; fileName: string; mimeType: string; sizeBytes: number; durationSec: number | null; khung: { id: string; name: string; max: number }[] | null; points: number | null; feedback: string | null } | null;
};
type ChiTiet = { id: string; tenDe: string; tenHocVien: string; sanPham: SanPhamCham[]; tuLuan: { id: string; stem: string; toiDa: number }[]; baiLam: Record<string, unknown> };

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const phutGiay = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Hàng chờ chấm của một khoá (tự luận + SẢN PHẨM) + form chấm. Sản phẩm chấm theo khung chấm của khoá; chấm xong từng sản phẩm mới hoàn tất lượt. */
export function HangChoCham({ luot }: { luot: LuotCho[] }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [ct, setCt] = useState<ChiTiet | null>(null);
  const [diem, setDiem] = useState<Record<string, string>>({});
  const [nhanXet, setNhanXet] = useState("");

  const mo = (id: string, giuDiem = false) =>
    chuyen(async () => {
      const r = await docLuotDeChamAction({ attemptId: id });
      if (!r.ok) return void toast.error(r.error.message);
      setCt(r.data as ChiTiet);
      if (!giuDiem) {
        setDiem({});
        setNhanXet("");
      }
    });

  if (luot.length === 0 && !ct) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
        <p className="text-sm font-medium">Không có bài nào đang chờ chấm</p>
        <p className="text-[13px] text-muted-foreground">Bài tự luận và sản phẩm học viên nộp sẽ hiện ở đây.</p>
      </div>
    );
  }
  const choSanPham = ct ? ct.sanPham.some((p) => p.bai && p.bai.status !== "GRADED") : false;
  return (
    <div>
      <ul className="mx-4 divide-y divide-border">
        {luot.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
            <span className="min-w-0 flex-1 basis-48">
              <span className="font-medium">{l.tenHocVien}</span>
              <span className="block text-xs text-muted-foreground">{l.tenDe} · lượt {l.soLuot} · nộp {l.nopLuc ? dinhDangNgay(l.nopLuc) : "—"}</span>
            </span>
            <button type="button" className={NUT_PHU} disabled={dangChay} onClick={() => mo(l.id)}>Chấm</button>
          </li>
        ))}
      </ul>
      {ct ? (
        <form
          className="m-4 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          aria-label="Chấm bài"
          onSubmit={(e) => {
            e.preventDefault();
            const d: Record<string, number> = {};
            for (const c of ct.tuLuan) d[c.id] = Number(diem[c.id]);
            chuyen(async () => {
              const r = await chamTayAction({ attemptId: ct.id, diem: d, feedback: nhanXet.trim() || null });
              if (!r.ok) return void toast.error(r.error.message);
              toast.success(`Đã chấm: ${r.data.scorePercent}% — ${r.data.passed ? "Đạt" : "Chưa đạt"}${r.data.vuaCapChungNhan ? " · đã cấp chứng nhận" : ""}`);
              setCt(null);
              router.refresh();
            });
          }}
        >
          <p className="text-sm"><strong>{ct.tenHocVien}</strong> · {ct.tenDe}</p>
          {ct.sanPham.map((p) => (
            <KhoiSanPham key={p.questionId} p={p} dangChay={dangChay} diem={diem} setDiem={setDiem} onXong={() => mo(ct.id, true)} chuyen={chuyen} />
          ))}
          {ct.tuLuan.map((c) => (
            <div key={c.id} className="rounded-[10px] border border-border p-3">
              <p className="text-sm font-medium">{c.stem}</p>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm">{typeof ct.baiLam[c.id] === "string" ? (ct.baiLam[c.id] as string) : "(Không trả lời)"}</p>
              <label htmlFor={`d-${c.id}`} className={`${NHAN_O} mt-2`}>Điểm (0–{c.toiDa})</label>
              <input id={`d-${c.id}`} inputMode="numeric" className={`${O_NHAP} max-w-[120px]`} value={diem[c.id] ?? ""} onChange={(e) => setDiem({ ...diem, [c.id]: e.target.value })} required />
            </div>
          ))}
          <div>
            <label htmlFor="cham-nx" className={NHAN_O}>Nhận xét</label>
            <textarea id="cham-nx" className={O_NHAP_VAN_BAN} rows={2} value={nhanXet} onChange={(e) => setNhanXet(e.target.value)} maxLength={5000} />
          </div>
          {choSanPham ? <p className="text-[13px] text-state-warning-ink">Chấm xong từng sản phẩm (hoặc yêu cầu nộp lại) rồi mới hoàn tất lượt.</p> : null}
          <div className="flex gap-2">
            <button type="submit" className={NUT_CHINH} disabled={dangChay || choSanPham || ct.tuLuan.some((c) => (diem[c.id] ?? "").trim() === "")}>Hoàn tất chấm</button>
            <button type="button" className={NUT_PHU} onClick={() => setCt(null)}>Đóng</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** Một câu SẢN PHẨM: thông tin tệp, chấm theo khung (hoặc điểm trực tiếp), yêu cầu nộp lại. Xem tệp đi qua vé có thời hạn của kho video hiện có — chưa nối hạ tầng nên chỉ hiện thông tin tệp. */
function KhoiSanPham({ p, dangChay, diem, setDiem, onXong, chuyen }: { p: SanPhamCham; dangChay: boolean; diem: Record<string, string>; setDiem: (d: Record<string, string>) => void; onXong: () => void; chuyen: (f: () => Promise<void>) => void }) {
  const [lyDo, setLyDo] = useState("");
  const b = p.bai;
  const k = (id: string) => `sp-${p.questionId}-${id}`;
  const tong = b?.khung ? b.khung.reduce((t, c) => t + c.max, 0) : 0;
  return (
    <div className="rounded-[10px] border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{p.stem}</p>
        <TrangThaiBadge sac="info">Sản phẩm · {p.toiDa} điểm</TrangThaiBadge>
      </div>
      {!b ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Học viên chưa nộp sản phẩm — câu này tính 0 điểm.</p>
      ) : (
        <>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{b.fileName}</span>
            <span className="text-muted-foreground">{b.mimeType} · {mb(b.sizeBytes)}{b.durationSec ? ` · ${phutGiay(b.durationSec)}` : ""}</span>
            {b.status === "GRADED" ? <TrangThaiBadge sac="success">Đã chấm {b.points}/{p.toiDa}</TrangThaiBadge> : null}
            {b.status === "RESUBMIT_REQUESTED" ? <TrangThaiBadge sac="warning">Chờ nộp lại</TrangThaiBadge> : null}
          </p>
          {b.feedback ? <p className="mt-1 text-[13px] text-muted-foreground">Nhận xét: {b.feedback}</p> : null}
          {b.status === "SUBMITTED" ? (
            <div className="mt-3 flex flex-col gap-3">
              {b.khung ? (
                <fieldset className="grid gap-2 sm:grid-cols-2">
                  <legend className="mb-1 text-[13px] font-medium">Chấm theo khung ({tong} điểm)</legend>
                  {b.khung.map((c) => (
                    <div key={c.id}>
                      <label htmlFor={k(c.id)} className={NHAN_O}>{c.name} (0–{c.max})</label>
                      <input id={k(c.id)} inputMode="numeric" className={O_NHAP} value={diem[k(c.id)] ?? ""} onChange={(e) => setDiem({ ...diem, [k(c.id)]: e.target.value })} />
                    </div>
                  ))}
                </fieldset>
              ) : (
                <div>
                  <label htmlFor={k("truc-tiep")} className={NHAN_O}>Điểm (0–{p.toiDa})</label>
                  <input id={k("truc-tiep")} inputMode="numeric" className={`${O_NHAP} max-w-[120px]`} value={diem[k("truc-tiep")] ?? ""} onChange={(e) => setDiem({ ...diem, [k("truc-tiep")]: e.target.value })} />
                </div>
              )}
              <div>
                <button
                  type="button"
                  className={NUT_CHINH}
                  disabled={dangChay}
                  onClick={() =>
                    chuyen(async () => {
                      const r = await chamSanPhamAction(b.khung ? { submissionId: b.id, scores: Object.fromEntries(b.khung.map((c) => [c.id, Number(diem[k(c.id)])])) } : { submissionId: b.id, diemTrucTiep: Number(diem[k("truc-tiep")]) });
                      if (!r.ok) return void toast.error(r.error.message);
                      toast.success(`Đã chấm sản phẩm: ${r.data.points}/${r.data.toiDa}`);
                      onXong();
                    })
                  }
                >
                  Lưu điểm sản phẩm
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <div className="min-w-[220px] flex-1">
                  <label htmlFor={k("lydo")} className={NHAN_O}>Yêu cầu nộp lại — lý do (≥ 10 ký tự)</label>
                  <input id={k("lydo")} className={O_NHAP} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
                </div>
                <button
                  type="button"
                  className={NUT_NGUY}
                  disabled={dangChay || lyDo.trim().length < 10}
                  onClick={() =>
                    chuyen(async () => {
                      const r = await yeuCauNopLaiAction({ submissionId: b.id, lyDo: lyDo.trim() });
                      if (!r.ok) return void toast.error(r.error.message);
                      toast.success("Đã yêu cầu học viên nộp lại");
                      onXong();
                    })
                  }
                >
                  Yêu cầu nộp lại
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
