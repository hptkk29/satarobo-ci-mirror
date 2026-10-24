import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PHAM_VI_CHUA_KHOP_DUOC } from "@/lib/elearning/requirement-match";
import { RequirementForm } from "./_components/requirement-form";
import { CloseButton } from "./_components/close-button";

/**
 * EL-17 — YÊU CẦU ĐÀO TẠO: khai, xem, đóng.
 *
 * ⚠️ Đây là CỬA của `elearning:requirement:manage` — khoá quyền có từ EL-02 mà trước
 * PR này không mã nào gọi. Hệ quả đo được: mẫu số của toàn bộ North Star Metric chỉ
 * khai được bằng seed hoặc SQL tay, tức trên thực tế là không khai được.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Yêu cầu đào tạo | Sata Robo",
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
  const duocSua = can(actor, "elearning:requirement:manage");

  // Xem đi bằng khoá xem tiến độ toàn hệ; SỬA đi bằng khoá riêng. Trưởng phòng cần
  // thấy nghĩa vụ nào đang áp cho người của mình, nhưng ra một nghĩa vụ mới là việc
  // khác hẳn.
  if (!can(actor, "elearning:progress:view-all") && !duocSua) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Yêu cầu đào tạo dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);

  const ds = await db.trnRequirement.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      courseId: true,
      scopeKind: true,
      departmentId: true,
      levelTag: true,
      orgUnitId: true,
      dueDays: true,
      validityMonths: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
    },
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    take: 200,
  });

  const tenKhoa = new Map(
    ds.length === 0
      ? []
      : (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(ds.map((y) => y.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title] as const),
  );

  const tenPhong = new Map(
    (
      await db.departmentDef.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      })
    ).map((d) => [d.id, d.name] as const),
  );

  const khoaChon = duocSua
    ? await db.trnCourse.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 200,
      })
    : [];

  const donViChon = duocSua
    ? await db.orgUnit.findMany({
        select: { id: true, code: true, name: true, path: true },
        orderBy: { path: "asc" },
        take: 200,
      })
    : [];

  const phongChon = [...tenPhong].map(([id, name]) => ({ id, name }));

  const ngay = (d: Date | null) => (d ? d.toLocaleDateString("vi-VN") : "—");

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/ma-tran" className="underline">
          Ma trận đào tạo
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Yêu cầu đào tạo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;Ai phải đạt khoá nào&rdquo;. Đây là mẫu số của mọi báo cáo tuân thủ:
          người không dính yêu cầu nào thì không nằm trong mẫu số.
        </p>
      </div>

      {duocSua ? (
        <RequirementForm
          khoa={khoaChon}
          phongBan={phongChon}
          donVi={donViChon.map((d) => ({ id: d.id, nhan: `${d.code} — ${d.name}` }))}
          phamViChuaDung={PHAM_VI_CHUA_KHOP_DUOC}
        />
      ) : null}

      {ds.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Chưa có yêu cầu nào. Chưa khai thì ma trận đào tạo trống và North Star
          Metric không có mẫu số.
        </p>
      ) : (
        /* Danh sách yêu cầu dài dần theo năm: đóng rồi vẫn ở lại, vì nó là một
           phần lịch sử tuân thủ. */
        <PhanTrangBang cuonNgang tenDonVi="yêu cầu" soDongMacDinh={25}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Khoá</th>
                <th className="py-2 pr-3">Áp cho</th>
                <th className="py-2 pr-3">Hạn</th>
                <th className="py-2 pr-3">Chu kỳ</th>
                <th className="py-2 pr-3">Hiệu lực</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {ds.map((y) => {
                const chua = PHAM_VI_CHUA_KHOP_DUOC[String(y.scopeKind)];
                const dong = y.status !== "ACTIVE";
                return (
                  <tr
                    key={y.id}
                    className={`border-b align-top ${dong ? "opacity-60" : ""}`}
                  >
                    <td className="py-2 pr-3">{tenKhoa.get(y.courseId) ?? "(đã gỡ)"}</td>
                    <td className="py-2 pr-3 text-xs">
                      {String(y.scopeKind)}
                      {y.departmentId
                        ? ` · ${tenPhong.get(y.departmentId) ?? y.departmentId}`
                        : ""}
                      {y.levelTag ? ` · ${String(y.levelTag)}` : ""}
                      {chua ? (
                        // ⚠️ Nói ngay tại dòng, không đợi người ta mở ma trận rồi
                        // thấy một hàng ô lạ. Một yêu cầu áp cho 0 người trông y hệt
                        // một yêu cầu chưa ai kịp làm.
                        <span className="mt-0.5 block text-amber-800">
                          Áp cho 0 người — {chua}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-xs">{y.dueDays} ngày</td>
                    <td className="py-2 pr-3 text-xs">
                      {y.validityMonths ? `${y.validityMonths} tháng` : "vô hạn"}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {ngay(y.effectiveFrom)} → {ngay(y.effectiveTo)}
                      {dong ? (
                        <span className="ml-1 font-medium">(đã đóng)</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      {duocSua && !dong ? (
                        <CloseButton requirementId={y.id} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      )}

      <p className="text-xs text-muted-foreground">
        {/* Nói vì sao đóng chứ không xoá — nếu không, người vận hành sẽ đi tìm nút
            xoá và tưởng hệ thống thiếu chức năng. */}
        Yêu cầu chỉ ĐÓNG được, không xoá: nó là một phần lịch sử tuân thủ, và xoá đi
        thì mọi báo cáo cũ đổi nghĩa hồi tố. Ngày kết thúc luôn đặt là hôm nay.
      </p>
    </div>
  );
}
