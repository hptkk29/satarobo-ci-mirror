"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { GOI_Y_O, NHAN_O, NUT_NHO, O_CHON, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
import { veCauMoRong, type LoaiMoRong } from "@/lib/elearning-online/dang-cau-hoi";
import { kiemCauHoi } from "@/lib/elearning-online/cham-diem";

/** Cấu hình đang soạn của một dạng mở rộng — object phẳng, gửi nguyên cho server (server kiểm lại, đây chỉ là nhập liệu + xem trước). */
export type CauHinh = Record<string, unknown>;

export const NHAN_LOAI_MO_RONG: Record<LoaiMoRong, string> = {
  FILL_BLANK: "Điền vào chỗ trống",
  MATCHING: "Ghép cặp",
  ORDERING: "Sắp xếp thứ tự",
  CLASSIFY: "Phân loại",
  IMAGE_HOTSPOT: "Chọn trên hình",
  NUMERIC: "Nhập số",
  PRODUCT: "Nộp sản phẩm",
  BLOCK_SEQUENCE: "Sắp khối lệnh",
};

export const MO_TA_LOAI_MO_RONG: Record<LoaiMoRong, string> = {
  FILL_BLANK: "Kéo từ vào ô trống hoặc gõ. Chấm từng ô.",
  MATCHING: "Nối mỗi mục bên trái với một mục bên phải. Chấm từng cặp.",
  ORDERING: "Xếp các bước đúng trình tự. Chấm theo số bước đúng vị trí.",
  CLASSIFY: "Kéo từng thẻ vào đúng nhóm. Chấm từng thẻ.",
  IMAGE_HOTSPOT: "Chạm vào đúng vị trí trên ảnh. Có sai số cho phép.",
  NUMERIC: "Gõ một số; chấp nhận dấu phẩy và dấu chấm thập phân.",
  PRODUCT: "Học viên nộp video/ảnh/PDF. Người chấm chấm tay theo khung chấm.",
  BLOCK_SEQUENCE: "Ghép khối lệnh để xe tới đích. Máy chấm bằng cách chạy mô phỏng, không chạy mã.",
};

export const SA_BAN_MAC_DINH: CauHinh = { cols: 5, rows: 4, start: { c: 0, r: 0, dir: "E" }, goal: { c: 4, r: 0 }, walls: [], blocks: ["fwd", "right", "left", "repeat"], maxBlocks: 8 };

export function cauHinhMacDinh(loai: LoaiMoRong): CauHinh {
  switch (loai) {
    case "FILL_BLANK": return { distractors: [], allowTyping: false };
    case "MATCHING": return { pairs: [{ left: "", right: "" }, { left: "", right: "" }], distractors: [] };
    case "ORDERING": return { items: ["", ""] };
    case "CLASSIFY": return { groups: [{ name: "", cards: [""] }, { name: "", cards: [""] }] };
    case "IMAGE_HOTSPOT": return { image: { imageUrl: "", width: 800, height: 600 }, regions: [{ shape: "rect", x: 0, y: 0, w: 50, h: 50 }], tolerance: 0 };
    case "NUMERIC": return { answer: 0, tolerance: 0 };
    case "PRODUCT": return { accept: ["VIDEO"], maxMb: 100 };
    case "BLOCK_SEQUENCE": return SA_BAN_MAC_DINH;
  }
}

type Props = { loai: LoaiMoRong; stem: string; setStem: (s: string) => void; ch: CauHinh; setCh: (c: CauHinh) => void };

const Hang = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;
const so = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
const cap = <T,>(ds: T[], i: number, v: T) => ds.map((x, k) => (k === i ? v : x));

