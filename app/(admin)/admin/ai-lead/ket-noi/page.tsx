// app/(admin)/admin/ai-lead/ket-noi/page.tsx — Trung tâm kết nối AI (AI Lead Gateway, lát K).
// Ba mục chọn bằng `?tab=` (Server Component, không thêm route): Tổng quan · Sự cố · Bằng chứng. Cổng trang = `ai-integration:view` (PAGE_GATES).
// MỌI trạng thái suy từ telemetry thật qua `docTrungTamKetNoi` → `tinhTrangKetNoi` (luật ở lib/ai-lead/dich-vu/ket-noi-thuan.ts): không có badge xanh mặc định.
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/ui/page-header";
import { ErrorState } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docLichSuChay, docNguoiXuLy, docSuCo, docTrungTamKetNoi, SO_SU_CO_MOI_TRANG, type LocSuCo, type TrungTamKetNoiView } from "@/lib/ai-lead/dich-vu/ket-noi";
import { cn } from "@/lib/utils";
import { LOP_O_CHON, LOP_THE } from "../_components/lop";
import { gioVn, rutGon } from "../_components/dinh-dang";
import { DanhSachSuCo } from "./_components/danh-sach-su-co";
import { GhiLanChay } from "./_components/ghi-lan-chay";
import { LichSuChay } from "./_components/lich-su-chay";
import { TheAgent } from "./_components/the-agent";
import { NutTaiLai } from "../_components/nut-tai-lai";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trung tâm kết nối AI | Admin Sata Robo" };

const MUC = [
  { ma: "tong-quan", nhan: "Tổng quan" },
  { ma: "su-co", nhan: "Sự cố" },
  { ma: "bang-chung", nhan: "Bằng chứng" },
] as const;
type MaMuc = (typeof MUC)[number]["ma"];
type SP = { tab?: string; state?: string; severity?: string; agentId?: string; trang?: string };

const STATES = ["OPEN", "ACKED", "RESOLVED"] as const;
const SEVS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function locSuCo(sp: SP): LocSuCo {
  return {
    state: STATES.find((s) => s === sp.state),
    severity: SEVS.find((s) => s === sp.severity),
    agentId: sp.agentId && /^[a-z0-9]{20,40}$/.test(sp.agentId) ? sp.agentId : undefined,
    trang: sp.trang ? Number(sp.trang) || 1 : 1,
  };
}

export default async function KetNoiAiLeadPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fai-lead%2Fket-noi");
  if (!(await checkAnyPermission([...PAGE_GATES["/ai-lead/ket-noi"]]))) redirect("/dashboard?error=unauthorized");

  const sp = await searchParams;
  const dangChon: MaMuc = MUC.find((m) => m.ma === sp.tab)?.ma ?? "tong-quan";
  const [quanLy, cauHinh] = await Promise.all([checkPermission("ai-integration:manage"), checkPermission("ai-leads:configure")]);
  const bayGio = new Date();

  // KHÔNG log lỗi trần (có thể chứa giá trị cột); lỗi đọc ⇒ ErrorState.
  const tong: TrungTamKetNoiView | null = await resolveActor(session.user.id).then((a) => docTrungTamKetNoi(a, bayGio)).catch(() => null);

  return (
    <div className="mx-auto w-full max-w-[96rem]">
      <PageHeader
        title="Trung tâm kết nối AI"
        subtitle="Trạng thái kết nối, sự cố và bằng chứng kiểm chứng của AI Messenger. Màu xanh chỉ xuất hiện khi có bằng chứng PASS còn hạn."
      />
      <nav aria-label="Các mục" className="mb-5 flex flex-wrap gap-1">
        {MUC.map((m) => (
          <Link
            key={m.ma}
            href={`?tab=${m.ma}`}
            aria-current={m.ma === dangChon ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
              m.ma === dangChon ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {m.nhan}
          </Link>
        ))}
      </nav>

      {tong === null ? (
        <ErrorState action={<NutTaiLai href={`?tab=${dangChon}`} />} />
      ) : dangChon === "tong-quan" ? (
        <TongQuan tong={tong} quanLy={quanLy} cauHinh={cauHinh} />
      ) : dangChon === "su-co" ? (
        <MucSuCo sp={sp} tong={tong} duocXuLy={quanLy || cauHinh} />
      ) : (
        <MucBangChung tong={tong} />
      )}
    </div>
  );
}

