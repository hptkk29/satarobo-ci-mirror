import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napR4 } from "@/lib/elearning/report-r45-query";
import { tiLe, type DongR4 } from "@/lib/elearning/report-r4";

/**
 * EL-17 — BÁO CÁO R4: theo phòng ban / cơ sở.
 *
 * ⚠️ Nhóm dưới 5 người bị GỘP vào "Khối hỗ trợ", và đó không phải chuyện thẩm mỹ.
 * Đo prod 20/08/2026: ba phòng (`MARKETING`, `KE_TOAN`, `IT`) mỗi phòng ĐÚNG MỘT
 * người. Một dòng "phòng Marketing: 0% đúng hạn" là một câu về đích danh một con
 * người, in trên tài liệu gửi khắp công ty — nó đi vòng qua mọi lời hứa ẩn danh mà
 * hệ thống đưa ra ở chỗ khác.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Báo cáo theo phòng ban | Sata Robo",
  robots: { index: false, follow: false },
};

function Bang({ ten, ds }: { ten: string; ds: DongR4[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{ten}</h2>
      {ds.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">Chưa có lượt học nào.</p>
      ) : (
        <PhanTrangBang cuonNgang tenDonVi="nhóm" soDongMacDinh={25}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Nhóm</th>
                <th className="py-2 pr-3">Người</th>
                <th className="py-2 pr-3">Lượt</th>
                <th className="py-2 pr-3">M2 đúng hạn</th>
                <th className="py-2 pr-3">M3 bỏ trắng</th>
                <th className="py-2 pr-3">M5 kịp nhịp</th>
              </tr>
            </thead>
            <tbody>
              {ds.map((d) => {
                const m2 = tiLe(d.m2DungHan, d.tong);
                const m3 = tiLe(d.m3BoTrang, d.tong);
                const m5 = tiLe(d.m5KipNhip, d.m5MauSo);
                return (
                  <tr key={d.nhanNhom} className="border-b">
                    <td className="py-2 pr-3">{d.nhanNhom}</td>
                    <td className="py-2 pr-3">{d.soNguoi}</td>
                    <td className="py-2 pr-3">{d.tong}</td>
                    <td className="py-2 pr-3">
                      {d.m2DungHan}
                      {/* Ngưỡng §9.2.1: ≥85% tốt, <70% báo động. Tô theo ngưỡng
                          thật, không tô theo cảm giác. */}
                      <span
                        className={
                          m2 != null && m2 < 70
                            ? "ml-1 text-xs font-medium text-rose-700"
                            : "ml-1 text-xs text-muted-foreground"
                        }
                      >
                        {m2 == null ? "—" : `${m2}%`}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {d.m3BoTrang}
                      <span
                        className={
                          m3 != null && m3 > 20
                            ? "ml-1 text-xs font-medium text-rose-700"
                            : "ml-1 text-xs text-muted-foreground"
                        }
                      >
                        {m3 == null ? "—" : `${m3}%`}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {/* Mẫu số 0 ⇒ nói "chưa đo được", KHÔNG in 0%. */}
                      {d.m5MauSo === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          chưa đo được (không ai đang học còn hạn)
                        </span>
                      ) : (
                        <>
                          {d.m5KipNhip}/{d.m5MauSo}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {m5}%
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </section>
  );
}

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
          Báo cáo theo phòng ban dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const r = await napR4(scopedDb(actor));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/ma-tran" className="underline">
          Ma trận
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Báo cáo theo phòng ban / cơ sở</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Đọc từ cột ẢNH CHỤP lúc giao bài, không đọc hồ sơ hiện tại — nên chuyển cơ
          sở hay đổi phòng ban không viết lại số liệu của các kỳ trước.
        </p>
      </div>

      <p className="rounded-md bg-muted px-3 py-2 text-xs">
        {/* Nói thẳng M5 là xấp xỉ. Một con số chính xác giả còn tệ hơn một con số kèm
            chú thích — và người đọc sẽ ra quyết định dựa trên nó. */}
        <strong>M5 là số XẤP XỈ:</strong> đo bằng phần trăm tiến độ so với phần thời
        gian đã trôi tới hạn, không đo bằng giây nội dung đã phủ trong tuần như định
        nghĩa đầy đủ ở §9.2.2.
      </p>

      {r.soLuotChuaGanQuanLy > 0 || r.soLuotChuaGanPhongBan > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {/* Đếm được, không lặng lẽ bỏ khỏi mẫu số — kế hoạch chốt đúng câu này. */}
          {r.soLuotChuaGanPhongBan > 0
            ? `${r.soLuotChuaGanPhongBan} lượt không có ảnh chụp phòng ban (gom vào dòng "Chưa gán phòng ban"). `
            : ""}
          {r.soLuotChuaGanQuanLy > 0
            ? `${r.soLuotChuaGanQuanLy} lượt không có quản lý trực tiếp — không ai nhận được báo cáo về những người này.`
            : ""}
        </p>
      ) : null}

      <Bang ten="Theo phòng ban" ds={r.theoPhongBan} />
      <Bang ten="Theo đơn vị / cơ sở" ds={r.theoDonVi} />

      <p className="text-xs text-muted-foreground">
        Nhóm dưới 5 người được gộp vào &ldquo;Khối hỗ trợ&rdquo;: ở quy mô hiện tại có
        ba phòng chỉ một người, và một dòng riêng cho họ là nêu đích danh một cá nhân
        trên tài liệu gửi khắp công ty. Người của nhóm nhỏ vẫn nằm trong tổng.
      </p>
    </div>
  );
}
