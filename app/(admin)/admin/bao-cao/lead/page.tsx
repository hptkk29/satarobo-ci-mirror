import { redirect } from "next/navigation";
import { safeCache } from "@/lib/cache/safe-cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import {
  buildLeadReport,
  type LeadReportRecord,
  type LeadLedgerRow,
} from "@/lib/reports/lead";
import {
  resolveReportFilters,
  reportFilterCacheKey,
  reportDateWhere,
  type ReportFilters,
} from "@/lib/reports/filters";
import { ReportFilterBar } from "@/components/admin/report-filter-bar";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo Lead | Admin" };
export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number) => n.toLocaleString("vi-VN");

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// REQ-05: tính báo cáo lead (fetch scoped + reduce thuần → object PRIMITIVE, không Date).
async function computeLeadReport(actor: Actor, filters: ReportFilters) {
  const sdb = scopedDb(actor); // Lead auto-scoped theo cơ sở (HO/SUPER_ADMIN bypass).
  const dateWhere = reportDateWhere(filters); // lọc theo Lead.createdAt.
  const [rows, centers] = await Promise.all([
    sdb.lead.findMany({
      where: {
        deletedAt: null,
        ...(filters.centerId ? { centerId: filters.centerId } : {}),
        ...(dateWhere ? { createdAt: dateWhere } : {}),
      },
      select: {
        id: true,
        status: true,
        source: true,
        centerId: true,
        commissionSource: true,
        createdAt: true,
        convertedAt: true,
        // Sổ rụng (GĐ1) — nguồn cho khối "Lead rụng ở bậc nào" bên dưới.
        droppedAtStage: true,
        lostNote: true,
        // Tỷ lệ chốt theo từng sale (27/08). Chỉ lấy id ở đây; tên tra sau, một lượt.
        assignedToId: true,
      },
      take: 20_000,
    }),
    // Center KHÔNG thuộc SCOPED_MODELS → sdb pass-through (chỉ lấy id→tên để gắn nhãn).
    sdb.center.findMany({ select: { id: true, name: true } }),
  ]);

  const centerNames = Object.fromEntries(centers.map((c) => [c.id, c.name]));

  // Tên sale: tra MỘT lượt theo tập id có thật trong kết quả, không join theo từng dòng.
  // `User` không thuộc SCOPED_MODELS nên sdb pass-through — ở đây chỉ lấy id→tên để gắn
  // nhãn, không mở thêm dữ liệu nào: id đã nằm sẵn trong lead mà người này xem được.
  const saleIds = [...new Set(rows.map((r) => r.assignedToId).filter((x): x is string => !!x))];
  const sales = saleIds.length
    ? await sdb.user.findMany({ where: { id: { in: saleIds } }, select: { id: true, name: true } })
    : [];
  const saleNames = Object.fromEntries(sales.map((u) => [u.id, u.name ?? u.id]));
  // Sổ trạng thái (GĐ1) của ĐÚNG tập lead đang xem — nguồn cho phễu "đã từng tới".
  //
  // Lọc theo `leadId in (...)` chứ không theo khoảng ngày của chính sổ: một lead tạo
  // trong kỳ có thể đổi trạng thái sang tháng sau, và bậc cao nhất nó từng tới vẫn
  // thuộc về lead đó. Lọc sổ theo ngày là cắt mất đúng phần đuôi ấy.
  //
  // `select` chỉ hai cột: bảng này mỗi lead nhiều dòng, kéo cả hàng là gánh vô ích.
  const leadIds = rows.map((r) => r.id);
  const ledger: LeadLedgerRow[] = leadIds.length
    ? await sdb.leadStatusHistory.findMany({
        where: { leadId: { in: leadIds } },
        select: { leadId: true, toStatus: true },
      })
    : [];

  const records: LeadReportRecord[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    centerId: r.centerId,
    commissionSource: r.commissionSource,
    createdAt: r.createdAt,
    convertedAt: r.convertedAt,
    droppedAtStage: r.droppedAtStage,
    lostNote: r.lostNote,
    assignedToId: r.assignedToId,
  }));
  return buildLeadReport(records, centerNames, saleNames, ledger);
}

