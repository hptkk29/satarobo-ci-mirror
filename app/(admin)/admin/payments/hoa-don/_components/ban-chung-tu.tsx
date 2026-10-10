"use client";

// "Bàn chứng từ" — danh sách lần thu + ngăn xử lý đứng CẠNH nhau (docs/ke-toan-hoa-don/PLAN.md §10).
//
// ≥ xl (1280px): lưới hai cột, ngăn là `<aside>` thường — KHÔNG dùng Sheet ở đây: Sheet của repo là
// Dialog modal có lớp phủ, khoá danh sách phía sau (PLAN §10). Ngưỡng là xl chứ không phải md như
// bản vẽ: sidebar cố định rộng 256px, ở md vùng nội dung chỉ còn ~500px — không đủ cho bảng lẫn
// ngăn 400px. Dưới xl: ngăn mở bằng Sheet, danh sách thành thẻ dưới md.
//
// ⚠️ Thân ngăn đặt `key={dong.key}` — đổi dòng là mount lại, mọi ô về rỗng (xem ngan-lan-thu.tsx).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh } from "@/components/admin/ui/table";
import { cn } from "@/lib/utils";
import { CAC_NGAN } from "@/lib/finance/hoa-don/ngan-hang-cho";
import type { DongHangCho, NganHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import { queryHoaDon, type LocUrl } from "@/lib/finance/hoa-don/loc-hang-cho";
import { LocUrlContext } from "./loc-url";
import { NganLanThu } from "./ngan-lan-thu";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const NGUON: Record<DongHangCho["nguon"], string> = { CK: "CK", LOI_KHAI: "Khai tay", KHONG_GIAO_DICH: "Tiền mặt" };
// Cột "Nguồn" chỉ hiện từ 2xl: ở 1440px bảng đứng cạnh ngăn 400px chỉ còn ~710px, đủ 4 cột — cột thứ
// năm đẩy "Trạng thái" xuống dưới ngăn (chụp 26/09). Nguồn vẫn in đầy đủ trong ngăn xử lý.
const COT_NGUON = "hidden 2xl:table-cell";
const O_CHON =
  "h-9 rounded-lg border border-border bg-card py-0 pl-2.5 pr-8 text-sm text-foreground outline-none focus:border-primary";
/** Ngăn SỔ ĐÃ XONG — chỉ hai ngăn này lọc theo tháng (lib/finance/hoa-don/loc-hang-cho.ts). */
const NGAN_THEO_THANG: readonly NganHangCho[] = ["da-xuat", "khong-xuat"];

/**
 * Bộ lọc cơ sở + tháng của màn (PLAN §10 "[CS1 ▾] [Tháng 9 ▾]"). Trang đọc + kiểm từ URL (`docBoLoc`);
 * `cacCoSo` CHỈ gồm cơ sở trong phạm vi kế toán của người xem.
 */
export type LocManHinh = {
  /** Phần nằm trên URL — mọi đường dẫn / `router.replace` của màn mang theo. */
  url: LocUrl;
  coSo: string | null;
  thang: string;
  thangMacDinh: string;
  cacCoSo: { id: string; ma: string; ten: string }[];
  cacThang: { gia: string; nhan: string }[];
};

/** `true` từ xl trở lên; `undefined` trước khi đo (SSR) — lúc đó chưa mở Sheet nào. */
function useLaXl(): boolean | undefined {
  const [la, setLa] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const doi = () => setLa(mq.matches);
    doi();
    mq.addEventListener("change", doi);
    return () => mq.removeEventListener("change", doi);
  }, []);
  return la;
}

/**
 * Màu số đếm trên từng ngăn khi CÓ việc. Bảng đủ khoá theo `NganHangCho` ⇒ thêm ngăn mà quên màu là tsc
 * đỏ (thay cho chuỗi điều kiện inline cũ — GĐ 8 thêm "Cần điều chỉnh"). Ngăn "sổ đã xong" giữ màu nhạt.
 */
const MAU_DEM_TRONG = "bg-background text-muted-foreground";
const MAU_DEM: Record<NganHangCho, string> = {
  cho: "bg-state-warning-soft text-state-warning-ink",
  lech: "bg-state-danger-soft text-state-danger-ink",
  "can-dieu-chinh": "bg-state-danger-soft text-state-danger-ink",
  nhap: MAU_DEM_TRONG,
  // Bước 1 MISA — bản đang / lỗi phát hành là việc tồn cần nhìn: cùng màu "cần xử lý" như ngăn lệch.
  "phat-hanh": "bg-state-info-soft text-state-info-ink",
  "da-xuat": MAU_DEM_TRONG,
  "khong-xuat": MAU_DEM_TRONG,
  "don-huy": MAU_DEM_TRONG,
};

