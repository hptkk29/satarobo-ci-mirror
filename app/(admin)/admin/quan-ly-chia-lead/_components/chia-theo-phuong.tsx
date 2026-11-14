"use client";
// Tab «Chia theo phường» của màn «Quản lý chia lead» (05/11/2026).
//
// Lead CHƯA có cơ sở được chia về cơ sở mà quản trị đã đặt cho PHƯỜNG/XÃ của khách. Phường chưa đặt, hoặc khách không khai phường ⇒ chia đều như cũ.
// Quyền gác ở Server Action `luuChiaTheoPhuongAction`, không ở đây. Hai chế độ theo `coSoCuaToi`:
//   · null  — TOÀN HỆ THỐNG (Quản trị / Hội sở): sửa mọi phường + bật/tắt.
//   · mảng — QUẢN LÝ CƠ SỞ: chỉ đặt/bỏ phường cho CƠ SỞ MÌNH; phường của cơ sở khác chỉ XEM; công tắc chỉ XEM.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { luuChiaTheoPhuongAction } from "../_actions-phuong";

type CoSo = { id: string; name: string };

const O_CHON = "rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground";

export function ChiaTheoPhuong({
  thanhPho,
  cacTinh,
  cacPhuong,
  coSo,
  daDat,
  batBanDau,
  coSoMacDinh = "",
  coSoCuaToi = null,
}: {
  thanhPho: string;
  cacTinh: readonly string[];
  cacPhuong: readonly string[];
  coSo: readonly CoSo[];
  /** Tên phường → Center.id đã lưu (hoặc null). */
  daDat: Readonly<Record<string, string | null>>;
  batBanDau: boolean;
  coSoMacDinh?: string;
  /** null = toàn hệ thống; mảng Center.id = chỉ được sửa phần của các cơ sở này (Quản lý cơ sở). */
  coSoCuaToi?: readonly string[] | null;
}) {
  const router = useRouter();
  const [dangLuu, batDauLuu] = useTransition();
  const [bat, setBat] = useState(batBanDau);
  const [giaTri, setGiaTri] = useState<Record<string, string>>(() => Object.fromEntries(cacPhuong.map((p) => [p, daDat[p] ?? ""])));
  const [loc, setLoc] = useState("");
  const [hangLoat, setHangLoat] = useState(coSoMacDinh);

  const heCoSo = coSoCuaToi !== null;
  const cuaToi = useMemo(() => new Set(coSoCuaToi ?? []), [coSoCuaToi]);
  /** Dòng này bấm sửa được không: toàn hệ thống ⇒ luôn; Quản lý cơ sở ⇒ phường đang trống hoặc đang của cơ sở mình (theo giá trị ĐÃ LƯU). */
  const suaDuoc = (p: string) => !heCoSo || !daDat[p] || cuaToi.has(daDat[p]!);
  const coSoChon = useMemo(() => (heCoSo ? coSo.filter((c) => cuaToi.has(c.id)) : coSo), [coSo, heCoSo, cuaToi]);
  const tenCoSo = useMemo(() => new Map(coSo.map((c) => [c.id, c.name])), [coSo]);
  const soDaDat = cacPhuong.filter((p) => giaTri[p]).length;
  const soCuaToi = cacPhuong.filter((p) => giaTri[p] && cuaToi.has(giaTri[p]!)).length;
  const dangHien = useMemo(() => {
    const k = loc.trim().toLowerCase();
    return k ? cacPhuong.filter((p) => p.toLowerCase().includes(k)) : cacPhuong;
  }, [cacPhuong, loc]);
  const daDoi = (!heCoSo && bat !== batBanDau) || cacPhuong.some((p) => (giaTri[p] ?? "") !== (daDat[p] ?? ""));

  function luu() {
    batDauLuu(async () => {
      const r = await luuChiaTheoPhuongAction({
        bat,
        thanhPho,
        // Quản lý cơ sở chỉ gửi phần mình sửa được (phần của cơ sở khác không phải việc của họ; máy chủ cũng tự kiểm lại).
        dong: cacPhuong.filter(suaDuoc).map((p) => ({ phuong: p, coSoId: giaTri[p] ? giaTri[p] : null })),
      });
      if (r.ok) {
        toast.success(`Đã lưu: ${r.soPhuongDaDat} phường/xã đã đặt, chia theo phường đang ${r.bat ? "BẬT" : "TẮT"}.`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <section className="space-y-4" aria-label="Chia lead theo phường/xã">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Lead <strong>chưa có cơ sở</strong> sẽ vào cơ sở bạn đặt cho <strong>phường/xã của khách</strong>. Phường chưa đặt, hoặc khách không khai phường, thì chia
          đều giữa các cơ sở như trước. Lead đã có cơ sở không bị đổi.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={bat}
            onChange={(e) => setBat(e.target.checked)}
            disabled={heCoSo}
            className="size-4"
            aria-label="Bật chia lead theo phường"
          />
          Bật chia lead theo phường/xã
          <span className={bat ? "text-emerald-600" : "text-muted-foreground"}>{bat ? "(đang BẬT)" : "(đang TẮT — chia đều như cũ)"}</span>
        </label>
        {heCoSo && (
          <p data-testid="ghi-chu-co-so" className="mt-2 text-sm text-muted-foreground">
            Bạn đặt được phường/xã cho <strong>cơ sở của mình</strong>
            {coSoChon.length > 0 && <> ({coSoChon.map((c) => c.name).join(", ")})</>}: chọn phường chưa ai nhận, hoặc trả lại phường của cơ sở bạn. Phường đã thuộc cơ sở khác
            và công tắc bật/tắt do Quản trị quyết định.
            {!bat && " Hiện chia theo phường đang TẮT nên các phường bạn đặt sẽ có tác dụng khi Quản trị bật."}
          </p>
        )}
        {bat && soDaDat === 0 && (
          <p role="status" className="mt-2 text-sm text-amber-600">
            Chưa đặt phường nào nên bật cũng chưa có tác dụng — lead vẫn chia đều. Hãy đặt cơ sở cho các phường bên dưới.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Thành phố / tỉnh</span>
          <select
            className={O_CHON}
            value={thanhPho}
            aria-label="Thành phố"
            onChange={(e) => router.push(`/quan-ly-chia-lead?tab=phuong&tp=${encodeURIComponent(e.target.value)}`)}
          >
            {cacTinh.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Tìm phường/xã</span>
          <input className={O_CHON} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Gõ tên phường…" aria-label="Tìm phường hoặc xã" />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Đặt nhanh các phường chưa đặt cho</span>
            <select className={O_CHON} value={hangLoat} onChange={(e) => setHangLoat(e.target.value)} aria-label="Cơ sở đặt nhanh">
              <option value="">— chọn cơ sở —</option>
              {coSoChon.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!hangLoat}
            onClick={() => setGiaTri((cu) => Object.fromEntries(cacPhuong.map((p) => [p, cu[p] ? cu[p]! : suaDuoc(p) ? hangLoat : ""])))}
            className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Áp dụng
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Đã đặt <strong data-testid="so-da-dat">{soDaDat}</strong>/{cacPhuong.length} phường/xã của {thanhPho}.
        {heCoSo && (
          <>
            {" "}
            Của cơ sở bạn: <strong data-testid="so-cua-toi">{soCuaToi}</strong>.
          </>
        )}
      </p>

      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Danh sách phường/xã">
        {dangHien.map((p) => (
          <li key={p} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
            <span className="text-sm">{p}</span>
            {suaDuoc(p) ? (
              <select
                className={O_CHON}
                aria-label={`Cơ sở của ${p}`}
                value={giaTri[p] ?? ""}
                onChange={(e) => setGiaTri((cu) => ({ ...cu, [p]: e.target.value }))}
              >
                <option value="">— chưa đặt (chia đều) —</option>
                {coSoChon.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {giaTri[p] && !tenCoSo.has(giaTri[p]!) && <option value={giaTri[p]}>(cơ sở không còn nhận lead)</option>}
              </select>
            ) : (
              <span data-testid={`khoa-${p}`} className="text-sm text-muted-foreground" title="Phường này đã thuộc cơ sở khác — chỉ Quản trị đổi được">
                {tenCoSo.get(daDat[p]!) ?? "Cơ sở khác"} (chỉ Quản trị đổi)
              </span>
            )}
          </li>
        ))}
        {dangHien.length === 0 && <li className="py-2 text-sm text-muted-foreground">Không có phường/xã nào khớp.</li>}
      </ul>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-background py-3">
        {daDoi && <span className="text-sm text-amber-600">Có thay đổi chưa lưu</span>}
        <button
          type="button"
          onClick={luu}
          disabled={dangLuu || !daDoi}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {dangLuu ? "Đang lưu…" : "Lưu"}
        </button>
      </div>
    </section>
  );
}
