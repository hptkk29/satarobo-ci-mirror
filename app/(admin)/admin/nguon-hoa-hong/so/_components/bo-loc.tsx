// app/(admin)/admin/nguon-hoa-hong/so/_components/bo-loc.tsx — HAI bộ lọc của tab Sổ, cả hai nằm TRÊN URL (06 §3 "bộ lọc quan trọng nằm trên URL"):
//   · `ChipNhomHangCho`  — chip theo LOẠI việc của hàng chờ (`LoaiHangChoSo` — định nghĩa DUY NHẤT ở `hang-cho-so-nhom.ts`; mỗi chip kèm số, số đến từ `docHangChoSo.demTheoLoai`: không tự đếm lại — luật 12b);
//   · `BoLocSoForm`      — biểu mẫu GET cho sổ "Tất cả": Kỳ · Vai · Người hưởng · Nguồn · Loại GD · Trạng thái.
// Server component thuần: lọc là điều hướng (đổi địa chỉ), không cần một dòng JS. Chip cơ sở nằm ở ScopeBar (giữ các tham số này khi đổi cơ sở).
import Link from "next/link";

import { BTN_OUTLINE, BTN_PRIMARY, CHIP, CHIP_ACTIVE, CHIP_IDLE, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { LOAI_HANG_CHO_SO, MO_TA_LOAI, NHAN_LOAI, type LoaiHangChoSo } from "@/lib/hoa-hong/hang-cho-so-nhom";
import type { LuaChonBoLocSo } from "@/lib/hoa-hong/doc-so-giao-dien";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { NHAN_TRANG_THAI_CHI } from "@/lib/hoa-hong/vi-sao-day-du";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export function ChipNhomHangCho({
  basePath,
  giu,
  dangChon,
  theoNhom,
  tong,
}: {
  basePath: string;
  /** Tham số khác sống sót khi đổi nhóm (`coSo`). `trang` KHÔNG giữ: đổi nhóm là về đầu danh sách. */
  giu: TruyVan;
  dangChon: LoaiHangChoSo | null;
  theoNhom: Record<LoaiHangChoSo, number>;
  tong: number;
}) {
  // Điện thoại: MỘT hàng cuộn ngang (sáu chip xếp dọc đẩy bảng ra ngoài màn đầu); ≥ sm: tự xuống dòng.
  return (
    <nav aria-label="Lọc hàng chờ theo nhóm lý do" className="-mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [&>a]:shrink-0">
      <Link href={hrefVoi(basePath, giu)} aria-current={dangChon === null ? "page" : undefined} className={cn(CHIP, dangChon === null ? CHIP_ACTIVE : CHIP_IDLE)}>
        Mọi nhóm
        <span className="tabular-nums">({tong})</span>
      </Link>
      {LOAI_HANG_CHO_SO.map((n) => (
        <Link
          key={n}
          href={hrefVoi(basePath, { ...giu, nhom: n })}
          aria-current={dangChon === n ? "page" : undefined}
          title={MO_TA_LOAI[n]}
          className={cn(CHIP, dangChon === n ? CHIP_ACTIVE : CHIP_IDLE)}
        >
          {NHAN_LOAI[n]}
          <span className="tabular-nums">({theoNhom[n]})</span>
        </Link>
      ))}
    </nav>
  );
}

export type GiaTriBoLoc = { thang: string; vai: string; nguoi: string; nguon: string; loai: string; tt: string };


function Chon({ ten, nhan, gia, tatCa, lua }: { ten: string; nhan: string; gia: string; tatCa: string; lua: { gia: string; nhan: string }[] }) {
  const id = `loc-so-${ten}`;
  // Giá trị trên URL không còn trong danh sách (kỳ cũ bị gỡ, người đã nghỉ…) vẫn đang LỌC: hiện nó thay vì để ô nói "Mọi …" trong khi bảng đã bị lọc.
  const dayDu = gia !== "" && !lua.some((l) => l.gia === gia) ? [...lua, { gia, nhan: `${gia} (không còn trong danh sách)` }] : lua;
  return (
    <div className="min-w-[9rem] flex-1 basis-[9rem]">
      <label htmlFor={id} className={NHAN_O}>
        {nhan}
      </label>
      <select id={id} name={ten} defaultValue={gia} className={O_NHAP}>
        <option value="">{tatCa}</option>
        {dayDu.map((l) => (
          <option key={l.gia} value={l.gia}>
            {l.nhan}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BoLocSoForm({
  basePath,
  giu,
  lua,
  gia,
  coLoc,
}: {
  basePath: string;
  /** Tham số phải mang theo khi gửi biểu mẫu (`xem`, `coSo`). */
  giu: TruyVan;
  lua: LuaChonBoLocSo;
  gia: GiaTriBoLoc;
  /** Đang có ít nhất một bộ lọc ⇒ hiện "Bỏ lọc". */
  coLoc: boolean;
}) {
  return (
    // `key` theo giá trị lọc: `defaultValue` chỉ đọc lúc mount, mà "Bỏ lọc"/Back là điều hướng phía client (form KHÔNG remount) — thiếu key thì ô vẫn nói giá trị cũ
    // trong khi địa chỉ và bảng đã đổi (lời nói dối kinh điển của form lọc trên URL).
    <form key={Object.values(gia).join("|")} method="get" action={basePath} className="mb-4 rounded-xl border border-border bg-card p-3">
      {Object.entries(giu).flatMap(([k, v]) => (v === null || v === undefined || String(v) === "" ? [] : [<input key={k} type="hidden" name={k} value={String(v)} />]))}
      <div className="flex flex-wrap items-end gap-3">
        <Chon ten="thang" nhan="Kỳ" gia={gia.thang} tatCa="Mọi kỳ" lua={lua.thang.map((t) => ({ gia: t, nhan: kyHienThi(t) }))} />
        <Chon ten="vai" nhan="Vai" gia={gia.vai} tatCa="Mọi vai" lua={lua.vai.map((v) => ({ gia: v.code, nhan: v.ten }))} />
        {/* Người chỉ có `view-self` không có danh sách người hưởng (họ chỉ có chính mình) ⇒ không vẽ ô lọc không có nghĩa. */}
        {lua.nguoiHuong.length > 0 && <Chon ten="nguoi" nhan="Người hưởng" gia={gia.nguoi} tatCa="Mọi người" lua={lua.nguoiHuong.map((n) => ({ gia: n.id, nhan: n.ten }))} />}
        <Chon ten="nguon" nhan="Nguồn" gia={gia.nguon} tatCa="Mọi nguồn" lua={lua.nhomNguon.map((n) => ({ gia: n.code, nhan: n.ten }))} />
        <Chon ten="loai" nhan="Loại GD" gia={gia.loai} tatCa="Mọi loại" lua={lua.loaiGiaoDich.map((l) => ({ gia: l.code, nhan: l.ten }))} />
        <Chon ten="tt" nhan="Trạng thái" gia={gia.tt} tatCa="Mọi trạng thái" lua={(Object.keys(NHAN_TRANG_THAI_CHI) as (keyof typeof NHAN_TRANG_THAI_CHI)[]).map((t) => ({ gia: t, nhan: NHAN_TRANG_THAI_CHI[t] }))} />
        <div className="flex items-center gap-2">
          <button type="submit" className={BTN_PRIMARY}>
            Lọc
          </button>
          {coLoc && (
            <Link href={hrefVoi(basePath, giu)} className={BTN_OUTLINE}>
              Bỏ lọc
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}
