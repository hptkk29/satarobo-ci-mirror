"use client";
// Lưới phân công giáo viên — người × (S/C/T) × T2..CN. Ô = mã SUY RA (không nhập tay); bấm ô ⇒ ngăn chi tiết (kế hoạch, thực tế,
// nguồn, tiền dự kiến từng dòng). Màn CHỈ ĐỌC ở bản này — trực / trợ giảng / dạy thay vẫn thao tác ở "Phân công buổi" và module nguồn.
// Màu không bao giờ là kênh duy nhất: mỗi trạng thái có chữ (nhãn) đi kèm.
import { useState } from "react";
import Link from "next/link";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { LuoiTuan } from "@/lib/parttime/luoi-tuan-db";
import type { CanhBaoO, HoatDongHien, OLuoi } from "@/lib/parttime/luoi-tuan-ghep";
import type { LyDoTrial } from "@/lib/parttime/luoi-tuan";
import { QuyetTrucBu } from "./quyet-truc-bu";
import { canhBaoTrongNgan, maKeHoach, nhanTruyCap } from "@/lib/parttime/nhan-o-luoi";
import { LuongTuanGv } from "./luong-tuan-gv";
import { NHAN_NGUON_DIEU_CHINH, lyDoHienThi, type DieuChinh } from "@/lib/parttime/ly-do-dieu-chinh";
import type { TrucDaHuy } from "@/lib/parttime/ly-do-dieu-chinh-db";

const THU = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const TEN_CA: Record<string, string> = { S: "Sáng", C: "Chiều", T: "Tối" };
const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

const NHAN_LOAI: Record<HoatDongHien["loai"], string> = {
  REGULAR: "Lớp cố định",
  MAKEUP: "Học bù",
  ADVANCE: "Học vượt",
  SUBSTITUTE: "Dạy thay",
  TRIAL: "Trial",
};
const MAU_LOAI: Record<HoatDongHien["loai"], string> = {
  REGULAR: "bg-muted text-foreground",
  MAKEUP: "bg-state-info-soft text-state-info-ink",
  ADVANCE: "bg-state-info-soft text-state-info-ink",
  SUBSTITUTE: "bg-state-warning-soft text-state-warning-ink",
  TRIAL: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
};
const NHAN_CANH_BAO: Record<CanhBaoO, string> = {
  NGHI_DA_DUYET: "GV có đơn nghỉ đã duyệt hôm nay nhưng vẫn còn buổi — cần đề nghị dạy thay",
  TRUNG_GIO: "Trùng giờ với một buổi khác",
  O_CO_SO_KHAC: "Cùng ca có việc ở cơ sở khác",
  LEGACY: "Ngày trước SR.QD.238 — không tính mã / tiền",
  CHUA_NHAN: "Có phân công chưa nhận",
  POLICY_UNRESOLVED: "Buổi lệch chuẩn (60/120 phút) chưa có ghi đè — chưa tính tiền",
  TRUC_CHUA_TINH_DUOC: "Tiền trực chưa tính được (buổi lệch chuẩn trong ca)",
  QUA_SO_TIET: "Quá số tiết tối đa một ca",
  CAN_QUYET_TRUC: "Có buổi học bù trong ca đang trực — chưa quyết GV còn trực phần còn lại không (T → TD hay D)",
};
const NHAN_TRIAL: Record<LyDoTrial, string> = {
  TRIAL_POLICY_DISABLED: "Chính sách hỗ trợ Trial chưa bật tại ngày này",
  CERTIFICATE_MISSING: "GV chưa có chứng nhận Trial còn hiệu lực",
  NOT_ASSIGNED_BEFORE_SESSION: "Không được phân công trước giờ buổi",
  TRIAL_TEACHER_MISMATCH: "GV trên buổi khác người được phân công — cần xem tay",
  CASE_CANCELLED: "Buổi đã huỷ",
  STUDENT_ABSENT: "Học viên vắng",
  ATTENDANCE_PENDING: "Còn học viên chưa điểm danh",
  DUPLICATE_CLAIM: "Có học viên bị tính trùng",
};
const NHAN_DONG = { MAIN: "Đứng chính", TA: "Trợ giảng", TRUC: "Trực vận hành", TRIAL: "Hỗ trợ Trial" } as const;

