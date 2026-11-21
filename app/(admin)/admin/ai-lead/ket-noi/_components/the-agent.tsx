"use client";

// Thẻ MỘT Agent trong Trung tâm kết nối: nhãn tổng hợp · ô trạng thái (mỗi ô có NGUỒN + LẦN KIỂM + LÝ DO) · bốn tầng L1–L4 · từng Page · hành động.
//
// KHÔNG CÓ XANH MẶC ĐỊNH: mọi màu xanh đến từ cờ `xanh` / `dat` của `ket-noi-thuan.ts`. Nhịp sống tươi một mình KHÔNG làm gì xanh (xem lý do trong thẻ).
// Webhook là LỜI KHAI của Agent (OD-01) — hiển thị kèm chú thích, không bao giờ dùng làm bằng chứng.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AgentKetNoiView, NhipWebhook } from "@/lib/ai-lead/dich-vu/ket-noi";
import { CAC_TANG, nhanTang } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import { datHoatDongAgentAction, datTrangThaiPageAction } from "../../cau-hinh/_actions";
import { phatHanhThamDoAction } from "../_actions";
import { gioVn, rutGon, tuoiChu } from "../../_components/dinh-dang";
import { LOP_THE } from "../../_components/lop";
import { NhanDon, NhanTang, NhanTong } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";

const CHU_NHIP = { CHUA_TUNG: "Chưa từng có", CON_MOI: "Còn mới", STALE: "Im lặng", NGAT: "Đã ngắt" } as const;
const CHU_HOP_DONG = { COMPATIBLE: "Tương thích", DEPRECATED: "Sắp loại bỏ", INCOMPATIBLE: "Không tương thích" } as const;
const CHU_HASH = { KHOP: "hash khớp hiện hành", LA: "hash LẠ", CHUA_BIET: "chưa biết hash" } as const;
const CHU_MUC_SU_CO = { LOW: "thấp", MEDIUM: "vừa", HIGH: "cao", CRITICAL: "nghiêm trọng" } as const;

function O({ nhan, giaTri, nguon, lanKiem, ghiChu }: { nhan: string; giaTri: React.ReactNode; nguon: string; lanKiem?: string | null; ghiChu?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-3" data-o={nhan}>
      <dt className="text-xs font-medium text-muted-foreground">{nhan}</dt>
      <dd className="mt-0.5 text-sm font-semibold [overflow-wrap:anywhere]">{giaTri}</dd>
      <dd className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Nguồn: {nguon}
        {lanKiem ? <> · kiểm lúc {lanKiem}</> : null}
        {ghiChu ? <> · {ghiChu}</> : null}
      </dd>
    </div>
  );
}

function ChuWebhook({ w, bayGio }: { w: NhipWebhook; bayGio: Date }) {
  if (w.trangThai === "CHUA_BIET") return <>chưa có dữ liệu từ Agent</>;
  if (w.trangThai === "CHUA_TUNG" || !w.lanCuoi) return <>Agent báo chưa từng nhận sự kiện Meta</>;
  return <>Agent báo nhận sự kiện Meta lần cuối {tuoiChu(bayGio.getTime() - w.lanCuoi.getTime())} trước ({gioVn(w.lanCuoi)})</>;
}