/** Phần "Đáp án và cách chấm" của từng dạng + xem trước theo ĐÚNG những gì học viên nhận (không đáp án). */
export function SoanDangMoRong(p: Props) {
  const { loai, ch, setCh } = p;
  const dat = (patch: CauHinh) => setCh({ ...ch, ...patch });
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <p className="text-[13px] text-muted-foreground">{MO_TA_LOAI_MO_RONG[loai]}</p>
      {loai === "FILL_BLANK" ? <SoanDienKhuyet {...p} dat={dat} /> : null}
      {loai === "MATCHING" ? <SoanGhepCap {...p} dat={dat} /> : null}
      {loai === "ORDERING" ? <SoanSapXep {...p} dat={dat} /> : null}
      {loai === "CLASSIFY" ? <SoanPhanLoai {...p} dat={dat} /> : null}
      {loai === "IMAGE_HOTSPOT" ? <SoanHinh {...p} dat={dat} /> : null}
      {loai === "NUMERIC" ? <SoanSo {...p} dat={dat} /> : null}
      {loai === "PRODUCT" ? <SoanSanPham {...p} dat={dat} /> : null}
      {loai === "BLOCK_SEQUENCE" ? <SoanKhoiLenh {...p} dat={dat} /> : null}
      <XemTruoc loai={loai} stem={p.stem} ch={ch} />
    </div>
  );
}

type Con = Props & { dat: (p: CauHinh) => void };

