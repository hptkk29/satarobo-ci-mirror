"use client";

// Tab "Quy tắc" (Rule Builder): ràng buộc THU HẸP của tự tạo lead · hạn SLA · người nhận thông báo + LEO THANG · lịch sử phiên bản + khôi phục.
//
// Nguyên tắc (luật 12): màn này chỉ là mặt tiền của engine thật (`bo-quy-tac*.ts`). Mọi con số hiện ra là con số máy chủ sẽ dùng; nút nào sáng là nút làm thật; nút khoá luôn kèm LÝ DO bằng chữ.
// Lưu = tạo phiên bản MỚI có lý do (≥ 10 ký tự) — máy chủ kiểm lại toàn bộ, kể cả thế giới sống (cơ sở còn hoạt động). Bật/tắt tự tạo lead KHÔNG ở đây (cổng riêng, tab Page).
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentView, BoQuyTacView, ThayDoiKhoiPhuc } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { CAU_NHOM_NGUOI_NHAN, NHOM_NGUOI_NHAN, SO_QUY_TAC_TOI_DA, SU_KIEN_THONG_BAO, type NhomNguoiNhan, type QuyTac, type SuKienThongBao } from "@/lib/ai-lead/dich-vu/bo-quy-tac-schema";
import { datRangBuocTuTaoAction, khoiPhucBoQuyTacAction, luuSlaThongBaoAction, xemTruocKhoiPhucAction } from "../_actions";
import { gioVn } from "../../_components/dinh-dang";
import { NhanDon } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";
import { LOP_O_CHON, LOP_O_NHAP, LOP_THE } from "../../_components/lop";
import { CAU_SU_KIEN, soThayDoi, tomTatKhacBiet } from "./khac-biet-quy-tac";

type CoSo = { id: string; code: string; name: string };

export function QuyTac({ view, agents, coSo, duocSua }: { view: BoQuyTacView; agents: AgentView[]; coSo: CoSo[]; duocSua: boolean }) {
  const hien = view.hienHanh;
  const rules = hien?.rules ?? [];
  // Phiên bản mà màn NÀY đang hiển thị — gửi kèm mỗi lần lưu để máy chủ từ chối nếu người khác đã lưu sau đó (khoá lạc quan, không ghi đè lặng lẽ).
  const baseVersion = hien?.version ?? 0;
  return (
    <div className="grid gap-5">
      {view.phienBanHong !== null ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <b>Phiên bản {view.phienBanHong} của bộ quy tắc bị hỏng, không đọc được.</b> Tự tạo lead đang bị CHẶN (hồ sơ chờ nhân viên duyệt) và bạn chưa lưu SLA/ràng buộc được. Khôi phục một phiên bản cũ còn tốt ở bảng «Lịch sử» bên dưới;
          nếu chưa có bản nào, tắt tự tạo lead ở mọi Page trước rồi mới đổi cấu hình khác.
        </div>
      ) : null}
      <section className={LOP_THE} aria-labelledby="qt-hien-hanh">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="qt-hien-hanh" className="text-base font-semibold">
            Bộ quy tắc đang áp dụng
          </h2>
          <NhanDon tone={hien ? "info" : "muted"}>{hien ? `Phiên bản ${hien.version}` : "Chưa có phiên bản nào"}</NhanDon>
        </div>
        <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {hien
            ? `Lưu ${gioVn(hien.publishedAt)} — lý do: ${hien.reason}${hien.savedFromVersion ? ` (khôi phục từ phiên bản ${hien.savedFromVersion})` : ""}.`
            : "Chưa ai đổi cấu hình nghiệp vụ nên chưa có phiên bản. Hạn SLA lấy từ tham số ai.* và người nhận thông báo là mặc định (quản lý cơ sở). Lần đổi đầu tiên sẽ tạo phiên bản 1."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Mỗi lần đổi cơ sở nhận, bật/tắt tự tạo lead, thêm/gỡ Page hoặc lưu quy tắc dưới đây đều tạo một phiên bản mới; phiên bản cũ không bao giờ bị sửa và khôi phục được. Quy tắc chỉ có thể{" "}
          <b>thu hẹp</b> việc tự tạo lead, không bao giờ bật thêm.
        </p>
      </section>

      <RangBuocTuTao rules={rules} agents={agents} coSo={coSo} duocSua={duocSua} baseVersion={baseVersion} />
      <SlaThongBao key={JSON.stringify(rules.filter((r) => r.kind === "SLA" || r.kind === "NOTIFY"))} rules={rules} agents={agents} coSo={coSo} duocSua={duocSua} baseVersion={baseVersion} />
      <LichSu lichSu={view.lichSu} hienHanh={hien?.version ?? null} duocSua={duocSua} />
    </div>
  );
}

