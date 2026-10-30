import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { znsProvider } from "@/lib/zalo/provider";
import { getRateLimitBackend } from "@/lib/rate-limit";
import { isMisaConfigured, isMisaLive, getMisaConfig } from "@/lib/misa/service";
import { MisaControls } from "./_components/misa-controls";
import { ZnsTest } from "./_components/zns-test";
import { ZalocrmSection } from "./_components/zalocrm-section";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { docTinhHinhNganSach } from "@/lib/ngan-sach-goi-ra/so-chi";
import { dinhDangVnd, kyThangDeDoc } from "@/lib/ngan-sach-goi-ra/chinh-sach";
import { isZalocrmEnabled } from "@/lib/flags";
import { docTongQuanNick, whereNhatKyZalocrm } from "@/lib/integrations/zalocrm/nick-admin";
import { tomTatGiao } from "@/lib/integrations/zalocrm/pham-vi-nick";

export const metadata = { title: "Tích hợp | Admin" };
export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  SENT: "bg-state-success-soft text-state-success-ink",
  SUCCESS: "bg-state-success-soft text-state-success-ink",
  SKIPPED: "bg-state-warning-soft text-state-warning-ink",
  FAILED: "bg-state-danger-soft text-state-danger-ink",
  PENDING: "bg-state-info-soft text-state-info-ink",
};

/**
 * Định dạng mốc thời gian cho các bảng ở màn này.
 *
 * Cùng công thức đang dùng inline ở bảng ZNS/MISA (`toISOString`) — cố ý KHÔNG dùng
 * `toLocaleString`: mục ZaloCRM truyền chuỗi xuống một client component, mà giờ địa
 * phương tính ở hai phía sẽ lệch nhau và sinh cảnh báo hydrate.
 */