export default async function LeadReportPage({
  searchParams,
}: {
  searchParams: Promise<{ center?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !(await checkPermission("leads:view-all")) &&
    !(await checkPermission("leads:view-own"))
  ) {
    redirect("/dashboard");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache cross-request keyed THEO SCOPE (actorScopeKey bắt buộc → không leak
  // số liệu giữa cơ sở) + bộ lọc cơ sở/ngày. TTL 120s; output primitive nên serialize an toàn.
  const report = await safeCache(
    () => computeLeadReport(actor, fc.filters),
    ["lead-report", actorScopeKey(actor), reportFilterCacheKey(fc.filters)],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Báo cáo Lead</h1>
        <p className="text-sm text-muted-foreground">
          Phễu SR.QD.217 mở rộng — phân tích chuyển đổi theo bước, nguồn, cơ sở và tháng.
        </p>
      </div>

      <ReportFilterBar
        basePath="/bao-cao/lead"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      {/* Thẻ số liệu tổng quan */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tổng lead" value={num(report.summary.total)} />
        <Stat
          label="Đã chốt"
          value={num(report.summary.converted)}
          hint={`Tỷ lệ ${pct(report.summary.conversionRate)}`}
        />
        <Stat label="Đang xử lý" value={num(report.summary.active)} />
        <Stat label="Thất bại / trùng" value={num(report.summary.lost)} />
      </div>

      {report.summary.total === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Chưa có lead trong phạm vi của bạn.
        </p>
      ) : null}

      {/* Phễu chuyển đổi — GĐ1: vẽ theo "ĐÃ TỪNG TỚI" (đọc sổ LeadStatusHistory).
          Trước đây vẽ theo trạng thái HIỆN TẠI, nên lead từng lên tới "Đã học thử" rồi
          rớt biến mất khỏi mọi bậc — kể cả bậc nó đã đi qua thật. Cột "đang ở" giữ lại
          trong bảng bên dưới vì nó trả lời câu khác: tồn đọng đang nằm ở đâu. */}
      <Card title="Phễu chuyển đổi (số lead ĐÃ TỪNG tới mỗi bước)">
        <FunnelChart
          data={report.funnelReached.map((f) => ({ name: f.label, value: f.count }))}
          height={360}
        />
        <PhanTrangBang cuonNgang>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Bước</th>
                <th className="px-3 py-2 text-right">Đã từng tới</th>
                <th className="px-3 py-2 text-right">Đang ở đây trở lên</th>
              </tr>
            </thead>
            <tbody>
              {report.funnelReached.map((f, i) => (
                <tr key={f.status} className="border-t">
                  <td className="px-3 py-2">{f.label}</td>
                  <td className="px-3 py-2 text-right font-medium">{f.count}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {report.funnel[i]?.count ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
        {report.ledgerCoverage.khongCoSo > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {report.ledgerCoverage.coSo}/
            {report.ledgerCoverage.coSo + report.ledgerCoverage.khongCoSo} lead có sổ
            trạng thái. Sổ chỉ ghi từ 25/08/2026 và cố ý không dựng lại quá khứ, nên{" "}
            {report.ledgerCoverage.khongCoSo} lead cũ vẫn đếm theo trạng thái hiện tại —
            với những lead đó, hai cột trên bằng nhau.
          </p>
        ) : null}
      </Card>

      {/* Tỷ lệ chuyển từng bước — mẫu số nay là phễu "đã từng tới", nên lead rụng
          giữa chừng vẫn nằm trong mẫu. Con số sẽ THẤP hơn bản trước 27/08 ở những kỳ
          có lead đã rụng: bản trước bỏ chúng khỏi cả tử lẫn mẫu nên tỷ lệ tự đẹp lên. */}
      <Card title="Tỷ lệ chuyển từng bước">
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Bước</th>
                <th className="px-3 py-2 text-right">Tỷ lệ chuyển</th>
              </tr>
            </thead>
            <tbody>
              {report.funnelConversion.map((c) => (
                <tr key={`${c.fromLabel}-${c.toLabel}`} className="border-t">
                  <td className="px-3 py-2">
                    {c.fromLabel} → {c.toLabel}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{pct(c.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </Card>

      {/* Tỷ lệ chốt của từng sale trong cơ sở (27/08 — chủ dự án yêu cầu).
          Đặt ngay dưới phễu vì đây là câu hỏi tiếp theo của người vừa nhìn phễu:
          "bậc nào rơi nhiều" → "rơi ở tay ai". */}
      <Card title="Tỷ lệ chốt theo từng sale">
        {report.bySale.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có lead nào trong khoảng lọc này.
          </p>
        ) : (
          <PhanTrangBang cuonNgang>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Sale</th>
                  <th className="px-3 py-2">Cơ sở</th>
                  <th className="px-3 py-2 text-right">Tổng lead</th>
                  <th className="px-3 py-2 text-right">Đã chốt</th>
                  <th className="px-3 py-2 text-right">Tỷ lệ chốt</th>
                </tr>
              </thead>
              <tbody>
                {report.bySale.map((s) => (
                  <tr key={s.key} className="border-t">
                    <td className="px-3 py-2 font-medium">{s.saleLabel}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.centerLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(s.converted)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {pct(s.conversionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Một người ôm lead ở hai cơ sở sẽ có hai dòng — cố ý, để tỷ lệ của cơ sở này
          không bị pha lẫn lead của cơ sở kia. Dòng &quot;Chưa chia cho ai&quot; là lead
          chưa có người phụ trách, thường là chỗ hở lớn nhất của phễu.
        </p>
      </Card>

      {/* Theo nguồn */}
      <Card title="Lead theo nguồn">
        <BarChart
          data={report.bySource.map((s) => ({
            name: s.label,
            "Tổng": s.total,
            "Đã chốt": s.converted,
          }))}
          xKey="name"
          bars={[
            { key: "Tổng", name: "Tổng", color: "#F97316" },
            { key: "Đã chốt", name: "Đã chốt", color: "#7C3AED" },
          ]}
          height={300}
        />
      </Card>

      {/* Theo cơ sở */}
      <Card title="Lead theo cơ sở">
        <BarChart
          data={report.byCenter.map((s) => ({
            name: s.label,
            "Tổng": s.total,
            "Đã chốt": s.converted,
          }))}
          xKey="name"
          bars={[
            { key: "Tổng", name: "Tổng", color: "#F97316" },
            { key: "Đã chốt", name: "Đã chốt", color: "#7C3AED" },
          ]}
          height={300}
        />
      </Card>

      {/* Theo tháng */}
      <Card title="Lead theo tháng">
        <LineChart
          data={report.byMonth.map((m) => ({
            name: m.month,
            "Tổng": m.total,
            "Đã chốt": m.converted,
          }))}
          xKey="name"
          lines={[
            { key: "Tổng", name: "Tổng", color: "#F97316" },
            { key: "Đã chốt", name: "Đã chốt", color: "#7C3AED" },
          ]}
          height={300}
        />
      </Card>

      {/* Theo nguồn hoa hồng */}
      <Card title="Lead theo nguồn hoa hồng">
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Nguồn hoa hồng</th>
                <th className="px-3 py-2 text-right">Tổng</th>
                <th className="px-3 py-2 text-right">Đã chốt</th>
                <th className="px-3 py-2 text-right">Tỷ lệ</th>
              </tr>
            </thead>
            <tbody>
              {report.byCommissionSource.map((s) => (
                <tr key={s.key} className="border-t">
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2 text-right">{num(s.total)}</td>
                  <td className="px-3 py-2 text-right">{num(s.converted)}</td>
                  <td className="px-3 py-2 text-right font-medium">{pct(s.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </Card>

      {/* Rụng ở bậc nào — người đọc DUY NHẤT của Lead.droppedAtStage + lostNote.
          Hai cột đó có từ GĐ1 nhưng tới 26/08 không màn nào đọc. */}
      <Card title="Lead rụng ở bậc nào">
        {report.byDropStage.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có lead nào rụng trong khoảng lọc này. (Bậc rụng chỉ ghi khi lead
            chuyển sang &quot;Đang nuôi dưỡng&quot; hoặc &quot;Đã mất&quot;.)
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Rụng ở bậc</th>
                  <th className="px-3 py-2 text-right">Số lead</th>
                  <th className="px-3 py-2">Lý do hay gặp</th>
                </tr>
              </thead>
              <tbody>
                {report.byDropStage.map((d) => (
                  <tr key={d.stage} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{d.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(d.count)}</td>
                    <td className="px-3 py-2">
                      {d.topReasons.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {d.topReasons.map((r) => (
                            <li key={r.reason} className="text-muted-foreground">
                              {r.reason}{" "}
                              <span className="tabular-nums">({num(r.count)})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {d.missingReason > 0 && (
                        // KHÔNG gộp vào "—": lead rụng trước ngày bật ép nhập lý do
                        // vốn không có gì để hiện, khác hẳn "người dùng bỏ trống".
                        <p className="mt-1 text-xs text-muted-foreground">
                          {num(d.missingReason)} lead rụng trước khi hệ thống bắt ghi
                          lý do
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