// ─── Ràng buộc thu hẹp ───────────────────────────────────────────────────────────────────────────────────────────────────────

function RangBuocTuTao({ rules, agents, coSo, duocSua, baseVersion }: { rules: QuyTac[]; agents: AgentView[]; coSo: CoSo[]; duocSua: boolean; baseVersion: number }) {
  const auto = rules.filter((r): r is Extract<QuyTac, { kind: "AUTO_CREATE" }> => r.kind === "AUTO_CREATE");
  return (
    <section className={LOP_THE} aria-labelledby="qt-rang-buoc">
      <h2 id="qt-rang-buoc" className="text-base font-semibold">
        Tự tạo lead — ràng buộc thu hẹp theo Page
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Chỉ hiện Page đang BẬT tự tạo lead. Ràng buộc đòi thêm điều kiện; hồ sơ không thoả vẫn chờ nhân viên duyệt (không mất khách).
      </p>
      {auto.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Chưa Page nào bật tự tạo lead (bật ở tab “Page”, cần quyền Quản trị tối cao).</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {auto.map((r) => (
            <li key={`${r.agentId}:${r.pageId}:${r.requireConsent === true}:${[...(r.campusCenterIds ?? [])].sort().join(",")}`}>
              <MotRangBuoc r={r} tenAgent={agents.find((a) => a.id === r.agentId)?.name ?? r.agentId} coSo={coSo} duocSua={duocSua} baseVersion={baseVersion} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MotRangBuoc({ r, tenAgent, coSo, duocSua, baseVersion }: { r: Extract<QuyTac, { kind: "AUTO_CREATE" }>; tenAgent: string; coSo: CoSo[]; duocSua: boolean; baseVersion: number }) {
  const id = useId();
  const [dongY, datDongY] = useState(r.requireConsent === true);
  const [chon, datChon] = useState<string[]>(r.campusCenterIds ?? []);
  const doi = dongY !== (r.requireConsent === true) || [...chon].sort().join() !== [...(r.campusCenterIds ?? [])].sort().join();
  return (
    <div role="group" aria-label={`Ràng buộc tự tạo lead của Page ${r.pageId}`} className="rounded-lg border p-3 sm:p-4">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
        Page <span className="font-mono">{r.pageId}</span> <span className="font-normal text-muted-foreground">· {tenAgent}</span>
      </p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={dongY} disabled={!duocSua} onChange={(e) => datDongY(e.target.checked)} />
        Chỉ tự tạo khi khách đã đồng ý liên hệ
      </label>
      <fieldset className="mt-2" disabled={!duocSua}>
        <legend className="text-sm font-medium">Chỉ tự tạo cho các cơ sở được chọn</legend>
        <p className="mt-1 text-xs text-muted-foreground" data-pham-vi-co-so={chon.length === 0 ? "khong-gioi-han" : "gioi-han"}>
          {chon.length === 0
            ? "Chưa chọn cơ sở nào ⇒ KHÔNG giới hạn: hồ sơ của mọi cơ sở đều được tự tạo lead."
            : `Chỉ ${chon.length} cơ sở dưới đây được tự tạo lead; hồ sơ thuộc cơ sở khác (hoặc chưa biết cơ sở) chờ nhân viên duyệt.`}
        </p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {coSo.map((c) => (
            <label key={c.id} htmlFor={`${id}-${c.id}`} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                id={`${id}-${c.id}`}
                type="checkbox"
                className="size-5"
                checked={chon.includes(c.id)}
                onChange={(e) => datChon((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))}
              />
              {c.name} <span className="text-muted-foreground">({c.code})</span>
            </label>
          ))}
        </div>
      </fieldset>
      {duocSua ? (
        <div className="mt-3">
          <NutLyDo
            nhan="Lưu ràng buộc"
            tieuDe={`Lưu ràng buộc của Page ${r.pageId}?`}
            moTa="Tạo phiên bản mới của bộ quy tắc. Chỉ thu hẹp việc tự tạo lead; không bật/tắt tự tạo lead."
            nhanXacNhan="Lưu ràng buộc"
            nguyHiem={false}
            bienThe="default"
            disabled={!doi}
            thongBaoXong="Đã lưu ràng buộc."
            chay={(lyDo) => datRangBuocTuTaoAction({ baseVersion, agentId: r.agentId, pageId: r.pageId, requireConsent: dongY, campusCenterIds: chon, lyDo })}
          />
          {!doi ? <p className="mt-1 text-xs text-muted-foreground">Chưa có thay đổi để lưu.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── SLA + người nhận thông báo / leo thang ─────────────────────────────────────────────────────────────────────────────────

type DongSla = { k: number; loai: "DEFAULT" | "PAGE" | "CAMPUS"; pageId: string; centerId: string; claim: string; resolve: string };
type DongTb = { k: number; event: SuKienThongBao; centerId: string; after: string; to: NhomNguoiNhan[] };
type DaXoa = { loai: "sla"; dong: DongSla; viTri: number } | { loai: "tb"; dong: DongTb; viTri: number };

function tuQuyTac(rules: QuyTac[]): { sla: DongSla[]; tb: DongTb[] } {
  let k = 0;
  const sla: DongSla[] = [];
  const tb: DongTb[] = [];
  for (const r of rules) {
    if (r.kind === "SLA") {
      sla.push({ k: k++, loai: r.scope.type, pageId: r.scope.type === "PAGE" ? r.scope.pageId : "", centerId: r.scope.type === "CAMPUS" ? r.scope.centerId : "", claim: String(r.claimMinutes), resolve: String(r.resolveMinutes) });
    } else if (r.kind === "NOTIFY") {
      tb.push({ k: k++, event: r.event, centerId: r.centerId ?? "", after: String(r.afterMinutes), to: [...r.to] });
    }
  }
  return { sla, tb };
}

/** Dựng quy tắc gửi máy chủ, hoặc trả câu lỗi. Máy chủ kiểm lại tất cả — ở đây chỉ để người dùng thấy lỗi sớm, đúng chỗ. */
function dungQuyTac(sla: DongSla[], tb: DongTb[]): { rules: unknown[] } | { loi: string } {
  const so = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
  const rules: unknown[] = [];
  for (const [i, d] of sla.entries()) {
    const claim = so(d.claim);
    const resolve = so(d.resolve);
    if (!(claim >= 5 && claim <= 10_080)) return { loi: `SLA dòng ${i + 1}: hạn nhận phải là số nguyên từ 5 đến 10080 phút.` };
    if (!(resolve >= 5 && resolve <= 43_200)) return { loi: `SLA dòng ${i + 1}: hạn xử lý phải là số nguyên từ 5 đến 43200 phút.` };
    if (claim > resolve) return { loi: `SLA dòng ${i + 1}: hạn nhận không được lớn hơn hạn xử lý.` };
    if (d.loai === "PAGE" && d.pageId === "") return { loi: `SLA dòng ${i + 1}: chọn Page.` };
    if (d.loai === "CAMPUS" && d.centerId === "") return { loi: `SLA dòng ${i + 1}: chọn cơ sở.` };
    rules.push({ kind: "SLA", scope: d.loai === "DEFAULT" ? { type: "DEFAULT" } : d.loai === "PAGE" ? { type: "PAGE", pageId: d.pageId } : { type: "CAMPUS", centerId: d.centerId }, claimMinutes: claim, resolveMinutes: resolve });
  }
  for (const [i, d] of tb.entries()) {
    const after = so(d.after);
    if (!(after >= 0 && after <= 10_080)) return { loi: `Thông báo dòng ${i + 1}: số phút phải là số nguyên từ 0 đến 10080.` };
    if (d.to.length === 0) return { loi: `Thông báo dòng ${i + 1}: chọn ít nhất một nhóm người nhận.` };
    // Thứ tự nhóm cố định theo danh sách chuẩn ⇒ cùng nội dung luôn ra cùng payload (so 'có thay đổi' không phụ thuộc thứ tự tick).
    rules.push({ kind: "NOTIFY", event: d.event, centerId: d.centerId === "" ? null : d.centerId, afterMinutes: after, to: NHOM_NGUOI_NHAN.filter((n) => d.to.includes(n)) });
  }
  return { rules };
}

function SlaThongBao({ rules, agents, coSo, duocSua, baseVersion }: { rules: QuyTac[]; agents: AgentView[]; coSo: CoSo[]; duocSua: boolean; baseVersion: number }) {
  const goc = tuQuyTac(rules);
  const [sla, datSla] = useState<DongSla[]>(goc.sla);
  const [tb, datTb] = useState<DongTb[]>(goc.tb);
  const [k, datK] = useState(1000);
  // Dòng vừa xoá (chưa lưu gì lên máy chủ): giữ lại để HOÀN TÁC theo thứ tự ngược, kèm vị trí cũ — bấm nhầm «Xoá» không mất công gõ lại.
  const [daXoa, datDaXoa] = useState<DaXoa[]>([]);
  // Dòng bị xoá kéo theo nút «Xoá» biến mất ⇒ tiêu điểm bàn phím rơi về <body>. Đưa tiêu điểm tới «Hoàn tác» mỗi khi có thêm một dòng bị gỡ (không đụng khi hoàn tác / lưu).
  const nutHoanTac = useRef<HTMLButtonElement>(null);
  const soDaXoaTruoc = useRef(0);
  useEffect(() => {
    if (daXoa.length > soDaXoaTruoc.current) nutHoanTac.current?.focus();
    soDaXoaTruoc.current = daXoa.length;
  }, [daXoa.length]);
  const pageIds = [...new Set(agents.flatMap((a) => a.pages.map((p) => p.pageId)))].sort();
  const tenCoSo = (id: string) => coSo.find((c) => c.id === id)?.name ?? id;
  const kq = dungQuyTac(sla, tb);
  const daLuu = dungQuyTac(goc.sla, goc.tb);
  const doi = "rules" in kq && "rules" in daLuu ? JSON.stringify(kq.rules) !== JSON.stringify(daLuu.rules) : true;
  const sua = <T extends { k: number }>(ds: T[], kk: number, v: Partial<T>): T[] => ds.map((d) => (d.k === kk ? { ...d, ...v } : d));
  // Trần tổng số quy tắc của MỘT phiên bản (xem SO_QUY_TAC_TOI_DA): tính cả ROUTE/AUTO theo Page (không sửa ở màn này) + SLA + thông báo trong bản nháp.
  const quyTacKhac = rules.filter((r) => r.kind !== "SLA" && r.kind !== "NOTIFY").length;
  const daDung = quyTacKhac + sla.length + tb.length;
  const day = daDung >= SO_QUY_TAC_TOI_DA;
  const gan = daDung >= Math.floor(SO_QUY_TAC_TOI_DA * 0.8);
  const khacBiet = "rules" in kq && "rules" in daLuu ? tomTatKhacBiet(daLuu.rules as QuyTac[], kq.rules as QuyTac[], tenCoSo) : null;
  const xoaSla = (d: DongSla, vt: number) => {
    datSla((x) => x.filter((y) => y.k !== d.k));
    datDaXoa((x) => [...x, { loai: "sla", dong: d, viTri: vt }]);
  };
  const xoaTb = (d: DongTb, vt: number) => {
    datTb((x) => x.filter((y) => y.k !== d.k));
    datDaXoa((x) => [...x, { loai: "tb", dong: d, viTri: vt }]);
  };
  const hoanTac = () => {
    const cuoi = daXoa.at(-1);
    if (!cuoi) return; // nút «Hoàn tác» bị khoá khi bản nháp ĐÃ đầy (xoá rồi thêm lại): khôi phục sẽ vượt trần, phải gỡ bớt trước
    datDaXoa((x) => x.slice(0, -1));
    if (cuoi.loai === "sla") datSla((x) => [...x.slice(0, cuoi.viTri), cuoi.dong, ...x.slice(cuoi.viTri)]);
    else datTb((x) => [...x.slice(0, cuoi.viTri), cuoi.dong, ...x.slice(cuoi.viTri)]);
  };

  return (
    <section className={LOP_THE} aria-labelledby="qt-sla">
      <h2 id="qt-sla" className="text-base font-semibold">
        Hạn SLA và người nhận thông báo
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        SLA: cơ sở thắng Page, Page thắng mặc định; không quy tắc ⇒ dùng tham số ai.*. Hạn chỉ tính cho hồ sơ MỚI (hồ sơ cũ giữ hạn đã ghi). Thông báo: dòng riêng của cơ sở thay hoàn toàn dòng chung; “+ phút” &gt; 0 là bậc{" "}
        <b>leo thang</b> báo thêm nhóm khác nếu việc chưa xong.
      </p>

      <details open className="group mt-5" data-khoi="sla">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg [&::-webkit-details-marker]:hidden">
          <h3 className="text-sm font-semibold">Hạn SLA</h3>
          <NhanDon tone="muted">{sla.length} quy tắc</NhanDon>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Mở ra</span>
          <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">Thu gọn</span>
        </summary>
      {sla.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có quy tắc SLA — đang dùng tham số ai.slaClaimMinutes / ai.slaResolveMinutes.</p> : null}
      <ul className="mt-2 grid gap-2">
        {sla.map((d, i) => (
          <li key={d.k}><div role="group" aria-label={`Quy tắc SLA ${i + 1}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_7rem_7rem_auto] lg:items-end">
            <Truong nhan="Phạm vi">
              <select className={LOP_O_CHON} value={d.loai} disabled={!duocSua} onChange={(e) => datSla((x) => sua(x, d.k, { loai: e.target.value as DongSla["loai"] }))}>
                <option value="DEFAULT">Mặc định</option>
                <option value="PAGE">Theo Page</option>
                <option value="CAMPUS">Theo cơ sở</option>
              </select>
            </Truong>
            <Truong nhan={d.loai === "PAGE" ? "Page" : d.loai === "CAMPUS" ? "Cơ sở" : "Áp cho"}>
              {d.loai === "PAGE" ? (
                <select className={LOP_O_CHON} value={d.pageId} disabled={!duocSua} onChange={(e) => datSla((x) => sua(x, d.k, { pageId: e.target.value }))}>
                  <option value="">Chọn Page…</option>
                  {pageIds.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : d.loai === "CAMPUS" ? (
                <select className={LOP_O_CHON} value={d.centerId} disabled={!duocSua} onChange={(e) => datSla((x) => sua(x, d.k, { centerId: e.target.value }))}>
                  <option value="">Chọn cơ sở…</option>
                  {coSo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="flex min-h-11 items-center text-sm text-muted-foreground">Mọi hồ sơ chưa có quy tắc hẹp hơn</p>
              )}
            </Truong>
            <Truong nhan="Hạn nhận (phút)">
              <Input inputMode="numeric" className={LOP_O_NHAP} value={d.claim} disabled={!duocSua} onChange={(e) => datSla((x) => sua(x, d.k, { claim: e.target.value }))} />
            </Truong>
            <Truong nhan="Hạn xử lý (phút)">
              <Input inputMode="numeric" className={LOP_O_NHAP} value={d.resolve} disabled={!duocSua} onChange={(e) => datSla((x) => sua(x, d.k, { resolve: e.target.value }))} />
            </Truong>
            {duocSua ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => xoaSla(d, i)} aria-label={`Xoá quy tắc SLA ${i + 1}`}>
                Xoá
              </Button>
            ) : null}
          </div></li>
        ))}
      </ul>
      {duocSua ? (
        <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={day} onClick={() => { datSla((x) => [...x, { k, loai: "DEFAULT", pageId: "", centerId: "", claim: "30", resolve: "240" }]); datK(k + 1); }}>
          + Thêm quy tắc SLA
        </Button>
      ) : null}
      </details>

      <details open className="group mt-4" data-khoi="thong-bao">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg [&::-webkit-details-marker]:hidden">
          <h3 className="text-sm font-semibold">Người nhận thông báo và leo thang</h3>
          <NhanDon tone="muted">{tb.length} quy tắc</NhanDon>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Mở ra</span>
          <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">Thu gọn</span>
        </summary>
      {tb.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có quy tắc thông báo — đang dùng mặc định: quản lý cơ sở nhận báo hồ sơ/quá hạn, người xem Trung tâm kết nối nhận báo sự cố.</p> : null}
      <ul className="mt-2 grid gap-2">
        {tb.map((d, i) => (
          <li key={d.k}><div role="group" aria-label={`Quy tắc thông báo ${i + 1}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_auto] lg:items-end">
            <Truong nhan="Sự kiện">
              <select className={LOP_O_CHON} value={d.event} disabled={!duocSua} onChange={(e) => datTb((x) => sua(x, d.k, { event: e.target.value as SuKienThongBao }))}>
                {SU_KIEN_THONG_BAO.map((s) => (
                  <option key={s} value={s}>
                    {CAU_SU_KIEN[s]}
                  </option>
                ))}
              </select>
            </Truong>
            <Truong nhan="Cơ sở">
              <select className={LOP_O_CHON} value={d.centerId} disabled={!duocSua} onChange={(e) => datTb((x) => sua(x, d.k, { centerId: e.target.value }))}>
                <option value="">Mọi cơ sở</option>
                {coSo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Truong>
            <Truong nhan="Báo sau (phút)">
              <Input inputMode="numeric" className={LOP_O_NHAP} value={d.after} disabled={!duocSua} onChange={(e) => datTb((x) => sua(x, d.k, { after: e.target.value }))} />
            </Truong>
            {duocSua ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => xoaTb(d, i)} aria-label={`Xoá quy tắc thông báo ${i + 1}`}>
                Xoá
              </Button>
            ) : null}
            <fieldset className="grid gap-0.5 sm:col-span-2 lg:col-span-4" disabled={!duocSua}>
              <legend className="text-xs font-medium text-muted-foreground">Nhóm người nhận</legend>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {NHOM_NGUOI_NHAN.map((n) => (
                  <label key={n} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={d.to.includes(n)}
                      onChange={(e) => datTb((x) => sua(x, d.k, { to: e.target.checked ? [...d.to, n] : d.to.filter((y) => y !== n) }))}
                    />
                    {CAU_NHOM_NGUOI_NHAN[n]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div></li>
        ))}
      </ul>
      {duocSua ? (
        <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={day} onClick={() => { datTb((x) => [...x, { k, event: "SLA_CLAIM_OVERDUE", centerId: "", after: "60", to: ["HO_REVIEWERS"] }]); datK(k + 1); }}>
          + Thêm quy tắc thông báo
        </Button>
      ) : null}
      </details>

      <p
        className={gan ? "mt-4 text-xs font-medium text-state-warning-ink" : "mt-4 text-xs text-muted-foreground"}
        data-so-quy-tac={daDung}
        role={day ? "alert" : undefined}
      >
        Đã dùng {daDung}/{SO_QUY_TAC_TOI_DA} quy tắc trong phiên bản này (tính cả định tuyến và tự tạo lead theo Page).
        {day ? " Đã ĐẦY — gỡ bớt quy tắc rồi mới thêm được." : gan ? " Sắp đầy." : ""}
      </p>

      {duocSua ? (
        <div className="mt-3 border-t pt-4">
          {khacBiet && soThayDoi(khacBiet) > 0 ? <TomTatKhacBiet kb={khacBiet} /> : null}
          {"loi" in kq ? (
            <p role="alert" className="mb-2 rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {kq.loi}
            </p>
          ) : null}
          <NutLyDo
            nhan="Lưu SLA và thông báo"
            tieuDe="Lưu bộ quy tắc SLA và thông báo?"
            moTa={
              <div className="grid gap-2">
                <p>Tạo phiên bản mới của bộ quy tắc, áp dụng ngay cho hồ sơ MỚI và các lượt báo kế tiếp. Máy chủ kiểm lại cơ sở/Page còn hợp lệ.</p>
                {khacBiet && soThayDoi(khacBiet) > 0 ? <TomTatKhacBiet kb={khacBiet} chiTietTrongHop /> : null}
              </div>
            }
            nhanXacNhan="Lưu phiên bản mới"
            nguyHiem={false}
            bienThe="default"
            disabled={"loi" in kq || !doi}
            thongBaoXong="Đã lưu phiên bản mới."
            chay={async (lyDo) => ("rules" in kq ? luuSlaThongBaoAction({ baseVersion, rules: kq.rules, lyDo }) : { ok: false, error: kq.loi })}
          />
          {!("loi" in kq) && !doi ? <p className="mt-1 text-xs text-muted-foreground">Chưa có thay đổi để lưu.</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Bạn chỉ có quyền xem. Sửa quy tắc cần quyền ai-leads:configure.</p>
      )}
      {/* Vùng thông báo LUÔN có mặt (đọc lên đáng tin hơn thành phần vừa mới gắn) và DÍNH ở đáy khung nhìn: bấm «Xoá» ở đầu danh sách dài thì nút Hoàn tác vẫn nằm trong tầm mắt. */}
      <div role="status" aria-live="polite" data-hoan-tac={daXoa.length > 0 ? daXoa.length : undefined} className="sticky bottom-3 z-10 empty:hidden">
        {daXoa.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              Đã gỡ {daXoa.length} quy tắc khỏi bản nháp (chưa lưu). Gần nhất: {daXoa.at(-1)!.loai === "sla" ? "quy tắc SLA" : "quy tắc thông báo"}.
              {day ? " Bản nháp đã ĐẦY — gỡ bớt một quy tắc rồi mới hoàn tác được." : ""}
            </span>
            <Button ref={nutHoanTac} type="button" variant="outline" className="min-h-11" disabled={day} onClick={hoanTac}>
              Hoàn tác
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Nhãn BAO quanh ô nhập ⇒ gắn nhãn↔ô ngầm định (không cần id), đọc đúng bằng trình đọc màn hình. */
function Truong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs font-medium text-muted-foreground">{nhan}</span>
      {children}
    </label>
  );
}

// ─── Lịch sử + khôi phục ─────────────────────────────────────────────────────────────────────────────────────────────────────

function LichSu({ lichSu, hienHanh, duocSua }: { lichSu: BoQuyTacView["lichSu"]; hienHanh: number | null; duocSua: boolean }) {
  return (
    <section className={LOP_THE} aria-labelledby="qt-lich-su">
      {/* Đóng mặc định: tối đa 20 dòng nhiều chữ làm trang di động dài gấp đôi, trong khi việc thường làm (sửa SLA/thông báo) không cần nó. */}
      <details className="group" data-khoi="lich-su">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg [&::-webkit-details-marker]:hidden">
          <h2 id="qt-lich-su" className="text-base font-semibold">
            Lịch sử phiên bản
          </h2>
          <NhanDon tone="muted">{lichSu.length} phiên bản gần nhất</NhanDon>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Mở ra</span>
          <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">Thu gọn</span>
        </summary>
      {lichSu.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Chưa có phiên bản nào.</p>
      ) : (
        <ul className="mt-3 divide-y" aria-label="Các phiên bản gần đây">
          {lichSu.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="font-mono text-sm font-semibold">v{v.version}</span>
              {v.version === hienHanh ? <NhanDon tone="info">Đang áp dụng</NhanDon> : null}
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                {gioVn(v.publishedAt)} · {v.soQuyTac} quy tắc · {v.reason}
                {v.savedFromVersion ? ` · khôi phục từ v${v.savedFromVersion}` : ""}
              </span>
              {duocSua && v.version !== hienHanh ? <KhoiPhuc version={v.version} /> : null}
            </li>
          ))}
        </ul>
      )}
      </details>
    </section>
  );
}

/** Tóm tắt «sắp lưu gì»: thêm / sửa / xoá so với phiên bản đang áp dụng. `chiTietTrongHop` = bản trong hộp xác nhận (liệt kê đủ); bản ngoài hộp đếm + mở ra xem. */
function TomTatKhacBiet({ kb, chiTietTrongHop = false }: { kb: ReturnType<typeof tomTatKhacBiet>; chiTietTrongHop?: boolean }) {
  const nhom: { ten: string; ds: string[]; dau: string }[] = [
    { ten: "Thêm", ds: kb.them, dau: "+" },
    { ten: "Sửa", ds: kb.sua, dau: "~" },
    { ten: "Xoá", ds: kb.xoa, dau: "−" },
  ];
  const dem = soThayDoi(kb);
  const noiDung = (
    <ul className="grid gap-1.5 text-sm" aria-label="Thay đổi so với phiên bản đang áp dụng">
      {nhom.flatMap((g) =>
        g.ds.map((d, i) => (
          <li key={`${g.ten}-${i}`} className="flex gap-2 [overflow-wrap:anywhere]">
            <span className="w-14 shrink-0 font-medium text-muted-foreground">
              {g.dau} {g.ten}
            </span>
            <span className="min-w-0">{d}</span>
          </li>
        )),
      )}
    </ul>
  );
  if (chiTietTrongHop)
    return (
      <div data-khac-biet="trong-hop" className="max-h-56 overflow-y-auto rounded-lg border bg-muted/30 p-3">
        {noiDung}
      </div>
    );
  return (
    <details data-khac-biet="ngoai-hop" className="mb-3 rounded-lg border bg-muted/30">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Chưa lưu: {dem} thay đổi
        <span className="text-xs font-normal text-muted-foreground">
          (+{kb.them.length} thêm · ~{kb.sua.length} sửa · −{kb.xoa.length} xoá) — bấm để xem
        </span>
      </summary>
      <div className="border-t p-3">{noiDung}</div>
    </details>
  );
}

const TEN_TRUONG: Record<ThayDoiKhoiPhuc["truong"], string> = { routingCenterId: "Cơ sở nhận mặc định", autoCreate: "Tự tạo lead" };
const giaTri = (v: string | boolean | null): string => (v === null ? "(trống)" : v === true ? "BẬT" : v === false ? "TẮT" : v);

function KhoiPhuc({ version }: { version: number }) {
  const router = useRouter();
  const [mo, datMo] = useState(false);
  const [thayDoi, datThayDoi] = useState<ThayDoiKhoiPhuc[] | null>(null);
  const [lyDo, datLyDo] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();
  const du = lyDo.trim().length >= 10;

  function moHop() {
    datMo(true);
    datThayDoi(null);
    datLoi(null);
    batDau(async () => {
      const r = await xemTruocKhoiPhucAction({ version });
      if (r.ok) datThayDoi(r.thayDoi);
      else datLoi(r.error);
    });
  }
  function dong() {
    if (dangChay) return;
    datMo(false);
    datLyDo("");
  }
  function xacNhan() {
    if (!du) return;
    batDau(async () => {
      const r = await khoiPhucBoQuyTacAction({ version, lyDo: lyDo.trim() });
      if (r.ok) {
        toast.success(`Đã khôi phục — tạo phiên bản ${r.version}.`);
        datMo(false);
        datLyDo("");
      } else datLoi(r.error);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11 px-3 text-sm" onClick={moHop} aria-label={`Khôi phục phiên bản ${version}`}>
        Khôi phục…
      </Button>
      <Dialog open={mo} onOpenChange={(m) => (m ? moHop() : dong())}>
        <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Khôi phục phiên bản {version}?</DialogTitle>
            <DialogDescription render={<div />}>
              Ghi lại cơ sở nhận và tự tạo lead của MỌI Page theo phiên bản này (Page không có quy tắc ⇒ về mặc định: không cơ sở, tắt tự tạo) và tạo một phiên bản MỚI. Phiên bản cũ không bị sửa. Máy chủ từ chối nếu một cơ sở trong phiên bản đó đã ngừng hoạt động.
            </DialogDescription>
          </DialogHeader>
          <div aria-live="polite">
            {thayDoi === null && !loi ? (
              <p className="text-sm text-muted-foreground">Đang tính các thay đổi…</p>
            ) : thayDoi !== null && thayDoi.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cơ sở nhận và tự tạo lead hiện tại đã khớp phiên bản này; chỉ SLA/thông báo/ràng buộc sẽ được khôi phục.</p>
            ) : thayDoi !== null ? (
              <ul className="grid gap-1 text-sm" aria-label="Thay đổi sẽ áp dụng">
                {thayDoi.map((t, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    Page <span className="font-mono">{t.pageId}</span> — {TEN_TRUONG[t.truong]}: {giaTri(t.tu)} → <b>{giaTri(t.sang)}</b>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`ly-do-kp-${version}`} className="text-sm font-medium">
              Lý do (bắt buộc, ghi vào nhật ký)
            </label>
            <Textarea id={`ly-do-kp-${version}`} value={lyDo} onChange={(e) => datLyDo(e.target.value)} rows={3} maxLength={500} disabled={dangChay} aria-invalid={lyDo.length > 0 && !du} />
            <p className={lyDo.length > 0 && !du ? "text-xs text-state-danger-ink" : "text-xs text-muted-foreground"}>
              {du ? "Đủ điều kiện xác nhận." : `Cần ít nhất 10 ký tự (đang có ${lyDo.trim().length}).`}
            </p>
          </div>
          {loi ? (
            <p role="alert" className="rounded-md bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={dong} disabled={dangChay}>
              Huỷ
            </Button>
            <Button type="button" className="min-h-11" disabled={!du || dangChay || thayDoi === null} onClick={xacNhan}>
              {dangChay ? "Đang xử lý…" : "Khôi phục"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
