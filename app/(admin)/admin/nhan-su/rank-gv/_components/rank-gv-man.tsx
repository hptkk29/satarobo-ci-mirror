"use client";
// Màn "Rank & Đơn giá giáo viên" — ba tab. Nút chỉ vẽ khi người xem CÓ quyền làm (trang truyền cờ — luật 12); action kiểm lại ở server.
// Mọi thay đổi có hiệu lực từ ngày chọn (≥ hôm nay) — không hồi tố; màn nói rõ điều đó ở từng form.
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { DongRankGv, TrangRankDonGia } from "@/lib/parttime/rank-don-gia-db";
import { capChungNhanAction, datChinhSachTrialAction, deXuatRankAction, quyetRankAction, thuHoiChungNhanAction } from "../_actions";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const dmy = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "—");
const TRANG_THAI: Record<string, { nhan: string; cls: string }> = {
  PROPOSED: { nhan: "Chờ duyệt", cls: "bg-state-warning-soft text-state-warning-ink" },
  APPROVED: { nhan: "Đã duyệt", cls: "bg-state-success-soft text-state-success-ink" },
  REJECTED: { nhan: "Từ chối", cls: "bg-state-danger-soft text-state-danger-ink" },
  CANCELLED: { nhan: "Huỷ", cls: "bg-muted text-muted-foreground" },
};
const TAB = [
  { k: "rank", nhan: "Rank giáo viên" },
  { k: "don-gia", nhan: "Bảng đơn giá" },
  { k: "trial", nhan: "Hỗ trợ Trial" },
] as const;
type MaTab = (typeof TAB)[number]["k"];

export type QuyenMan = {
  /** id cơ sở → được đề xuất Rank ở đó. */
  deXuatTai: string[];
  duyet: boolean;
  chungNhan: boolean;
  chinhSach: boolean;
  /** Danh sách cơ sở (id, nhãn) trong phạm vi xem — cho form đề xuất / chính sách. */
  coSo: { id: string; nhan: string }[];
  toi: string;
};

type Mo =
  | { loai: "de-xuat"; gv: DongRankGv }
  | { loai: "quyet"; gv: DongRankGv; duyet: boolean }
  | { loai: "cap"; gv: DongRankGv }
  | { loai: "thu-hoi"; gv: DongRankGv }
  | { loai: "chinh-sach" }
  | null;

export function RankGvMan({ du, quyen, tab: tabDau }: { du: TrangRankDonGia; quyen: QuyenMan; tab: MaTab }) {
  const [tab, setTab] = useState<MaTab>(tabDau);
  const [mo, setMo] = useState<Mo>(null);
  return (
    <>
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TAB.map((t) => (
          <button
            key={t.k}
            role="tab"
            type="button"
            aria-selected={tab === t.k}
            onClick={() => setTab(t.k)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.nhan}
          </button>
        ))}
      </div>
      {tab === "rank" && <TabRank du={du} quyen={quyen} setMo={setMo} />}
      {tab === "don-gia" && <TabDonGia du={du} />}
      {tab === "trial" && <TabTrial du={du} quyen={quyen} setMo={setMo} />}
      {/* key: mỗi lần mở là form MỚI — không mang ô đã gõ của giáo viên trước sang giáo viên sau. */}
      <Form key={mo ? `${mo.loai}:${"gv" in mo ? mo.gv.userId : "cs"}` : "dong"} mo={mo} dong={() => setMo(null)} du={du} quyen={quyen} />
    </>
  );
}