function dinhDangLuc(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("settings:view"))) redirect("/dashboard");

  const canEdit = await checkPermission("settings:edit");
  const zaloConfigured = znsProvider.isConfigured();
  const zaloLive = znsProvider.isLive();

  // ZaloMessageLog/IntegrationLog là log tích hợp global (∉ SCOPED_MODELS) → pass-through.
  // ⚠️ Vì là pass-through nên `sdb` KHÔNG cách ly cơ sở ở hai bảng đó: mục ZaloCRM bên
  // dưới phải tự dựng `where` theo actor (`whereNhatKyZalocrm`) — giữ `actor` lại để dùng.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [zaloLogs, misaCfg, misaLogs] = await Promise.all([
    sdb.zaloMessageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, toPhone: true, templateKey: true, status: true, errorMessage: true, fallbackEmailed: true, createdAt: true, providerMessageId: true },
    }),
    getMisaConfig(),
    sdb.integrationLog.findMany({
      where: { provider: "MISA" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, action: true, status: true, errorMessage: true, createdAt: true },
    }),
  ]);
  const misaConfigured = isMisaConfigured();
  const misaLive = isMisaLive();
  // Trần chi phí tháng (27/08/2026). Đặt ở màn này vì đây là nơi người vận hành đã
  // quen vào xem "các đường ra ngoài đang thế nào". Cảnh báo 80% mà chỉ nằm trong log
  // server thì thực tế là không có cảnh báo — phải có chỗ người nhìn thấy.
  const nganSach = await docTinhHinhNganSach();
  // BGĐ 31/07 — tài khoản nhận tiền theo TỪNG CƠ SỞ + 1 dòng cấu hình chung (fallback).
  const centers = await sdb.center.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  // ─── Mục ZaloCRM (S7) ─────────────────────────────────────────────────────
  // Cờ TẮT ⇒ không nạp gì: mục vẫn hiện (để người vận hành biết trạng thái đường lùi)
  // nhưng không tốn ba lượt truy vấn cho một tính năng chưa bật.
  const zalocrmBat = isZalocrmEnabled();
  const zalocrm = zalocrmBat ? await docTongQuanNick(actor) : null;
  const zalocrmLogs = zalocrm
    ? await sdb.integrationLog.findMany({
        // LUÔN có `where.provider` — chỉ mục duy nhất của bảng là
        // [provider, status, createdAt]. Và đây cũng chính là lưới cách ly cơ sở:
        // `IntegrationLog` ∉ SCOPED_MODELS nên `sdb` không lọc giúp dòng nào.
        where: whereNhatKyZalocrm(actor, zalocrm.orgCodes),
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          provider: true,
          action: true,
          status: true,
          errorMessage: true,
          createdAt: true,
        },
      })
    : [];

  // 31/08/2026 (theo `main`) — khối VietQR theo cơ sở ĐÃ GỠ khỏi màn này. Tài khoản nhận
  // tiền nay khai trong từng phương thức thanh toán loại "Chuyển khoản"
  // (`/admin/payment-methods`). Giữ lại đường ghi cũ là giữ một CỬA GHI THỨ HAI vào kho
  // `IntegrationConfig` khoá `VIETQR:*` — kho mà đường đọc chỉ còn dùng làm lối lùi.

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Tích hợp ngoài</h1>
        <p className="text-sm text-muted-foreground">Trạng thái các adapter. Khi thiếu credential, hệ thống tự fallback an toàn.</p>
      </div>

      {/* Trần chi phí THÁNG cho lời gọi ra ngoài — chốt 27/08/2026. */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">
            Ngân sách gọi ra ngoài — kỳ {kyThangDeDoc(nganSach.kyThang)}
          </h2>
          <span className="text-xs text-muted-foreground">
            Tổng đã dùng <b className="tabular-nums">{dinhDangVnd(nganSach.tongDaTieuVnd)}đ</b> /{" "}
            {dinhDangVnd(nganSach.tongTranVnd)}đ
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Chạm trần là NGỪNG gọi ra (không âm thầm gửi tiếp). Cảnh báo ở mốc{" "}
          {nganSach.mocCanhBaoPhanTram}%. Sửa các con số trần ở màn{" "}
          <b>Cấu hình vận hành</b> (nhóm Tài chính) — có hiệu lực trong vài phút, không
          cần triển khai lại. Tổng là số cộng của các trục, không có ô nhập riêng.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {nganSach.theoTruc.map((t) => {
            const trangThai = t.daChamTran
              ? "bg-state-danger-soft text-state-danger-ink"
              : t.phanTram >= nganSach.mocCanhBaoPhanTram
                ? "bg-state-warning-soft text-state-warning-ink"
                : "bg-state-success-soft text-state-success-ink";
            return (
              <div key={t.truc} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{t.nhan}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${trangThai}`}>
                    {t.tranVnd === 0 ? "đang tắt" : `${t.phanTram}%`}
                  </span>
                </div>
                <div className="mt-1 text-sm tabular-nums text-foreground">
                  {dinhDangVnd(t.daTieuVnd)}đ{" "}
                  <span className="text-xs text-muted-foreground">
                    / {dinhDangVnd(t.tranVnd)}đ
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.soLuot} lượt
                  {t.soLuotBiChan > 0 && (
                    <span className="text-state-danger-ink">
                      {" "}
                      · {t.soLuotBiChan} lượt BỊ CHẶN vì hết ngân sách
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* AUTH-SĐT P4 — soi nhanh backend rate-limit (P0-d): memory = bộ đếm reset
          theo instance serverless, không chặn được brute-force trải đều instance. */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Rate limit (Upstash Redis)</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ getRateLimitBackend() === "upstash" ? "bg-state-success-soft text-state-success-ink" : "bg-state-danger-soft text-state-danger-ink" }`}
          >
            {getRateLimitBackend() === "upstash" ? "Redis (bền vững)" : "Memory (per-instance!)"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {getRateLimitBackend() === "upstash"
            ? "Env Upstash đã nạp. Lưu ý: lỗi runtime (URL sai, DB đã xoá) vẫn tự rơi về memory từng request — thấy log [rate-limit] Upstash error thì kiểm console.upstash.com."
            : "Chưa nạp env UPSTASH_REDIS_REST_URL/TOKEN (hoặc chưa redeploy sau khi thêm) → bộ đếm chống brute-force reset theo instance."}
        </p>
      </section>

      {/* ⚠️ 31/08/2026 — khối "Tài khoản nhận tiền (VietQR)" ĐÃ GỠ khỏi màn này.
          Tài khoản nhận tiền nay khai NGAY TRONG từng phương thức thanh toán loại
          "Chuyển khoản" (/payment-methods), và mở nhanh từ trang Cơ sở → mục Thanh toán.
          Lý do gộp: trước đó có HAI cửa cho cùng một việc (màn này khai theo CƠ SỞ, form
          phương thức lại có 4 ô ngân hàng riêng không ai đọc) — người vận hành khai một
          nơi rồi tưởng nơi kia cũng đổi theo.
          Dữ liệu cũ ở IntegrationConfig khoá `VIETQR:*` vẫn được đọc như đường LÙI
          (lib/payments/vietqr.ts:resolveOrderPaymentConfig); chuyển nốt sang phương thức
          bằng `scripts/pttt-chuyen-tai-khoan-vietqr.ts`. */}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Zalo OA / ZNS</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ zaloLive ? "bg-state-success-soft text-state-success-ink" : zaloConfigured ? "bg-state-warning-soft text-state-warning-ink" : "bg-muted text-muted-foreground" }`}
          >
            {zaloLive ? "Đang bật (live)" : zaloConfigured ? "Có credential (mô phỏng)" : "Chưa cấu hình"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {zaloConfigured
            ? "Có ZALO_APP_ID + ZALO_OA_ACCESS_TOKEN. Bật ZALO_LIVE=true để gửi thật."
            : "Chưa có credential → tin nhắn Zalo bị bỏ qua, tự gửi email dự phòng."}
        </p>

        <ZnsTest canEdit={canEdit} />

        <div className="mt-3 overflow-x-auto">
          <PhanTrangBang>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">SĐT</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Fallback email</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  <th className="px-3 py-2">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {zaloLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Chưa có log.
                    </td>
                  </tr>
                ) : (
                  zaloLogs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.toPhone ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.templateKey ?? "—"}</td>
                      <td className="px-3 py-2">
                        {/* SENT + providerMessageId "SIMULATED-…" = ZALO_LIVE chưa bật: log xanh
                            nhưng KHÔNG tin nào rời hệ thống — phải phân biệt kẻo tưởng đã gửi. */}
                        {l.status === "SENT" && l.providerMessageId?.startsWith("SIMULATED-") ? (
                          <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-xs text-state-info-ink">SENT (mô phỏng)</span>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[l.status] ?? ""}`}>{l.status}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{l.fallbackEmailed ? "có" : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.errorMessage ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      </section>

      {/* S7 — sức khoẻ trục Zalo cá nhân. Đặt ngay dưới Zalo OA/ZNS: hai mục cùng nói
          về Zalo, và người đi tìm "vì sao khách nhắn mà không thấy" sẽ nhìn quanh đây. */}
      <ZalocrmSection
        enabled={zalocrmBat}
        canEdit={canEdit}
        rows={(zalocrm?.rows ?? []).map((n) => ({
          zcrmAccountId: n.zcrmAccountId,
          orgCode: n.orgCode,
          centerName: n.centerName,
          displayName: n.displayName,
          daGiaoCho: tomTatGiao(n.giao),
          status: n.status,
          lastEventAt: n.lastEventAt ? dinhDangLuc(n.lastEventAt) : null,
        }))}
        canhBao={zalocrm?.canhBao ?? []}
        nguongGio={zalocrm?.nguongGio ?? 0}
        orgCodes={zalocrm?.orgCodes ?? []}
        logs={zalocrmLogs.map((l) => ({
          id: l.id,
          provider: l.provider,
          action: l.action,
          status: l.status,
          errorMessage: l.errorMessage,
          createdAt: dinhDangLuc(l.createdAt),
        }))}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">MISA AMIS (kế toán)</h2>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ misaCfg.isEnabled && misaLive ? "bg-state-success-soft text-state-success-ink" : misaCfg.isEnabled && misaConfigured ? "bg-state-warning-soft text-state-warning-ink" : "bg-muted text-muted-foreground" }`}
            >
              {misaCfg.isEnabled
                ? misaLive
                  ? "Đang bật (live)"
                  : misaConfigured
                    ? "Bật (mô phỏng)"
                    : "Bật nhưng thiếu credential"
                : "Đang tắt"}
            </span>
            <MisaControls enabled={misaCfg.isEnabled} canEdit={canEdit} />
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {misaConfigured
            ? "Có credential MISA. Bật MISA_LIVE=true để push thật."
            : "Chưa có credential (MISA_CLIENT_ID/SECRET/API_URL) → sync bị bỏ qua, không push."}
        </p>

        <div className="mt-3 overflow-x-auto">
          <PhanTrangBang>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Hành động</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  <th className="px-3 py-2">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {misaLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      Chưa có log.
                    </td>
                  </tr>
                ) : (
                  misaLogs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.action}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLS[l.status] ?? ""}`}>{l.status}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.errorMessage ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      </section>
    </div>
  );
}
