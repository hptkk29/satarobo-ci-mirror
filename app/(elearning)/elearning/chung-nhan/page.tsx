import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cauTrangThai, trangThaiHienThi } from "@/lib/elearning/certificate";
import { RevokeButton } from "./_components/revoke-button";
import { IssueButton } from "./_components/issue-button";

/**
 * EL-16 — DANH SÁCH CHỨNG NHẬN đã cấp, và nơi thu hồi.
 *
 * ⚠️ Trang này là CỬA của một cổng vừa mở: `thuHoiChungNhanAction` đòi quyền
 * `elearning:certificate:revoke`, và không có màn nào gọi thì cái quyền ấy chỉ là
 * một dòng trong bảng phân quyền. Năm action mồ côi của EL-09 đã dạy đúng bài này.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chứng nhận đào tạo | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);

  // Xem danh sách đi bằng khoá xem tiến độ toàn hệ; THU HỒI đi bằng khoá riêng.
  // Hai việc khác nhau: phòng Đào tạo cần thấy ai đã có chứng nhận gì, nhưng vô
  // hiệu một chứng từ là quyết định của Nhân sự Hội sở.
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Danh sách chứng nhận dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const duocThuHoi = can(actor, "elearning:certificate:revoke");
  const duocCap = can(actor, "elearning:certificate:issue");
  const db = scopedDb(actor);
  const now = new Date();

  const ds = await db.trnCertificate.findMany({
    select: {
      id: true,
      certCode: true,
      snapFullName: true,
      snapEmployeeCode: true,
      issuedAt: true,
      validUntil: true,
      revokedAt: true,
      revokeReason: true,
      status: true,
      courseId: true,
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  const tenKhoa = new Map(
    (
      await db.trnCourse.findMany({
        where: { id: { in: [...new Set(ds.map((c) => c.courseId))] } },
        select: { id: true, title: true },
      })
    ).map((k) => [k.id, k.title]),
  );

  // ⚠️ Lượt ĐÃ HOÀN THÀNH mà CHƯA có chứng nhận — chỗ bấm của nút cấp tay.
  //
  // Không liệt kê thì nút cấp tay không có nơi nào để bấm, và khoá quyền
  // `certificate:issue` lại thành một dòng chết. Nhóm này KHÔNG rỗng trên thực tế:
  // mọi lượt hoàn thành TRƯỚC khi EL-16 lên chạy đều rơi vào đây — sự kiện của
  // chúng đã chạy xong từ lâu và `verifiedAt` còn NULL.
  const chuaCap = duocCap
    ? await db.trnEnrollment.findMany({
        where: {
          status: { in: ["COMPLETED", "COMPLETED_LATE"] },
          revokedAt: null,
          certificate: { is: null },
        },
        select: {
          id: true,
          userId: true,
          courseId: true,
          completedAt: true,
          verifiedAt: true,
        },
        orderBy: { completedAt: "desc" },
        take: 50,
      })
    : [];

  const tenNguoi = new Map(
    chuaCap.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(chuaCap.map((e) => e.userId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const tenKhoaChuaCap = new Map(
    chuaCap.length === 0
      ? []
      : (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(chuaCap.map((e) => e.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title] as const),
  );

  const ngay = (d: Date) => d.toLocaleDateString("vi-VN");

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Chứng nhận đã cấp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* Nói ra rằng chứng nhận cấp TỰ ĐỘNG — nếu không, người vận hành sẽ đi tìm
              nút "cấp chứng nhận" không tồn tại và tưởng hệ thống thiếu chức năng. */}
          Chứng nhận được cấp tự động khi một lượt học hoàn thành có kiểm chứng.
          Trạng thái dưới đây suy từ hạn hiệu lực, không đọc từ cột đã lưu.
        </p>
      </div>

      {chuaCap.length > 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900">
            {chuaCap.length} lượt đã hoàn thành nhưng chưa có chứng nhận
          </h2>
          <p className="mt-1 text-xs text-amber-900">
            Thường là lượt hoàn thành trước khi khâu cấp tự động lên chạy. Cấp tay
            vẫn đi qua đủ điều kiện và vẫn tự suy hạn hiệu lực.
          </p>
          <ul className="mt-2 space-y-2">
            {chuaCap.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="font-medium">{tenNguoi.get(e.userId)}</span>
                {" · "}
                {tenKhoaChuaCap.get(e.courseId) ?? "(khoá đã gỡ)"}
                {e.completedAt ? ` · xong ${ngay(e.completedAt)}` : ""}
                {e.verifiedAt == null ? (
                  <span className="ml-1 text-amber-800">
                    (lượt cũ, chưa có mốc kiểm chứng — cấp tay sẽ đóng dấu theo ngày
                    hoàn thành)
                  </span>
                ) : null}
                <div className="mt-1">
                  <IssueButton
                    enrollmentId={e.id}
                    tenNguoi={tenNguoi.get(e.userId) ?? "người này"}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ds.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Chưa có chứng nhận nào được cấp.
        </p>
      ) : (
        /* Danh sách này dài dần theo từng năm và không bao giờ ngắn lại — chứng
           nhận không bị xoá, chỉ hết hiệu lực hoặc bị thu hồi. */
        <PhanTrangBang cuonNgang tenDonVi="chứng nhận" soDongMacDinh={25}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Số hiệu</th>
                <th className="py-2 pr-3">Người được cấp</th>
                <th className="py-2 pr-3">Khoá</th>
                <th className="py-2 pr-3">Ngày cấp</th>
                <th className="py-2 pr-3">Hiệu lực</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ds.map((c) => {
                const tt = trangThaiHienThi(c, now);
                return (
                  <tr key={c.id} className="border-b align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{c.certCode}</td>
                    <td className="py-2 pr-3">
                      {c.snapFullName}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {c.snapEmployeeCode}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {tenKhoa.get(c.courseId) ?? "(khoá đã gỡ)"}
                    </td>
                    <td className="py-2 pr-3 text-xs">{ngay(c.issuedAt)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {cauTrangThai(tt, c)}
                      {c.revokeReason ? (
                        <span className="mt-0.5 block text-muted-foreground">
                          Lý do: {c.revokeReason}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      <a
                        href={`/api/elearning/chung-nhan?id=${c.id}`}
                        target="_blank"
                        rel="noopener"
                        className="mr-2 text-xs underline"
                      >
                        PDF
                      </a>
                      {duocThuHoi && tt !== "REVOKED" ? (
                        <RevokeButton certificateId={c.id} certCode={c.certCode} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </div>
  );
}