function TongQuan({ tong, quanLy, cauHinh }: { tong: TrungTamKetNoiView; quanLy: boolean; cauHinh: boolean }) {
  return (
    <div className="grid gap-5">
      <section className={cn(LOP_THE, "grid gap-1 text-sm")} aria-label="Điều kiện chung">
        <p>
          Hash hợp đồng hiện hành: <span className="font-mono text-xs">{rutGon(tong.hashHienHanh, 8)}</span> · Cổng PROD:{" "}
          <b>{tong.congProd.allowed ? "đang mở" : "đang đóng"}</b>
          {tong.congProd.allowed ? null : <> (chờ chủ dự án — thiếu {tong.congProd.thieu.join(", ")})</>} · Catalog mới nhất: {tong.catalogMoiNhat === null ? "chưa xuất bản" : `v${tong.catalogMoiNhat}`}
        </p>
        <p className="text-xs text-muted-foreground">
          Cập nhật lúc {gioVn(tong.bayGio)}. Ngưỡng “mất kết nối” = {Math.round(tong.nguongMatKetNoiMs / 1000)} giây không có nhịp sống (tham số ai.heartbeatSeconds × ai.staleMultiplier).
          {!tong.masterKeyOk ? " Máy chủ CHƯA đặt AI_LEAD_AGENT_MASTER_KEY — mọi yêu cầu máy nhận 503 NOT_CONFIGURED." : ""}
        </p>
        {/* Nuốt lỗi gửi thông báo ở log thì người trực không biết ai không nhận được chuông: đếm từ nhật ký audit bền. null = không đọc được (≠ 0). */}
        <p className={cn("text-xs", tong.thongBaoLoi24h ? "font-medium text-amber-700" : "text-muted-foreground")} data-thong-bao-loi={tong.thongBaoLoi24h ?? "khong-doc-duoc"}>
          Thông báo nội bộ gửi lỗi trong 24 giờ:{" "}
          {tong.thongBaoLoi24h === null ? "không đọc được số liệu" : tong.thongBaoLoi24h === 0 ? "0" : `${tong.thongBaoLoi24h} lần ghi nhận (gộp tối đa 1 dòng / 10 phút / kênh) — nhân viên có thể chưa nhận được chuông; xem nhật ký kiểm toán (module ai-lead, hành động AI_LEAD_THONG_BAO_LOI)`}
        </p>
        {tong.catalogToanVen && !tong.catalogToanVen.ok ? (
          <p role="alert" className="rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink" data-catalog-toan-ven="hong">
            Catalog mới nhất (v{tong.catalogMoiNhat}) KHÔNG toàn vẹn ({tong.catalogToanVen.ly === "ETAG_LECH" ? "etag không khớp nội dung — có thể đã bị sửa tay trong cơ sở dữ liệu" : "nội dung không còn đúng hợp đồng"}). Agent đang nhận 503 ở /catalog và hồ sơ khách mới cũng bị từ chối tạm thời (TEMP_UNAVAILABLE) cho tới khi bạn xuất bản lại ở tab Catalog (xuất bản lại được cả khi nội dung không đổi).
          </p>
        ) : null}
        {/* Từ chối KHÔNG xác thực được (chữ ký sai/Agent lạ): chỉ có số GỘP theo mã, không IP/nội dung. Cờ tắt ⇒ «chưa đo» (KHÔNG in 0: 0 nghĩa là «đã đo, không có»). */}
        <p
          className={cn("text-xs", tong.tuChoiChuaXacThuc.chuaXacThuc && tong.tuChoiChuaXacThuc.chuaXacThuc.tong > 0 ? "font-medium text-amber-700" : "text-muted-foreground")}
          data-tu-choi-chua-xac-thuc={tong.tuChoiChuaXacThuc.chuaXacThuc ? tong.tuChoiChuaXacThuc.chuaXacThuc.tong : tong.tuChoiChuaXacThuc.bat ? "khong-doc-duoc" : "chua-do"}
        >
          Yêu cầu bị từ chối khi chưa xác thực được (hôm nay + hôm qua):{" "}
          {!tong.tuChoiChuaXacThuc.bat
            ? "chưa đo — bộ đếm đang TẮT (Cấu hình vận hành → AI Lead)"
            : tong.tuChoiChuaXacThuc.chuaXacThuc === null
              ? "không đọc được số liệu"
              : tong.tuChoiChuaXacThuc.chuaXacThuc.tong === 0
                ? "0"
                : `${tong.tuChoiChuaXacThuc.chuaXacThuc.tong} — ${tong.tuChoiChuaXacThuc.chuaXacThuc.theoMa.slice(0, 4).map((m) => `${m.ma} ×${m.n}`).join(", ")}`}
        </p>
      </section>

      {quanLy ? (
        <div className="flex flex-wrap items-center gap-2">
          <GhiLanChay
            agents={tong.agents.map((a) => ({
              id: a.agent.id,
              name: a.agent.name,
              environment: a.agent.environment,
              pageIds: a.pages.map((p) => p.pageId),
              lastBuildSha: a.agent.lastBuildSha,
              lastContractHash: a.agent.lastContractHash,
            }))}
            hashHienHanh={tong.hashHienHanh}
          />
        </div>
      ) : null}

      {tong.agents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-semibold">Chưa có Agent nào</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Chưa có gì để theo dõi. Quản trị tối cao tạo Agent ở{" "}
            <Link href="/ai-lead/cau-hinh?tab=agent" className="underline underline-offset-2">
              Cấu hình AI Lead
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-2">
          {tong.agents.map((a) => (
            <TheAgent key={a.agent.id} v={a} bayGio={tong.bayGio} quyen={{ quanLy, page: quanLy || cauHinh }} />
          ))}
        </div>
      )}
    </div>
  );
}

