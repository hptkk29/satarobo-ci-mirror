"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { soanLoTrinhAction } from "../../_actions";

/**
 * EL-18 — SOẠN một lộ trình (danh sách khoá THEO THỨ TỰ).
 *
 * ⚠️ Cửa này tồn tại vì `soanLoTrinhAction` từng là action MỒ CÔI (0 màn nào gọi). Thứ tự các khoá chính
 * là nội dung của lộ trình, nên form cho đổi thứ tự bằng hai nút lên/xuống thay vì chỉ "thêm vào cuối".
 * Một khoá chỉ xuất hiện MỘT lần (server cũng bác) — khoá đã chọn bị bỏ khỏi ô chọn.
 */

type Khoa = { id: string; title: string };

const O = "w-full rounded-md border px-2 py-1 text-sm";

export function PathForm(props: { khoa: Khoa[] }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);

  const [ma, setMa] = useState("");
  const [tieuDe, setTieuDe] = useState("");
  const [moTa, setMoTa] = useState("");
  const [tuanTu, setTuanTu] = useState(true);
  const [chon, setChon] = useState("");
  const [ds, setDs] = useState<string[]>([]);
  const [lyDo, setLyDo] = useState("");

  const ten = (id: string) => props.khoa.find((k) => k.id === id)?.title ?? id;
  const conLai = props.khoa.filter((k) => !ds.includes(k.id));

  const doiCho = (i: number, j: number) =>
    setDs((cu) => {
      if (j < 0 || j >= cu.length) return cu;
      const moi = [...cu];
      [moi[i], moi[j]] = [moi[j]!, moi[i]!];
      return moi;
    });

  const thieu: string[] = [];
  if (ma.trim().length < 3) thieu.push("mã lộ trình (≥ 3 ký tự)");
  if (tieuDe.trim().length < 3) thieu.push("tên lộ trình (≥ 3 ký tự)");
  if (ds.length === 0) thieu.push("ít nhất một khoá");
  if (lyDo.trim().length < 10) thieu.push("lý do (≥ 10 ký tự)");

  const luu = () =>
    batDau(async () => {
      const r = await soanLoTrinhAction(
        {
          code: ma.trim(),
          title: tieuDe.trim(),
          description: moTa.trim() || null,
          sequential: tuanTu,
          courseIds: ds,
        },
        // `reason` ở tham số THỨ HAI — schema `.strict()`.
        { reason: lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(`Đã soạn lộ trình (${r.data.soBuoc} bước)`);
      setMo(false);
      setMa("");
      setTieuDe("");
      setMoTa("");
      setDs([]);
      setLyDo("");
      router.refresh();
    });

  if (!mo) {
    return (
      <button type="button" onClick={() => setMo(true)} className="rounded-md border px-3 py-1.5 text-sm">
        + Soạn lộ trình mới
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (thieu.length === 0) luu();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Mã lộ trình</span>
          <input className={O} value={ma} onChange={(e) => setMa(e.target.value)} maxLength={60} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Tên lộ trình</span>
          <input className={O} value={tieuDe} onChange={(e) => setTieuDe(e.target.value)} maxLength={200} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Mô tả (không bắt buộc)</span>
        <textarea className={O} rows={2} value={moTa} onChange={(e) => setMoTa(e.target.value)} maxLength={2000} />
      </label>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={tuanTu} onChange={(e) => setTuanTu(e.target.checked)} />
        <span>Học tuần tự (xong khoá trước mới mở khoá sau)</span>
      </label>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">Các khoá, theo thứ tự ({ds.length})</span>
        {ds.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs">Chưa chọn khoá nào.</p>
        ) : (
          <ol className="space-y-1">
            {ds.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
                <span className="flex-1">{ten(id)}</span>
                <button type="button" aria-label="Lên" disabled={i === 0} onClick={() => doiCho(i, i - 1)} className="rounded border px-1.5 disabled:opacity-30">
                  ↑
                </button>
                <button type="button" aria-label="Xuống" disabled={i === ds.length - 1} onClick={() => doiCho(i, i + 1)} className="rounded border px-1.5 disabled:opacity-30">
                  ↓
                </button>
                <button type="button" aria-label="Bỏ khoá này" onClick={() => setDs((cu) => cu.filter((x) => x !== id))} className="rounded border px-1.5">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex gap-2">
          <select className={O} value={chon} onChange={(e) => setChon(e.target.value)}>
            <option value="">— chọn khoá để thêm —</option>
            {conLai.map((k) => (
              <option key={k.id} value={k.id}>
                {k.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!chon}
            onClick={() => {
              setDs((cu) => [...cu, chon]);
              setChon("");
            }}
            className="shrink-0 rounded-md border px-3 py-1 disabled:opacity-50"
          >
            Thêm
          </button>
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Lý do soạn (bắt buộc, ≥ 10 ký tự — vào nhật ký)</span>
        <textarea className={O} rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
      </label>

      {thieu.length > 0 ? <p className="text-xs text-muted-foreground">Còn thiếu: {thieu.join(" · ")}</p> : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={dangChay || thieu.length > 0}
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang lưu…" : "Lưu lộ trình"}
        </button>
        <button type="button" onClick={() => setMo(false)} className="rounded-md border px-3 py-1.5">
          Thôi
        </button>
      </div>
    </form>
  );
}
