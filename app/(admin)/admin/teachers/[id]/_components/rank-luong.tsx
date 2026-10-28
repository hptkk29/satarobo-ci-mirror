"use client";
// Khối "Rank lương" trong hồ sơ giáo viên — Rank đứng chính SR.QD.238 (R1–R4, quyết định đơn giá tiết) + chứng nhận Trial.
// Chốt 25/10/2026: CHỈ Giám đốc · Quản trị tối cao · Đào tạo đổi Rank, đổi là ÁP NGAY từ ngày hiệu lực — không còn đề xuất / chờ người khác
// duyệt. Khối nằm ở cột phụ (hẹp) từ màn rộng và ở cột đơn trên điện thoại ⇒ bố cục theo CHÍNH bề ngang khối (`@container`), không theo
// màn hình. Nút chỉ vẽ khi người xem CÓ quyền (trang truyền cờ — luật 12); dialog dùng chung với màn Rank, action kiểm lại ở server.
import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, CalendarClock, History } from "lucide-react";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { RankCuaGv } from "@/lib/parttime/rank-don-gia-db";
import { RankDialog, dmy, khoaMo, type GvRank, type MoRank, type QuyenRank } from "@/app/(admin)/admin/teachers/rank/_components/rank-dialog";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";
/** Số mốc hiện sẵn — phần cũ hơn nằm trong `<details>` (không đẩy khối dài vô tận ở cột phụ). */
const HIEN_SAN = 4;

function trangThaiChungNhan(c: RankCuaGv["chungNhan"][number], homNay: string): { nhan: string; cls: string } {
  if (c.hieuLucHomNay) return { nhan: "Đang hiệu lực", cls: "bg-state-success-soft text-state-success-ink" };
  if (c.daThuHoi) return { nhan: "Đã thu hồi", cls: "bg-state-danger-soft text-state-danger-ink" };
  if (c.tuNgay > homNay) return { nhan: "Chưa tới ngày", cls: "bg-state-info-soft text-state-info-ink" };
  return { nhan: "Hết hiệu lực", cls: "bg-muted text-muted-foreground" };
}

export type QuyenRankHoSo = QuyenRank & {
  /** Có `parttime_rank:view` ở một cơ sở của GV — được xem căn cứ + lịch sử. Chính GV không có quyền này chỉ thấy Rank + chứng nhận. */
  xemChiTiet: boolean;
};

