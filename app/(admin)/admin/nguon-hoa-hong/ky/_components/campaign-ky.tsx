// app/(admin)/admin/nguon-hoa-hong/ky/_components/campaign-ky.tsx — LỌC THEO CAMPAIGN AFFILIATE trên tab Kỳ (AFF-P3, docs/source-commission/12 §9).
//
// Hai thứ, cả hai CHỈ ĐỌC:
//   · `LocCampaignKy`  — biểu mẫu GET (lọc nằm trên URL như mọi bộ lọc của module): một ô chọn campaign, mang theo cơ sở · tháng · trạng thái.
//   · `PhanCampaignKy` — dải «phần của campaign trong kỳ đang chọn».
//
// ⚠️ LUẬT 12 — lọc ở đây KHÔNG đổi con số nào của kỳ. `DaiSo`, `ViecDangDo`, các nút Tính / Rà soát / Khoá / Xuất đều áp dụng cho CẢ KỲ (cổng Khoá so lại bản chụp của CẢ KỲ); một tổng đã lọc đặt cạnh
// nút Khoá là nói sai nút đó làm gì. Nên phần của campaign nằm ở dải RIÊNG, ghi thẳng «chỉ là phần của campaign», và bảng chi / khoá kỳ không theo campaign.
import Link from "next/link";

import { BTN_OUTLINE, BTN_PRIMARY, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import type { PhanCampaignCuaKy } from "@/lib/hoa-hong/ky-doc";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";

export function LocCampaignKy({
  basePath,
  giu,
  lua,
  dangChon,
}: {
  basePath: string;
  /** Tham số phải sống sót khi lọc: cơ sở · tháng · trạng thái. Chuyển trang KHÔNG giữ (lọc là về trang đầu). */
  giu: TruyVan;
  lua: { code: string; ten: string }[];
  /** Mã campaign đang lọc (đã qua `MA_DANH_MUC_RE`), hoặc null. */
  dangChon: string | null;
}) {
  // Sổ chưa có dòng Affiliate nào trong tầm nhìn ⇒ không vẽ ô lọc không dẫn đến đâu — trừ khi URL đang mang bộ lọc (để người xem thấy và bỏ được).
  if (lua.length === 0 && dangChon === null) return null;
  // Mã trên URL không còn trong danh sách vẫn đang LỌC: hiện nó thay vì để ô nói «Mọi campaign» trong khi các dòng phụ đã theo một campaign.
  const day = dangChon !== null && !lua.some((l) => l.code === dangChon) ? [...lua, { code: dangChon, ten: `${dangChon} (không còn trong danh sách)` }] : lua;
  return (
    <form key={dangChon ?? ""} method="get" action={basePath} aria-label="Lọc kỳ theo campaign Affiliate" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
      {Object.entries(giu).flatMap(([k, v]) => (v === null || v === undefined || String(v) === "" ? [] : [<input key={k} type="hidden" name={k} value={String(v)} />]))}
      <div className="min-w-[12rem] flex-1 basis-[12rem]">
        <label htmlFor="loc-ky-camp" className={NHAN_O}>
          Campaign Affiliate
        </label>
        <select id="loc-ky-camp" name="camp" defaultValue={dangChon ?? ""} className={O_NHAP}>
          <option value="">Mọi campaign</option>
          {day.map((l) => (
            <option key={l.code} value={l.code}>
              {l.ten}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY}>
          Lọc
        </button>
        {dangChon !== null && (
          <Link href={hrefVoi(basePath, giu)} className={BTN_OUTLINE}>
            Bỏ lọc
          </Link>
        )}
      </div>
    </form>
  );
}

export function PhanCampaignKy({
  tenCampaign,
  kyNhan,
  phan,
  hrefSo,
}: {
  tenCampaign: string;
  /** Nhãn kỳ đang chọn («10/2026»). */
  kyNhan: string;
  /** null = campaign không có dòng nào trong kỳ này (KHÁC với «0 đồng»). */
  phan: PhanCampaignCuaKy | null;
  /** Liên kết sang tab Sổ với đúng bộ lọc kỳ + campaign — null khi người xem không mở được tab Sổ. */
  hrefSo: string | null;
}) {
  return (
    <section aria-label={`Phần của campaign ${tenCampaign} trong kỳ`} className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">
        Phần của campaign «{tenCampaign}» trong kỳ {kyNhan}
      </h2>
      {phan ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Hoa hồng ghi mới <b className="text-lg font-semibold tabular-nums text-foreground">{dinhDangDong(phan.hoaHong)}</b>
          </span>
          <span>
            Điều chỉnh <b className="font-semibold tabular-nums text-foreground">{dinhDangDong(phan.dieuChinh)}</b>
          </span>
          <span>
            <b className="font-semibold tabular-nums text-foreground">{phan.soDong}</b> dòng
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Campaign này chưa có dòng nào trong kỳ {kyNhan}.</p>
      )}
      <p role="note" className="mt-2 text-xs text-muted-foreground">
        Đây chỉ là phần của campaign. Các số của kỳ ở trên, nút Tính / Khoá và bảng chi áp dụng cho cả kỳ, không theo campaign.
        {hrefSo && (
          <>
            {" "}
            <Link href={hrefSo} className="font-medium text-primary-ink hover:underline">
              Xem các dòng này ở Sổ
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
