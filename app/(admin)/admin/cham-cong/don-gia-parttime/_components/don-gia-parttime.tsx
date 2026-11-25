"use client";
// Danh mục "Đơn giá Parttime" — bảng giá SR.QD.238 (chỉ đọc) + luật ca/tiết + chính sách hỗ trợ Trial theo ngày hiệu lực + các phiên bản
// chính sách. Nút "Đặt chính sách" chỉ vẽ khi trang báo `suaDuoc` (cùng `quyenDonGia` với action — luật 12). Dialog dùng chung với màn Rank.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { BTN_PRIMARY } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { TrangDonGia } from "@/lib/parttime/rank-don-gia-db";
import { RankDialog, dmy, khoaMo, type MoRank } from "@/app/(admin)/admin/teachers/rank/_components/rank-dialog";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const PILL = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";
const TH = "whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const H2 = "text-sm font-bold uppercase tracking-wider text-muted-foreground";

export function DonGiaParttime({ du, suaDuoc, coSo }: { du: TrangDonGia; suaDuoc: boolean; coSo: { id: string; nhan: string }[] }) {
  const [mo, setMo] = useState<MoRank>(null);
  const g = du.donGia?.thamSo;
  return (
    <div className="space-y-6">
      {/* 1 · Bảng giá */}
      <section aria-labelledby="bang-gia" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="bang-gia" className={H2}>
            Bảng đơn giá
          </h2>
          {du.donGia && (
            <p className="text-xs text-muted-foreground">
              Đang áp <b className="text-foreground">{du.donGia.banChinhSach}</b> · từ {dmy(du.donGia.hieuLucTu)} · chung mọi cơ sở
            </p>
          )}
        </div>
        {!g ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            Hôm nay không thuộc chính sách SR.QD.238 — buổi trước ngày hiệu lực tính theo cách cũ, không có bảng đơn giá theo tiết.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border">
              <PhanTrangBang tenDonVi="mức" khoaGhiNho="don-gia-parttime" soDongMacDinh={20} cuonNgang>
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className={TH}>Khoản</th>
                      <th className={cn(TH, "text-right")}>Đơn giá</th>
                      <th className={TH}>Đơn vị</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={3} className="whitespace-nowrap px-4 py-1.5 text-xs font-semibold text-muted-foreground">
                        Đứng chính — theo Rank của giáo viên tại ngày dạy
                      </td>
                    </tr>
                    {Object.entries(g.donGia.mainTheoRank)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([r, gia]) => (
                        <tr key={r} className="border-b border-border/60">
                          <td className="whitespace-nowrap px-4 py-2.5">
                            Rank {r}
                            {Number(r) === g.rankMacDinh && <span className={cn(PILL, "ml-2 bg-muted text-muted-foreground")}>mặc định nhân sự mới</span>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{vnd(gia)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">/ tiết</td>
                        </tr>
                      ))}
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={3} className="whitespace-nowrap px-4 py-1.5 text-xs font-semibold text-muted-foreground">
                        Không theo Rank
                      </td>
                    </tr>
                    {(
                      [
                        ["Trợ giảng", g.donGia.troGiang, "/ tiết"],
                        ["Trực vận hành — đủ ca", g.donGia.trucCa, "/ ca"],
                        ["Trực vận hành — nửa ca", g.donGia.nuaCaTruc, "/ nửa ca"],
                      ] as const
                    ).map(([a, b, c]) => (
                      <tr key={a} className="border-b border-border/60">
                        <td className="whitespace-nowrap px-4 py-2.5">{a}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{vnd(b)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PhanTrangBang>
            </div>

            <dl className="min-w-0 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-foreground">Một tiết</dt>
                <dd className="text-muted-foreground">
                  {g.tiet.chuanBiPhut}&prime; chuẩn bị + {g.tiet.dayPhut}&prime; dạy = {g.tiet.chuanPhut}&prime;. Buổi lệch chuẩn (60&prime;, 120&prime;…) chưa có ghi đè
                  được duyệt thì chưa tính tiền.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Ca</dt>
                <dd className="text-muted-foreground tabular-nums">
                  {g.ca.map((c) => `${c.ma} ${c.tu}–${c.den}`).join(" · ")} — tối đa {g.toiDaTietMoiCa} tiết mỗi ca.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Ca không trả chồng</dt>
                <dd className="text-muted-foreground">0 tiết + trực = đủ ca · 1 tiết + trực = nửa ca · từ 2 tiết = không còn tiền trực.</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {/* 2 · Hỗ trợ Trial */}
      <section aria-labelledby="ho-tro-trial" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="ho-tro-trial" className={H2}>
              Hỗ trợ Trial
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Trả theo <b className="text-foreground">học viên có mặt</b> ở buổi Trial, khi giáo viên có chứng nhận còn hiệu lực và được phân công trước giờ
              buổi. Bật / tắt theo ngày hiệu lực, không hồi tố — khác công tắc tiền Parttime.
            </p>
          </div>
          {suaDuoc && (
            <button type="button" className={BTN_PRIMARY} onClick={() => setMo({ loai: "chinh-sach" })}>
              Đặt chính sách
            </button>
          )}
        </div>

        <ul aria-label="Đang áp hôm nay" className="mb-4 flex flex-wrap gap-2">
          {du.trialHomNay.map((t) => (
            <li key={t.centerId} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <span className="font-medium text-foreground">{t.tenCoSo}</span>
              {t.chong ? (
                <span className={cn(PILL, "bg-state-danger-soft text-state-danger-ink")}>
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Chồng ngày — đang tính 0đ
                </span>
              ) : t.bat ? (
                <span className={cn(PILL, "bg-state-success-soft text-state-success-ink tabular-nums")}>{vnd(t.muc)} / HV</span>
              ) : (
                <span className={cn(PILL, "bg-muted text-muted-foreground")}>Tắt</span>
              )}
            </li>
          ))}
        </ul>

        {du.chinhSachTrial.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            Chưa có chính sách nào — mọi buổi Trial đang tính 0đ hỗ trợ.{suaDuoc ? " Bấm “Đặt chính sách” để bật từ một ngày." : ""}
          </p>
        ) : (
          <PhanTrangBang tenDonVi="dòng" khoaGhiNho="don-gia-trial" cuonNgang>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className={TH}>Phạm vi</th>
                  <th className={TH}>Trạng thái</th>
                  <th className={cn(TH, "text-right")}>Mức / HV</th>
                  <th className={TH}>Hiệu lực</th>
                  <th className={TH}>Căn cứ · người duyệt</th>
                </tr>
              </thead>
              <tbody>
                {du.chinhSachTrial.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {c.phamVi}
                      {c.dangAp && <span className={cn(PILL, "ml-2 bg-state-info-soft text-state-info-ink")}>đang áp</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={cn(PILL, c.enabled ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground")}>
                        {c.enabled ? "Bật" : "Tắt"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{vnd(c.amountPerStudent)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {dmy(c.effectiveFrom)} → {c.effectiveTo ? dmy(c.effectiveTo) : "nay"}
                    </td>
                    <td className="max-w-[20rem] px-4 py-2.5 text-xs text-muted-foreground">
                      <span className="block truncate" title={c.reason}>
                        {c.reason}
                      </span>
                      <span className="block truncate">{c.nguoiDuyet}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      {/* 3 · Phiên bản chính sách */}
      <section aria-labelledby="phien-ban" className="rounded-xl border border-border bg-card p-5">
        <h2 id="phien-ban" className={cn(H2, "mb-3")}>
          Phiên bản chính sách thù lao
        </h2>
        <ol className="divide-y divide-border text-sm">
          {du.phienBan.map((b) => (
            <li key={b.code} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0 truncate font-medium text-foreground">
                {b.code}
                {b.dangAp && <span className={cn(PILL, "ml-2 bg-state-success-soft text-state-success-ink")}>đang áp</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                {dmy(b.tu)} → {b.den ? dmy(b.den) : "nay"} · {b.laSrQd238 ? "theo tiết / ca (SR.QD.238)" : "cách tính cũ"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <RankDialog key={khoaMo(mo)} mo={mo} dong={() => setMo(null)} homNay={du.homNay} quyen={{ coSo }} />
    </div>
  );
}