function lienKetNguon(h: HoatDongHien, lopTrial: Record<string, string>): string | null {
  if (h.sourceType === "CLASS_SESSION") return `/attendance?sessionId=${encodeURIComponent(h.sourceId)}`;
  if (h.sourceType === "MAKEUP_CASE") return `/hoc-bu/case/${encodeURIComponent(h.sourceId)}`;
  const lop = lopTrial[h.sourceId];
  return lop ? `/lop-trial/${encodeURIComponent(lop)}` : null;
}

function MaO({ o }: { o: OLuoi }) {
  if (!o.ke) {
    return o.hoatDong.length || o.trucId ? <span className="text-xs text-muted-foreground">cũ</span> : <span className="text-muted-foreground/60">·</span>;
  }
  const ma = o.ke.ma ?? "?";
  const loi = o.canhBao.some((c) => c === "TRUNG_GIO" || c === "QUA_SO_TIET" || c === "POLICY_UNRESOLVED" || c === "NGHI_DA_DUYET");
  const cho = o.canhBao.includes("CHUA_NHAN");
  // PR6: trực + học bù chưa quyết — mã chỉ phần chắc chắn (D) + dấu "?" bằng CHỮ để không phụ thuộc màu.
  const choTruc = o.canhBao.includes("CAN_QUYET_TRUC");
  if (ma === "X" && !o.ke.coTrial) return <span className="text-muted-foreground/60">X</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
          loi ? "bg-state-danger-soft text-state-danger-ink" : cho || choTruc ? "bg-state-warning-soft text-state-warning-ink" : "bg-state-success-soft text-state-success-ink",
        )}
        title={choTruc ? "Có học bù trong ca trực — chưa quyết GV còn trực phần còn lại không" : undefined}
      >
        {ma}
        {choTruc && <span aria-label="chờ quyết định trực">+T?</span>}
      </span>
      {o.ke.coTrial && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">+TR</span>}
    </span>
  );
}

type Chon = { dong: LuoiTuan["dong"][number]; ngay: string; ca: string; o: OLuoi } | null;

