import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { traDongBaoCao } from "@/lib/elearning/report-query";
import {
  nhanNhom,
  phanNhom,
  soNgayTre,
  tongHopTuanThu,
  R1_COLUMNS,
} from "@/lib/elearning/report-compliance";

/**
 * EL-06 — BÁO CÁO R1: TUÂN THỦ HẠN CHÓT (BA §14.1).
 *
 * ⚠️ Trang này là đích của thông báo "có lượt học quá hạn". Thông báo trỏ vào một
 * trang không tồn tại thì cảnh báo thành ngõ cụt — người nhận bấm vào, thấy 404,
 * và lần sau họ không bấm nữa.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Báo cáo tuân thủ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ luot?: string }>;
}) {
  const { luot } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);

  // Xem báo cáo tổng và XUẤT file là hai quyền khác nhau — xuất là mang dữ liệu
  // nhân sự ra khỏi hệ thống.
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem báo cáo</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Báo cáo tuân thủ dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm"
        >
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);
  const cacLuot = await db.trnAssignment.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, title: true, dueAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const chon = luot ?? cacLuot[0]?.id ?? null;
  const ds = chon ? await traDongBaoCao(db, chon) : [];
  const tong = tongHopTuanThu(ds);
  const now = new Date();
  const duocXuat = can(actor, "elearning:report:export");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Báo cáo tuân thủ hạn chót</h1>

      {/* Lối vào R2. Trang nào không có lối vào thì chỉ người viết nó biết đường
          tới — và một báo cáo giám sát không ai mở là một báo cáo không tồn tại.
          Chỉ hiện cho người có quyền: R2 chứa dữ liệu hành vi từng cá nhân. */}
      {can(actor, "elearning:video-analytics:view") ? (
        <Link
          href="/elearning/bao-cao/video"
          className="mt-2 inline-block text-sm text-primary underline"
        >
          Xem chi tiết xem video và cờ nghi ngờ →
        </Link>
      ) : null}

      {cacLuot.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa có lượt giao nào đang chạy.
        </p>
      ) : (
        <>
          <nav className="mt-4 flex flex-wrap gap-2">
            {cacLuot.map((l: { id: string; title: string }) => (
              <Link
                key={l.id}
                href={`/elearning/bao-cao?luot=${l.id}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  l.id === chon
                    ? "border-primary bg-primary/10 font-medium"
                    : "border-border text-muted-foreground"
                }`}
              >
                {l.title}
              </Link>
            ))}
          </nav>

          <dl className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <O nhan="Đã giao" so={tong.daGiao} />
            <O nhan="Đúng hạn" so={tong.dungHan} />
            <O nhan="Trễ" so={tong.tre} />
            <O nhan="Đang học" so={tong.dangHoc} />
            <O nhan="Chưa học" so={tong.chuaHoc} />
            <O
              nhan="Tỉ lệ đúng hạn"
              // ⚠️ Mẫu số 0 thì hiện "chưa đo được", KHÔNG hiện 0%. "0% tuân thủ"
              // đọc thành thảm hoạ, còn sự thật là chưa có ai để đo.
              chu={tong.tyLeDungHan === null ? "chưa đo được" : `${tong.tyLeDungHan}%`}
            />
          </dl>

          {(tong.thuHoi > 0 || tong.tamDung > 0 || tong.tuongDuong > 0) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ngoài mẫu số: {tong.thuHoi} đã thu hồi · {tong.tamDung} tạm dừng đồng hồ
              {tong.tuongDuong > 0 && ` · ${tong.tuongDuong} công nhận tương đương`}. Họ
              không nằm trong phép đo hạn chót của kỳ này nên không tính vào tỉ lệ
              {tong.tuongDuong > 0 &&
                " — riêng nhóm công nhận tương đương VẪN được tính là đã được đào tạo"}
              .
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Danh sách {ds.length} người</p>
            {duocXuat && chon && (
              <a
                href={`/api/elearning/bao-cao-r1?assignmentId=${chon}`}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                Xuất Excel
              </a>
            )}
          </div>

          <div className="mt-2">
            <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={25}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {R1_COLUMNS.map((c) => (
                      <th key={c} className="px-2 py-1 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ds.map((d) => {
                    const tre = soNgayTre(d, now);
                    return (
                      <tr key={d.userId} className="border-b border-border last:border-0">
                        <td className="px-2 py-1">{d.fullName}</td>
                        <td className="px-2 py-1 text-muted-foreground">{d.employeeCode}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.departmentName ?? ""}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.managerName ?? ""}
                        </td>
                        <td className="px-2 py-1">{nhanNhom(phanNhom(d))}</td>
                        <td className="px-2 py-1">{d.progressPercent}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.dueAtOriginal?.toLocaleDateString("vi-VN") ?? ""}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.completedAt?.toLocaleDateString("vi-VN") ?? ""}
                        </td>
                        <td className="px-2 py-1">{tre ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        </>
      )}
    </div>
  );
}

function O(props: { nhan: string; so?: number; chu?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{props.nhan}</dt>
      <dd className="text-lg font-bold">{props.chu ?? props.so}</dd>
    </div>
  );
}