export function TheAgent({
  v,
  bayGio,
  quyen,
}: {
  v: AgentKetNoiView;
  bayGio: Date;
  quyen: { quanLy: boolean; page: boolean };
}) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [thongBao, datThongBao] = useState<{ ok: boolean; chu: string } | null>(null);
  const { agent, tongHop, thamDo } = v;
  const nhip = tongHop.nhip;
  const cat = v.catalog;

  function chay(f: () => Promise<{ ok: true } | { ok: false; error: string }>, chuOk: string) {
    datThongBao(null);
    batDau(async () => {
      const r = await f();
      datThongBao(r.ok ? { ok: true, chu: chuOk } : { ok: false, chu: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <article className={LOP_THE} aria-label={`Agent ${agent.name}`} data-agent={agent.id}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 break-words text-base font-semibold">{agent.name}</h2>
        <NhanDon tone={agent.environment === "PROD" ? "warning" : "info"}>{agent.environment}</NhanDon>
        <NhanTong ketQua={tongHop} />
      </header>
      <p className="mt-1 text-sm text-muted-foreground" data-ly-do-tong-hop>
        {tongHop.lyDo}
      </p>
      {tongHop.canhBao.length > 0 ? (
        <ul className="mt-3 grid gap-1 rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink" aria-label="Cảnh báo">
          {tongHop.canhBao.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 min-[120rem]:grid-cols-4">
        <O
          nhan="Nhịp sống"
          giaTri={
            nhip.trangThai === "CHUA_TUNG" ? "Chưa từng có" : `${CHU_NHIP[nhip.trangThai]} · ${tuoiChu(nhip.tuoiMs ?? 0)} trước`
          }
          nguon="Agent gửi qua /heartbeats"
          lanKiem={gioVn(nhip.lanCuoi)}
          ghiChu="Nhịp sống KHÔNG chứng minh webhook, token Page hay luồng đầu-cuối"
        />
        <O
          nhan="Hợp đồng"
          giaTri={`${CHU_HOP_DONG[tongHop.hopDong.contractStatus]} · ${CHU_HASH[tongHop.hopDong.hash]}`}
          nguon="công tắc tay của Admin + hash Agent tự khai"
          lanKiem={gioVn(nhip.lanCuoi)}
        />
        <O
          nhan="Bản build"
          giaTri={`${agent.lastAgentVersion ?? "—"} · ${rutGon(agent.lastBuildSha, 7)}`}
          nguon="Agent tự khai ở nhịp sống"
          lanKiem={gioVn(nhip.lanCuoi)}
        />
        <O
          nhan="Catalog"
          giaTri={
            cat.moiNhat === null
              ? "Chưa xuất bản bản nào"
              : cat.daThay === null
                ? `Agent chưa báo · mới nhất v${cat.moiNhat}`
                : `Agent thấy v${cat.daThay} · mới nhất v${cat.moiNhat}${cat.tre ? " (CŨ)" : ""}`
          }
          nguon="Agent khai (catalogVersionSeen) so với bản Admin đã xuất bản"
          lanKiem={gioVn(nhip.lanCuoi)}
        />
        <O
          nhan="Yêu cầu 24 giờ"
          // Lỗi từ chối (400/401/413/415/429…) bị loại TRƯỚC bảng yêu cầu nên máy chủ KHÔNG có số này — in «0 lỗi» là nói dối («không có yêu cầu hỏng»). Có dòng lỗi thật thì in; không thì nói «chưa đo».
          giaTri={
            v.tuChoi
              ? `${v.luuLuong24h.tong} yêu cầu đã xử lý (24 giờ)${v.luuLuong24h.loi > 0 ? ` · ${v.luuLuong24h.loi} lỗi khi xử lý` : ""} · ${v.tuChoi.tong} bị từ chối ở bước xác thực (hôm nay + hôm qua)${v.tuChoi.theoMa.length > 0 ? ` — ${v.tuChoi.theoMa.slice(0, 3).map((m) => `${m.ma} ×${m.n}`).join(", ")}` : ""}`
              : v.luuLuong24h.loi > 0
                ? `${v.luuLuong24h.tong} yêu cầu · ${v.luuLuong24h.loi} lỗi`
                : `${v.luuLuong24h.tong} yêu cầu đã xử lý · lỗi từ chối: chưa đo`
          }
          nguon={v.tuChoi ? "máy chủ đếm + bộ đếm từ chối (gộp, không lưu nội dung)" : "máy chủ đếm"}
          lanKiem={gioVn(bayGio)}
          ghiChu={
            v.tuChoi
              ? "bộ đếm chỉ gồm yêu cầu đã qua kiểm chữ ký rồi bị từ chối ở bước xác thực (hết hạn mức, lệch giờ, dữ liệu sai…); KHÔNG gồm xung đột idempotency (409) hay lỗi 5xx khi xử lý. Chữ ký sai/Agent lạ đếm riêng ở dòng «bị từ chối khi chưa xác thực được»"
              : "chỉ đếm yêu cầu đã qua xác thực; yêu cầu bị 401/413/415 bị loại trước nên không nằm ở đây — bật «Ghi bộ đếm yêu cầu bị từ chối» ở Cấu hình vận hành để có số thật"
          }
        />
        <O
          nhan="Hồ sơ chờ"
          giaTri={`${v.hoSo.cho} chờ · ${v.hoSo.dangXuLy} đang xử lý · ${v.hoSo.quaHan} quá hạn SLA${v.hoSo.quaTuoi > 0 ? ` · ${v.hoSo.quaTuoi} ứ trong hàng chờ quá ngưỡng tuổi` : ""}`}
          nguon="máy chủ đếm trong phạm vi của bạn"
          lanKiem={gioVn(bayGio)}
        />
        <O
          nhan="Sự cố đang mở"
          giaTri={
            v.suCoMo.tong === 0 ? (
              "Không có"
            ) : (
              <Link href={`?tab=su-co&agentId=${agent.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-6">
                {v.suCoMo.tong} (cao nhất: {v.suCoMo.nghiemTrongNhat ? CHU_MUC_SU_CO[v.suCoMo.nghiemTrongNhat] : "—"})
              </Link>
            )
          }
          nguon="Agent báo qua /incidents"
          lanKiem={gioVn(bayGio)}
        />
        <O
          nhan="Thăm dò hai chiều"
          giaTri={
            thamDo.dangMo
              ? `Đang chờ Agent xác nhận (hết hạn ${gioVn(thamDo.dangMo.expiresAt)})`
              : thamDo.ackGanNhat
                ? `Agent đã xác nhận lúc ${gioVn(thamDo.ackGanNhat)}`
                : "Chưa có lần nào"
          }
          nguon="Admin phát hành, Agent chép lại ở nhịp kế tiếp"
        />
      </dl>

      <section className="mt-5" aria-label={`Bốn tầng kiểm chứng — ${agent.name}`}>
        <h3 className="text-sm font-semibold">Kiểm chứng L1–L4</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Chỉ lần chạy PASS còn hạn mới tính là đạt. Giả lập (MOCK_ONLY), chưa chạy hay bị chặn không bao giờ tính.</p>
        <ul className="mt-2 grid gap-2">
          {CAC_TANG.map((t) => {
            const x = tongHop.tang[t];
            return (
              <li key={t} data-tang={t} className="grid gap-1 rounded-lg border border-border p-3 sm:grid-cols-[11rem_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
                <span className="text-sm font-medium">{nhanTang(t)}</span>
                <NhanTang tang={x} />
                <div className="min-w-0 text-xs text-muted-foreground">
                  <p>{x.lyDo}</p>
                  <p>
                    Nguồn: {x.nguon}
                    {x.lanKiemCuoi ? <> · lần kiểm {gioVn(x.lanKiemCuoi)}</> : null}
                  </p>
                  {x.coGiaLap && !x.dat ? <p className="font-medium text-foreground">Có lần chạy giả lập (MOCK_ONLY) — không tính là đạt.</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-5" aria-label={`Các Page — ${agent.name}`}>
        <h3 className="text-sm font-semibold">Page được cấp ({v.pages.length})</h3>
        {v.pages.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Chưa được cấp Page nào.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {v.pages.map((p) => (
              <li key={p.pageId} className="grid gap-2 rounded-lg border border-border p-3" data-page={p.pageId}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{p.pageId}</span>
                  <NhanTong ketQua={p.tinhTrang} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Webhook (lời khai của Agent, Admin không xác minh được): <ChuWebhook w={p.webhook} bayGio={bayGio} />
                </p>
                <p className={p.luuLuongBatThuong ? "text-xs font-medium text-state-warning-ink" : "text-xs text-muted-foreground"} data-cuoc-moi={p.cuocMoiHomNay} data-bat-thuong={p.luuLuongBatThuong ? "co" : undefined}>
                  Cuộc trò chuyện mới hôm nay: {p.cuocMoiHomNay}
                  {p.luuLuongBatThuong ? " — vượt ngưỡng cảnh báo hằng ngày của một Page (có thể AI bị lạm dụng). Chỉ cảnh báo, không chặn." : ""}
                </p>
                {quyen.page ? (
                  p.state === "ENABLED" ? (
                    <div>
                      <NutLyDo
                        nhan="Tạm dừng Page"
                        tieuDe={`Tạm dừng Page ${p.pageId}?`}
                        moTa="Agent ngừng thu thập hồ sơ cho Page này từ nhịp sống kế tiếp; chuyển khách cho nhân viên vẫn dùng được."
                        nhanXacNhan="Tạm dừng"
                        thongBaoXong="Đã tạm dừng Page."
                        chay={(lyDo) => datTrangThaiPageAction({ agentId: agent.id, pageId: p.pageId, state: "PAUSED", lyDo })}
                      />
                    </div>
                  ) : (
                    <div>
                      <NutLyDo
                        nhan="Bật lại Page"
                        tieuDe={`Bật lại Page ${p.pageId}?`}
                        moTa="Agent nhận lại hồ sơ cho Page này từ nhịp sống kế tiếp."
                        nhanXacNhan="Bật lại"
                        nguyHiem={false}
                        thongBaoXong="Đã bật lại Page."
                        chay={(lyDo) => datTrangThaiPageAction({ agentId: agent.id, pageId: p.pageId, state: "ENABLED", lyDo })}
                      />
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {quyen.quanLy ? (
        <section className="mt-5 flex flex-wrap items-center gap-2" aria-label={`Hành động — ${agent.name}`}>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={dang || !agent.active || !!thamDo.dangMo}
            onClick={() => chay(async () => {
              const r = await phatHanhThamDoAction({ agentId: agent.id });
              return r.ok ? { ok: true as const } : r;
            }, "Đã phát thăm dò. Agent sẽ nhận ở nhịp sống kế tiếp và xác nhận ở nhịp sau đó.")}
          >
            {dang ? "Đang xử lý…" : "Kiểm tra kết nối"}
          </Button>
          {agent.active ? (
            <NutLyDo
              nhan="Tắt Agent"
              tieuDe={`Tắt Agent “${agent.name}”?`}
              moTa="Mọi yêu cầu của Agent bị từ chối (401 AGENT_DISABLED) ngay lập tức."
              nhanXacNhan="Tắt Agent"
              thongBaoXong="Đã tắt Agent."
              chay={(lyDo) => datHoatDongAgentAction({ agentId: agent.id, active: false, lyDo })}
            />
          ) : null}
          {thamDo.dangMo ? <p className="text-xs text-muted-foreground">Đang có thăm dò chờ xác nhận — chưa phát thêm được.</p> : null}
          <p className="text-xs text-muted-foreground">L2 tự được ghi khi Agent xác nhận thăm dò ở nhịp sống kế tiếp — không có nút ghi tay.</p>
        </section>
      ) : null}
      {thongBao ? (
        <p role={thongBao.ok ? "status" : "alert"} className={thongBao.ok ? "mt-3 text-sm text-foreground" : "mt-3 text-sm text-state-danger-ink"}>
          {thongBao.chu}
        </p>
      ) : null}
    </article>
  );
}