/** `quyetTrucDuoc`: người xem phân công được ở cơ sở này + công tắc phân công bật (trang quyết — luật 12). BẮT BUỘC (luật 7). */
export function LuoiGv({
  luoi,
  lopTrialCuaBuoi,
  quyetTrucDuoc,
  dieuChinh,
  trucDaHuy,
  bangChung,
  homNay,
  tienBat,
}: {
  luoi: LuoiTuan;
  lopTrialCuaBuoi: Record<string, string>;
  quyetTrucDuoc: boolean;
  /** PR7: assignmentId / dutyId → điều chỉnh có nguồn. BẮT BUỘC (luật 7). */
  dieuChinh: Record<string, DieuChinh[]>;
  trucDaHuy: TrucDaHuy[];
  /** PR8: assignmentId → nhãn bằng chứng chấm công + có lượt chấm thật không. BẮT BUỘC (luật 7). */
  bangChung: Record<string, { nhan: string; coMat: boolean }>;
  /** "YYYY-MM-DD" — chế độ Theo ngày mở đúng hôm nay khi tuần đang xem chứa hôm nay. */
  homNay: string;
  /** Công tắc tiền (COMPENSATION) của cơ sở — ngăn lương tuần nói đúng trạng thái. BẮT BUỘC (luật 7). */
  tienBat: boolean;
}) {
  const [chon, setChon] = useState<Chon>(null);
  // PR8: điện thoại mặc định xem THEO NGÀY (danh sách theo ca); bấm "Cả tuần" để xem lưới. Máy tính luôn thấy lưới (CSS, không đo màn).
  const [cheDo, setCheDo] = useState<"ngay" | "tuan">("ngay");
  const [ngayXem, setNgayXem] = useState(luoi.ngays.includes(homNay) ? homNay : luoi.ngays[0]!);
  const [luongTuan, setLuongTuan] = useState<LuoiTuan["dong"][number] | null>(null);
  const caCuaNgay = (d: LuoiTuan["dong"][number], ngay: string) => Object.keys(d.o[ngay] ?? { S: 0, C: 0, T: 0 });

  if (luoi.dong.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Tuần này chưa có giáo viên nào được phân buổi dạy hay ca trực ở cơ sở này.
      </p>
    );
  }

  return (
    <>
      <div role="group" aria-label="Cách xem" className="mb-3 inline-flex rounded-lg border border-border bg-card p-0.5 sm:hidden">
        {(
          [
            ["ngay", "Theo ngày"],
            ["tuan", "Cả tuần"],
          ] as const
        ).map(([k, nhan]) => (
          <button
            key={k}
            type="button"
            aria-pressed={cheDo === k}
            onClick={() => setCheDo(k)}
            className={cn("min-h-10 rounded-md px-4 text-sm font-medium transition-colors", cheDo === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {nhan}
          </button>
        ))}
      </div>

      {cheDo === "ngay" && (
        <XemTheoNgay luoi={luoi} ngay={ngayXem} setNgay={setNgayXem} onChon={(dong, ca, o) => setChon({ dong, ngay: ngayXem, ca, o })} />
      )}

      <div className={cn("overflow-x-auto rounded-xl border border-border bg-card", cheDo === "ngay" && "hidden sm:block")}>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 w-28 bg-muted/40 px-2 py-2 text-left font-medium sm:w-44 sm:px-3">Giáo viên</th>
              <th className="w-10 px-1 py-2 text-left font-medium">Ca</th>
              {luoi.ngays.map((n, i) => (
                <th key={n} className="px-1 py-2 text-center font-medium">
                  {THU[i]} <span className="tabular-nums">{dm(n)}</span>
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Tuần</th>
            </tr>
          </thead>
          <tbody>
            {luoi.dong.map((d) => {
              const caS = caCuaNgay(d, luoi.ngays[0]!);
              return [
                ...caS.map((ca, k) => (
                  <tr key={`${d.userId}-${ca}`} className={cn(k === 0 && "border-t border-border")}>
                    {k === 0 && (
                      <td rowSpan={caS.length + 1} className="sticky left-0 z-10 w-28 bg-card px-2 py-2 align-top break-words sm:w-44 sm:px-3">
                        <div className="font-medium text-foreground">{d.ten}</div>
                        {d.laMuon && (
                          <div className="mt-0.5 inline-block rounded bg-state-info-soft px-1.5 text-[11px] font-medium text-state-info-ink">
                            GV {d.tenCoSoGoc ?? "cơ sở khác"}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-1 py-1 text-xs font-semibold text-muted-foreground" title={TEN_CA[ca] ?? ca}>
                      {ca}
                    </td>
                    {luoi.ngays.map((ngay) => {
                      const o = d.o[ngay]?.[ca];
                      if (!o) return <td key={ngay} />;
                      const coViec = o.hoatDong.length > 0 || o.trucId != null;
                      return (
                        <td key={ngay} className="px-0.5 py-0.5 text-center">
                          {coViec ? (
                            <button
                              type="button"
                              onClick={() => setChon({ dong: d, ngay, ca, o })}
                              className="inline-flex min-h-8 w-full items-center justify-center rounded-md px-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                              aria-label={`${d.ten} — ${dm(ngay)} ca ${TEN_CA[ca] ?? ca}: ${nhanTruyCap(o)}`}
                            >
                              <MaO o={o} />
                            </button>
                          ) : (
                            <span className="text-muted-foreground/40">·</span>
                          )}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                )),
                <tr key={`${d.userId}-tien`} className="border-b border-border/60 bg-muted/20 text-xs">
                  <td className="px-1 py-1 text-muted-foreground">Lương ngày</td>
                  {luoi.ngays.map((ngay) => (
                    <td key={ngay} className="px-1 py-1 text-center tabular-nums text-muted-foreground">
                      {d.tongNgay[ngay] ? vnd(d.tongNgay[ngay]!) : "—"}
                      {(d.ngoaiCa[ngay]?.length ?? 0) > 0 && (
                        <div className="text-state-danger-ink" title="Có buổi không nằm trọn trong ca nào">
                          {d.ngoaiCa[ngay]!.length} buổi vượt ca
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => setLuongTuan(d)}
                      className="rounded-md px-1.5 py-1 font-semibold tabular-nums text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Lương tuần của ${d.ten}: ${vnd(d.tongTuan)} — xem theo khoản`}
                    >
                      {vnd(d.tongTuan)}
                    </button>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>

      <LuongTuanGv dong={luongTuan} nhanTuan={`Tuần ${dm(luoi.ngays[0]!)} – ${dm(luoi.ngays[luoi.ngays.length - 1]!)}`} tienBat={tienBat} onDong={() => setLuongTuan(null)} />

      <Sheet open={chon != null} onOpenChange={(v) => !v && setChon(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {chon && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {chon.dong.ten} · {dm(chon.ngay)} · ca {TEN_CA[chon.ca] ?? chon.ca}
                </SheetTitle>
                <SheetDescription>
                  {chon.dong.laMuon ? `GV ${chon.dong.tenCoSoGoc ?? "cơ sở khác"} · ` : ""}
                  Rank {chon.dong.rankTheoNgay[chon.ngay] ?? "—"} tại ngày này. Mã và tiền là DỰ KIẾN, suy từ phân công — chưa phải công.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                {(() => {
                  const coBc = chon.o.hoatDong.filter((h) => bangChung[h.id]?.coMat).length;
                  return (
                    <dl className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-border p-2">
                        <dt className="text-xs text-muted-foreground">Kế hoạch</dt>
                        <dd className="text-lg font-bold">{maKeHoach(chon.o)}</dd>
                      </div>
                      <div className="rounded-lg border border-border p-2">
                        <dt className="text-xs text-muted-foreground">Có chấm công</dt>
                        <dd className="text-sm font-semibold">{chon.o.hoatDong.length ? `${coBc}/${chon.o.hoatDong.length} buổi` : "—"}</dd>
                      </div>
                      <div className="rounded-lg border border-border p-2">
                        <dt className="text-xs text-muted-foreground">Đã xác nhận</dt>
                        <dd className="text-lg font-bold">{chon.o.thucTe ? (chon.o.thucTe.ma ?? "?") : "—"}</dd>
                      </div>
                    </dl>
                  );
                })()}
                {!chon.o.thucTe && (
                  <p className="-mt-2 text-xs text-muted-foreground">Chưa có đơn vị nào được quản lý xác nhận — tiền trực / dạy chỉ trả theo đơn vị đã xác nhận, không theo mã kế hoạch.</p>
                )}

                {quyetTrucDuoc && chon.o.canhBao.includes("CAN_QUYET_TRUC") && (
                  <QuyetTrucBu
                    shiftLabel={TEN_CA[chon.ca] ?? chon.ca}
                    buoi={chon.o.hoatDong.filter((h) => h.loai === "MAKEUP" && h.vai === "MAIN").map((h) => ({ caseId: h.sourceId, gio: `${h.gioBatDau}–${h.gioKetThuc}` }))}
                    onXong={() => setChon(null)}
                  />
                )}

                {canhBaoTrongNgan(chon.o.canhBao, quyetTrucDuoc).length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-2 text-state-warning-ink">
                    {canhBaoTrongNgan(chon.o.canhBao, quyetTrucDuoc).map((c) => (
                      <li key={c}>• {NHAN_CANH_BAO[c]}</li>
                    ))}
                  </ul>
                )}

                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Việc trong ca</h3>
                  <ul className="space-y-2">
                    {chon.o.hoatDong.map((h) => {
                      const href = lienKetNguon(h, lopTrialCuaBuoi);
                      return (
                        <li key={h.id} className="rounded-lg border border-border p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", MAU_LOAI[h.loai])}>{NHAN_LOAI[h.loai]}</span>
                            <span className="text-xs">{h.vai === "MAIN" ? "Đứng chính" : "Trợ giảng"}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {h.gioBatDau}–{h.gioKetThuc}
                            </span>
                            <span className={cn("rounded px-1.5 text-[11px]", h.daGan ? "bg-state-success-soft text-state-success-ink" : "bg-state-warning-soft text-state-warning-ink")}>
                              {h.daGan ? "Đã gán" : "Chưa nhận"}
                            </span>
                          </div>
                          {bangChung[h.id] && (
                            <div className="mt-1 text-xs">
                              Bằng chứng chấm công: <b>{bangChung[h.id]!.nhan}</b>
                            </div>
                          )}
                          <div className="mt-1 text-xs text-muted-foreground">
                            Đồng bộ từ {h.sourceType === "CLASS_SESSION" ? "lớp chính thức" : h.sourceType === "MAKEUP_CASE" ? "học bù" : "Trial"}
                            {href && (
                              <>
                                {" · "}
                                <Link href={href} className="font-medium text-primary hover:underline">
                                  Mở nguồn
                                </Link>
                              </>
                            )}
                          </div>
                          {h.trial && (
                            <div className="mt-1 text-xs">
                              Hỗ trợ Trial: <b className="tabular-nums">{vnd(h.trial.soTien)}</b> · {h.trial.soCoMat} HV có mặt
                              {h.trial.lyDo.length > 0 && (
                                <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
                                  {h.trial.lyDo.map((l) => (
                                    <li key={l}>{NHAN_TRIAL[l]}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {chon.o.trucId && (
                      <li className="rounded-lg border border-border p-2 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Trực vận hành</span> — có phân công trực tường minh cho ca này
                      </li>
                    )}
                  </ul>
                </section>

                <DieuChinhO
                  ds={[
                    ...[...chon.o.hoatDong.map((h) => h.id), ...(chon.o.trucId ? [chon.o.trucId] : [])].flatMap((id) => dieuChinh[id] ?? []),
                    ...trucDaHuy.filter((t) => t.userId === chon.dong.userId && t.ngay === chon.ngay && t.shiftCode === chon.ca).flatMap((t) => t.dieuChinh),
                  ]}
                />

                {chon.o.ke && (
                  <section>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lương dự kiến</h3>
                    <table className="w-full text-xs">
                      <tbody>
                        {chon.o.ke.dong.map((d, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="py-1">{NHAN_DONG[d.loai]}</td>
                            <td className="py-1 text-right tabular-nums text-muted-foreground">
                              {d.loai === "TRIAL" ? "" : `${d.soLuong} × ${vnd(d.donGia)}`}
                            </td>
                            <td className="py-1 text-right font-medium tabular-nums">{d.thanhTien == null ? "chưa tính" : vnd(d.thanhTien)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-1 font-semibold">Tổng ca</td>
                          <td />
                          <td className="py-1 text-right font-bold tabular-nums">{vnd(chon.o.ke.tong)}</td>
                        </tr>
                      </tbody>
                    </table>
                    {chon.o.thucTe && chon.o.thucTe.tong !== chon.o.ke.tong && (
                      <p className="mt-1 text-xs text-state-warning-ink">
                        Thực tế đã xác nhận {vnd(chon.o.thucTe.tong)} khác dự kiến — xem đối soát ở Công parttime tháng.
                      </p>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

const lucNgan = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};

/** PR7: điều chỉnh của ô — chỉ hiện khi có; mỗi dòng nói nguồn, lý do thật (hoặc "không có dữ liệu lịch sử"), ai, lúc nào, trước → sau. */
function DieuChinhO({ ds }: { ds: DieuChinh[] }) {
  if (ds.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vì sao khác kế hoạch ban đầu</h3>
      <ul className="space-y-1.5">
        {ds.map((d) => (
          <li key={`${d.nguon}:${d.maThamChieu}`} className="rounded-lg border border-border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{NHAN_NGUON_DIEU_CHINH[d.nguon]}</span>
              {d.truocSau && <span className="text-muted-foreground">{d.truocSau}</span>}
            </div>
            <p className="mt-1 text-foreground">{lyDoHienThi(d)}</p>
            {(d.nguoiYeuCau || d.luc) && (
              <p className="mt-0.5 text-muted-foreground">
                {d.nguoiYeuCau ?? ""}
                {d.nguoiDuyet && d.nguoiDuyet !== d.nguoiYeuCau ? ` · duyệt: ${d.nguoiDuyet}` : ""}
                {d.luc ? ` · ${lucNgan(d.luc)}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * PR8: điện thoại xem THEO NGÀY — chọn ngày ở hàng chip, mỗi giáo viên một thẻ với ba dòng S/C/T của ngày đó + lương ngày. Bấm một dòng có việc ⇒
 * cùng ngăn chi tiết như lưới. Không ép lưới 7 cột xuống 375px.
 */
function XemTheoNgay({
  luoi,
  ngay,
  setNgay,
  onChon,
}: {
  luoi: LuoiTuan;
  ngay: string;
  setNgay: (n: string) => void;
  onChon: (dong: LuoiTuan["dong"][number], ca: string, o: OLuoi) => void;
}) {
  const coViec = (o: OLuoi | undefined) => o != null && (o.hoatDong.length > 0 || o.trucId != null);
  const nguoi = luoi.dong.filter((d) => Object.values(d.o[ngay] ?? {}).some(coViec));
  return (
    <div className="mb-4 space-y-3 sm:hidden">
      <div role="tablist" aria-label="Chọn ngày" className="grid grid-cols-7 gap-1">
        {luoi.ngays.map((n, i) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === ngay}
            onClick={() => setNgay(n)}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center rounded-lg border text-[11px] leading-tight transition-colors",
              n === ngay ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
            )}
          >
            <span className="font-semibold">{THU[i]}</span>
            <span className="tabular-nums">{dm(n)}</span>
          </button>
        ))}
      </div>
      {nguoi.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Ngày này không có giáo viên nào có buổi dạy hay ca trực.</p>
      ) : (
        nguoi.map((d) => (
          <section key={d.userId} className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
                {d.ten}
                {d.laMuon && <span className="ml-1.5 rounded bg-state-info-soft px-1.5 text-[11px] font-medium text-state-info-ink">GV {d.tenCoSoGoc ?? "cơ sở khác"}</span>}
              </h3>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{d.tongNgay[ngay] ? vnd(d.tongNgay[ngay]!) : "—"}</span>
            </div>
            <ul className="divide-y divide-border">
              {Object.entries(d.o[ngay] ?? {}).map(([ca, o]) => (
                <li key={ca}>
                  {coViec(o) ? (
                    <button
                      type="button"
                      onClick={() => onChon(d, ca, o)}
                      className="flex min-h-11 w-full items-center gap-3 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">{TEN_CA[ca] ?? ca}</span>
                      <span className="shrink-0">
                        <MaO o={o} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {o.hoatDong.map((h) => (h.loai === "REGULAR" ? `${h.gioBatDau}–${h.gioKetThuc}` : `${h.gioBatDau}–${h.gioKetThuc} ${NHAN_LOAI[h.loai]}`)).join(" · ") || "Trực"}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums">{o.ke ? vnd(o.ke.tong) : ""}</span>
                    </button>
                  ) : (
                    <div className="flex min-h-9 items-center gap-3 py-1 text-xs text-muted-foreground/70">
                      <span className="w-12 shrink-0 font-semibold">{TEN_CA[ca] ?? ca}</span>
                      <span>Không có việc</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
