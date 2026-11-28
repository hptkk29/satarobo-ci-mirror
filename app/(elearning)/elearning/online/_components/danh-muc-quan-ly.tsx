"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { luuDanhMucAction, xoaDanhMucAction } from "../_actions";
import { NUT_CHINH, NUT_NGUY, NUT_NHO, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";

type Dong = { id: string; name: string; parentId: string | null; soKhoa: number };

/** QoDanhMuc — danh mục khoá 2 cấp (cha → con). Xoá chỉ khi không còn danh mục con/khoá; xoá bắt buộc lý do (vào nhật ký). */
export function DanhMucQuanLy({ dong, coQuyen }: { dong: Dong[]; coQuyen: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [ten, setTen] = useState("");
  const [cha, setCha] = useState("");
  const [dangSua, setDangSua] = useState<{ id: string; name: string } | null>(null);
  const [xoa, setXoa] = useState<{ id: string; name: string; lyDo: string } | null>(null);
  const chaDs = dong.filter((d) => !d.parentId);

  const luu = (input: { id?: string; name: string; parentId?: string | null }, xong?: () => void) =>
    chuyen(async () => {
      const r = await luuDanhMucAction(input);
      if (!r.ok) return void toast.error(r.error.message);
      toast.success(input.id ? "Đã đổi tên" : "Đã thêm danh mục");
      xong?.();
      router.refresh();
    });

  const xoaThat = () =>
    xoa &&
    chuyen(async () => {
      const r = await xoaDanhMucAction({ id: xoa.id }, { reason: xoa.lyDo.trim() });
      if (!r.ok) return void toast.error(r.error.message);
      toast.success("Đã xoá danh mục");
      setXoa(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {coQuyen ? (
        <form
          className="flex flex-wrap items-end gap-2 px-4 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ten.trim().length < 2) return void toast.error("Tên danh mục tối thiểu 2 ký tự");
            luu({ name: ten.trim(), parentId: cha || null }, () => setTen(""));
          }}
        >
          <div className="min-w-[200px] flex-1">
            <label htmlFor="dm-ten" className="mb-1 block text-[13px] font-medium">Tên danh mục mới</label>
            <input id="dm-ten" className={O_NHAP} value={ten} onChange={(e) => setTen(e.target.value)} maxLength={120} />
          </div>
          <div className="w-[220px]">
            <label htmlFor="dm-cha" className="mb-1 block text-[13px] font-medium">Thuộc</label>
            <select id="dm-cha" className={O_CHON} value={cha} onChange={(e) => setCha(e.target.value)}>
              <option value="">Cấp 1 (không thuộc danh mục nào)</option>
              {chaDs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" className={NUT_CHINH} disabled={dangChay}>Thêm</button>
        </form>
      ) : null}

      <ul className="divide-y divide-border border-t border-border">
        {chaDs.length === 0 ? <li className="px-4 py-6 text-sm text-muted-foreground">Chưa có danh mục nào.</li> : null}
        {chaDs.map((c) => (
          <li key={c.id}>
            <Dong d={c} cap={0} />
            <ul>
              {dong.filter((x) => x.parentId === c.id).map((x) => <li key={x.id}><Dong d={x} cap={1} /></li>)}
            </ul>
          </li>
        ))}
      </ul>

      {xoa ? (
        <div role="dialog" aria-label="Xoá danh mục" className="mx-4 mb-4 rounded-lg border border-state-danger/40 bg-card p-4">
          <p className="text-sm">Xoá danh mục <strong>{xoa.name}</strong>? Chỉ xoá được khi không còn danh mục con hoặc khoá thuộc nó.</p>
          <label htmlFor="dm-lydo" className="mt-3 block text-[13px] font-medium">Lý do (≥ 10 ký tự, vào nhật ký)</label>
          <input id="dm-lydo" className={`${O_NHAP} mt-1`} value={xoa.lyDo} onChange={(e) => setXoa({ ...xoa, lyDo: e.target.value })} />
          <div className="mt-3 flex gap-2">
            <button type="button" className={NUT_NGUY} disabled={dangChay || xoa.lyDo.trim().length < 10} onClick={xoaThat}>Xoá</button>
            <button type="button" className={NUT_NHO} onClick={() => setXoa(null)}>Huỷ</button>
          </div>
        </div>
      ) : null}
    </div>
  );

  function Dong({ d, cap }: { d: Dong; cap: 0 | 1 }) {
    const sua = dangSua?.id === d.id;
    return (
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${cap ? "pl-10" : ""}`}>
        {sua ? (
          <>
            <input aria-label="Tên danh mục" className={`${O_NHAP} max-w-xs`} value={dangSua!.name} onChange={(e) => setDangSua({ id: d.id, name: e.target.value })} />
            <button type="button" className={NUT_NHO} disabled={dangChay} onClick={() => luu({ id: d.id, name: dangSua!.name.trim(), parentId: d.parentId }, () => setDangSua(null))}>Lưu</button>
            <button type="button" className={NUT_NHO} onClick={() => setDangSua(null)}>Huỷ</button>
          </>
        ) : (
          <>
            <span className={cap ? "text-sm" : "text-sm font-semibold"}>{cap ? "› " : ""}{d.name}</span>
            <span className="text-xs text-muted-foreground">{d.soKhoa} khoá</span>
            {coQuyen ? (
              <span className="ml-auto flex gap-2">
                <button type="button" className={NUT_NHO} onClick={() => setDangSua({ id: d.id, name: d.name })}>Đổi tên</button>
                <button type="button" className={NUT_NHO} onClick={() => setXoa({ id: d.id, name: d.name, lyDo: "" })}>Xoá</button>
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  }
}
