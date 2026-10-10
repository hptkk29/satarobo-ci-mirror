"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateVN } from "@/lib/format/date";
import type { BeChiTiet, CachXep, MucChiTiet } from "@/lib/hoc-bu/case-chi-tiet";
import { normalizeEvalNotes, normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";
// Cùng hộp thoại PHIẾU nhận xét của site giáo viên (đánh giá chung + bảng năng lực 9 tiêu chí, xuất PDF) — nhận xét học bù là phiếu như bên giáo viên,
// không phải một ô chữ (yêu cầu 09/10/2026). `luu` thay đường lưu mặc định bằng đường lưu theo MỤC của case.
import { StudentEvalDialog } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";
import { kiemKetQuaGui, lyDoSuaThieu, nhanKetQuaMuc, type KetQuaChon, type LuaChonMuc } from "@/lib/hoc-bu/hien-thi-thuan";

// ĐIỂM DANH HAI TẦNG của buổi dạy bù (T07/T16) — dùng chung admin + site giáo viên (hành động truyền từ trang).
//
//   TẦNG 1  bé có tới buổi bù không (Có mặt / Vắng)
//   TẦNG 2  từng BÀI: học xong hay chưa — nhập CÙNG LÚC với tầng 1, KHÔNG BAO GIỜ tự suy "có mặt ⇒ xong"; kèm đánh giá của giáo viên cho riêng bài đó
//
// Điểm danh GỐC (buổi vắng) không đổi vì học bù: kết quả ở đây là một sự kiện riêng (T08). Sửa điểm danh đảo được, có lý do và dấu vết.
// GV điểm danh trên ĐIỆN THOẠI ngay trong lớp ⇒ nút cao 44px, cột đơn ở 375px. ⚠️ Chỉ token `:root` (site GV không có `.admin-scope`).

export type KetQuaHanhDong = { ok: true } | { ok: false; error: string };

type KetQuaMucGui = Record<string, { ketQua: KetQuaChon; danhGia: string | null }>;

export type HanhDongBe = {
  diemDanh: (p: { participantId: string; coMat: boolean; ketQuaMuc: KetQuaMucGui; nhanXetChung: string | null }) => Promise<KetQuaHanhDong>;
  /** Không truyền = không cho sửa điểm danh (vd. Sale chỉ xem). */
  sua?: (p: { participantId: string; coMat: boolean; ketQuaMuc: KetQuaMucGui; nhanXetChung: string | null; phienBan: number; lyDo: string }) => Promise<KetQuaHanhDong>;
  /** Lưu PHIẾU nhận xét của một bài (đánh giá chung + bảng năng lực) — không đụng điểm danh. Không truyền = chỉ xem phiếu. */
  luuPhieu?: (p: { caseStudentId: string; danhGia: string; rubric: Record<string, number> }) => Promise<KetQuaHanhDong>;
  /** Không truyền = không cho gỡ (site giáo viên). */
  goBe?: (participantId: string) => Promise<KetQuaHanhDong>;
};

const CACH_XEP: Record<CachXep, string> = { LUOT: "Lượt bù", PHI: "Đã thu phí", MIEN_PHI: "Miễn phí" };
const PILL = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";
const TONE = {
  success: "bg-[color:var(--state-success-soft)] text-[color:var(--state-success)]",
  danger: "bg-[color:var(--state-danger-soft)] text-[color:var(--state-danger)]",
  warning: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]",
  info: "bg-[color:var(--state-info-soft)] text-[color:var(--state-info)]",
  muted: "bg-muted text-muted-foreground",
} as const;
const NUT = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors hover:brightness-95 disabled:opacity-50";
const O_NHAP = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DiemDanhBe({
  be,
  moDiemDanh,
  coTheNhap,
  hanhDong,
  boiCanh,
  hrefPhieuGoc,
}: {
  be: BeChiTiet[];
  /** Case còn SCHEDULED — chỉ lúc này mới điểm danh lần đầu được. */
  moDiemDanh: boolean;
  /** Người xem được nhập điểm danh + đánh giá (quản lý / GV của case). Sale: false ⇒ chỉ xem. */
  coTheNhap: boolean;
  hanhDong: HanhDongBe;
  /** Chữ in trên phiếu: tên khoá + ngày buổi bù đã định dạng. */
  boiCanh: { khoa: string; ngayHienThi: string };
  /** Phần đầu đường PDF phiếu (kết thúc bằng '/'); thêm id mục để ra đường dẫn. Là CHUỖI — hàm thường không đi được từ Server sang Client Component. Bỏ trống = không có nút PDF. */
  hrefPhieuGoc?: string;
}) {
  const dangTinh = be.filter((b) => b.status !== "REMOVED");
  const daGo = be.filter((b) => b.status === "REMOVED");
  if (dangTinh.length === 0 && daGo.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Case chưa có học viên nào.</p>;
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {dangTinh.map((b) => (
          <li key={b.id}>
            <TheBe b={b} moDiemDanh={moDiemDanh} coTheNhap={coTheNhap} hanhDong={hanhDong} boiCanh={boiCanh} hrefPhieuGoc={hrefPhieuGoc} />
          </li>
        ))}
      </ul>
      {daGo.length > 0 && (
        <p className="text-xs text-muted-foreground">Đã gỡ khỏi case: {daGo.map((b) => b.hocVien).join(", ")} (buổi cần bù đã quay lại danh sách).</p>
      )}
    </div>
  );
}

