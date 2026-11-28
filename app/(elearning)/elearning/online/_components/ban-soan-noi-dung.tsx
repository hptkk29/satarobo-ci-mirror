"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, FolderPlus, MoreHorizontal, Pencil, PenLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { datBoCucAction, moBanNhapAction, suaBaiAction, suaChuongAction, themBaiAction, themChuongAction, xoaBaiAction, xoaChuongAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_NGUY, NUT_NHO, NUT_PHU, O_CHON, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { NHAN_LOAI_BAI } from "@/lib/elearning-online/hien-thi";
import { XemMienPhiThe } from "./xem-mien-phi-the";

type Bai = {
  id: string;
  stableId: string;
  kind: "VIDEO" | "READ" | "ASSIGNMENT" | "QUIZ" | "FINAL_EXAM";
  title: string;
  description: string | null;
  required: boolean;
  hidden: boolean;
  freePreview: boolean;
  durationSec: number | null;
  passPercent: number | null;
  contentJson: unknown;
};
type Chuong = { id: string; stableId: string; title: string; hidden: boolean; lessons: Bai[] };

type Props = {
  courseId: string;
  versionId: string;
  soBan: number;
  trangThaiBan: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  /** Số bản đang chạy (nếu có) — để nói rõ học viên vẫn học bản nào khi đang soạn nháp. */
  soBanChay?: number | null;
  chuong: Chuong[];
  /** Có `onl:course:manage` — ẩn mọi nút sửa khi không. */
  duocSua: boolean;
  /** Khoá có bản đang chạy mà CHƯA có bản nháp — người soạn phải mở nháp trước. */
  canMoNhap: boolean;
  /** Đề của khoá để gắn vào bài kiểm tra/bài tập/thi cuối. */
  deThi?: { id: string; title: string; kind: string; status: string }[];
};

type KQ = { ok: true } | { ok: false; error: { message: string } };
type Chay = (f: () => Promise<KQ>, thanhCong: string, xong?: () => void) => void;

const noiDungDang = (b: Bai) => (b.contentJson ?? {}) as { mediaRef?: string; body?: string; assessmentId?: string };

/**
 * QoChuongBai / QoBai — TRÌNH SOẠN chương & bài của BẢN NHÁP. Bản đã phát hành chỉ đọc (bất biến). Đổi thứ tự bằng nút lên/xuống rồi lưu cả bố cục một lượt
 * (server kiểm bố cục phủ ĐÚNG tập chương/bài hiện có — thiếu/thừa là bị từ chối, tránh ghi đè lên chỉnh sửa của người khác).
 * Nội dung bài là THAM CHIẾU (khoá media, id bài đánh giá, thân bài đọc) — không dán URL video công khai.
 */
