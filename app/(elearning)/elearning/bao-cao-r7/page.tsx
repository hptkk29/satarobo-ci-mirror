import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  CHU_THICH_CHI_PHI,
  chiPhiMoiLuot,
  tiLeAnhChup,
} from "@/lib/elearning/metrics/snapshot";

/**
 * EL-20 — BÁO CÁO R7: hiệu quả chương trình (Kirkpatrick).
 *
 * ⚠️ Ở quy mô 15 người, Kirkpatrick L3 và L4 **vĩnh viễn** không có ý nghĩa thống kê
 * — không phải "chờ đủ dữ liệu". Vì vậy trang này KHÔNG có một phép so sánh nhóm nào,
 * và mọi ngôn ngữ dạng "nhóm đã học vs chưa học" bị một bước kiểm tĩnh quét và chặn
 * (`quetCumTuCam`, TS-37).
 *
 * Thay bằng ĐỌC TỪNG CA: mỗi ca một dòng, có tên, quản lý trực tiếp viết nhận xét.
 * Một phép so sánh nhóm ở n = 15 tạo ra một con số nghe như bằng chứng mà không phải
 * bằng chứng — và nó sẽ được dùng để quyết định về con người.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Hiệu quả đào tạo | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_MUC: Record<string, string> = {
  L1: "L1 — phản hồi của người học",
  L2: "L2 — kết quả kiểm tra",
  L3: "L3 — quản lý trực tiếp nhận xét",
  L4: "L4 — chỉ số vận hành",
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
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Báo cáo hiệu quả dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);

  const anhChup = await db.trnMetricSnapshot.findMany({
    orderBy: [{ periodEnd: "desc" }, { metricKey: "asc" }],
    select: {
      id: true,
      metricKey: true,
      periodStart: true,
      periodEnd: true,
      dimensionKey: true,
      numerator: true,
      denominator: true,
      groupN: true,
      suppressed: true,
    },
    take: 200,
  });

  const danhGia = await db.trnEvaluationResult.findMany({
    select: {
      id: true,
      programId: true,
      level: true,
      subjectUserId: true,
      score: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "desc" },
    take: 200,
  });

  const tenNguoi = new Map(
    danhGia.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(danhGia.map((d) => d.subjectUserId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const soLuotXong = await db.trnEnrollment.count({
    where: { verifiedAt: { not: null } },
  });

  // Ngân sách khai tay chưa có đường nhập ⇒ `null`. KHÔNG bịa số 0.
  const nganSach: number | null = null;
  const chiPhi = chiPhiMoiLuot({ nganSach, soLuotHoanThanh: soLuotXong });

  const ngay = (d: Date) => d.toLocaleDateString("vi-VN");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/bao-cao-r4" className="underline">
          Theo phòng ban
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Hiệu quả đào tạo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Đọc TỪNG CA. Mỗi dòng là một con người cụ thể, có tên.
        </p>
      </div>

      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {/* Nói ra giới hạn NGAY ĐẦU trang, không giấu ở chân trang. Người đọc sẽ ra
            quyết định dựa trên những con số dưới đây. */}
        <strong>Vì sao trang này chỉ liệt kê từng ca:</strong> ở quy mô 15 người,
        mức L3 và L4 của Kirkpatrick <strong>vĩnh viễn</strong> không đủ cỡ mẫu để nói
        điều gì có ý nghĩa — không phải chờ thêm dữ liệu. Một phép so sánh ở cỡ này tạo
        ra một con số nghe như bằng chứng mà không phải bằng chứng. Mỗi dòng dưới đây
        là một con người cụ thể, đọc từng dòng.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Chi phí trên mỗi lượt hoàn thành</h2>
        <div className="rounded-md border p-3">
          <p className="text-2xl font-bold">
            {/* ⚠️ Chưa khai ngân sách ⇒ MỘT DÒNG CHỮ, không phải số 0. "0đ/người" bị
                đọc thành "đào tạo không tốn gì", và đó là câu sẽ được trích trong một
                cuộc họp về ngân sách. */}
            {chiPhi == null ? (
              <span className="text-sm font-normal text-muted-foreground">
                Chưa khai ngân sách — không tính được chi phí/lượt.
              </span>
            ) : (
              `${chiPhi.toLocaleString("vi-VN")}đ`
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mẫu số: {soLuotXong} lượt hoàn thành có kiểm chứng.
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {CHU_THICH_CHI_PHI.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Ảnh chụp chỉ số theo kỳ</h2>
        <p className="text-xs text-muted-foreground">
          Ảnh chụp là BẤT BIẾN: số liệu quá khứ đổi cũng không viết lại bản đã chụp.
          Nhóm dưới 5 người bị chặn công bố tách riêng — cờ đặt ở tầng dữ liệu.
        </p>
        {anhChup.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            {/* Ảnh chụp là chỉ số TOÀN CÔNG TY (không thuộc cơ sở nào, `centerId` NULL) nên lượt đọc qua scopedDb của
                người cấp cơ sở luôn rỗng. Nói thẳng điều đó, đừng để họ đọc "chưa có ảnh chụp" và chờ cron đêm vô ích. */}
            {actor.isHoLevel
              ? "Chưa có ảnh chụp nào. Việc chốt chạy trong cron đêm."
              : "Ảnh chụp chỉ số là số liệu toàn công ty nên chỉ cấp Hội sở xem được; tài khoản cơ sở xem các bảng theo cơ sở ở phần dưới."}
          </p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={25}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Kỳ</th>
                  <th className="py-2 pr-3">Chỉ số</th>
                  <th className="py-2 pr-3">Nhóm</th>
                  <th className="py-2 pr-3">Cỡ nhóm</th>
                  <th className="py-2 pr-3">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {anhChup.map((a) => (
                  <tr key={a.id} className="border-b">
                    <td className="py-2 pr-3 text-xs">
                      {ngay(a.periodStart)} – {ngay(a.periodEnd)}
                    </td>
                    <td className="py-2 pr-3">{a.metricKey}</td>
                    <td className="py-2 pr-3 text-xs">{a.dimensionKey}</td>
                    <td className="py-2 pr-3">{a.groupN}</td>
                    <td className="py-2 pr-3">
                      {a.suppressed ? (
                        // Chặn công bố, và NÓI RA là bị chặn — một ô trống không lời
                        // giải thích đọc thành "hệ thống hỏng".
                        <span className="text-xs text-muted-foreground">
                          Không công bố (nhóm dưới 5 người)
                        </span>
                      ) : (
                        <>
                          {a.numerator}/{a.denominator}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {tiLeAnhChup(a) == null ? "—" : `${tiLeAnhChup(a)}%`}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Đánh giá theo từng ca</h2>
        {danhGia.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Chưa có phiếu đánh giá nào được ghi.
          </p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="phiếu" soDongMacDinh={25}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Lúc</th>
                  <th className="py-2 pr-3">Mức</th>
                  <th className="py-2 pr-3">Người</th>
                  <th className="py-2 pr-3">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {danhGia.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-2 pr-3 text-xs">{ngay(d.recordedAt)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {NHAN_MUC[String(d.level)] ?? String(d.level)}
                    </td>
                    <td className="py-2 pr-3">
                      {tenNguoi.get(d.subjectUserId) ?? "(không rõ)"}
                    </td>
                    <td className="py-2 pr-3">
                      {d.score == null ? "—" : String(d.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>
    </div>
  );
}