async function MucSuCo({ sp, tong, duocXuLy }: { sp: SP; tong: TrungTamKetNoiView; duocXuLy: boolean }) {
  const loc = locSuCo(sp);
  const doc = await Promise.all([docSuCo(loc), duocXuLy ? docNguoiXuLy(new Date()) : Promise.resolve([])]).catch(() => null);
  if (!doc) return <ErrorState action={<NutTaiLai href="?tab=su-co" />} />;
  const [kq, nguoi] = doc;
  const giu = (k: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ tab: "su-co" });
    for (const [a, b] of Object.entries({ state: loc.state, severity: loc.severity, agentId: loc.agentId, ...k })) if (b) q.set(a, b);
    return `?${q.toString()}`;
  };
  return (
    <div className="grid gap-4">
      <form method="get" className={cn(LOP_THE, "grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end")} aria-label="Lọc sự cố">
        <input type="hidden" name="tab" value="su-co" />
        <div className="grid gap-1.5">
          <label htmlFor="f-state" className="text-xs font-medium text-muted-foreground">
            Trạng thái
          </label>
          <select id="f-state" name="state" defaultValue={loc.state ?? ""} className={LOP_O_CHON}>
            <option value="">Tất cả</option>
            <option value="OPEN">Mới</option>
            <option value="ACKED">Đã nhận</option>
            <option value="RESOLVED">Đã đóng</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="f-sev" className="text-xs font-medium text-muted-foreground">
            Mức độ
          </label>
          <select id="f-sev" name="severity" defaultValue={loc.severity ?? ""} className={LOP_O_CHON}>
            <option value="">Tất cả</option>
            <option value="LOW">Thấp</option>
            <option value="MEDIUM">Vừa</option>
            <option value="HIGH">Cao</option>
            <option value="CRITICAL">Nghiêm trọng</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="f-agent" className="text-xs font-medium text-muted-foreground">
            Agent
          </label>
          <select id="f-agent" name="agentId" defaultValue={loc.agentId ?? ""} className={LOP_O_CHON}>
            <option value="">Tất cả</option>
            {tong.agents.map((a) => (
              <option key={a.agent.id} value={a.agent.id}>
                {a.agent.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" className="min-h-11">
          Lọc
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {kq.tong} sự cố · trang {kq.trang}/{kq.soTrang} ({SO_SU_CO_MOI_TRANG} sự cố mỗi trang)
      </p>
      <DanhSachSuCo rows={kq.rows} nguoiXuLy={nguoi} duocXuLy={duocXuLy} />
      {kq.soTrang > 1 ? (
        <nav aria-label="Phân trang sự cố" className="flex items-center gap-2">
          {kq.trang > 1 ? (
            <Link href={giu({ trang: String(kq.trang - 1) })} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm">
              Trang trước
            </Link>
          ) : null}
          {kq.trang < kq.soTrang ? (
            <Link href={giu({ trang: String(kq.trang + 1) })} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm">
              Trang sau
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

async function MucBangChung({ tong }: { tong: TrungTamKetNoiView }) {
  const rows = await docLichSuChay(null, 50).catch(() => null);
  if (!rows) return <ErrorState action={<NutTaiLai href="?tab=bang-chung" />} />;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        50 lần kiểm chứng gần nhất của {tong.agents.length} Agent. PASS ở đây là lịch sử — một lần PASS chỉ làm tầng “đạt” khi còn hạn và build/hợp đồng/Page chưa đổi (xem thẻ Agent).
      </p>
      <LichSuChay rows={rows} />
    </div>
  );
}
