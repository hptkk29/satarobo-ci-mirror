"use client";

// Tab "Page": allowlist Page của từng Agent — cấp Page, gỡ Page, tạm dừng / bật lại, cơ sở nhận hồ sơ mặc định.
// Gỡ Page = Agent nhận 403 PAGE_NOT_ALLOWED cho Page đó ngay; tạm dừng = Agent ngừng /lead-intakes cho Page (vẫn /handoffs được).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentView, QuyTacTuTaoView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { CAU_LY_DO_TU_TAO, choPhepTuTaoLead } from "@/lib/ai-lead/dich-vu/quy-tac-page";
import { datCoSoNhanAction, datTrangThaiPageAction, datTuTaoLeadChoPageAction, goPageAction, themPageAction } from "../_actions";
import { NhanDon } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";
import { LOP_O_CHON, LOP_O_NHAP, LOP_THE } from "../../_components/lop";

type CoSo = { id: string; code: string; name: string };

/**
 * Quy tắc theo Page: TỰ TẠO LEAD. Trạng thái HIỆU LỰC lấy từ CHÍNH hàm máy chủ dùng (`choPhepTuTaoLead`) — màn hình không tự suy lại.
 * Nút chỉ hiện với người có `ai-integration:manage` (`duocDat`); người chỉ có `ai-leads:configure` vẫn THẤY trạng thái nhưng không có nút (luật 12).
 * Nhãn có chữ BẬT/TẮT (không chỉ màu); không tông xanh — "bật" là rủi ro, không phải thành công.
 * `role="group"` (KHÔNG phải <section>/region): mỗi Page một khối cùng tên "Tự tạo lead cho Page này" — nếu là vùng (landmark) thì axe `landmark-unique` đỏ vì tên trùng (đo 28/10/2026).
 */