export function BanSoanNoiDung(p: Props) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [chuongMoi, setChuongMoi] = useState("");
  const [dangSuaBai, setDangSuaBai] = useState<string | null>(null);
  const [xoa, setXoa] = useState<{ loai: "chuong" | "bai"; id: string; ten: string; lyDo: string } | null>(null);
  const sua = p.duocSua && p.trangThaiBan === "DRAFT";

  const chay: Chay = (f, thanhCong, xong) =>
    chuyen(async () => {
      const r = await f();
      if (!r.ok) return void toast.error(r.error.message);
      toast.success(thanhCong);
      xong?.();
      router.refresh();
    });

  const luuBoCuc = (ds: Chuong[]) =>
    chay(() => datBoCucAction({ versionId: p.versionId, chuong: ds.map((c) => ({ chapterId: c.id, lessonIds: c.lessons.map((b) => b.id) })) }), "Đã lưu thứ tự");

  const doiChuong = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= p.chuong.length) return;
    const ds = [...p.chuong];
    [ds[i], ds[j]] = [ds[j]!, ds[i]!];
    luuBoCuc(ds);
  };
  const doiBai = (ci: number, bi: number, d: -1 | 1) => {
    const c = p.chuong[ci]!;
    const bj = bi + d;
    if (bj < 0 || bj >= c.lessons.length) return;
    const bs = [...c.lessons];
    [bs[bi], bs[bj]] = [bs[bj]!, bs[bi]!];
    luuBoCuc(p.chuong.map((x, k) => (k === ci ? { ...x, lessons: bs } : x)));
  };

  if (p.canMoNhap) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm">Bản {p.soBan} đang chạy và <strong>không sửa được</strong> (học viên đang học trên đó). Mở một bản nháp mới — sao chép nội dung hiện tại — để chỉnh sửa rồi phát hành.</p>
        {p.duocSua ? (
          <button type="button" className={NUT_CHINH} disabled={dangChay} onClick={() => chay(() => moBanNhapAction({ courseId: p.courseId }), "Đã mở bản nháp mới")}>
            Mở bản nháp mới
          </button>
        ) : null}
        <BangDocChuong chuong={p.chuong} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      {sua ? (
        <p className="flex items-start gap-2.5 rounded-[10px] bg-state-warning-soft px-4 py-2.5 text-[13px] leading-5 text-state-warning-ink">
          <PenLine className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Mọi thay đổi ở đây vào <strong>bản nháp {p.soBan}</strong>.{p.soBanChay ? ` Học viên vẫn học bản ${p.soBanChay} cho tới khi phát hành.` : ""}
          </span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Bản {p.soBan}
          <TrangThaiBadge sac={p.trangThaiBan === "PUBLISHED" ? "success" : "muted"}>{p.trangThaiBan === "PUBLISHED" ? "Đang chạy" : "Đã thay thế"}</TrangThaiBadge>
          — chỉ đọc.
        </p>
      )}

      {sua && p.chuong.length > 0 ? <XemMienPhiThe chuong={p.chuong} /> : null}

      {p.chuong.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <FolderPlus className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Chưa có chương nào</p>
          <p className="text-[13px] text-muted-foreground">Thêm chương đầu tiên ở khung bên dưới, rồi thêm bài vào chương.</p>
        </div>
      ) : null}

      <ol className="flex flex-col gap-4">
        {p.chuong.map((c, ci) => (
          <li key={c.id} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
              <span className="text-[15px] font-medium text-muted-foreground">Chương {ci + 1} ·</span>
              <TenChuong c={c} sua={sua} onLuu={(title) => chay(() => suaChuongAction({ chapterId: c.id, title }), "Đã đổi tên chương")} />
              <span className="text-[13px] text-muted-foreground">{c.lessons.length} bài</span>
              {c.hidden ? <TrangThaiBadge sac="muted">Ẩn</TrangThaiBadge> : null}
              {sua ? (
                <span className="ml-auto">
                  <MenuThem nhan={`Thao tác với chương ${c.title}`}>
                    <MucMenu icon={ArrowUp} nhan="Đưa chương lên" tat={ci === 0 || dangChay} onClick={() => doiChuong(ci, -1)} />
                    <MucMenu icon={ArrowDown} nhan="Đưa chương xuống" tat={ci === p.chuong.length - 1 || dangChay} onClick={() => doiChuong(ci, 1)} />
                    <MucMenu icon={c.hidden ? Eye : EyeOff} nhan={c.hidden ? "Hiện chương" : "Ẩn chương"} onClick={() => chay(() => suaChuongAction({ chapterId: c.id, hidden: !c.hidden }), c.hidden ? "Đã hiện chương" : "Đã ẩn chương")} />
                    <MucMenu icon={Trash2} nhan="Xoá chương" nguy onClick={() => setXoa({ loai: "chuong", id: c.id, ten: c.title, lyDo: "" })} />
                  </MenuThem>
                </span>
              ) : null}
            </div>
            <ul className="mx-4 divide-y divide-border">
              {c.lessons.length === 0 ? <li className="py-4 text-[13px] text-muted-foreground">Chương chưa có bài.</li> : null}
              {c.lessons.map((b, bi) => (
                <li key={b.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                    <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{ci + 1}.{bi + 1}</span>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-sm font-medium leading-5">{b.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{moTaDong(b)}</p>
                    </div>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {b.required ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-[color:var(--el-text2)]">Bắt buộc</span> : <span className="text-xs text-muted-foreground">Tuỳ chọn</span>}
                      {b.freePreview ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-state-success-soft px-2 py-0.5 text-xs font-medium text-state-success-ink"><Check className="h-3 w-3" aria-hidden />Miễn phí</span>
                      ) : null}
                      {b.hidden ? <TrangThaiBadge sac="muted">Ẩn</TrangThaiBadge> : null}
                    </span>
                    {sua ? (
                      <span className="flex items-center gap-1">
                        <button type="button" className={NUT_NHO} onClick={() => setDangSuaBai(dangSuaBai === b.id ? null : b.id)}><Pencil className="h-4 w-4" aria-hidden />Sửa</button>
                        <MenuThem nhan={`Thao tác với bài ${b.title}`}>
                          <MucMenu icon={ArrowUp} nhan="Đưa bài lên" tat={bi === 0 || dangChay} onClick={() => doiBai(ci, bi, -1)} />
                          <MucMenu icon={ArrowDown} nhan="Đưa bài xuống" tat={bi === c.lessons.length - 1 || dangChay} onClick={() => doiBai(ci, bi, 1)} />
                          <MucMenu icon={Trash2} nhan="Xoá bài" nguy onClick={() => setXoa({ loai: "bai", id: b.id, ten: b.title, lyDo: "" })} />
                        </MenuThem>
                      </span>
                    ) : null}
                  </div>
                  {sua && dangSuaBai === b.id ? (
                    <FormBai b={b} deThi={p.deThi ?? []} dangChay={dangChay} onDong={() => setDangSuaBai(null)} onLuu={(patch) => chay(() => suaBaiAction({ lessonId: b.id, ...patch }), "Đã lưu bài", () => setDangSuaBai(null))} />
                  ) : null}
                </li>
              ))}
            </ul>
            {sua ? <ThemBai versionId={p.versionId} chapterId={c.id} dangChay={dangChay} chay={chay} /> : null}
          </li>
        ))}
      </ol>

      {sua ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chuongMoi.trim()) return;
            chay(() => themChuongAction({ versionId: p.versionId, title: chuongMoi.trim() }), "Đã thêm chương", () => setChuongMoi(""));
          }}
        >
          <label htmlFor="chuong-moi" className="sr-only">Chương mới</label>
          <input id="chuong-moi" className={`${O_NHAP} min-w-[220px] flex-1`} value={chuongMoi} onChange={(e) => setChuongMoi(e.target.value)} placeholder="Tên chương mới" maxLength={200} />
          <button type="submit" className={NUT_PHU} disabled={dangChay || !chuongMoi.trim()}><Plus className="h-4 w-4" aria-hidden />Thêm chương</button>
        </form>
      ) : null}

      {xoa ? (
        <div role="dialog" aria-label={`Xoá ${xoa.loai === "chuong" ? "chương" : "bài"}`} className="rounded-lg border border-state-danger/40 bg-card p-4">
          <p className="text-sm">
            Xoá {xoa.loai === "chuong" ? "chương (kèm mọi bài trong chương)" : "bài"} <strong>{xoa.ten}</strong> khỏi BẢN NHÁP? Học viên đang học bản đang chạy không bị ảnh hưởng cho tới khi bạn phát hành.
          </p>
          <label htmlFor="xoa-lydo" className="mt-3 block text-[13px] font-medium">Lý do (≥ 10 ký tự, vào nhật ký)</label>
          <input id="xoa-lydo" className={`${O_NHAP} mt-1`} value={xoa.lyDo} onChange={(e) => setXoa({ ...xoa, lyDo: e.target.value })} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={NUT_NGUY}
              disabled={dangChay || xoa.lyDo.trim().length < 10}
              onClick={() =>
                chay(
                  () => (xoa.loai === "chuong" ? xoaChuongAction({ chapterId: xoa.id }, { reason: xoa.lyDo.trim() }) : xoaBaiAction({ lessonId: xoa.id }, { reason: xoa.lyDo.trim() })),
                  "Đã xoá",
                  () => setXoa(null),
                )
              }
            >
              Xoá
            </button>
            <button type="button" className={NUT_NHO} onClick={() => setXoa(null)}>Huỷ</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const phutGiay = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Dòng phụ của bài: loại · thời lượng · ngưỡng đạt (chỉ những gì có thật). */
function moTaDong(b: Bai): string {
  const ph = [NHAN_LOAI_BAI[b.kind] ?? b.kind];
  if (b.durationSec) ph.push(phutGiay(b.durationSec));
  if (b.passPercent !== null && b.passPercent !== undefined) ph.push(`đạt ≥${b.passPercent}%`);
  return ph.join(" · ");
}

/** Menu thao tác `⋯` (không cần JS để mở/đóng; chọn một mục thì tự đóng). */
function MenuThem({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <details className="relative">
      <summary
        aria-label={nhan}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
      </summary>
      <div
        role="menu"
        className="absolute right-0 top-9 z-20 min-w-48 rounded-[10px] border border-border bg-card p-1 shadow-[0_8px_24px_rgba(31,27,22,0.12)]"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) e.currentTarget.closest("details")?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}

function MucMenu({ icon: Icon, nhan, onClick, tat, nguy }: { icon: typeof Pencil; nhan: string; onClick: () => void; tat?: boolean; nguy?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={tat}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${nguy ? "text-state-danger-ink hover:bg-state-danger-soft" : "text-foreground"}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {nhan}
    </button>
  );
}

function BangDocChuong({ chuong }: { chuong: Chuong[] }) {
  return (
    <ol className="mt-2 w-full list-decimal pl-5 text-sm">
      {chuong.map((c) => (
        <li key={c.id} className="py-1">
          <span className="font-medium">{c.title}</span> — {c.lessons.length} bài
        </li>
      ))}
    </ol>
  );
}

function TenChuong({ c, sua, onLuu }: { c: Chuong; sua: boolean; onLuu: (t: string) => void }) {
  const [dang, setDang] = useState(false);
  const [t, setT] = useState(c.title);
  if (!sua || !dang) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-[15px] font-medium">{c.title}</span>
        {sua ? (
          <button type="button" className={NUT_NHO} aria-label={`Đổi tên chương ${c.title}`} onClick={() => setDang(true)}><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <input aria-label="Tên chương" className={`${O_NHAP} h-8 w-64!`} value={t} onChange={(e) => setT(e.target.value)} maxLength={200} />
      <button type="button" className={NUT_NHO} onClick={() => { if (t.trim()) { onLuu(t.trim()); setDang(false); } }}>Lưu</button>
      <button type="button" className={NUT_NHO} onClick={() => { setT(c.title); setDang(false); }}>Huỷ</button>
    </span>
  );
}

function ThemBai({ versionId, chapterId, dangChay, chay }: { versionId: string; chapterId: string; dangChay: boolean; chay: Chay }) {
  const [kind, setKind] = useState<Bai["kind"]>("VIDEO");
  const [ten, setTen] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-border bg-muted/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ten.trim()) return;
        chay(() => themBaiAction({ versionId, chapterId, kind, title: ten.trim() }), "Đã thêm bài", () => setTen(""));
      }}
    >
      <div className="w-[160px]">
        <label htmlFor={`k-${chapterId}`} className="sr-only">Loại bài</label>
        <select id={`k-${chapterId}`} className={O_CHON} value={kind} onChange={(e) => setKind(e.target.value as Bai["kind"])}>
          {Object.entries(NHAN_LOAI_BAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="min-w-[220px] flex-1">
        <label htmlFor={`t-${chapterId}`} className="sr-only">Tên bài mới</label>
        <input id={`t-${chapterId}`} className={O_NHAP} value={ten} onChange={(e) => setTen(e.target.value)} placeholder="Tên bài mới" maxLength={200} />
      </div>
      <button type="submit" className={NUT_PHU} disabled={dangChay || !ten.trim()}><Plus className="h-4 w-4" aria-hidden />Thêm bài</button>
    </form>
  );
}

function FormBai({ b, deThi, dangChay, onDong, onLuu }: { b: Bai; deThi: { id: string; title: string; kind: string; status: string }[]; dangChay: boolean; onDong: () => void; onLuu: (patch: Record<string, unknown>) => void }) {
  const nd = noiDungDang(b);
  const [title, setTitle] = useState(b.title);
  const [moTa, setMoTa] = useState(b.description ?? "");
  const [required, setRequired] = useState(b.required);
  const [free, setFree] = useState(b.freePreview);
  const [hidden, setHidden] = useState(b.hidden);
  const [phut, setPhut] = useState(b.durationSec ? String(Math.round(b.durationSec / 60)) : "");
  const [dat, setDat] = useState(b.passPercent?.toString() ?? "");
  const [media, setMedia] = useState(nd.mediaRef ?? "");
  const [than, setThan] = useState(nd.body ?? "");
  const [danhGia, setDanhGia] = useState(nd.assessmentId ?? "");
  const danhGiaKind = b.kind === "ASSIGNMENT" || b.kind === "QUIZ" || b.kind === "FINAL_EXAM";

  return (
    <form
      className="grid gap-3 border-t border-border bg-muted/30 px-4 py-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const contentJson = b.kind === "VIDEO" ? (media.trim() ? { mediaRef: media.trim() } : {}) : b.kind === "READ" ? { body: than } : danhGia.trim() ? { assessmentId: danhGia.trim() } : {};
        onLuu({
          title: title.trim(),
          description: moTa.trim() || null,
          required,
          freePreview: free,
          hidden,
          durationSec: phut.trim() ? Math.round(Number(phut) * 60) : null,
          passPercent: danhGiaKind && dat.trim() ? Number(dat) : null,
          contentJson,
        });
      }}
    >
      <div className="sm:col-span-2">
        <label className={NHAN_O} htmlFor={`bt-${b.id}`}>Tên bài *</label>
        <input id={`bt-${b.id}`} className={O_NHAP} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </div>
      <div className="sm:col-span-2">
        <label className={NHAN_O} htmlFor={`bm-${b.id}`}>Mô tả</label>
        <input id={`bm-${b.id}`} className={O_NHAP} value={moTa} onChange={(e) => setMoTa(e.target.value)} maxLength={2000} />
      </div>
      {b.kind === "VIDEO" ? (
        <>
          <div>
            <label className={NHAN_O} htmlFor={`bv-${b.id}`}>Khoá media video</label>
            <input id={`bv-${b.id}`} className={O_NHAP} value={media} onChange={(e) => setMedia(e.target.value)} placeholder="online/video/<khoá>/<bài>/<mã>.mp4" />
            <p className={GOI_Y_O}>Khoá đối tượng trong kho video hiện có, bắt buộc nằm dưới online/video/ — không dán URL, không trỏ vào video giáo trình hay bài nộp. Phát video có kiểm soát chờ hạ tầng; bài vẫn lưu được.</p>
          </div>
          <div>
            <label className={NHAN_O} htmlFor={`bp-${b.id}`}>Thời lượng (phút)</label>
            <input id={`bp-${b.id}`} inputMode="numeric" className={O_NHAP} value={phut} onChange={(e) => setPhut(e.target.value)} />
          </div>
        </>
      ) : null}
      {b.kind === "READ" ? (
        <div className="sm:col-span-2">
          <label className={NHAN_O} htmlFor={`bd-${b.id}`}>Nội dung bài đọc</label>
          <textarea id={`bd-${b.id}`} className={O_NHAP_VAN_BAN} rows={8} value={than} onChange={(e) => setThan(e.target.value)} maxLength={100000} />
        </div>
      ) : null}
      {danhGiaKind ? (
        <>
          <div>
            <label className={NHAN_O} htmlFor={`ba-${b.id}`}>Đề gắn với bài</label>
            <select id={`ba-${b.id}`} className={O_CHON} value={danhGia} onChange={(e) => setDanhGia(e.target.value)}>
              <option value="">— Chưa gắn đề —</option>
              {deThi.filter((d) => d.kind === b.kind && d.status !== "ARCHIVED").map((d) => (
                <option key={d.id} value={d.id}>{d.title}{d.status === "DRAFT" ? " (nháp)" : ""}</option>
              ))}
            </select>
            <p className={GOI_Y_O}>Tạo đề ở tab “Kiểm tra & thi”. Đề nháp chưa làm được; bài chưa gắn đề vẫn phát hành được kèm cảnh báo.</p>
          </div>
          <div>
            <label className={NHAN_O} htmlFor={`bn-${b.id}`}>Điểm đạt (%)</label>
            <input id={`bn-${b.id}`} inputMode="numeric" className={O_NHAP} value={dat} onChange={(e) => setDat(e.target.value)} />
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Bắt buộc (tính vào % hoàn thành)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />Cho học thử (không cần mua)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Ẩn</label>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={NUT_CHINH} disabled={dangChay || !title.trim()}>Lưu bài</button>
        <button type="button" className={NUT_PHU} onClick={onDong}>Đóng</button>
      </div>
    </form>
  );
}