export function BanChungTu({
  ngan,
  dem,
  dongTrongNgan,
  dangChon,
  chonKhongThay,
  thieuCoSo,
  khoOk,
  loc,
}: {
  ngan: NganHangCho;
  dem: Record<NganHangCho, number>;
  dongTrongNgan: DongHangCho[];
  dangChon: DongHangCho | null;
  chonKhongThay: boolean;
  thieuCoSo: number;
  khoOk: boolean;
  loc: LocManHinh;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const laXl = useLaXl();
  // Desktop: chưa chọn gì thì ngăn hiện sẵn dòng ĐẦU của ngăn — kế toán làm theo lô, không phải
  // bấm để bắt đầu. Không đổi URL (dưới xl không tự mở Sheet).
  const trongAside = dangChon ?? dongTrongNgan[0] ?? null;

  function chon(key: string | null) {
    router.replace(`${pathname}?${queryHoaDon(loc.url, { ngan, chon: key })}`, { scroll: false });
  }
  /** Đổi bộ lọc ⇒ bỏ dòng đang chọn (có thể không còn trong tập mới). */
  function doiLoc(url: LocUrl) {
    router.replace(`${pathname}?${queryHoaDon(url, { ngan })}`, { scroll: false });
  }
  const hrefNgan = (n: NganHangCho) => `${pathname}?${queryHoaDon(loc.url, { ngan: n })}`;
  // Ô chỉ hiện khi CÓ tác dụng (luật 12): một cơ sở thì chọn gì cũng như nhau; ngăn việc tồn không lọc tháng.
  const coOCoSo = loc.cacCoSo.length > 1;
  const coOThang = NGAN_THEO_THANG.includes(ngan);

  const moTa = CAC_NGAN.find((n) => n.ngan === ngan)!;

  return (
    <LocUrlContext.Provider value={loc.url}>
    <div className="flex flex-col gap-4">
      {!khoOk ? (
        <Bao>
          Kho lưu tệp hoá đơn chưa được cấu hình (biến <code className="font-mono text-xs">R2_INVOICE_BUCKET_NAME</code>) —
          vẫn tải được phiếu thu, nhưng chưa tải hoá đơn lên được. Báo người vận hành.
        </Bao>
      ) : null}
      {thieuCoSo > 0 ? (
        <Bao>
          {thieuCoSo} khoản thu nằm trên đơn chưa gán cơ sở nên chưa lên được danh sách này. Gán cơ sở cho đơn ở trang
          đơn hàng.
        </Bao>
      ) : null}
      {chonKhongThay ? (
        <Bao>Lần thu vừa mở không còn trong danh sách — có thể đã có người xử lý hoặc số tiền vừa đổi.</Bao>
      ) : null}

      <nav aria-label="Ngăn hoá đơn" className="-mx-1 overflow-x-auto px-1">
        <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
          {CAC_NGAN.map((n) => {
            const dangMo = n.ngan === ngan;
            const so = dem[n.ngan];
            return (
              <li key={n.ngan}>
                <Link
                  href={hrefNgan(n.ngan)}
                  scroll={false}
                  aria-current={dangMo ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors duration-150",
                    dangMo
                      ? "bg-card font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.nhan}
                  <span
                    className={cn(
                      "min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums",
                      so > 0 ? MAU_DEM[n.ngan] : MAU_DEM_TRONG,
                    )}
                  >
                    {so}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {coOCoSo || coOThang ? (
        <div className="flex flex-wrap items-center gap-2">
          {coOCoSo ? (
            <select
              aria-label="Cơ sở"
              value={loc.coSo ?? ""}
              onChange={(e) => doiLoc({ ...loc.url, coSo: e.target.value || null })}
              className={O_CHON}
            >
              <option value="">Tất cả cơ sở</option>
              {loc.cacCoSo.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.ma} · ${c.ten}`}
                </option>
              ))}
            </select>
          ) : null}
          {coOThang ? (
            <select
              aria-label="Tháng"
              value={loc.thang}
              onChange={(e) =>
                doiLoc({ ...loc.url, thang: e.target.value === loc.thangMacDinh ? null : e.target.value })
              }
              className={O_CHON}
            >
              {loc.cacThang.map((t) => (
                <option key={t.gia} value={t.gia}>
                  {t.nhan}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start xl:gap-5">
        <div className="min-w-0">
          {dongTrongNgan.length === 0 ? (
            <EmptyState
              title={moTa.rong}
              description={
                ngan === "cho"
                  ? "Tiền về sẽ tự lên đây. Hoá đơn đã tải tệp nằm ở ngăn “Đã tải tệp”."
                  : "Đổi ngăn phía trên để xem các lần thu khác."
              }
              action={
                ngan !== "cho" ? (
                  <Link href={hrefNgan("cho")} className="text-sm font-medium text-primary hover:underline">
                    Về ngăn Chờ xuất
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {dongTrongNgan.map((d) => (
                  <li key={d.key}>
                    <button
                      type="button"
                      onClick={() => chon(d.key)}
                      aria-pressed={dangChon?.key === d.key}
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/50",
                        dangChon?.key === d.key && "border-primary/50 bg-primary-soft/40",
                      )}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate font-medium text-foreground">{d.tenKhach || d.maDon}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">{tien(d.soTien)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate tabular-nums">
                          {d.ngayThuLabel} · {d.maDon}
                          {d.nhanDot ? ` · ${d.nhanDot}` : ""}
                        </span>
                        <StatusPill tone={d.tone}>{d.nhan}</StatusPill>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
                {/* `khoaDongHien`: xác nhận xong ngăn chuyển sang dòng KẾ TIẾP (`?chon=`) — bảng phải mở đúng trang
                    chứa nó (PLAN §10). Khoá trang gắn cả bộ lọc: đổi lọc là về trang 1 của tập mới. */}
                <PhanTrangBang
                  cuonNgang
                  tenDonVi="lần thu"
                  khoaGhiNho="hoa-don"
                  khoaTrang={`hoa-don:${ngan}:${loc.url.coSo ?? ""}:${loc.url.thang ?? ""}`}
                  khoaDongHien={dangChon?.key ?? null}
                  classThanh="px-4 pb-3"
                >
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th scope="col" className={adminTh}>
                          Ngày thu
                        </th>
                        <th scope="col" className={adminTh}>
                          Khách · đơn
                        </th>
                        <th scope="col" className={cn(adminTh, "text-right")}>
                          Số tiền
                        </th>
                        <th scope="col" className={cn(adminTh, COT_NGUON)}>
                          Nguồn
                        </th>
                        <th scope="col" className={adminTh}>
                          Trạng thái
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dongTrongNgan.map((d) => {
                        const dangXem = trongAside?.key === d.key;
                        return (
                          <tr
                            key={d.key}
                            aria-selected={dangXem}
                            className={cn(
                              "relative cursor-pointer border-b border-border/60 transition-colors duration-150 last:border-0",
                              dangXem ? "bg-primary-soft/50" : "hover:bg-muted/50",
                            )}
                          >
                            <td className={cn(adminTd, "tabular-nums text-muted-foreground")}>{d.ngayThuLabel}</td>
                            <td className={cn(adminTd, "w-full max-w-0")}>
                              {/* Vùng bấm phủ cả HÀNG (`after:inset-0`, neo ở `relative` của <tr>) — khuôn /cham-cong.
                                  `w-full max-w-0`: ô bảng BỎ QUA `max-w-[16rem]`, nên tên dài từng đẩy nhãn trạng
                                  thái ("Đang tải tệp MISA · mô phỏng") ra mép phải và bị cắt ở 1440 (smoke 30/09).
                                  Cột tên nhận phần CÒN LẠI và `truncate` bên dưới mới thật sự cắt. */}
                              <button
                                type="button"
                                onClick={() => chon(d.key)}
                                className="block max-w-full truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                              >
                                <span className="font-medium text-foreground">{d.tenKhach || "—"}</span>
                                <span className="ml-2 text-xs tabular-nums text-muted-foreground">{d.maDon}</span>
                              </button>
                            </td>
                            <td className={cn(adminTd, "text-right font-semibold tabular-nums")}>{tien(d.soTien)}</td>
                            <td className={cn(adminTd, COT_NGUON, "text-muted-foreground")}>
                              {NGUON[d.nguon]}
                              {d.nhanDot ? ` · ${d.nhanDot}` : ""}
                            </td>
                            <td className={adminTd}>
                              <StatusPill tone={d.tone}>{d.nhan}</StatusPill>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </PhanTrangBang>
              </div>
            </>
          )}
        </div>

        <aside
          aria-label="Chứng từ của lần thu"
          className="hidden rounded-xl border border-border bg-card xl:sticky xl:top-4 xl:block xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto"
        >
          {trongAside ? (
            <NganLanThu key={trongAside.key} dong={trongAside} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
              <Inbox className="h-5 w-5" aria-hidden />
              Chọn một lần thu để xem phiếu thu và tải hoá đơn.
            </div>
          )}
        </aside>
      </div>

      <Sheet open={laXl === false && dangChon !== null} onOpenChange={(mo) => (mo ? null : chon(null))}>
        {/* `admin-scope`: Sheet render qua PORTAL ra ngoài khung admin ⇒ không có class này là token
            rơi về `:root` (primary thành cam — chụp 26/09 ở 375px). */}
        <SheetContent side="right" className="admin-scope w-full overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>{dangChon ? `${dangChon.tenKhach || dangChon.maDon}` : "Lần thu"}</SheetTitle>
          </SheetHeader>
          {dangChon ? <NganLanThu key={dangChon.key} dong={dangChon} /> : null}
        </SheetContent>
      </Sheet>
    </div>
    </LocUrlContext.Provider>
  );
}

function Bao({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
