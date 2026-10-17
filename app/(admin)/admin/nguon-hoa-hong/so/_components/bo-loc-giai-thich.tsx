// app/(admin)/admin/nguon-hoa-hong/so/_components/bo-loc-giai-thich.tsx — bộ lọc của góc nhìn «Không đủ điều kiện» (Hướng G). Biểu mẫu GET: lọc là điều hướng, nằm TRÊN URL.
//
// CHỈ những ô mà bảng giải thích thật sự lọc được (`BoLocGiaiThich`): Kỳ (kỳ hiệu lực của khoản thu) · Vai · Người hưởng dự kiến · Nguồn. Không vẽ «Loại GD» / «Trạng thái chi» của sổ:
// bảng này không có hai cột đó nên ô lọc sẽ im lặng không làm gì — lời hứa suông (luật 12).
import Link from "next/link";

import { BTN_OUTLINE, BTN_PRIMARY, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";

export type GiaTriLocGiaiThich = { thang: string; vai: string; nguoi: string; nguon: string };
export type LuaChonLocGiaiThich = {
  thang: string[];
  vai: { code: string; ten: string }[];
  /** RỖNG với người chỉ có `view-self` — họ chỉ có chính mình, ô lọc người không có nghĩa. */
  nguoiHuong: { id: string; ten: string }[];
  nhomNguon: { code: string; ten: string }[];
};

function Chon({ ten, nhan, gia, tatCa, lua }: { ten: string; nhan: string; gia: string; tatCa: string; lua: { gia: string; nhan: string }[] }) {
  const id = `loc-gt-${ten}`;
  // Giá trị trên URL không còn trong danh sách vẫn đang LỌC: hiện nó thay vì để ô nói «Mọi …» trong khi bảng đã bị lọc.
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

export function BoLocGiaiThichForm({
  basePath,
  giu,
  lua,
  gia,
  coLoc,
}: {
  basePath: string;
  /** Tham số phải mang theo khi gửi biểu mẫu (`xem`, `coSo`). */
  giu: TruyVan;
  lua: LuaChonLocGiaiThich;
  gia: GiaTriLocGiaiThich;
  coLoc: boolean;
}) {
  return (
    // `key` theo giá trị lọc: `defaultValue` chỉ đọc lúc mount, mà «Bỏ lọc»/Back là điều hướng phía client (form KHÔNG remount).
    <form key={Object.values(gia).join("|")} method="get" action={basePath} className="mb-4 rounded-xl border border-border bg-card p-3">
      {Object.entries(giu).flatMap(([k, v]) => (v === null || v === undefined || String(v) === "" ? [] : [<input key={k} type="hidden" name={k} value={String(v)} />]))}
      <div className="flex flex-wrap items-end gap-3">
        <Chon ten="thang" nhan="Kỳ" gia={gia.thang} tatCa="Mọi kỳ" lua={lua.thang.map((t) => ({ gia: t, nhan: kyHienThi(t) }))} />
        <Chon ten="vai" nhan="Vai" gia={gia.vai} tatCa="Mọi vai" lua={lua.vai.map((v) => ({ gia: v.code, nhan: v.ten }))} />
        {lua.nguoiHuong.length > 0 && <Chon ten="nguoi" nhan="Người hưởng dự kiến" gia={gia.nguoi} tatCa="Mọi người" lua={lua.nguoiHuong.map((n) => ({ gia: n.id, nhan: n.ten }))} />}
        <Chon ten="nguon" nhan="Nguồn" gia={gia.nguon} tatCa="Mọi nguồn" lua={lua.nhomNguon.map((n) => ({ gia: n.code, nhan: n.ten }))} />
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
