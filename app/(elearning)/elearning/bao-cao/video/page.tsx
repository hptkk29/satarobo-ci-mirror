import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { dungR2ChoBai, type DaiNhiet } from "@/lib/elearning/report-r2";
import { CAU_LUAT, type MaLuatCo } from "@/lib/elearning/watch-flag-rules";
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
    <div className="flex h-4 w-full gap-px overflow-hidden rounded">
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
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</div>;
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:video-analytics:view")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem báo cáo này</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Báo cáo chi tiết xem video chứa dữ liệu hành vi của từng người học.
        </p>
      </div>
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

  const dong = bai ? await dungR2ChoBai(bai) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Chi tiết xem video</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Báo cáo này có <strong>cửa sổ 90 ngày</strong>. Dữ liệu đoạn xem và phiên
          xem cũ hơn 90 ngày đã bị xoá theo chính sách — trống ở đó là đúng, không
          phải mất dữ liệu.
        </p>
      </div>

      {/* ── Hàng đợi cờ ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold">
          Cờ nghi ngờ chờ bạn xử ({hangDoi.length})
        </h2>
        {hangDoi.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Không có cờ nào đang chờ bạn.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {hangDoi.map((c) => (
              <div key={c.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {CAU_LUAT[c.ruleCode as MaLuatCo] ?? c.ruleCode}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {c.lesson.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mở lúc {gio(c.openedAt)} · hạn khiếu nại {gio(c.appealDeadline)}
                  {c.status === "APPEALED"
                    ? ` · đã khiếu nại ${gio(c.appealedAt)}, hạn trả lời ${gio(c.decisionDueAt)}`
                    : ""}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {Object.entries((c.evidenceJson ?? {}) as Record<string, number>).map(
                    ([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-mono">{v}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {c.appealNote ? (
                  <p className="mt-2 rounded bg-muted px-2 py-1 text-xs">
                    Khiếu nại: {c.appealNote}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Chưa có khiếu nại. Hết cửa sổ, cờ tự chốt thành “giữ cờ”.
                  </p>
                )}
                <DecideFlag flagId={c.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Chọn bài ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold">Chọn bài video</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {dsBai.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có bài video nào.</p>
          ) : (
            dsBai.map((b) => (
              <Link
                key={b.id}
                href={`/elearning/bao-cao/video?bai=${b.id}`}
                className={`rounded-md border px-2 py-1 text-xs ${
                  b.id === bai ? "border-primary bg-primary/10 font-medium" : ""
                }`}
              >
                {b.title}
              </Link>
            ))
          )}
        </div>
      </section>

      {/* ── Bảng R2 ───────────────────────────────────────────────────────── */}
      {bai ? (
        <section>
          <h2 className="text-sm font-bold">Từng người học</h2>
          {dong.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Chưa ai xem bài này, hoặc dữ liệu đã quá 90 ngày.
            </p>
          ) : (
            <div className="mt-2 space-y-4">
              {dong.map((d) => (
                <div key={d.userId} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs">{d.userId}</span>
                    <span>
                      phủ <strong>{d.phanTramPhu}%</strong> · xem{" "}
                      {Math.round(d.totalWatchSec / 60)} phút · {d.soPhien} phiên
                    </span>
                  </div>
                  <div className="mt-2">
                    {d.dai ? (
                      <Dai dai={d.dai} />
                    ) : (
                      // Nói RÕ là đã dọn. Vẽ một dải rỗng ở đây là báo cáo nói
                      // người học xong từ năm ngoái là "chưa xem đoạn nào".
                      <p className="text-xs text-muted-foreground">
                        Dải đoạn xem đã bị xoá theo hạn 90 ngày. Con số tổng bên
                        trên vẫn là số thật.
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    tua {d.seekCount} lần ({d.blockedSeekCount} lần bị chặn) · điểm
                    kiểm tra tập trung {d.attnPassedCount}/{d.attnAskedCount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