export function RankLuong({ ten, du, quyen }: { ten: string; du: RankCuaGv; quyen: QuyenRankHoSo }) {
  const [mo, setMo] = useState<MoRank>(null);
  const cn0 = du.chungNhan[0] ?? null;
  const gv: GvRank = { userId: du.userId, ten, rank: du.rank, coSoIds: du.coSoIds, chungNhan: cn0 ? { id: cn0.id } : null };
  const capDuoc = quyen.chungNhan && !cn0?.hieuLucHomNay && !(cn0 && !cn0.daThuHoi && cn0.tuNgay > du.homNay);
  const thuHoiDuoc = quyen.chungNhan && cn0 != null && !cn0.daThuHoi && (cn0.denNgay == null || cn0.denNgay >= du.homNay);
  const ttCn = cn0 ? trangThaiChungNhan(cn0, du.homNay) : null;

  return (
    <section aria-labelledby="rank-luong" className="@container rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="rank-luong" className="text-base font-semibold text-foreground">
            Rank lương
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">SR.QD.238 · Rank quyết định đơn giá tiết đứng chính. Đổi có hiệu lực từ ngày chọn, không hồi tố.</p>
        </div>
        {quyen.doi && (
          <button type="button" className={cn(BTN_PRIMARY, "shrink-0")} onClick={() => setMo({ loai: "doi", gv, bangGia: du.bangGia })}>
            Đổi Rank
          </button>
        )}
      </header>

      <div className="space-y-5 px-5 py-5">
        {/* Thang 4 bậc — bậc đang áp tô đặc, bậc đã lên lịch viền đứt + ngày; giá mỗi bậc theo chính sách đang áp. */}
        <ol aria-label="Thang Rank" className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((r) => {
            const dangAp = r === du.rank;
            const sapToi = du.rankSapToi?.rank === r;
            const gia = du.bangGia?.[String(r)];
            return (
              <li
                key={r}
                aria-current={dangAp ? "step" : undefined}
                className={cn(
                  "flex min-h-16 min-w-0 flex-col items-center justify-center rounded-lg border px-1 py-2 text-center",
                  dangAp
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : sapToi
                      ? "border-dashed border-primary bg-primary-soft/40 text-foreground"
                      : "border-border text-muted-foreground",
                )}
              >
                <span className="text-lg font-bold leading-none tabular-nums">R{r}</span>
                <span className={cn("mt-1 max-w-full truncate text-xs tabular-nums", dangAp ? "opacity-90" : "")}>
                  {sapToi ? `từ ${dmy(du.rankSapToi!.tuNgay).slice(0, 5)}` : gia != null ? `${Math.round(gia / 1000)}k` : "—"}
                </span>
              </li>
            );
          })}
        </ol>

        <dl className="grid gap-x-6 gap-y-4 text-sm @md:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Đang áp</dt>
            <dd className="mt-0.5 text-foreground">
              <b className="tabular-nums">Rank {du.rank}</b>{" "}
              <span className="text-muted-foreground">{du.nguonRank === "MAC_DINH" ? "· mặc định nhân sự mới" : `· từ ${dmy(du.rankTuNgay)}`}</span>
            </dd>
            {du.rankSapToi && (
              <dd className="mt-1 flex items-center gap-1 text-xs text-state-info-ink">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Lên Rank {du.rankSapToi.rank} từ {dmy(du.rankSapToi.tuNgay)}
              </dd>
            )}
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Tiết đứng chính</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
              {du.donGiaHomNay != null ? `${vnd(du.donGiaHomNay)} / tiết` : "Hôm nay không thuộc SR.QD.238"}
            </dd>
          </div>
          <div className="min-w-0 @md:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Chứng nhận Trial</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {cn0 && ttCn ? (
                <>
                  <span className={cn(PILL, ttCn.cls)}>
                    {cn0.hieuLucHomNay && <BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                    {ttCn.nhan}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {cn0.code ? `${cn0.code} · ` : ""}
                    {dmy(cn0.tuNgay)} → {cn0.denNgay ? dmy(cn0.denNgay) : "không thời hạn"}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Chưa có — buổi Trial chưa được tính hỗ trợ.</span>
              )}
            </dd>
            {(capDuoc || thuHoiDuoc) && (
              <dd className="mt-2 flex flex-wrap gap-2">
                {capDuoc && (
                  <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "cap", gv })}>
                    Cấp chứng nhận Trial
                  </button>
                )}
                {thuHoiDuoc && (
                  <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "thu-hoi", gv })}>
                    Thu hồi chứng nhận
                  </button>
                )}
              </dd>
            )}
          </div>
        </dl>

        {quyen.xemChiTiet && (
          <div className="grid gap-5 border-t border-border pt-5 @2xl:grid-cols-2">
            <DongThoiGian
              tieuDe="Các mốc Rank"
              rong="Chưa có quyết định nào — đang áp Rank mặc định cho nhân sự mới."
              muc={du.lichSu.map((l) => ({
                id: l.id,
                chinh: (
                  <>
                    <b className="tabular-nums">R{l.rank}</b> từ <span className="tabular-nums">{dmy(l.tuNgay)}</span>
                    {l.tuongLai && <span className={cn(PILL, "ml-2 bg-state-info-soft text-state-info-ink")}>Đã lên lịch</span>}
                  </>
                ),
                phu: [l.nguoiDuyet, l.lyDo].filter(Boolean).join(" · "),
              }))}
            />
            <DongThoiGian
              tieuDe="Chứng nhận Trial"
              rong="Chưa được cấp. Phòng Đào tạo Hội sở cấp sau khi giáo viên đạt yêu cầu dạy Trial."
              muc={du.chungNhan.map((c) => {
                const t = trangThaiChungNhan(c, du.homNay);
                return {
                  id: c.id,
                  chinh: (
                    <>
                      <span className="tabular-nums">
                        {dmy(c.tuNgay)} → {c.denNgay ? dmy(c.denNgay) : "không hạn"}
                      </span>
                      <span className={cn(PILL, "ml-2", t.cls)}>{t.nhan}</span>
                    </>
                  ),
                  phu: [c.code, c.nguoiCap && `cấp bởi ${c.nguoiCap}`, c.daThuHoi && c.lyDoThuHoi ? `thu hồi: ${c.lyDoThuHoi}` : null].filter(Boolean).join(" · "),
                };
              })}
            />
          </div>
        )}

        {quyen.xemChiTiet && (
          <p className="text-xs text-muted-foreground">
            Đơn giá từng bậc, trợ giảng, trực và hỗ trợ Trial ở{" "}
            <Link href="/cham-cong/don-gia-parttime" className="font-medium text-primary hover:underline">
              Đơn giá Parttime
            </Link>
            .
          </p>
        )}
      </div>

      <RankDialog key={khoaMo(mo)} mo={mo} dong={() => setMo(null)} homNay={du.homNay} quyen={quyen} />
    </section>
  );
}

/** Dòng thời gian gọn cho cột hẹp: mốc mới nhất trên cùng; quá `HIEN_SAN` mốc thì phần cũ gập trong `<details>`. */
function DongThoiGian({ tieuDe, rong, muc }: { tieuDe: string; rong: string; muc: { id: string; chinh: React.ReactNode; phu: string }[] }) {
  const Muc = ({ m }: { m: (typeof muc)[number] }) => (
    <li className="relative pb-3 pl-5 last:pb-0">
      <span aria-hidden className="absolute left-[3px] top-1.5 h-2 w-2 rounded-full bg-primary" />
      <span aria-hidden className="absolute bottom-0 left-[6px] top-4 w-px bg-border" />
      <p className="text-sm text-foreground">{m.chinh}</p>
      {m.phu && (
        <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground" title={m.phu}>
          {m.phu}
        </p>
      )}
    </li>
  );
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
        {tieuDe}
      </h3>
      {muc.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{rong}</p>
      ) : (
        <>
          <ol>
            {muc.slice(0, HIEN_SAN).map((m) => (
              <Muc key={m.id} m={m} />
            ))}
          </ol>
          {muc.length > HIEN_SAN && (
            <details className="group mt-1">
              <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Xem {muc.length - HIEN_SAN} mốc cũ hơn</span>
                <span className="hidden group-open:inline">Thu gọn</span>
              </summary>
              <ol className="mt-2">
                {muc.slice(HIEN_SAN).map((m) => (
                  <Muc key={m.id} m={m} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}