function TabRank({ du, quyen, setMo }: { du: TrangRankDonGia; quyen: QuyenMan; setMo: (m: Mo) => void }) {
  return (
    <div className="space-y-6">
      <section>
        <p className="mb-2 text-sm text-muted-foreground">
          SR.QD.238 §3: Quản lý cơ sở <b>đề xuất</b>, Ban lãnh đạo <b>duyệt</b>. Nhân sự mới mặc định Rank 1. Đổi Rank có hiệu lực từ ngày duyệt ghi —
          tiết đã dạy trước ngày đó giữ Rank cũ.
        </p>
        {du.giaoVien.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Chưa có giáo viên nào trong phạm vi bạn xem.</p>
        ) : (
          <PhanTrangBang tenDonVi="giáo viên" khoaGhiNho="rank-gv" cuonNgang>
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Giáo viên</th>
                  <th className="px-3 py-2 font-medium">Cơ sở gốc · tham gia</th>
                  <th className="px-3 py-2 font-medium">Rank hiện tại</th>
                  <th className="px-3 py-2 font-medium">Đề xuất</th>
                  <th className="px-3 py-2 font-medium">Chứng nhận Trial</th>
                  <th className="px-3 py-2 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {du.giaoVien.map((g) => {
                  // Chỉ khi đề xuất được ở ÍT NHẤT một cơ sở CỦA CHÍNH GV này (action kiểm cùng điều kiện — luật 12).
                  const deXuatDuoc = g.deXuatDangCho == null && g.coSoIds.some((c) => quyen.deXuatTai.includes(c));
                  const dx = g.deXuatDangCho;
                  return (
                    <tr key={g.userId} className="border-b border-border/60 align-top">
                      <td className="px-3 py-2 font-medium text-foreground">{g.ten}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {g.coSoGoc ?? "—"} · {g.coSo.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold">R{g.rank}</span>{" "}
                        <span className="text-xs text-muted-foreground">{g.nguonRank === "MAC_DINH" ? "mặc định" : `từ ${dmy(g.rankTuNgay)}`}</span>
                        {g.rankSapToi && (
                          <div className="text-xs text-state-info-ink">
                            → R{g.rankSapToi.rank} từ {dmy(g.rankSapToi.tuNgay)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {dx ? (
                          <div>
                            <span className={cn("rounded px-1.5 py-0.5 font-semibold", TRANG_THAI.PROPOSED!.cls)}>R{dx.proposedRank} · chờ duyệt</span>
                            <div className="mt-1 text-muted-foreground">
                              từ {dmy(dx.effectiveFrom)} · {dx.nguoiDeXuat}
                            </div>
                            <div className="mt-0.5 max-w-[16rem] text-muted-foreground">{dx.basis}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {g.chungNhan ? (
                          <div>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-semibold",
                                g.chungNhan.hieuLucHomNay ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {g.chungNhan.hieuLucHomNay ? "Đang hiệu lực" : g.chungNhan.daThuHoi ? "Đã thu hồi" : g.chungNhan.tuNgay > du.homNay ? "Chưa tới ngày" : "Hết hiệu lực"}
                            </span>
                            <div className="mt-1 text-muted-foreground">
                              {g.chungNhan.code ? `${g.chungNhan.code} · ` : ""}
                              {dmy(g.chungNhan.tuNgay)} → {g.chungNhan.denNgay ? dmy(g.chungNhan.denNgay) : "không thời hạn"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Chưa có</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {deXuatDuoc && (
                            <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "de-xuat", gv: g })}>
                              Đề xuất Rank
                            </button>
                          )}
                          {dx && quyen.duyet && dx.proposedById !== quyen.toi && (
                            <>
                              <button type="button" className={BTN_PRIMARY} onClick={() => setMo({ loai: "quyet", gv: g, duyet: true })}>
                                Duyệt
                              </button>
                              <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "quyet", gv: g, duyet: false })}>
                                Từ chối
                              </button>
                            </>
                          )}
                          {quyen.chungNhan && !g.chungNhan?.hieuLucHomNay && !(g.chungNhan && !g.chungNhan.daThuHoi && g.chungNhan.tuNgay > du.homNay) && (
                            <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "cap", gv: g })}>
                              Cấp chứng nhận
                            </button>
                          )}
                          {quyen.chungNhan && g.chungNhan && !g.chungNhan.daThuHoi && (g.chungNhan.denNgay == null || g.chungNhan.denNgay >= du.homNay) && (
                            <button type="button" className={BTN_OUTLINE} onClick={() => setMo({ loai: "thu-hoi", gv: g })}>
                              Thu hồi
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Lịch sử đề xuất</h2>
        {du.lichSuDeXuat.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đề xuất nào.</p>
        ) : (
          <PhanTrangBang tenDonVi="đề xuất" khoaGhiNho="rank-gv-lich-su" cuonNgang>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Giáo viên</th>
                  <th className="px-3 py-2 font-medium">Rank</th>
                  <th className="px-3 py-2 font-medium">Hiệu lực từ</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Người quyết · ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {du.lichSuDeXuat.map((d) => (
                  <tr key={d.id} className="border-b border-border/60">
                    <td className="px-3 py-2">{d.ten}</td>
                    <td className="px-3 py-2 tabular-nums">
                      R{d.currentRank} → R{d.proposedRank}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{dmy(d.effectiveFrom)}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", TRANG_THAI[d.status]?.cls)}>{TRANG_THAI[d.status]?.nhan ?? d.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {d.nguoiQuyet ? `${d.nguoiQuyet} · ${dmy(d.decidedAt)}` : "—"}
                      {d.decisionNote ? ` · ${d.decisionNote}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>
    </div>
  );
}

function TabDonGia({ du }: { du: TrangRankDonGia }) {
  if (!du.donGia) return <p className="text-sm text-muted-foreground">Hôm nay không thuộc chính sách SR.QD.238 — không có bảng đơn giá.</p>;
  const g = du.donGia.thamSo.donGia;
  const dong: [string, string, string][] = [
    ...["1", "2", "3", "4"].map((r): [string, string, string] => [`Đứng chính — Rank ${r}`, vnd(g.mainTheoRank[r] ?? 0), "/ tiết"]),
    ["Trợ giảng (không theo Rank)", vnd(g.troGiang), "/ tiết"],
    ["Trực vận hành — đủ ca", vnd(g.trucCa), "/ ca"],
    ["Trực vận hành — nửa ca (ca có 1 tiết)", vnd(g.nuaCaTruc), "/ nửa ca"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Theo <b>{du.donGia.banChinhSach}</b>, hiệu lực từ {dmy(du.donGia.hieuLucTu)}. Đơn giá chung mọi cơ sở — chưa có chính sách riêng theo cơ sở. Đổi đơn giá
        cần chính sách mới (phiên bản + ngày hiệu lực), không sửa ở màn này.
      </p>
      <div className="max-w-xl overflow-hidden rounded-xl border border-border">
        <PhanTrangBang tenDonVi="mức" khoaGhiNho="rank-gv-don-gia" soDongMacDinh={20} cuonNgang>
          <table className="w-full text-sm">
            <tbody>
              {dong.map(([a, b, c]) => (
                <tr key={a} className="border-b border-border/60">
                  <td className="px-3 py-2">{a}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{b}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c}</td>
                </tr>
              ))}
              {du.trialHomNay.map((t) => (
                <tr key={t.centerId} className="border-b border-border/60">
                  <td className="px-3 py-2">Hỗ trợ Trial — {t.tenCoSo}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{t.bat ? vnd(t.muc) : "Chưa bật"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.bat ? "/ học viên có mặt" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
      <p className="text-xs text-muted-foreground">
        Ca không trả chồng: 0 tiết + trực = cả ca · 1 tiết + trực = nửa ca · từ 2 tiết = 0 tiền trực. Đây là đơn giá — tiền thật chỉ tính khi quản lý xác nhận
        công, và công tắc tiền Parttime hiện đang tắt.{" "}
        <Link href="/cham-cong/phan-cong-gv" className="font-medium text-primary hover:underline">
          Xem lương dự kiến trên lưới
        </Link>
      </p>
    </div>
  );
}

function TabTrial({ du, quyen, setMo }: { du: TrangRankDonGia; quyen: QuyenMan; setMo: (m: Mo) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          SR.QD.238 §6: hỗ trợ Trial theo <b>học viên có mặt</b>, khi giáo viên có chứng nhận Trial còn hiệu lực và được phân công trước giờ buổi. Công tắc dưới đây
          bật / tắt khoản này theo ngày hiệu lực — <b>không</b> phải công tắc tiền Parttime, không hồi tố buổi đã qua.
        </p>
        {quyen.chinhSach && (
          <button type="button" className={BTN_PRIMARY} onClick={() => setMo({ loai: "chinh-sach" })}>
            Đặt chính sách mới
          </button>
        )}
      </div>
      {du.chinhSachTrial.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Chưa có chính sách hỗ trợ Trial nào — mọi buổi Trial tính 0đ hỗ trợ (lý do: chính sách chưa bật).
        </p>
      ) : (
        <PhanTrangBang tenDonVi="dòng" khoaGhiNho="rank-gv-trial" cuonNgang>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Phạm vi</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 text-right font-medium">Mức / HV</th>
                <th className="px-3 py-2 font-medium">Hiệu lực</th>
                <th className="px-3 py-2 font-medium">Lý do · người duyệt</th>
              </tr>
            </thead>
            <tbody>
              {du.chinhSachTrial.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="px-3 py-2">{c.phamVi}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", c.enabled ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground")}>
                      {c.enabled ? "Bật" : "Tắt"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{vnd(c.amountPerStudent)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {dmy(c.effectiveFrom)} → {c.effectiveTo ? dmy(c.effectiveTo) : "nay"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.reason} · {c.nguoiDuyet}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </div>
  );
}

function Form({ mo, dong, du, quyen }: { mo: Mo; dong: () => void; du: TrangRankDonGia; quyen: QuyenMan }) {
  const [dang, start] = useTransition();
  // Đề xuất: GV chỉ thuộc MỘT cơ sở người xem đề xuất được ⇒ chọn sẵn cơ sở đó.
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => {
    if (mo?.loai !== "de-xuat") return {};
    const duoc = mo.gv.coSoIds.filter((c) => quyen.deXuatTai.includes(c));
    return duoc.length === 1 ? { coSo: duoc[0]! } : {};
  });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gui = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        setF({});
        dong();
      } else toast.error(r.error);
    });
  if (!mo) return null;
  const tieuDe =
    mo.loai === "de-xuat"
      ? `Đề xuất Rank — ${mo.gv.ten}`
      : mo.loai === "quyet"
        ? `${mo.duyet ? "Duyệt" : "Từ chối"} đề xuất Rank — ${mo.gv.ten}`
        : mo.loai === "cap"
          ? `Cấp chứng nhận Trial — ${mo.gv.ten}`
          : mo.loai === "thu-hoi"
            ? `Thu hồi chứng nhận Trial — ${mo.gv.ten}`
            : "Đặt chính sách hỗ trợ Trial";
  const NHAN = "mb-1 block text-sm font-semibold text-foreground";
  return (
    <Dialog open onOpenChange={(v) => !v && dong()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          <DialogDescription>Có hiệu lực từ ngày chọn (không trước hôm nay {dmy(du.homNay)}) — không sửa ngày đã qua. Mọi thao tác ghi nhật ký.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {mo.loai === "de-xuat" && (
            <>
              <p>
                Rank hiện tại: <b>R{mo.gv.rank}</b>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={NHAN}>Rank đề xuất</span>
                  <select className={cn(FIELD, "w-full")} value={f.rank ?? ""} onChange={set("rank")}>
                    <option value="">— chọn —</option>
                    {[1, 2, 3, 4]
                      .filter((r) => r !== mo.gv.rank)
                      .map((r) => (
                        <option key={r} value={r}>
                          Rank {r}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span className={NHAN}>Hiệu lực từ</span>
                  <input type="date" min={du.homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
                </label>
              </div>
              <label className="block">
                <span className={NHAN}>Cơ sở đề xuất</span>
                <select className={cn(FIELD, "w-full")} value={f.coSo ?? ""} onChange={set("coSo")}>
                  <option value="">— chọn —</option>
                  {quyen.coSo
                    .filter((c) => quyen.deXuatTai.includes(c.id) && mo.gv.coSoIds.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nhan}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className={NHAN}>Căn cứ (thâm niên · tỷ lệ tái tục · năng lực)</span>
                <textarea rows={3} maxLength={2000} className={cn(FIELD, "h-auto w-full py-2")} value={f.canCu ?? ""} onChange={set("canCu")} placeholder="vd: 26 tháng · 96% · đạt năng lực" />
              </label>
            </>
          )}
          {mo.loai === "quyet" && mo.gv.deXuatDangCho && (
            <>
              <p>
                R{mo.gv.rank} → <b>R{mo.gv.deXuatDangCho.proposedRank}</b> từ {dmy(mo.gv.deXuatDangCho.effectiveFrom)} · đề xuất bởi {mo.gv.deXuatDangCho.nguoiDeXuat}
              </p>
              <p className="text-muted-foreground">{mo.gv.deXuatDangCho.basis}</p>
              <label className="block">
                <span className={NHAN}>{mo.duyet ? "Ghi chú (tuỳ chọn)" : "Lý do từ chối (bắt buộc)"}</span>
                <textarea rows={2} maxLength={1000} className={cn(FIELD, "h-auto w-full py-2")} value={f.ghiChu ?? ""} onChange={set("ghiChu")} />
              </label>
            </>
          )}
          {mo.loai === "cap" && (
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={NHAN}>Số / mã chứng nhận</span>
                <input className={cn(FIELD, "w-full")} maxLength={100} value={f.ma ?? ""} onChange={set("ma")} />
              </label>
              <label>
                <span className={NHAN}>Hiệu lực từ</span>
                <input type="date" min={du.homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
              </label>
              <label className="col-span-2">
                <span className={NHAN}>Ghi chú</span>
                <input className={cn(FIELD, "w-full")} maxLength={1000} value={f.ghiChu ?? ""} onChange={set("ghiChu")} />
              </label>
            </div>
          )}
          {mo.loai === "thu-hoi" && (
            <>
              <label className="block">
                <span className={NHAN}>Thu hồi từ ngày (buổi Trial trước ngày này vẫn được tính)</span>
                <input type="date" min={du.homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
              </label>
              <label className="block">
                <span className={NHAN}>Lý do thu hồi</span>
                <textarea rows={2} maxLength={1000} className={cn(FIELD, "h-auto w-full py-2")} value={f.ghiChu ?? ""} onChange={set("ghiChu")} />
              </label>
            </>
          )}
          {mo.loai === "chinh-sach" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={NHAN}>Phạm vi</span>
                  <select className={cn(FIELD, "w-full")} value={f.coSo ?? ""} onChange={set("coSo")}>
                    <option value="">Toàn hệ thống</option>
                    {quyen.coSo.map((c) => (
                      <option key={c.id} value={c.id}>
                        Riêng {c.nhan}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={NHAN}>Trạng thái</span>
                  <select className={cn(FIELD, "w-full")} value={f.bat ?? "1"} onChange={set("bat")}>
                    <option value="1">Bật</option>
                    <option value="0">Tắt</option>
                  </select>
                </label>
                <label>
                  <span className={NHAN}>Mức / học viên có mặt (VND)</span>
                  <input inputMode="numeric" className={cn(FIELD, "w-full")} value={f.muc ?? "30000"} onChange={set("muc")} />
                </label>
                <label>
                  <span className={NHAN}>Hiệu lực từ</span>
                  <input type="date" min={du.homNay} className={cn(FIELD, "w-full")} value={f.ngay ?? ""} onChange={set("ngay")} />
                </label>
              </div>
              <label className="block">
                <span className={NHAN}>Lý do / căn cứ phê duyệt</span>
                <textarea rows={2} maxLength={2000} className={cn(FIELD, "h-auto w-full py-2")} value={f.ghiChu ?? ""} onChange={set("ghiChu")} placeholder="vd: Theo SR.QD.238 §6, áp từ tháng 11" />
              </label>
            </>
          )}
        </div>
        <DialogFooter>
          <button type="button" className={BTN_OUTLINE} onClick={dong} disabled={dang}>
            Huỷ
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={dang}
            onClick={() => {
              if (mo.loai === "de-xuat")
                gui(() => deXuatRankAction({ userId: mo.gv.userId, centerId: f.coSo ?? "", proposedRank: f.rank ?? "", effectiveFrom: f.ngay ?? "", basis: f.canCu ?? "" }));
              else if (mo.loai === "quyet" && mo.gv.deXuatDangCho) gui(() => quyetRankAction({ id: mo.gv.deXuatDangCho!.id, duyet: mo.duyet, ghiChu: f.ghiChu ?? null }));
              else if (mo.loai === "cap") gui(() => capChungNhanAction({ userId: mo.gv.userId, code: f.ma ?? null, effectiveFrom: f.ngay ?? "", note: f.ghiChu ?? null }));
              else if (mo.loai === "thu-hoi" && mo.gv.chungNhan) gui(() => thuHoiChungNhanAction({ id: mo.gv.chungNhan!.id, tuNgay: f.ngay ?? "", lyDo: f.ghiChu ?? "" }));
              else if (mo.loai === "chinh-sach")
                gui(() => datChinhSachTrialAction({ centerId: f.coSo ? f.coSo : null, enabled: (f.bat ?? "1") === "1", amountPerStudent: f.muc ?? "30000", effectiveFrom: f.ngay ?? "", reason: f.ghiChu ?? "" }));
            }}
          >
            {dang ? "Đang lưu…" : mo.loai === "quyet" ? (mo.duyet ? "Duyệt" : "Từ chối") : "Lưu"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
