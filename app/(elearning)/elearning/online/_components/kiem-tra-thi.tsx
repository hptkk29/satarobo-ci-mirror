"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { luuCauHoiAction, luuDeThiAction, luuTruCauHoiAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_NHO, NUT_PHU, O_CHON, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { NHAN_LOAI_BAI } from "@/lib/elearning-online/hien-thi";
import { LOAI_MO_RONG, laLoaiMoRong, type LoaiMoRong } from "@/lib/elearning-online/dang-cau-hoi";
import { NHAN_LOAI_MO_RONG, SoanDangMoRong, cauHinhMacDinh, type CauHinh } from "./soan-dang-cau";

type Loai = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_TEXT" | "ESSAY" | LoaiMoRong;
/** 13 dạng: 5 dạng gốc + 8 dạng mở rộng (V10.0). */
const NHAN_LOAI: Record<Loai, string> = { SINGLE_CHOICE: "Chọn một", MULTIPLE_CHOICE: "Chọn nhiều", TRUE_FALSE: "Đúng / Sai", SHORT_TEXT: "Trả lời ngắn", ESSAY: "Tự luận", ...NHAN_LOAI_MO_RONG };
const LOAI_GOC: Loai[] = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_TEXT", "ESSAY"];

export type CauHoiDong = { id: string; type: Loai; stem: string; points: number; status: "ACTIVE" | "ARCHIVED" };
export type DeThiDong = { id: string; kind: "QUIZ" | "ASSIGNMENT" | "FINAL_EXAM"; title: string; passPercent: number; timeLimitMin: number | null; maxAttempts: number | null; shuffle: boolean; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; soCau: number; soLuot: number; cauIds: string[] };

/**
 * Tab "Kiểm tra & thi" — NGÂN HÀNG CÂU HỎI + ĐỀ của MỘT khoá Online (tách bạch với ngân hàng nội bộ/LMS Offline). Server kiểm cuối; đáp án đúng không bao giờ rời server khi học viên làm bài.
 * Đề gắn vào bài học ở tab "Chương & bài" (bài kiểm tra / bài tập / thi cuối chọn một đề cùng loại).
 */
export function KiemTraThi({ courseId, cauHoi, deThi, duocSua }: { courseId: string; cauHoi: CauHoiDong[]; deThi: DeThiDong[]; duocSua: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Ngân hàng câu hỏi" className="rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Ngân hàng câu hỏi <span className="font-normal text-muted-foreground">({cauHoi.filter((c) => c.status === "ACTIVE").length})</span></h2>
          {duocSua ? <a className={NUT_NHO} href={`/elearning/online/khoa/${courseId}/nhap-cau-hoi`}>Nhập từ Excel</a> : null}
        </header>
        <DanhSachCau courseId={courseId} cauHoi={cauHoi} duocSua={duocSua} />
        {duocSua ? <FormCauHoi courseId={courseId} /> : null}
      </section>
      <section aria-label="Đề kiểm tra và thi" className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Đề kiểm tra · bài tập · thi cuối khoá <span className="font-normal text-muted-foreground">({deThi.length})</span></h2>
        </header>
        <DanhSachDe courseId={courseId} deThi={deThi} cauHoi={cauHoi} duocSua={duocSua} />
      </section>
    </div>
  );
}