function TuTaoLead({ agent, page, quyTac, duocDat }: { agent: AgentView; page: AgentView["pages"][number]; quyTac: QuyTacTuTaoView | null; duocDat: boolean }) {
  const tieuDeId = `tu-tao-${agent.id}-${page.pageId}`;
  // Không đọc được trạng thái ⇒ KHÔNG hiện "TẮT" (đó là một khẳng định) và KHÔNG có nút: người quản trị không được tin rằng tự tạo lead đang tắt khi chưa biết.
  if (quyTac === null) {
    return (
      <div role="group" aria-labelledby={tieuDeId} className="grid gap-2 rounded-lg bg-muted/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={tieuDeId} className="text-sm font-medium">
            Tự tạo lead cho Page này
          </h3>
          <NhanDon tone="muted">KHÔNG ĐỌC ĐƯỢC</NhanDon>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="tu-tao-hieu-luc">
          Không đọc được trạng thái tự tạo lead lúc này. Tải lại trang; chưa kết luận được là đang bật hay tắt.
        </p>
      </div>
    );
  }
  const bat = quyTac.batTheo.includes(`${agent.id}:${page.pageId}`);
  const hieuLuc = choPhepTuTaoLead({
    autoCreateToanHe: quyTac.toanHe,
    pageAutoCreate: bat,
    pageState: page.state,
    agentActive: agent.active,
    environment: agent.environment,
  });
  return (
    <div role="group" aria-labelledby={tieuDeId} className="grid gap-2 rounded-lg bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={tieuDeId} className="text-sm font-medium">
          Tự tạo lead cho Page này
        </h3>
        <NhanDon tone={bat ? "warning" : "muted"}>{bat ? "BẬT" : "TẮT"}</NhanDon>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="tu-tao-hieu-luc">
        {CAU_LY_DO_TU_TAO[hieuLuc.lyDo]}
      </p>
      {duocDat ? (
        <div>
          {bat ? (
            <NutLyDo
              nhan="Tắt tự tạo lead"
              tieuDe={`Tắt tự tạo lead cho Page ${page.pageId}?`}
              moTa="Từ lượt AI gửi kế tiếp, hồ sơ đủ điều kiện của Page này quay về hàng chờ nhân viên duyệt. Lead đã tạo không bị đổi."
              nhanXacNhan="Tắt tự tạo lead"
              nguyHiem={false}
              thongBaoXong="Đã tắt tự tạo lead cho Page."
              chay={(lyDo) => datTuTaoLeadChoPageAction({ agentId: agent.id, pageId: page.pageId, bat: false, lyDo })}
            />
          ) : (
            <NutLyDo
              nhan="Bật tự tạo lead"
              tieuDe={`Bật tự tạo lead cho Page ${page.pageId}?`}
              moTa="Bật sẽ tạo lead và chia sale ngay khi AI gửi đủ tên Facebook + SĐT + cơ sở, không qua duyệt. Chỉ có hiệu lực khi công tắc toàn hệ cũng bật."
              nhanXacNhan="Bật tự tạo lead"
              thongBaoXong="Đã bật tự tạo lead cho Page."
              chay={(lyDo) => datTuTaoLeadChoPageAction({ agentId: agent.id, pageId: page.pageId, bat: true, lyDo })}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function DongPage({
  agent,
  page,
  coSo,
  duocSua,
  quyTac,
  duocDatTuTao,
}: {
  agent: AgentView;
  page: AgentView["pages"][number];
  coSo: CoSo[];
  duocSua: boolean;
  quyTac: QuyTacTuTaoView | null;
  duocDatTuTao: boolean;
}) {
  const router = useRouter();
  const [rt, datRt] = useState(page.routingCenterId ?? "");
  const [loi, datLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const doi = rt !== (page.routingCenterId ?? "");
  const tenCoSo = coSo.find((c) => c.id === page.routingCenterId);

  return (
    <li className="grid gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{page.pageId}</span>
        <NhanDon tone={page.state === "PAUSED" ? "warning" : "info"}>{page.state === "PAUSED" ? "Đang tạm dừng" : "Đang nhận hồ sơ"}</NhanDon>
        <NhanDon tone={page.nguon.san ? "info" : "warning"}>{page.nguon.san ? `Nguồn lead: ${page.nguon.groupCode}` : "Nguồn lead CHƯA cấu hình"}</NhanDon>
      </div>
      {!page.nguon.san ? (
        <p role="note" data-nguon-chua-san={page.nguon.ma} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 [overflow-wrap:anywhere]">
          Hồ sơ AI của Page này <b>chưa tạo được lead chính thức</b> — chúng nằm ở mục Ngoại lệ (mã NGUON_CHUA_CAU_HINH) cho tới khi nguồn được cấu hình; khách không bị mất.{" "}
          {page.nguon.ma === "NGUON_TAT_HOAC_LOI"
            ? "Module Nguồn lead đang TẮT (cờ nguon.enabled) hoặc bộ quy nguồn không chạy được."
            : "Page chưa được gán nhóm nguồn «Marketing HO» ở module Nguồn lead (cần danh mục Page CRM + bảng nguồn theo Page; quyền sources:manage)."}{" "}
          Gói AI Lead không tự tạo nhóm nguồn hay chính sách hoa hồng — việc của Owner.{" "}
          <Link href="/nguon-hoa-hong/nguon" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2" data-lien-ket-nguon>
            Mở module Nguồn để cấu hình Page này
          </Link>{" "}
          (luồng có nhật ký kiểm toán; cần quyền sources:manage).
        </p>
      ) : null}
      {duocSua ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor={`rt-${agent.id}-${page.pageId}`} className="text-xs text-muted-foreground">
              Cơ sở nhận hồ sơ khi khách chưa chọn cơ sở
            </label>
            <select id={`rt-${agent.id}-${page.pageId}`} className={LOP_O_CHON} value={rt} onChange={(e) => datRt(e.target.value)} disabled={dang}>
              <option value="">— Chưa đặt (hồ sơ chỉ Hội sở thấy) —</option>
              {coSo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!doi || dang}
            onClick={() =>
              batDau(async () => {
                datLoi(null);
                const r = await datCoSoNhanAction({ agentId: agent.id, pageId: page.pageId, routingCenterId: rt === "" ? null : rt });
                if (!r.ok) datLoi(r.error);
                else router.refresh();
              })
            }
          >
            {dang ? "Đang lưu…" : "Lưu cơ sở nhận"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Cơ sở nhận hồ sơ: {tenCoSo ? `${tenCoSo.code} · ${tenCoSo.name}` : "chưa đặt"}</p>
      )}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <TuTaoLead agent={agent} page={page} quyTac={quyTac} duocDat={duocDatTuTao} />
      {duocSua ? (
        <div className="flex flex-wrap gap-2">
          {page.state === "ENABLED" ? (
            <NutLyDo
              nhan="Tạm dừng Page"
              tieuDe={`Tạm dừng Page ${page.pageId}?`}
              moTa="Agent ngừng thu thập hồ sơ (/lead-intakes) cho Page này từ nhịp sống kế tiếp; việc chuyển khách cho nhân viên (/handoffs, lý do INTAKE_PAUSED) vẫn dùng được."
              nhanXacNhan="Tạm dừng"
              thongBaoXong="Đã tạm dừng Page."
              chay={(lyDo) => datTrangThaiPageAction({ agentId: agent.id, pageId: page.pageId, state: "PAUSED", lyDo })}
            />
          ) : (
            <NutLyDo
              nhan="Bật lại Page"
              tieuDe={`Bật lại Page ${page.pageId}?`}
              moTa="Agent nhận lại hồ sơ cho Page này ở nhịp sống kế tiếp."
              nhanXacNhan="Bật lại"
              nguyHiem={false}
              thongBaoXong="Đã bật lại Page."
              chay={(lyDo) => datTrangThaiPageAction({ agentId: agent.id, pageId: page.pageId, state: "ENABLED", lyDo })}
            />
          )}
          <NutLyDo
            nhan="Gỡ Page"
            tieuDe={`Gỡ Page ${page.pageId} khỏi “${agent.name}”?`}
            moTa="Agent nhận 403 PAGE_NOT_ALLOWED cho Page này NGAY. Bằng chứng kiểm chứng đã ghi sẽ hết hạn vì tập Page đổi."
            nhanXacNhan="Gỡ Page"
            thongBaoXong="Đã gỡ Page."
            chay={(lyDo) => goPageAction({ agentId: agent.id, pageId: page.pageId, lyDo })}
          />
        </div>
      ) : null}
    </li>
  );
}

function ThemPage({ agent, coSo }: { agent: AgentView; coSo: CoSo[] }) {
  const router = useRouter();
  const [pageId, datPageId] = useState("");
  const [rt, datRt] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  return (
    <form
      className="mt-3 grid gap-2 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      aria-label={`Cấp Page cho ${agent.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        datLoi(null);
        batDau(async () => {
          const r = await themPageAction({ agentId: agent.id, pageId: pageId.trim(), routingCenterId: rt === "" ? null : rt });
          if (!r.ok) datLoi(r.error);
          else {
            datPageId("");
            datRt("");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor={`np-${agent.id}`} className="text-sm font-medium">
          Mã Page (pageId)
        </label>
        <Input id={`np-${agent.id}`} className={LOP_O_NHAP} value={pageId} onChange={(e) => datPageId(e.target.value)} placeholder="VD: 104500000000777" autoComplete="off" required />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`nr-${agent.id}`} className="text-sm font-medium">
          Cơ sở nhận mặc định
        </label>
        <select id={`nr-${agent.id}`} className={LOP_O_CHON} value={rt} onChange={(e) => datRt(e.target.value)}>
          <option value="">— Chưa đặt —</option>
          {coSo.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="min-h-11" disabled={dang || pageId.trim().length < 5}>
        {dang ? "Đang cấp…" : "Cấp Page"}
      </Button>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink sm:col-span-3">
          {loi}
        </p>
      ) : null}
    </form>
  );
}

export function PageAgent({
  agents,
  coSo,
  duocSua,
  quyTac,
  duocDatTuTao,
}: {
  agents: AgentView[];
  coSo: CoSo[];
  duocSua: boolean;
  /** BẮT BUỘC (không mặc định): thiếu là TypeScript báo, không phải mục "tự tạo lead" lặng lẽ hiện sai. `null` = KHÔNG đọc được (khác với "tắt"). */
  quyTac: QuyTacTuTaoView | null;
  /** Có `ai-integration:manage` — mới được bật/tắt tự tạo lead. */
  duocDatTuTao: boolean;
}) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm font-semibold">Chưa có Agent nào để cấp Page</p>
        <p className="mt-1 text-sm text-muted-foreground">Quản trị tối cao tạo Agent ở tab “Agent & khoá” trước; sau đó quay lại đây cấp Page.</p>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 2xl:grid-cols-2">
      {agents.map((a) => (
        <li key={a.id} className={LOP_THE}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-base font-semibold">{a.name}</h2>
            <NhanDon tone={a.environment === "PROD" ? "warning" : "info"}>{a.environment}</NhanDon>
          </div>
          {a.pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa được cấp Page nào — Agent này chưa phục vụ được Page nào (mọi yêu cầu nhận 403 PAGE_NOT_ALLOWED).</p>
          ) : (
            <ul>
              {a.pages.map((p) => (
                <DongPage key={p.pageId} agent={a} page={p} coSo={coSo} duocSua={duocSua} quyTac={quyTac} duocDatTuTao={duocDatTuTao} />
              ))}
            </ul>
          )}
          {duocSua ? <ThemPage agent={a} coSo={coSo} /> : null}
        </li>
      ))}
    </ul>
  );
}
