"use client";
// Màn "Rank giáo viên" (màn con của mục Giáo viên): Rank đứng chính + chứng nhận Trial của mọi GV trong phạm vi. Chốt 25/10/2026: chỉ Giám đốc
// · QTTC · Đào tạo đổi Rank, áp ngay — không còn hàng chờ duyệt. Chi tiết từng người (lịch sử Rank, chứng nhận) ở hồ sơ GV `/teachers/[id]`.
// Nút chỉ vẽ khi người xem CÓ quyền (luật 12); action kiểm lại ở server. Điện thoại: mỗi GV một thẻ; từ md: bảng.
import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, CalendarClock } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type {
  DongRankGv,
  TrangRankDonGia,
} from "@/lib/parttime/rank-don-gia-db";
import {
  RankDialog,
  dmy,
  khoaMo,
  type MoRank,
  type QuyenRank,
} from "./rank-dialog";

const PILL =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";
const TH =
  "whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide";

function trangThaiCn(
  c: NonNullable<DongRankGv["chungNhan"]>,
  homNay: string,
): { nhan: string; cls: string } {
  if (c.hieuLucHomNay)
    return {
      nhan: "Đang hiệu lực",
      cls: "bg-state-success-soft text-state-success-ink",
    };
  if (c.daThuHoi)
    return {
      nhan: "Đã thu hồi",
      cls: "bg-state-danger-soft text-state-danger-ink",
    };
  if (c.tuNgay > homNay)
    return {
      nhan: "Chưa tới ngày",
      cls: "bg-state-info-soft text-state-info-ink",
    };
  return { nhan: "Hết hiệu lực", cls: "bg-muted text-muted-foreground" };
}

/** `hoSoMo`: userId GV mà người xem MỞ ĐƯỢC hồ sơ (cùng cổng của trang hồ sơ) — chỉ những người này mới có link. */
export function RankGvMan({
  du,
  quyen,
  hoSoMo,
}: {
  du: TrangRankDonGia;
  quyen: QuyenRank;
  hoSoMo: string[];
}) {
  const [mo, setMo] = useState<MoRank>(null);
  const moHoSo = new Set(hoSoMo);

  if (du.giaoVien.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Chưa có giáo viên nào trong phạm vi bạn xem.
      </p>
    );
  }

  const thaoTac = (g: DongRankGv) => {
    const cn0 = g.chungNhan;
    const cap =
      quyen.chungNhan &&
      !cn0?.hieuLucHomNay &&
      !(cn0 && !cn0.daThuHoi && cn0.tuNgay > du.homNay);
    const thuHoi =
      quyen.chungNhan &&
      cn0 != null &&
      !cn0.daThuHoi &&
      (cn0.denNgay == null || cn0.denNgay >= du.homNay);
    const gv = {
      userId: g.userId,
      ten: g.ten,
      rank: g.rank,
      coSoIds: g.coSoIds,
      chungNhan: cn0 ? { id: cn0.id } : null,
    };
    return [
      quyen.doi && (
        <button
          key="doi"
          type="button"
          className={BTN_OUTLINE}
          onClick={() => setMo({ loai: "doi", gv, bangGia: null })}
        >
          Đổi Rank
        </button>
      ),
      cap && (
        <button
          key="cap"
          type="button"
          className={BTN_OUTLINE}
          onClick={() => setMo({ loai: "cap", gv })}
        >
          Cấp chứng nhận
        </button>
      ),
      thuHoi && (
        <button
          key="thu"
          type="button"
          className={BTN_OUTLINE}
          onClick={() => setMo({ loai: "thu-hoi", gv })}
        >
          Thu hồi
        </button>
      ),
    ].filter(Boolean);
  };

  const Ten = ({ g }: { g: DongRankGv }) =>
    moHoSo.has(g.userId) ? (
      <Link
        href={`/teachers/${g.userId}`}
        className="font-medium text-foreground hover:text-primary hover:underline"
      >
        {g.ten}
      </Link>
    ) : (
      <span className="font-medium text-foreground">{g.ten}</span>
    );

  const Rank = ({ g }: { g: DongRankGv }) => (
    <div className="min-w-0">
      <span className="inline-flex items-baseline gap-1.5">
        <b className="tabular-nums text-foreground">R{g.rank}</b>
        <span className="text-xs text-muted-foreground">
          {g.nguonRank === "MAC_DINH" ? "mặc định" : `từ ${dmy(g.rankTuNgay)}`}
        </span>
      </span>
      {g.rankSapToi && (
        <span className="mt-0.5 flex items-center gap-1 text-xs text-state-info-ink">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />R
          {g.rankSapToi.rank} từ {dmy(g.rankSapToi.tuNgay)}
        </span>
      )}
    </div>
  );

  const ChungNhan = ({ g }: { g: DongRankGv }) => {
    if (!g.chungNhan)
      return <span className="text-xs text-muted-foreground">Chưa có</span>;
    const t = trangThaiCn(g.chungNhan, du.homNay);
    return (
      <div className="min-w-0">
        <span className={cn(PILL, t.cls)}>
          {g.chungNhan.hieuLucHomNay && (
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          {t.nhan}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {g.chungNhan.code ? `${g.chungNhan.code} · ` : ""}
          {dmy(g.chungNhan.tuNgay)} →{" "}
          {g.chungNhan.denNgay ? dmy(g.chungNhan.denNgay) : "không hạn"}
        </span>
      </div>
    );
  };

  return (
    <>
      {/* Điện thoại / máy tính bảng dọc: thẻ — bảng 6 cột ép vào 375px là cuộn ngang cả trang. */}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card md:hidden">
        {du.giaoVien.map((g) => {
          const nut = thaoTac(g);
          return (
            <li key={g.userId} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Ten g={g} />
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {g.coSoGoc ?? "—"} · dạy {g.coSo.join(", ") || "—"}
                  </p>
                </div>
                <Rank g={g} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-xs text-muted-foreground">
                  Chứng nhận Trial
                </span>
                <ChungNhan g={g} />
              </div>
              {nut.length > 0 && (
                <div className="flex flex-wrap gap-2 [&>button]:min-h-11 [&>button]:flex-1 [&>button]:justify-center">
                  {nut}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <PhanTrangBang tenDonVi="giáo viên" khoaGhiNho="rank-gv" cuonNgang>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className={TH}>Giáo viên</th>
                <th className={TH}>Cơ sở gốc · dạy</th>
                <th className={TH}>Rank</th>
                <th className={TH}>Chứng nhận Trial</th>
                {(quyen.doi || quyen.chungNhan) && (
                  <th className={cn(TH, "text-right")}>Thao tác</th>
                )}
              </tr>
            </thead>
            <tbody>
              {du.giaoVien.map((g) => (
                <tr
                  key={g.userId}
                  className="border-b border-border/60 align-top last:border-b-0"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <Ten g={g} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {g.coSoGoc ?? "—"} · {g.coSo.join(", ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Rank g={g} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <ChungNhan g={g} />
                  </td>
                  {(quyen.doi || quyen.chungNhan) && (
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {thaoTac(g)}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
      <RankDialog
        key={khoaMo(mo)}
        mo={mo}
        dong={() => setMo(null)}
        homNay={du.homNay}
        quyen={quyen}
      />
    </>
  );
}