function DanhSachCau({ courseId, cauHoi, duocSua }: { courseId: string; cauHoi: CauHoiDong[]; duocSua: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [xoa, setXoa] = useState<{ id: string; lyDo: string } | null>(null);
  if (cauHoi.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">Chưa có câu hỏi nào.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {cauHoi.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <TrangThaiBadge sac="info">{NHAN_LOAI[c.type]}</TrangThaiBadge>
            <span className="min-w-0 flex-1 truncate">{c.stem}</span>
            <span className="text-xs text-muted-foreground">{c.points} điểm</span>
            {c.status === "ARCHIVED" ? <TrangThaiBadge sac="muted">Đã lưu trữ</TrangThaiBadge> : null}
            {duocSua && c.status === "ACTIVE" ? (
              <button type="button" className={NUT_NHO} onClick={() => setXoa({ id: c.id, lyDo: "" })}>Lưu trữ</button>
            ) : null}
          </li>
        ))}
      </ul>
      {xoa ? (
        <div role="dialog" aria-label="Lưu trữ câu hỏi" className="m-4 rounded-lg border border-border p-4">
          <p className="text-sm">Lưu trữ câu hỏi? Đề đang dùng giữ tham chiếu; lượt làm bài đã có KHÔNG đổi (đã chụp snapshot); lượt mới bỏ qua câu này.</p>
          <label htmlFor="ch-lydo" className="mt-3 block text-[13px] font-medium">Lý do (≥ 10 ký tự)</label>
          <input id="ch-lydo" className={`${O_NHAP} mt-1`} value={xoa.lyDo} onChange={(e) => setXoa({ ...xoa, lyDo: e.target.value })} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={NUT_PHU}
              disabled={dangChay || xoa.lyDo.trim().length < 10}
              onClick={() =>
                chuyen(async () => {
                  const r = await luuTruCauHoiAction({ courseId, questionId: xoa.id }, { reason: xoa.lyDo.trim() });
                  if (!r.ok) return void toast.error(r.error.message);
                  toast.success("Đã lưu trữ câu hỏi");
                  setXoa(null);
                  router.refresh();
                })
              }
            >
              Lưu trữ
            </button>
            <button type="button" className={NUT_NHO} onClick={() => setXoa(null)}>Huỷ</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function FormCauHoi({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [loai, setLoai] = useState<Loai>("SINGLE_CHOICE");
  const [stem, setStem] = useState("");
  const [lc, setLc] = useState<{ text: string; dung: boolean }[]>([{ text: "", dung: true }, { text: "", dung: false }]);
  const [dungSai, setDungSai] = useState(true);
  const [ngan, setNgan] = useState("");
  const [diem, setDiem] = useState("1");
  const [giaiThich, setGiaiThich] = useState("");
  const [ch, setCh] = useState<CauHinh>({});
  const moRong = laLoaiMoRong(loai);
  const coLuaChon = loai === "SINGLE_CHOICE" || loai === "MULTIPLE_CHOICE";

  const gui = (e: React.FormEvent) => {
    e.preventDefault();
    const options = lc.map((o, i) => ({ id: String.fromCharCode(97 + i), text: o.text }));
    const dungIds = lc.flatMap((o, i) => (o.dung ? [String.fromCharCode(97 + i)] : []));
    chuyen(async () => {
      const r = await luuCauHoiAction({
        courseId,
        type: loai,
        stem,
        ...(coLuaChon ? { options, correct: loai === "SINGLE_CHOICE" ? dungIds[0] : dungIds } : {}),
        ...(loai === "TRUE_FALSE" ? { correct: dungSai } : {}),
        ...(loai === "SHORT_TEXT" ? { accepted: ngan.split("\n").map((x) => x.trim()).filter(Boolean) } : {}),
        ...(moRong ? { cauHinh: ch } : {}),
        explanation: giaiThich.trim() || null,
        points: Number(diem) || 1,
      });
      if (!r.ok) return void toast.error(r.error.message);
      toast.success("Đã thêm câu hỏi");
      setStem("");
      setLc([{ text: "", dung: true }, { text: "", dung: false }]);
      setNgan("");
      setGiaiThich("");
      if (moRong) setCh(cauHinhMacDinh(loai));
      router.refresh();
    });
  };

  return (
    <form onSubmit={gui} className="grid gap-3 border-t border-border bg-muted/30 p-4 sm:grid-cols-2" aria-label="Thêm câu hỏi">
      <h3 className="text-sm font-semibold sm:col-span-2">Thêm câu hỏi</h3>
      <div>
        <label htmlFor="cq-loai" className={NHAN_O}>Loại câu hỏi</label>
        <select
          id="cq-loai"
          className={O_CHON}
          value={loai}
          onChange={(e) => {
            const l = e.target.value as Loai;
            setLoai(l);
            if (laLoaiMoRong(l)) setCh(cauHinhMacDinh(l));
          }}
        >
          <optgroup label="Dạng cơ bản">{LOAI_GOC.map((k) => <option key={k} value={k}>{NHAN_LOAI[k]}</option>)}</optgroup>
          <optgroup label="Dạng nâng cao">{LOAI_MO_RONG.map((k) => <option key={k} value={k}>{NHAN_LOAI[k]}</option>)}</optgroup>
        </select>
      </div>
      <div>
        <label htmlFor="cq-diem" className={NHAN_O}>Điểm</label>
        <input id="cq-diem" inputMode="numeric" className={O_NHAP} value={diem} onChange={(e) => setDiem(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="cq-stem" className={NHAN_O}>{loai === "FILL_BLANK" ? "Câu có chỗ trống * (đặt đáp án trong [[ ]])" : "Nội dung câu hỏi *"}</label>
        <textarea id="cq-stem" className={O_NHAP_VAN_BAN} rows={2} value={stem} onChange={(e) => setStem(e.target.value)} maxLength={5000} />
      </div>
      {coLuaChon ? (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-[13px] font-medium">Các lựa chọn — tích ô đáp án đúng{loai === "SINGLE_CHOICE" ? " (chỉ một)" : ""}</legend>
          {lc.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={loai === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                name="cq-dung"
                aria-label={`Đáp án đúng: lựa chọn ${i + 1}`}
                checked={o.dung}
                onChange={(e) => setLc(lc.map((x, k) => (loai === "SINGLE_CHOICE" ? { ...x, dung: k === i } : k === i ? { ...x, dung: e.target.checked } : x)))}
              />
              <input aria-label={`Lựa chọn ${i + 1}`} className={O_NHAP} value={o.text} onChange={(e) => setLc(lc.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} maxLength={1000} />
              {lc.length > 2 ? <button type="button" className={NUT_NHO} onClick={() => setLc(lc.filter((_, k) => k !== i))}>Bỏ</button> : null}
            </div>
          ))}
          {lc.length < 10 ? <div><button type="button" className={NUT_NHO} onClick={() => setLc([...lc, { text: "", dung: false }])}>Thêm lựa chọn</button></div> : null}
        </fieldset>
      ) : null}
      {loai === "TRUE_FALSE" ? (
        <fieldset className="flex gap-4 sm:col-span-2">
          <legend className="mb-1 text-[13px] font-medium">Đáp án</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="cq-ds" checked={dungSai} onChange={() => setDungSai(true)} />Đúng</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="cq-ds" checked={!dungSai} onChange={() => setDungSai(false)} />Sai</label>
        </fieldset>
      ) : null}
      {loai === "SHORT_TEXT" ? (
        <div className="sm:col-span-2">
          <label htmlFor="cq-ngan" className={NHAN_O}>Đáp án được chấp nhận (mỗi dòng một đáp án)</label>
          <textarea id="cq-ngan" className={O_NHAP_VAN_BAN} rows={3} value={ngan} onChange={(e) => setNgan(e.target.value)} />
          <p className={GOI_Y_O}>Không phân biệt hoa/thường và khoảng trắng; KHÔNG bỏ dấu tiếng Việt.</p>
        </div>
      ) : null}
      {moRong ? <SoanDangMoRong loai={loai as LoaiMoRong} stem={stem} setStem={setStem} ch={Object.keys(ch).length ? ch : cauHinhMacDinh(loai as LoaiMoRong)} setCh={setCh} /> : null}
      {loai === "ESSAY" ? <p className={`${GOI_Y_O} sm:col-span-2`}>Câu tự luận do giáo viên chấm tay (tab “Chấm bài”). Điểm câu = điểm tối đa ở trên.</p> : null}
      <div className="sm:col-span-2">
        <label htmlFor="cq-gt" className={NHAN_O}>Giải thích (hiện cho học viên theo cài đặt xem kết quả)</label>
        <input id="cq-gt" className={O_NHAP} value={giaiThich} onChange={(e) => setGiaiThich(e.target.value)} maxLength={3000} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={NUT_CHINH} disabled={dangChay || !stem.trim()}>{dangChay ? "Đang lưu…" : "Thêm câu hỏi"}</button>
      </div>
    </form>
  );
}

function DanhSachDe({ courseId, deThi, cauHoi, duocSua }: { courseId: string; deThi: DeThiDong[]; cauHoi: CauHoiDong[]; duocSua: boolean }) {
  const [sua, setSua] = useState<DeThiDong | "moi" | null>(null);
  return (
    <>
      {deThi.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">Chưa có đề nào.</p> : null}
      <ul className="divide-y divide-border">
        {deThi.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <TrangThaiBadge sac="info">{NHAN_LOAI_BAI[d.kind]}</TrangThaiBadge>
            <span className="min-w-0 flex-1 font-medium">{d.title}</span>
            <span className="text-xs text-muted-foreground">{d.soCau} câu · đạt {d.passPercent}%{d.timeLimitMin ? ` · ${d.timeLimitMin} phút` : ""}{d.maxAttempts ? ` · ${d.maxAttempts} lượt` : ""} · {d.soLuot} lượt đã làm</span>
            <TrangThaiBadge sac={d.status === "ACTIVE" ? "success" : d.status === "DRAFT" ? "warning" : "muted"}>{d.status === "ACTIVE" ? "Đang dùng" : d.status === "DRAFT" ? "Nháp" : "Lưu trữ"}</TrangThaiBadge>
            {duocSua ? <button type="button" className={NUT_NHO} onClick={() => setSua(d)}>Sửa</button> : null}
          </li>
        ))}
      </ul>
      {duocSua ? (
        <div className="border-t border-border p-4">
          {sua ? (
            <FormDe key={sua === "moi" ? "moi" : sua.id} courseId={courseId} cauHoi={cauHoi.filter((c) => c.status === "ACTIVE")} de={sua === "moi" ? null : sua} onDong={() => setSua(null)} />
          ) : (
            <button type="button" className={NUT_CHINH} onClick={() => setSua("moi")}>Tạo đề mới</button>
          )}
        </div>
      ) : null}
    </>
  );
}

function FormDe({ courseId, cauHoi, de, onDong }: { courseId: string; cauHoi: CauHoiDong[]; de: DeThiDong | null; onDong: () => void }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [kind, setKind] = useState<DeThiDong["kind"]>(de?.kind ?? "QUIZ");
  const [title, setTitle] = useState(de?.title ?? "");
  const [dat, setDat] = useState(String(de?.passPercent ?? 70));
  const [phut, setPhut] = useState(de?.timeLimitMin ? String(de.timeLimitMin) : "");
  const [luot, setLuot] = useState(de?.maxAttempts ? String(de.maxAttempts) : "");
  const [xao, setXao] = useState(de?.shuffle ?? false);
  const [tt, setTt] = useState<DeThiDong["status"]>(de?.status ?? "DRAFT");
  const [chon, setChon] = useState<string[]>(de?.cauIds ?? []);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label={de ? "Sửa đề" : "Tạo đề mới"}
      onSubmit={(e) => {
        e.preventDefault();
        chuyen(async () => {
          const r = await luuDeThiAction({
            id: de?.id, courseId, kind, title, passPercent: Number(dat) || 0, timeLimitMin: phut.trim() ? Number(phut) : null, maxAttempts: luot.trim() ? Number(luot) : null, shuffle: xao, status: tt,
            cau: chon.map((questionId) => ({ questionId })),
          });
          if (!r.ok) return void toast.error(r.error.message);
          toast.success("Đã lưu đề");
          onDong();
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor="de-loai" className={NHAN_O}>Loại</label>
        <select id="de-loai" className={O_CHON} value={kind} onChange={(e) => setKind(e.target.value as DeThiDong["kind"])}>
          <option value="QUIZ">Bài kiểm tra</option>
          <option value="ASSIGNMENT">Bài tập</option>
          <option value="FINAL_EXAM">Thi cuối khoá</option>
        </select>
      </div>
      <div>
        <label htmlFor="de-tt" className={NHAN_O}>Trạng thái</label>
        <select id="de-tt" className={O_CHON} value={tt} onChange={(e) => setTt(e.target.value as DeThiDong["status"])}>
          <option value="DRAFT">Nháp (học viên chưa làm được)</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="ARCHIVED">Lưu trữ</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="de-ten" className={NHAN_O}>Tên đề *</label>
        <input id="de-ten" className={O_NHAP} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>
      <div>
        <label htmlFor="de-dat" className={NHAN_O}>Điểm đạt (%)</label>
        <input id="de-dat" inputMode="numeric" className={O_NHAP} value={dat} onChange={(e) => setDat(e.target.value)} />
      </div>
      <div>
        <label htmlFor="de-phut" className={NHAN_O}>Thời gian (phút)</label>
        <input id="de-phut" inputMode="numeric" className={O_NHAP} value={phut} onChange={(e) => setPhut(e.target.value)} placeholder="Không giới hạn" />
      </div>
      <div>
        <label htmlFor="de-luot" className={NHAN_O}>Số lượt tối đa</label>
        <input id="de-luot" inputMode="numeric" className={O_NHAP} value={luot} onChange={(e) => setLuot(e.target.value)} placeholder="Không giới hạn" />
      </div>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={xao} onChange={(e) => setXao(e.target.checked)} />Xáo thứ tự câu hỏi mỗi lượt</label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[13px] font-medium">Chọn câu hỏi ({chon.length})</legend>
        {cauHoi.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có câu hỏi hoạt động — thêm ở ngân hàng phía trên.</p> : null}
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {cauHoi.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0">
                <input type="checkbox" checked={chon.includes(c.id)} onChange={(e) => setChon(e.target.checked ? [...chon, c.id] : chon.filter((x) => x !== c.id))} />
                <span className="min-w-0 flex-1 truncate">{c.stem}</span>
                <span className="text-xs text-muted-foreground">{NHAN_LOAI[c.type]} · {c.points}đ</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={NUT_CHINH} disabled={dangChay || !title.trim()}>{dangChay ? "Đang lưu…" : "Lưu đề"}</button>
        <button type="button" className={NUT_PHU} onClick={onDong}>Đóng</button>
      </div>
    </form>
  );
}