function SoanDienKhuyet({ ch, dat }: Con) {
  return (
    <>
      <p className={GOI_Y_O}>Đặt đáp án trong <code className="font-mono">[[ ]]</code> ở ô “Nội dung câu hỏi”; nhiều cách viết đúng: <code className="font-mono">[[3|ba]]</code>.</p>
      <div>
        <label htmlFor="dk-nhieu" className={NHAN_O}>Thẻ chữ gây nhiễu (mỗi dòng một từ)</label>
        <textarea id="dk-nhieu" className={O_NHAP_VAN_BAN} rows={2} value={((ch.distractors as string[]) ?? []).join("\n")} onChange={(e) => dat({ distractors: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ch.allowTyping === true} onChange={(e) => dat({ allowTyping: e.target.checked })} />Cho gõ thay vì kéo thẻ</label>
    </>
  );
}

function SoanGhepCap({ ch, dat }: Con) {
  const cap2 = (ch.pairs as { left: string; right: string }[]) ?? [];
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Các cặp đúng (bên trái ↔ bên phải)</legend>
        {cap2.map((c, i) => (
          <Hang key={i}>
            <input aria-label={`Bên trái, cặp ${i + 1}`} className={`${O_NHAP} min-w-[160px] flex-1`} value={c.left} onChange={(e) => dat({ pairs: cap(cap2, i, { ...c, left: e.target.value }) })} maxLength={1000} />
            <span aria-hidden className="text-muted-foreground">↔</span>
            <input aria-label={`Bên phải, cặp ${i + 1}`} className={`${O_NHAP} min-w-[160px] flex-1`} value={c.right} onChange={(e) => dat({ pairs: cap(cap2, i, { ...c, right: e.target.value }) })} maxLength={1000} />
            {cap2.length > 2 ? <button type="button" className={NUT_NHO} aria-label={`Xoá cặp ${i + 1}`} onClick={() => dat({ pairs: cap2.filter((_, k) => k !== i) })}><X className="h-4 w-4" aria-hidden /></button> : null}
          </Hang>
        ))}
        {cap2.length < 10 ? <div><button type="button" className={NUT_NHO} onClick={() => dat({ pairs: [...cap2, { left: "", right: "" }] })}><Plus className="h-4 w-4" aria-hidden />Thêm cặp</button></div> : null}
      </fieldset>
      <div>
        <label htmlFor="gc-nhieu" className={NHAN_O}>Mục nhiễu bên phải (mỗi dòng một mục)</label>
        <textarea id="gc-nhieu" className={O_NHAP_VAN_BAN} rows={2} value={((ch.distractors as string[]) ?? []).join("\n")} onChange={(e) => dat({ distractors: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
      </div>
    </>
  );
}

function SoanSapXep({ ch, dat }: Con) {
  const ds = (ch.items as string[]) ?? [];
  const doi = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ds.length) return;
    const a = [...ds];
    [a[i], a[j]] = [a[j]!, a[i]!];
    dat({ items: a });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">Xếp ĐÚNG thứ tự ở đây — máy sẽ trộn khi hiện cho học viên</legend>
      {ds.map((t, i) => (
        <Hang key={i}>
          <span className="w-6 text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
          <input aria-label={`Bước ${i + 1}`} className={`${O_NHAP} min-w-[200px] flex-1`} value={t} onChange={(e) => dat({ items: cap(ds, i, e.target.value) })} maxLength={1000} />
          <button type="button" className={NUT_NHO} aria-label={`Đưa bước ${i + 1} lên`} disabled={i === 0} onClick={() => doi(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></button>
          <button type="button" className={NUT_NHO} aria-label={`Đưa bước ${i + 1} xuống`} disabled={i === ds.length - 1} onClick={() => doi(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></button>
          {ds.length > 2 ? <button type="button" className={NUT_NHO} aria-label={`Xoá bước ${i + 1}`} onClick={() => dat({ items: ds.filter((_, k) => k !== i) })}><X className="h-4 w-4" aria-hidden /></button> : null}
        </Hang>
      ))}
      {ds.length < 12 ? <div><button type="button" className={NUT_NHO} onClick={() => dat({ items: [...ds, ""] })}><Plus className="h-4 w-4" aria-hidden />Thêm bước</button></div> : null}
    </fieldset>
  );
}

function SoanPhanLoai({ ch, dat }: Con) {
  const nhom = (ch.groups as { name: string; cards: string[] }[]) ?? [];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[13px] font-medium">Các nhóm và thẻ thuộc nhóm đó</legend>
      {nhom.map((g, i) => (
        <div key={i} className="grid gap-2 rounded-[10px] border border-border bg-card p-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`pl-n-${i}`} className={NHAN_O}>Tên nhóm {i + 1}</label>
            <input id={`pl-n-${i}`} className={O_NHAP} value={g.name} onChange={(e) => dat({ groups: cap(nhom, i, { ...g, name: e.target.value }) })} maxLength={100} />
            {nhom.length > 2 ? <button type="button" className={`${NUT_NHO} mt-2`} onClick={() => dat({ groups: nhom.filter((_, k) => k !== i) })}>Xoá nhóm</button> : null}
          </div>
          <div>
            <label htmlFor={`pl-t-${i}`} className={NHAN_O}>Thẻ của nhóm {i + 1} (mỗi dòng một thẻ)</label>
            <textarea id={`pl-t-${i}`} className={O_NHAP_VAN_BAN} rows={3} value={g.cards.join("\n")} onChange={(e) => dat({ groups: cap(nhom, i, { ...g, cards: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) }) })} />
          </div>
        </div>
      ))}
      {nhom.length < 6 ? <div><button type="button" className={NUT_NHO} onClick={() => dat({ groups: [...nhom, { name: "", cards: [""] }] })}><Plus className="h-4 w-4" aria-hidden />Thêm nhóm</button></div> : null}
    </fieldset>
  );
}

type Vung = { shape: "rect"; x: number; y: number; w: number; h: number } | { shape: "circle"; cx: number; cy: number; r: number };
function SoanHinh({ ch, dat }: Con) {
  const anh = (ch.image as { imageUrl: string; width: number; height: number }) ?? { imageUrl: "", width: 800, height: 600 };
  const vung = (ch.regions as Vung[]) ?? [];
  const suaAnh = (patch: Partial<typeof anh>) => dat({ image: { ...anh, ...patch } });
  const sua = (i: number, v: Vung) => dat({ regions: cap(vung, i, v) });
  const num = (id: string, nhan: string, v: number, onChange: (n: number) => void) => (
    <div className="w-24">
      <label htmlFor={id} className={NHAN_O}>{nhan}</label>
      <input id={id} inputMode="decimal" className={O_NHAP} value={Number.isFinite(v) ? String(v) : ""} onChange={(e) => onChange(so(e.target.value))} />
    </div>
  );
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <label htmlFor="ih-url" className={NHAN_O}>Địa chỉ ảnh (https)</label>
          <input id="ih-url" className={O_NHAP} value={anh.imageUrl} onChange={(e) => suaAnh({ imageUrl: e.target.value })} placeholder="https://…" />
        </div>
        {num("ih-w", "Rộng (px)", anh.width, (n) => suaAnh({ width: n }))}
        {num("ih-h", "Cao (px)", anh.height, (n) => suaAnh({ height: n }))}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Vùng đúng (toạ độ theo điểm ảnh của ảnh gốc)</legend>
        {vung.map((v, i) => (
          <Hang key={i}>
            <select aria-label={`Hình dạng vùng ${i + 1}`} className={`${O_CHON} w-36`} value={v.shape} onChange={(e) => sua(i, e.target.value === "rect" ? { shape: "rect", x: 0, y: 0, w: 50, h: 50 } : { shape: "circle", cx: 50, cy: 50, r: 25 })}>
              <option value="rect">Chữ nhật</option>
              <option value="circle">Tròn</option>
            </select>
            {v.shape === "rect" ? (
              <>
                {num(`ih-x-${i}`, "x", v.x, (n) => sua(i, { ...v, x: n }))}
                {num(`ih-y-${i}`, "y", v.y, (n) => sua(i, { ...v, y: n }))}
                {num(`ih-ww-${i}`, "rộng", v.w, (n) => sua(i, { ...v, w: n }))}
                {num(`ih-hh-${i}`, "cao", v.h, (n) => sua(i, { ...v, h: n }))}
              </>
            ) : (
              <>
                {num(`ih-cx-${i}`, "tâm x", v.cx, (n) => sua(i, { ...v, cx: n }))}
                {num(`ih-cy-${i}`, "tâm y", v.cy, (n) => sua(i, { ...v, cy: n }))}
                {num(`ih-r-${i}`, "bán kính", v.r, (n) => sua(i, { ...v, r: n }))}
              </>
            )}
            {vung.length > 1 ? <button type="button" className={`${NUT_NHO} self-end`} aria-label={`Xoá vùng ${i + 1}`} onClick={() => dat({ regions: vung.filter((_, k) => k !== i) })}><X className="h-4 w-4" aria-hidden /></button> : null}
          </Hang>
        ))}
        {vung.length < 10 ? <div><button type="button" className={NUT_NHO} onClick={() => dat({ regions: [...vung, { shape: "rect", x: 0, y: 0, w: 50, h: 50 }] })}><Plus className="h-4 w-4" aria-hidden />Thêm vùng</button></div> : null}
      </fieldset>
      <div className="w-40">
        <label htmlFor="ih-sai" className={NHAN_O}>Sai số cho phép (px)</label>
        <input id="ih-sai" inputMode="decimal" className={O_NHAP} value={String(ch.tolerance ?? 0)} onChange={(e) => dat({ tolerance: so(e.target.value) })} />
      </div>
    </>
  );
}

function SoanSo({ ch, dat }: Con) {
  const f = (id: string, nhan: string, v: unknown, onChange: (s: string) => void, rong = "w-40", goiY?: string) => (
    <div className={rong}>
      <label htmlFor={id} className={NHAN_O}>{nhan}</label>
      <input id={id} className={O_NHAP} value={v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v)} onChange={(e) => onChange(e.target.value)} />
      {goiY ? <p className={GOI_Y_O}>{goiY}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {f("so-dapan", "Đáp án", ch.answer, (s) => dat({ answer: so(s) }))}
      {f("so-donvi", "Đơn vị", ch.unit, (s) => dat({ unit: s }), "w-28")}
      {f("so-sai", "Sai số ±", ch.tolerance, (s) => dat({ tolerance: so(s) }), "w-28")}
      {f("so-goiy", "Gợi ý khi sai", ch.hint, (s) => dat({ hint: s }), "min-w-[220px] flex-1")}
    </div>
  );
}

function SoanSanPham({ ch, dat }: Con) {
  const cho = (ch.accept as string[]) ?? [];
  const bat = (k: string, on: boolean) => dat({ accept: on ? [...new Set([...cho, k])] : cho.filter((x) => x !== k) });
  return (
    <>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-[13px] font-medium">Cho nộp</legend>
        {[["VIDEO", "Video"], ["IMAGE", "Ảnh"], ["PDF", "Tệp PDF"]].map(([k, n]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cho.includes(k!)} onChange={(e) => bat(k!, e.target.checked)} />{n}</label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <div className="w-44">
          <label htmlFor="sp-mb" className={NHAN_O}>Dung lượng tối đa (MB)</label>
          <input id="sp-mb" inputMode="numeric" className={O_NHAP} value={String(ch.maxMb ?? "")} onChange={(e) => dat({ maxMb: so(e.target.value) })} />
        </div>
        {cho.includes("VIDEO") ? (
          <div className="w-44">
            <label htmlFor="sp-giay" className={NHAN_O}>Thời lượng video tối đa (giây)</label>
            <input id="sp-giay" inputMode="numeric" className={O_NHAP} value={ch.maxVideoSec === undefined ? "" : String(ch.maxVideoSec)} onChange={(e) => dat({ maxVideoSec: e.target.value.trim() ? so(e.target.value) : undefined })} />
          </div>
        ) : null}
      </div>
      <p className={GOI_Y_O}>Bài nộp lưu riêng tư; chỉ người chấm được phân công và phụ huynh của học viên xem được. Chấm tay theo khung chấm của khoá.</p>
    </>
  );
}

const KHOI: [string, string][] = [["fwd", "Đi thẳng 1 ô"], ["right", "Rẽ phải"], ["left", "Rẽ trái"], ["repeat", "Lặp n lần"], ["ifwall", "Nếu gặp tường"], ["stop", "Dừng"]];
function SoanKhoiLenh({ ch, dat }: Con) {
  const cols = Number(ch.cols) || 5, rows = Number(ch.rows) || 4;
  const start = ch.start as { c: number; r: number; dir: string };
  const goal = ch.goal as { c: number; r: number };
  const tuong = (ch.walls as { c: number; r: number }[]) ?? [];
  const khoi = (ch.blocks as string[]) ?? [];
  const la = (c: number, r: number, o: { c: number; r: number }) => o.c === c && o.r === r;
  const datO = (c: number, r: number, dung: "xe" | "dich" | "tuong") => {
    if (dung === "xe") return dat({ start: { ...start, c, r }, walls: tuong.filter((w) => !la(c, r, w)) });
    if (dung === "dich") return dat({ goal: { c, r }, walls: tuong.filter((w) => !la(c, r, w)) });
    if (la(c, r, start) || la(c, r, goal)) return;
    dat({ walls: tuong.some((w) => la(c, r, w)) ? tuong.filter((w) => !la(c, r, w)) : [...tuong, { c, r }] });
  };
  const resize = (k: "cols" | "rows", v: number) => {
    const n = Math.min(12, Math.max(2, Math.round(v) || 2));
    const nc = k === "cols" ? n : cols, nr = k === "rows" ? n : rows;
    dat({ [k]: n, walls: tuong.filter((w) => w.c < nc && w.r < nr), start: { ...start, c: Math.min(start.c, nc - 1), r: Math.min(start.r, nr - 1) }, goal: { c: Math.min(goal.c, nc - 1), r: Math.min(goal.r, nr - 1) } });
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-24"><label htmlFor="kl-cot" className={NHAN_O}>Cột</label><input id="kl-cot" inputMode="numeric" className={O_NHAP} value={cols} onChange={(e) => resize("cols", so(e.target.value))} /></div>
        <div className="w-24"><label htmlFor="kl-hang" className={NHAN_O}>Hàng</label><input id="kl-hang" inputMode="numeric" className={O_NHAP} value={rows} onChange={(e) => resize("rows", so(e.target.value))} /></div>
        <div className="w-32">
          <label htmlFor="kl-huong" className={NHAN_O}>Xe quay về</label>
          <select id="kl-huong" className={O_CHON} value={start.dir} onChange={(e) => dat({ start: { ...start, dir: e.target.value } })}>
            <option value="N">Bắc (lên)</option><option value="E">Đông (phải)</option><option value="S">Nam (xuống)</option><option value="W">Tây (trái)</option>
          </select>
        </div>
        <div className="w-32"><label htmlFor="kl-max" className={NHAN_O}>Số khối tối đa</label><input id="kl-max" inputMode="numeric" className={O_NHAP} value={String(ch.maxBlocks ?? "")} onChange={(e) => dat({ maxBlocks: so(e.target.value) })} /></div>
      </div>
      <LuoiTuongTac cols={cols} rows={rows} start={start} goal={goal} walls={tuong} onO={datO} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-[13px] font-medium">Khối cho phép</legend>
        {KHOI.map(([k, n]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={khoi.includes(k)} onChange={(e) => dat({ blocks: e.target.checked ? [...new Set([...khoi, k])] : khoi.filter((x) => x !== k) })} />{n}</label>
        ))}
      </fieldset>
      <p className={GOI_Y_O}>Chấm bằng cách chạy chương trình của học viên trên sa bàn: tới đích là đúng (tối đa 500 bước; đụng tường thì đứng yên).</p>
    </>
  );
}

const MUI: Record<string, string> = { N: "▲", E: "▶", S: "▼", W: "◀" };
function LuoiTuongTac({ cols, rows, start, goal, walls, onO }: { cols: number; rows: number; start: { c: number; r: number; dir: string }; goal: { c: number; r: number }; walls: { c: number; r: number }[]; onO?: (c: number, r: number, dung: "xe" | "dich" | "tuong") => void }) {
  const [dung, setDung] = useState<"xe" | "dich" | "tuong">("tuong");
  return (
    <div className="flex flex-col gap-2">
      {onO ? (
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Bấm ô để đặt</legend>
          <span className="text-[13px] text-muted-foreground">Bấm ô để đặt:</span>
          {([["xe", "Xe"], ["dich", "Đích"], ["tuong", "Tường"]] as const).map(([k, n]) => (
            <label key={k} className="flex items-center gap-1.5 text-sm"><input type="radio" name="kl-dung" checked={dung === k} onChange={() => setDung(k)} />{n}</label>
          ))}
        </fieldset>
      ) : null}
      <div role="grid" aria-label="Sa bàn" className="inline-grid w-fit gap-1 rounded-[10px] bg-muted p-2" style={{ gridTemplateColumns: `repeat(${cols}, 2.5rem)` }}>
        {Array.from({ length: rows * cols }, (_, n) => {
          const c = n % cols, r = Math.floor(n / cols);
          const xe = start.c === c && start.r === r, dich = goal.c === c && goal.r === r, tuong = walls.some((w) => w.c === c && w.r === r);
          return (
            <button
              key={n}
              type="button"
              disabled={!onO}
              aria-label={`Ô cột ${c + 1} hàng ${r + 1}${xe ? ", xe" : dich ? ", đích" : tuong ? ", tường" : ""}`}
              onClick={() => onO?.(c, r, dung)}
              className={`flex h-10 w-10 items-center justify-center rounded-md border text-base outline-none focus-visible:ring-2 focus-visible:ring-ring ${tuong ? "border-foreground/30 bg-foreground/80" : "border-border bg-card"} ${dich ? "text-state-warning-ink" : "text-primary-ink"}`}
            >
              {xe ? MUI[start.dir] : dich ? "★" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Xem trước — dựng từ ĐÚNG phần `veCauMoRong` gửi học viên (nếu cấu hình chưa hợp lệ thì nói rõ vì sao, không vẽ gì sai). */
function XemTruoc({ loai, stem, ch }: { loai: LoaiMoRong; stem: string; ch: CauHinh }) {
  const k = kiemCauHoi({ type: loai, stem, cauHinh: ch });
  return (
    <section aria-label="Xem trước cho học viên" className="rounded-xl border border-border bg-card p-4">
      <h4 className="mb-2 text-[13px] font-medium text-muted-foreground">Xem trước · Học viên</h4>
      {!k.ok ? <p className="text-[13px] text-state-warning-ink">{k.thongBao}</p> : <KhungXemTruoc loai={loai} stem={stem} options={k.optionsJson} key_={k.answerKeyJson} />}
    </section>
  );
}

function KhungXemTruoc({ loai, stem, options, key_ }: { loai: LoaiMoRong; stem: string; options: unknown; key_: unknown }) {
  const v = veCauMoRong({ id: "xem-truoc", type: loai, stem, options, key: key_, points: 1 });
  const c = v.cauHinh as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- cấu hình xem trước đã qua server-shape, chỉ để vẽ
  const the = "rounded-lg border border-border bg-muted px-3 py-1.5 text-sm";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-medium">{v.stem}</p>
      {loai === "FILL_BLANK" ? <div className="flex flex-wrap gap-2">{(c.the as string[]).map((t) => <span key={t} className={the}>{t}</span>)}<span className="text-xs text-muted-foreground">{c.soO} ô trống{c.choGo ? " · cho gõ" : ""}</span></div> : null}
      {loai === "MATCHING" ? (
        <div className="grid grid-cols-2 gap-3">
          <ul className="flex flex-col gap-2">{(c.trai as { id: string; text: string }[]).map((x) => <li key={x.id} className={the}>{x.text}</li>)}</ul>
          <ul className="flex flex-col gap-2">{(c.phai as { id: string; text: string }[]).map((x) => <li key={x.id} className={the}>{x.text}</li>)}</ul>
        </div>
      ) : null}
      {loai === "ORDERING" ? <ul className="flex flex-col gap-2">{(c.muc as { id: string; text: string }[]).map((x) => <li key={x.id} className={the}>{x.text}</li>)}</ul> : null}
      {loai === "CLASSIFY" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">{(c.the as { id: string; text: string }[]).map((x) => <span key={x.id} className={the}>{x.text}</span>)}</div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">Nhóm: {(c.nhom as { id: string; text: string }[]).map((x) => <span key={x.id} className="rounded-md border border-dashed border-border px-2 py-1">{x.text}</span>)}</div>
        </div>
      ) : null}
      {loai === "IMAGE_HOTSPOT" ? (
        <img src={String(c.anh)} width={Math.min(480, Number(c.rong))} alt="Ảnh của câu hỏi (xem trước)" className="rounded-lg border border-border" />
      ) : null}
      {loai === "NUMERIC" ? <div className="flex items-center gap-2"><span className="inline-flex h-10 w-32 items-center rounded-lg border border-input bg-card px-3 text-muted-foreground">Nhập số</span>{c.donVi ? <span>{String(c.donVi)}</span> : null}</div> : null}
      {loai === "PRODUCT" ? <p className="text-muted-foreground">Cho nộp: {(c.cho as string[]).join(", ")} · tối đa {String(c.toiDaMb)} MB{c.toiDaGiay ? ` · video ≤ ${String(c.toiDaGiay)} giây` : ""}</p> : null}
      {loai === "BLOCK_SEQUENCE" ? (
        <div className="flex flex-col gap-2">
          <LuoiTuongTac cols={Number(c.cols)} rows={Number(c.rows)} start={c.start} goal={c.goal} walls={c.walls} />
          <div className="flex flex-wrap gap-2">{(c.blocks as string[]).map((b) => <span key={b} className={the}>{KHOI.find((x) => x[0] === b)?.[1] ?? b}</span>)}<span className="text-xs text-muted-foreground">tối đa {String(c.maxBlocks)} khối</span></div>
        </div>
      ) : null}
    </div>
  );
}
