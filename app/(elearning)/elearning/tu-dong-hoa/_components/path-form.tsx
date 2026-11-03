"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { soanLoTrinhAction } from "../../_actions";
import { NHAN_O, NUT_CHINH, NUT_NHO, NUT_PHU, O_NHAP, O_CHON, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

/**
 * EL-18 — SOẠN một lộ trình (danh sách khoá THEO THỨ TỰ).
 *
 * ⚠️ Cửa này tồn tại vì `soanLoTrinhAction` từng là action MỒ CÔI (0 màn nào gọi). Thứ tự các khoá chính
 * là nội dung của lộ trình, nên form cho đổi thứ tự bằng hai nút lên/xuống thay vì chỉ "thêm vào cuối".
 * Một khoá chỉ xuất hiện MỘT lần (server cũng bác) — khoá đã chọn bị bỏ khỏi ô chọn.
 */

type Khoa = { id: string; title: string };

const O = O_NHAP;

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
      <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_PHU}>
        + Soạn lộ trình mới
      </button>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-background p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (thieu.length === 0) luu();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className={NHAN_O}>Mã lộ trình</span>
          <input className={O} value={ma} onChange={(e) => setMa(e.target.value)} maxLength={60} />
        </label>
        <label className="block space-y-1">
          <span className={NHAN_O}>Tên lộ trình</span>
          <input className={O} value={tieuDe} onChange={(e) => setTieuDe(e.target.value)} maxLength={200} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className={NHAN_O}>Mô tả (không bắt buộc)</span>
        <textarea className={O_NHAP_VAN_BAN} rows={2} value={moTa} onChange={(e) => setMoTa(e.target.value)} maxLength={2000} />
      </label>

      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={tuanTu} onChange={(e) => setTuanTu(e.target.checked)} />
        <span>Học tuần tự (xong khoá trước mới mở khoá sau)</span>
      </label>

      <div className="space-y-2">
        <span className={NHAN_O}>Các khoá, theo thứ tự ({ds.length})</span>
        {ds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">Chưa chọn khoá nào.</p>
        ) : (
          <ol className="space-y-1">
            {ds.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
                <span className="w-6 text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1">{ten(id)}</span>
                <button type="button" aria-label="Lên" disabled={i === 0} onClick={() => doiCho(i, i - 1)} className={`${NUT_NHO} w-8 px-0`}>
                  ↑
                </button>
                <button type="button" aria-label="Xuống" disabled={i === ds.length - 1} onClick={() => doiCho(i, i + 1)} className={`${NUT_NHO} w-8 px-0`}>
                  ↓
                </button>
                <button type="button" aria-label="Bỏ khoá này" onClick={() => setDs((cu) => cu.filter((x) => x !== id))} className={`${NUT_NHO} w-8 px-0`}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <select className={`${O_CHON} flex-1 basis-56`} aria-label="Chọn khoá để thêm vào lộ trình" value={chon} onChange={(e) => setChon(e.target.value)}>
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
            className={`${NUT_PHU} shrink-0`}
          >
            Thêm
          </button>
        </div>
      </div>

      <label className="block space-y-1">
        <span className={NHAN_O}>Lý do soạn (bắt buộc, ≥ 10 ký tự — vào nhật ký)</span>
        <textarea className={O_NHAP_VAN_BAN} rows={2} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
      </label>

      {thieu.length > 0 ? <p className="text-sm font-medium text-state-warning-ink">Còn thiếu: {thieu.join(" · ")}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={dangChay || thieu.length > 0} className={NUT_CHINH}>
          {dangChay ? "Đang lưu…" : "Lưu lộ trình"}
        </button>
        <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
          Thôi
        </button>
      </div>
    </form>
  );
}