function TheBe({ b, moDiemDanh, coTheNhap, hanhDong, boiCanh, hrefPhieuGoc }: { b: BeChiTiet; moDiemDanh: boolean; coTheNhap: boolean; hanhDong: HanhDongBe; boiCanh: { khoa: string; ngayHienThi: string }; hrefPhieuGoc?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chon, setChon] = useState<LuaChonMuc>(() => Object.fromEntries(b.muc.map((m) => [m.id, { ketQua: m.result === "COMPLETED" || m.result === "NOT_COMPLETED" ? m.result : null, danhGia: m.danhGia ?? "" }])));
  const [nhanXetChung, setNhanXetChung] = useState(b.nhanXetChung ?? "");
  const [moChung, setMoChung] = useState(false);
  const [suaMo, setSuaMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  const choDiemDanh = b.status === "PENDING" && moDiemDanh && coTheNhap;
  const daDiemDanh = b.status === "PRESENT" || b.status === "ABSENT";
  const duocSua = daDiemDanh && coTheNhap && !!hanhDong.sua;

  function chay(viec: () => Promise<KetQuaHanhDong>, xong: string, sauKhi?: () => void) {
    setLoi(null);
    start(async () => {
      try {
        const kq = await viec();
        if (!kq.ok) {
          setLoi(kq.error);
          toast.error(kq.error);
          return;
        }
        toast.success(xong);
        sauKhi?.();
        router.refresh();
      } catch {
        setLoi("Mất kết nối — chưa lưu được, thử lại");
        toast.error("Mất kết nối — chưa lưu được, thử lại");
      }
    });
  }

  const kiem = kiemKetQuaGui(b.muc, chon);
  const chung = nhanXetChung.trim() ? nhanXetChung.trim() : null;

  function guiCoMat() {
    if (!kiem.ok) {
      setLoi(kiem.lyDo);
      return;
    }
    chay(() => hanhDong.diemDanh({ participantId: b.id, coMat: true, ketQuaMuc: kiem.ketQuaMuc, nhanXetChung: chung }), `${b.hocVien}: có mặt — đã lưu kết quả từng bài`);
  }
  function guiVang() {
    chay(() => hanhDong.diemDanh({ participantId: b.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null }), `${b.hocVien}: vắng — các bài quay lại danh sách cần bù`);
  }
  function guiSua(coMat: boolean) {
    const thieuLyDo = lyDoSuaThieu(lyDo);
    if (thieuLyDo) {
      setLoi(`Lý do sửa: ${thieuLyDo}`);
      return;
    }
    if (coMat && !kiem.ok) {
      setLoi(kiem.lyDo);
      return;
    }
    chay(
      () => hanhDong.sua!({ participantId: b.id, coMat, ketQuaMuc: coMat && kiem.ok ? kiem.ketQuaMuc : {}, nhanXetChung: coMat ? chung : null, phienBan: b.version, lyDo: lyDo.trim() }),
      "Đã sửa điểm danh",
      () => {
        setSuaMo(false);
        setLyDo("");
      },
    );
  }

  const pill =
    b.status === "PRESENT"
      ? { nhan: "Có mặt", tone: TONE.success }
      : b.status === "ABSENT"
        ? { nhan: "Vắng", tone: TONE.danger }
        : { nhan: "Chờ điểm danh", tone: TONE.muted };

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card" aria-label={`Học viên ${b.hocVien}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-foreground">{b.hocVien}</h3>
          <p className="truncate text-xs text-muted-foreground">{b.lop.join(" · ")}</p>
        </div>
        <span className={cn(PILL, pill.tone)}>{pill.nhan}</span>
      </header>

      <ul className="divide-y divide-border">
        {b.muc.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">Bé chưa có bài nào còn hiệu lực trong case.</li>}
        {b.muc.map((m) => (
          <MucRow
            key={m.id}
            m={m}
            dangNhap={choDiemDanh || suaMo}
            luaChon={chon[m.id]}
            doi={(v) => setChon((cu) => ({ ...cu, [m.id]: { ...(cu[m.id] ?? { ketQua: null, danhGia: "" }), ...v } }))}
            b={b}
            coTheNhap={coTheNhap && daDiemDanh && !suaMo}
            hanhDong={hanhDong}
            boiCanh={boiCanh}
            hrefPhieuGoc={hrefPhieuGoc}
          />
        ))}
      </ul>

      {b.mucDaNha.length > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Đã nhả khỏi case: {b.mucDaNha.map((m) => m.tenBai).join(", ")} — buổi cần bù tương ứng đã quay lại danh sách.
        </p>
      )}

      {(choDiemDanh || suaMo) && (
        <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
          <button type="button" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMoChung((v) => !v)} aria-expanded={moChung}>
            {moChung ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />} Nhận xét chung về buổi học (tuỳ chọn)
          </button>
          {moChung && <textarea aria-label="Nhận xét chung" className={O_NHAP} rows={2} value={nhanXetChung} onChange={(e) => setNhanXetChung(e.target.value)} />}
          {suaMo && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor={`ly-do-${b.id}`}>
                Lý do sửa điểm danh (bắt buộc)
              </label>
              <textarea id={`ly-do-${b.id}`} className={O_NHAP} rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
              <p className="text-xs text-muted-foreground">{lyDoSuaThieu(lyDo) ?? "Đủ."}</p>
            </div>
          )}
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {choDiemDanh ? (
              <>
                <button type="button" disabled={pending} onClick={guiCoMat} className={cn(NUT, TONE.success, "w-full sm:w-auto")}>
                  <Check className="size-4" aria-hidden /> Có mặt — lưu kết quả
                </button>
                <button type="button" disabled={pending} onClick={guiVang} className={cn(NUT, TONE.danger, "w-full sm:w-auto")}>
                  <X className="size-4" aria-hidden /> Vắng
                </button>
                {hanhDong.goBe && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => chay(() => hanhDong.goBe!(b.id), `Đã gỡ ${b.hocVien} khỏi case`)}
                    className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    Gỡ bé khỏi case
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" disabled={pending} onClick={() => guiSua(true)} className={cn(NUT, TONE.success, "w-full sm:w-auto")}>
                  <Check className="size-4" aria-hidden /> Lưu: có mặt
                </button>
                <button type="button" disabled={pending} onClick={() => guiSua(false)} className={cn(NUT, TONE.danger, "w-full sm:w-auto")}>
                  <X className="size-4" aria-hidden /> Lưu: vắng
                </button>
                <button type="button" disabled={pending} onClick={() => { setSuaMo(false); setLoi(null); }} className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted">
                  Huỷ sửa
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {daDiemDanh && !suaMo && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            {b.status === "PRESENT" ? (b.nhanXetChung ? `Nhận xét chung: ${b.nhanXetChung}` : "Chưa có nhận xét chung") : "Bé vắng buổi bù — lượt không bị tiêu."}
          </p>
          {duocSua && (
            <button type="button" onClick={() => setSuaMo(true)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-primary-ink hover:bg-muted">
              <Pencil className="size-3.5" aria-hidden /> Sửa điểm danh
            </button>
          )}
        </div>
      )}
      {loi && !(choDiemDanh || suaMo) && (
        <p role="alert" className="border-t border-border bg-[color:var(--state-danger-soft)] px-4 py-2 text-sm text-[color:var(--state-danger)]">
          {loi}
        </p>
      )}
    </article>
  );
}

function MucRow({
  m,
  b,
  dangNhap,
  luaChon,
  doi,
  coTheNhap,
  hanhDong,
  boiCanh,
  hrefPhieuGoc,
}: {
  m: MucChiTiet;
  b: BeChiTiet;
  dangNhap: boolean;
  luaChon: LuaChonMuc[string] | undefined;
  doi: (v: Partial<LuaChonMuc[string]>) => void;
  /** Được lập / sửa phiếu (đã điểm danh, không đang sửa điểm danh, đúng quyền). */
  coTheNhap: boolean;
  hanhDong: HanhDongBe;
  boiCanh: { khoa: string; ngayHienThi: string };
  hrefPhieuGoc?: string;
}) {
  const nhan = nhanKetQuaMuc(m.result);
  const coKetQua = m.result === "COMPLETED" || m.result === "NOT_COMPLETED";
  const chu = m.danhGia?.trim() ?? "";
  const daCoPhieu = chu.length > 0 || m.rubric !== null;
  const hrefPdf = daCoPhieu && hrefPhieuGoc ? `${hrefPhieuGoc}${m.id}` : undefined;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{m.tenBai}</p>
          <p className="truncate text-xs text-muted-foreground">
            {m.ngayVang ? `Vắng ${formatDateVN(m.ngayVang)} · ` : ""}
            {CACH_XEP[m.cachXep]}
          </p>
        </div>
        {!dangNhap && <span className={cn(PILL, TONE[nhan.tone])}>{nhan.nhan}</span>}
      </div>

      {dangNhap ? (
        // Điểm danh CHỈ chọn xong / chưa xong. Nhận xét là PHIẾU, lập sau khi lưu điểm danh (như bên giáo viên: điểm danh trước, "Nhận xét" từng bé sau).
        <div role="group" aria-label={`Kết quả ${m.tenBai}`} className="grid grid-cols-2 gap-2">
          {(["COMPLETED", "NOT_COMPLETED"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={luaChon?.ketQua === k}
              onClick={() => doi({ ketQua: k })}
              className={cn(
                "min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
                luaChon?.ketQua === k ? (k === "COMPLETED" ? "border-transparent " + TONE.success : "border-transparent " + TONE.warning) : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {k === "COMPLETED" ? "Đã học xong" : "Chưa xong"}
            </button>
          ))}
        </div>
      ) : (
        <>
          {chu && <p className="whitespace-pre-line rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">{chu}</p>}
          {coKetQua &&
            (coTheNhap && hanhDong.luuPhieu ? (
              // Hộp thoại dùng chung với site giáo viên có nút cao 32px; ở đây nới lên 44px (ngón tay trên điện thoại) mà không sửa component dùng chung.
              <div className="[&_a]:min-h-11 [&_button]:min-h-11">
              <StudentEvalDialog
                sessionId={m.id}
                studentId={b.studentId}
                studentName={b.hocVien}
                courseName={boiCanh.khoa}
                sessionTopic={m.tenBai}
                sessionDate={boiCanh.ngayHienThi}
                projectName={m.duAn}
                existing={daCoPhieu ? { projectName: m.duAn, notes: normalizeEvalNotes({ overall: chu }), rubric: normalizeEvalRatings(m.rubric) } : null}
                done={daCoPhieu}
                pdfHref={hrefPdf}
                luu={(p) => hanhDong.luuPhieu!({ caseStudentId: m.id, danhGia: p.notes.overall, rubric: p.rubric })}
              />
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={cn(PILL, daCoPhieu ? TONE.success : TONE.warning)}>{daCoPhieu ? "Đã nhận xét" : "Chưa nhận xét"}</span>
                {hrefPdf && (
                  <a
                    href={hrefPdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Xuất PDF
                  </a>
                )}
              </div>
            ))}
        </>
      )}
    </li>
  );
}
