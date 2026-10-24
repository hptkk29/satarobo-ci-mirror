import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napR5 } from "@/lib/elearning/report-r45-query";

/**
 * EL-17 — BÁO CÁO R5: kết quả kiểm tra + PHÂN TÍCH CÂU HỎI.
 *
 * Nửa sau mới là phần đáng tiền: một câu hỏi mà 90% người làm sai không chứng minh
 * học viên kém — nhiều khả năng câu ấy mơ hồ, hoặc nội dung dạy chưa phủ. Không đo
 * thì đề thi cứ thế được dùng lại năm này qua năm khác.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kết quả kiểm tra | Sata Robo",
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
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Kết quả kiểm tra dành cho phòng Đào tạo và Nhân sự.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const r = await napR5(scopedDb(actor));
  const canRa = r.cauHoi.filter((c) => c.canRaLai === true);
  const chuaDu = r.cauHoi.filter((c) => c.canRaLai === null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/kho-cau-hoi" className="underline">
          Kho câu hỏi
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Kết quả kiểm tra</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tỉ lệ đạt tính trên lượt LẦN ĐẦU. Gộp mọi lần làm là đo &ldquo;cuối cùng có
          ai đạt không&rdquo; — một câu hỏi khác, và luôn cho ra con số đẹp hơn.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Theo đề thi</h2>
        {r.deThi.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Chưa có lượt thi nào được chấm xong.
          </p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="đề thi" soDongMacDinh={25}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Đề thi</th>
                  <th className="py-2 pr-3">Tổng lượt</th>
                  <th className="py-2 pr-3">Lượt lần đầu</th>
                  <th className="py-2 pr-3">Đạt lần đầu (M6)</th>
                  <th className="py-2 pr-3">Điểm TB</th>
                </tr>
              </thead>
              <tbody>
                {r.deThi.map((t) => (
                  <tr key={t.examId} className="border-b">
                    <td className="py-2 pr-3">{t.tenDe}</td>
                    <td className="py-2 pr-3">{t.tongLuot}</td>
                    <td className="py-2 pr-3">{t.soLuotLanDau}</td>
                    <td className="py-2 pr-3">
                      {/* Mẫu số 0 ⇒ gạch ngang, KHÔNG in 0%. */}
                      {t.tiLeDatLanDau == null
                        ? "—"
                        : `${t.soDatLanDau}/${t.soLuotLanDau} · ${t.tiLeDatLanDau}%`}
                    </td>
                    <td className="py-2 pr-3">{t.diemTrungBinh ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Câu hỏi cần rà lại ({canRa.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Gắn cờ ở CẢ HAI đầu: quá khó (≤30% đúng) thì câu mơ hồ hoặc nội dung chưa
          phủ; quá dễ (100% đúng) thì câu không phân loại được ai, tức chiếm chỗ trong
          đề mà không đo gì.
        </p>
        {canRa.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Không có câu nào vượt ngưỡng.
          </p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="câu hỏi" soDongMacDinh={25}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Câu hỏi</th>
                  <th className="py-2 pr-3">Lượt</th>
                  <th className="py-2 pr-3">% đúng</th>
                  <th className="py-2 pr-3">Vì sao</th>
                </tr>
              </thead>
              <tbody>
                {canRa.map((c) => (
                  <tr key={c.examQuestionId} className="border-b align-top">
                    <td className="py-2 pr-3">{c.noiDung.slice(0, 120)}</td>
                    <td className="py-2 pr-3">{c.soLuot}</td>
                    <td className="py-2 pr-3">{c.tiLeDung}%</td>
                    <td className="py-2 pr-3 text-xs">{c.lyDo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      {chuaDu.length > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {/* ⚠️ "Chưa đủ dữ liệu" KHÁC "không có vấn đề". Gộp hai cái là để người
              soạn đề tin rằng những câu này đã được kiểm. */}
          {chuaDu.length} câu chưa đủ lượt làm để kết luận (cần ít nhất 5). Chúng
          KHÔNG phải là câu &ldquo;không có vấn đề&rdquo; — chỉ là chưa đo được.
        </p>
      ) : null}
    </div>
  );
}
