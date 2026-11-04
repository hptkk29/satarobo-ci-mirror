import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getPolicyAcceptance } from "@/lib/elearning/policy-acceptance";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { AcceptPolicyButton } from "./_components/accept-policy-button";
import { AppealFlag } from "./_components/appeal-flag";

/**
 * EL-04 — "DỮ LIỆU CỦA TÔI".
 *
 * Chiều ĐỐI TRỌNG của chiều thu thập: hệ thống đo nhịp học thì người học phải xem
 * được nó giữ gì về mình. Bật cơ chế thu mà chưa có chỗ này là bật đúng NỬA nghĩa
 * vụ — và nửa còn lại mới là phần ba văn bản pháp lý yêu cầu.
 *
 * ⚠️ Trang này CHỈ đọc dữ liệu của CHÍNH CHỦ THỂ. Không có tham số nào nhận id
 * người khác; thêm `?userId=` cũng không đổi kết quả, vì mọi truy vấn khoá theo
 * `session.user.id`. Đây cũng là ngoại lệ CÓ TÊN của ngưỡng ẩn danh `n < 5`:
 * người ta luôn được xem đủ chi tiết về mình, kể cả khi phòng ban họ có 1 người.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dữ liệu của tôi | Sata Robo",
  robots: { index: false, follow: false },
};

function Muc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

const gio = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(d)
    : "—";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const userId = session.user.id;
  const actor = await resolveActor(userId);
  const db = scopedDb(actor);

  const policy = await getPolicyAcceptance(userId);

  // Mọi truy vấn dưới đây khoá theo `userId` của phiên. Không nhận tham số nào.
  const [soLuot, tienDo, soPhien, cacCo] = await Promise.all([
    db.trnEnrollment.count({ where: { userId } }),
    // KHÔNG cắt `take`: trang này hứa "toàn bộ những gì hệ thống ghi nhận", nên âm
    // thầm chỉ hiện 50 dòng gần nhất là nói sai — và nói sai ở đúng trang thực thi quyền
    // của chủ thể dữ liệu. Phân trang ở client thay vì cắt ở server.
    db.trnLessonProgress.findMany({
      where: { userId },
      orderBy: { lastActivityAt: "desc" },
      select: {
        id: true,
        readSeconds: true,
        scrollMaxPct: true,
        status: true,
        verifiedAt: true,
        lastActivityAt: true,
        lesson: { select: { title: true } },
      },
    }),
    db.trnVideoSession.count({ where: { userId } }),
    // EL-13 — cờ nghi ngờ CỦA CHÍNH NGƯỜI NÀY. Đặt ở đây chứ không ở một trang
    // quản trị riêng: người bị gắn cờ phải thấy nó ở chỗ họ đã được chỉ tới để
    // xem "hệ thống ghi nhận gì về tôi". Giấu trong một màn khác là để họ phát
    // hiện khi cửa sổ khiếu nại đã đóng.
    db.trnWatchFlag.findMany({
      where: { userId },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        ruleCode: true,
        status: true,
        openedAt: true,
        appealDeadline: true,
        evidenceJson: true,
        appealNote: true,
        decisionNote: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Dữ liệu của tôi</h1>
      <p className="text-sm text-muted-foreground">
        Đây là toàn bộ những gì khu đào tạo nội bộ ghi nhận về việc học của bạn.
      </p>

      <Muc title="Chính sách theo dõi học tập">
        <p>
          Bản đang hiệu lực: <strong>{policy.currentVersion}</strong>
        </p>
        <p className="mt-1">
          {policy.accepted ? (
            <>
              Bạn đã xác nhận bản <strong>{policy.acceptedVersion}</strong> lúc{" "}
              {gio(policy.acceptedAt)}.
            </>
          ) : policy.acceptedVersion ? (
            <>
              Bạn đã xác nhận bản <strong>{policy.acceptedVersion}</strong> lúc{" "}
              {gio(policy.acceptedAt)}, nhưng bản đó không còn hiệu lực. Cần xác
              nhận lại bản mới trước khi học tiếp.
            </>
          ) : (
            <>Bạn chưa xác nhận bản nào. Cần xác nhận trước khi bắt đầu học.</>
          )}
        </p>
        {/* Nút chỉ hiện khi CHƯA xác nhận bản đang hiệu lực. Người đã xác nhận rồi
            không có việc gì để bấm, và một nút không làm gì chỉ gây phân vân. */}
        {!policy.accepted && (
          <div className="mt-3">
            <AcceptPolicyButton version={policy.currentVersion} />
          </div>
        )}
      </Muc>

      {cacCo.length > 0 ? (
        <Muc title="Ghi nhận bất thường và đường khiếu nại">
          <p className="mb-3">
            Hệ thống ghi nhận {cacCo.length} lần số liệu học của bạn nằm ngoài
            khoảng bình thường. Đây là <strong>ghi nhận máy</strong>, chưa phải kết
            luận — bạn có quyền nói lại, và số liệu làm căn cứ hiện ngay bên dưới.
          </p>
          <div className="space-y-3">
            {cacCo.map((c) => (
              <AppealFlag
                key={c.id}
                flagId={c.id}
                ruleCode={c.ruleCode}
                status={c.status}
                openedAt={gio(c.openedAt)}
                appealDeadline={gio(c.appealDeadline)}
                conNgay={Math.max(
                  0,
                  Math.ceil(
                    (c.appealDeadline.getTime() - Date.now()) / 86_400_000,
                  ),
                )}
                evidence={(c.evidenceJson ?? {}) as Record<string, number>}
                appealNote={c.appealNote}
                decisionNote={c.decisionNote}
              />
            ))}
          </div>
        </Muc>
      ) : null}

      <Muc title="Hệ thống ghi nhận những gì">
        <ul className="list-inside list-disc space-y-1">
          <li>Số giây bạn ở lại trang bài học, và phần trăm bài đã cuộn qua.</li>
          <li>Thời điểm hoạt động gần nhất trên mỗi bài.</li>
          <li>
            Với bài video: các đoạn đã xem, số lần tua, và câu hỏi chèn giữa bài.
          </li>
          <li>
            Dấu vân kỹ thuật của phiên xem — <strong>không</strong> lưu địa chỉ IP
            đầy đủ, chỉ lưu bản băm và tiền tố mạng.
          </li>
        </ul>
        <p className="mt-2">
          Dữ liệu đo hành vi (đoạn xem, đếm tua) bị <strong>xoá sau 90 ngày</strong>.
          Chứng từ hoàn thành thì giữ dài để làm bằng chứng đào tạo.
        </p>
      </Muc>

      <Muc title="Số liệu của bạn">
        <p>
          {soLuot} lượt ghi danh · {tienDo.length} bài có ghi nhận tiến độ ·{" "}
          {soPhien} phiên xem video còn lưu.
        </p>
      </Muc>

      <Muc title="Tiến độ từng bài">
        {tienDo.length === 0 ? (
          <p>Chưa có bài nào được ghi nhận.</p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="bài" khoaGhiNho="el-du-lieu-cua-toi">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Bài</th>
                  <th className="py-1 pr-3">Đã đọc</th>
                  <th className="py-1 pr-3">Đã xem</th>
                  <th className="py-1 pr-3">Hoàn thành</th>
                  <th className="py-1">Gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {tienDo.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-1 pr-3">{p.lesson.title}</td>
                    <td className="py-1 pr-3">{p.readSeconds}s</td>
                    <td className="py-1 pr-3">{p.scrollMaxPct}%</td>
                    <td className="py-1 pr-3">{gio(p.verifiedAt)}</td>
                    <td className="py-1">{gio(p.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Muc>

      <Muc title="Yêu cầu về dữ liệu của bạn">
        <p>
          Muốn xin bản sao, đính chính một bản ghi, hoặc rút lại đồng ý theo dõi:
          liên hệ phòng Đào tạo. Rút đồng ý thì hệ thống <strong>ngừng thu nhịp
          học ngay</strong>, và nghĩa vụ học chuyển sang hình thức khác (điểm danh
          trực tiếp / xác nhận của quản lý trực tiếp) chứ <strong>không tự huỷ</strong>.
        </p>
      </Muc>
    </div>
  );
}
