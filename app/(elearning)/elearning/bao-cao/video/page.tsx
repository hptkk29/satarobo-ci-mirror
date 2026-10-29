import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { dungR2ChoBai, type DaiNhiet } from "@/lib/elearning/report-r2";
import { CAU_LUAT, type MaLuatCo } from "@/lib/elearning/watch-flag-rules";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { Khoi, KhoiRong, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { DecideFlag } from "./_components/decide-flag";

/**
 * EL-13 — BÁO CÁO R2: CHI TIẾT XEM VIDEO + HÀNG ĐỢI CỜ NGHI NGỜ.
 *
 * ⚠️ R2 có CỬA SỔ 90 NGÀY. Câu đó phải nằm TRÊN màn hình, không giấu trong tài
 * liệu: người quản lý mở R2 cho một khoá từ năm ngoái và thấy trống trơn sẽ kết
 * luận "hệ thống mất dữ liệu" và đi báo lỗi — trong khi hạn dọn đang làm đúng việc.
 *
 * ⚠️ Hàng đợi cờ đặt CÙNG trang với báo cáo, không tách màn riêng: người xử cần
 * nhìn số liệu của bài để quyết, và bắt họ mở hai màn rồi tự ghép là cách chắc
 * chắn để họ quyết mà không xem gì.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chi tiết xem video | Sata Robo",
  robots: { index: false, follow: false },
};

const gio = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(d) : "—";

/** Dải nhiệt: mỗi ô một khối, đậm dần theo tỉ lệ đã xem. */
function Dai({ dai }: { dai: DaiNhiet }) {
  return (
    <div
      role="img"
      aria-label={`Dải đoạn đã xem của video dài ${Math.round(dai.o.length * dai.giayMoiO)} giây: ${Math.round(
        (dai.o.filter((v) => v > 0).length / Math.max(1, dai.o.length)) * 100,
      )}% số ô có người xem`}
      className="flex h-4 w-full gap-px overflow-hidden rounded"
    >
      {dai.o.map((v, i) => (
        <div
          key={i}
          className="flex-1"
          // Màu tính theo tỉ lệ nên không dùng lớp Tailwind động được (JIT không
          // sinh ra lớp từ chuỗi ghép lúc chạy).
          style={{
            backgroundColor:
              v === 0 ? "rgb(229 231 235)" : `rgba(22 163 74 / ${0.25 + v * 0.75})`,
          }}
          title={`${Math.round(i * dai.giayMoiO)}s–${Math.round((i + 1) * dai.giayMoiO)}s · ${Math.round(v * 100)}%`}
        />
      ))}
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ bai?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:video-analytics:view")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Chi tiết xem video" />
        <NoPermission
          permission="elearning:video-analytics:view"
          what="báo cáo chi tiết xem video"
          askWho="phòng Đào tạo"
        />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const { bai } = await searchParams;

  const [dsBai, hangDoi] = await Promise.all([
    db.trnLesson.findMany({
      where: { kind: "VIDEO", deletedAt: null },
      select: { id: true, title: true, durationSec: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
    // Hàng đợi CỦA CHÍNH người đang xem: cờ giao cho họ và chưa có quyết định.
    // Không hiện cờ của người khác — người xử có tên là để mỗi cờ có đúng một
    // người thấy mình phải trả lời.
    db.trnWatchFlag.findMany({
      where: {
        handlerUserId: session.user.id,
        status: { in: ["OPEN", "APPEALED"] },
      },
      select: {
        id: true,
        userId: true,
        ruleCode: true,
        status: true,
        openedAt: true,
        appealDeadline: true,
        appealedAt: true,
        appealNote: true,
        decisionDueAt: true,
        evidenceJson: true,
        lesson: { select: { title: true } },
      },
      orderBy: [{ status: "desc" }, { openedAt: "asc" }],
      take: 100,
    }),
  ]);

  const dong = bai ? await dungR2ChoBai(db, bai) : [];

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/bao-cao">Báo cáo tuân thủ</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title="Chi tiết xem video"
          subtitle={
            <>
              Báo cáo này có <strong>cửa sổ 90 ngày</strong>. Dữ liệu đoạn xem và phiên
              xem cũ hơn 90 ngày đã bị xoá theo chính sách — trống ở đó là đúng, không
              phải mất dữ liệu. Báo cáo chứa dữ liệu hành vi của từng người học.
            </>
          }
        />
      </div>

      {/* ── Hàng đợi cờ ───────────────────────────────────────────────────── */}
      <Khoi tieuDe={`Cờ nghi ngờ chờ bạn xử (${hangDoi.length})`}>
        {hangDoi.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có cờ nào đang chờ bạn.</p>
        ) : (
          <div className="space-y-3">
            {hangDoi.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    {CAU_LUAT[c.ruleCode as MaLuatCo] ?? c.ruleCode}
                  </p>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {c.lesson.title}
                    <TrangThaiBadge sac={c.status === "APPEALED" ? "warning" : "info"}>
                      {c.status === "APPEALED" ? "Đã khiếu nại" : "Đang mở"}
                    </TrangThaiBadge>
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Mở lúc {gio(c.openedAt)} · hạn khiếu nại {gio(c.appealDeadline)}
                  {c.status === "APPEALED"
                    ? ` · đã khiếu nại ${gio(c.appealedAt)}, hạn trả lời ${gio(c.decisionDueAt)}`
                    : ""}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {Object.entries((c.evidenceJson ?? {}) as Record<string, number>).map(
                    ([k, v]) => (
                      <div key={k} className="flex gap-1.5">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-mono">{v}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {c.appealNote ? (
                  <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">
                    Khiếu nại: {c.appealNote}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Chưa có khiếu nại. Hết cửa sổ, cờ tự chốt thành “giữ cờ”.
                  </p>
                )}
                <DecideFlag flagId={c.id} />
              </div>
            ))}
          </div>
        )}
      </Khoi>

      {/* ── Chọn bài ──────────────────────────────────────────────────────── */}
      <Khoi tieuDe="Chọn bài video">
        {dsBai.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có bài video nào.</p>
        ) : (
          <nav aria-label="Bài video" className="flex flex-wrap gap-2">
            {dsBai.map((b) => (
              <Link
                key={b.id}
                href={`/elearning/bao-cao/video?bai=${b.id}`}
                aria-current={b.id === bai ? "true" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  b.id === bai
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {b.title}
              </Link>
            ))}
          </nav>
        )}
      </Khoi>

      {/* ── Bảng R2 ───────────────────────────────────────────────────────── */}
      {bai ? (
        <Khoi tieuDe="Từng người học">
          {dong.length > 0 ? (
            <p data-testid="r2-tom-tat-phien-ban" className="mb-3 text-sm text-muted-foreground">
              Phiên bản hiện tại của bài: <strong>{dong[0]!.phienBanBai}</strong> ·{" "}
              {dong.filter((d) => !d.laBanCu && d.trangThai === "DONE").length} người đã xong ở phiên bản này ·{" "}
              {dong.filter((d) => d.laBanCu && d.trangThai === "DONE").length} người đã xong ở phiên bản trước (không tính
              vào phiên bản hiện tại).
            </p>
          ) : null}
          {dong.length === 0 ? (
            <KhoiRong
              title="Chưa ai xem bài này"
              description="Hoặc dữ liệu đã quá 90 ngày — trống ở đây là đúng, không phải mất dữ liệu."
            />
          ) : (
            <div className="space-y-3">
              {dong.map((d) => (
                <div key={d.userId} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{d.userId}</span>
                    <span>
                      phủ <strong>{d.phanTramPhu}%</strong>
                      {d.laBanCu ? " (video cũ)" : ""} · xem {Math.round(d.totalWatchSec / 60)} phút · {d.soPhien} phiên
                    </span>
                  </div>
                  {d.laBanCu ? (
                    <p
                      role="note"
                      data-testid="r2-ban-cu"
                      className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                    >
                      Hoàn thành khoá ở phiên bản {d.phienBan} của bài — bài hiện ở phiên bản {d.phienBanBai} (video đã
                      được thay). Kết quả và chứng nhận giữ nguyên; con số ở đây là của video cũ, KHÔNG phải tiến độ
                      trên video hiện tại.
                    </p>
                  ) : null}
                  {d.lichSu.length > 0 ? (
                    <p data-testid="r2-lich-su" className="mt-2 text-sm text-muted-foreground">
                      Phiên bản trước:{" "}
                      {d.lichSu
                        .map(
                          (b) =>
                            `v${b.rev} · ${b.trangThai === "DONE" ? "đã xong" : "chưa xong"} · ${Math.round(b.coveredSec / 60)} phút phủ`,
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    {d.dai ? (
                      <Dai dai={d.dai} />
                    ) : (
                      // Nói RÕ là đã dọn. Vẽ một dải rỗng ở đây là báo cáo nói
                      // người học xong từ năm ngoái là "chưa xem đoạn nào".
                      <p className="text-sm text-muted-foreground">
                        Dải đoạn xem đã bị xoá theo hạn 90 ngày. Con số tổng bên
                        trên vẫn là số thật.
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    tua {d.seekCount} lần ({d.blockedSeekCount} lần bị chặn) · điểm
                    kiểm tra tập trung {d.attnPassedCount}/{d.attnAskedCount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Khoi>
      ) : null}
    </TrangQuanTri>
  );
}
