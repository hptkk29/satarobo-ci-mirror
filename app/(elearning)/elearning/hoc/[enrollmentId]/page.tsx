import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napDeCuongKhoa } from "@/lib/elearning/course-view";

/**
 * EL-04 — ĐỀ CƯƠNG MỘT KHOÁ.
 *
 * ⚠️ Route này là ĐÍCH của ba đường dẫn đã tồn tại từ lâu và đang trả 404:
 * thông báo "được giao khoá", thông báo "quá hạn", và chuông việc-chưa-xong. Cả ba
 * trỏ `/elearning/hoc/{enrollmentId}` — một địa chỉ chưa bao giờ có tệp.
 *
 * Hệ quả suốt thời gian đó: người học nhận thông báo được giao bài, bấm vào, gặp
 * trang lỗi; và không có đường nào khác vào bài trừ gõ tay URL hai đoạn — mà họ
 * không biết `lessonId`.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá học | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TT: Record<string, string> = {
  NOT_STARTED: "chưa bắt đầu",
  IN_PROGRESS: "đang học",
  COMPLETED: "đã hoàn thành",
  COMPLETED_LATE: "hoàn thành (trễ hạn)",
  OVERDUE: "quá hạn",
};

export default async function Page({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  const { enrollmentId } = await params;
  const kh = await napDeCuongKhoa(scopedDb(actor), {
    enrollmentId,
    userId: session.user.id,
  });

  if (!kh) {
    // Không phân biệt "không có" với "không phải của bạn": nói một câu cho cả hai,
    // vì phân biệt ra là tiết lộ lượt học của người khác có tồn tại.
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center text-sm">
        <p>Không mở được khoá này — có thể lượt học đã bị thu hồi.</p>
        <Link href="/elearning" className="underline">
          Về danh sách khoá của tôi
        </Link>
      </div>
    );
  }

  const quaHan = kh.status === "OVERDUE";

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">{kh.tenKhoa}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {NHAN_TT[kh.status] ?? kh.status} · {kh.soBaiXong}/{kh.soBaiBatBuoc} bài
          bắt buộc
          {kh.dueAt
            ? ` · hạn ${kh.dueAt.toLocaleDateString("vi-VN")}`
            : " · không có hạn"}
        </p>
      </div>

      {quaHan ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Khoá đã quá hạn. Liên hệ phòng Đào tạo nếu cần gia hạn.
        </p>
      ) : null}

      {kh.chungNhan ? (
        // ⚠️ Chứng nhận cấp TỰ ĐỘNG qua hàng đợi sự kiện. Không hiện ở đây thì người
        // học không có cách nào biết mình đã có, và đường tải PDF thành một cổng
        // không cửa.
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-medium">Bạn đã có chứng nhận hoàn thành khoá này.</p>
          <p className="mt-1 text-xs">
            Số hiệu <span className="font-mono">{kh.chungNhan.certCode}</span>
            {kh.chungNhan.validUntil
              ? ` · có hiệu lực đến ${kh.chungNhan.validUntil.toLocaleDateString("vi-VN")}`
              : " · không thời hạn"}
          </p>
          <a
            href={`/api/elearning/chung-nhan?id=${kh.chungNhan.id}`}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-block rounded-md border border-emerald-300 bg-background px-3 py-1.5 text-xs font-medium"
          >
            Tải bản PDF (có mã QR tra cứu)
          </a>
        </div>
      ) : null}

      {kh.slaGraceDays > 0 ? (
        // ⚠️ Nói cho người học biết hạn của họ ĐÃ được nới, và vì sao. Không nói thì
        // họ thấy một cái hạn khác với hạn ban đầu và tưởng hệ thống tính sai.
        <p className="rounded-md bg-muted px-3 py-2 text-xs">
          Hạn của bạn đã được nới thêm <strong>{kh.slaGraceDays} ngày làm việc</strong>{" "}
          vì bài nộp phải chờ chấm quá hạn cam kết. Bạn không bị tính trễ vì việc đó.
        </p>
      ) : null}

      {kh.chuong.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Khoá này chưa có bài nào. Báo với phòng Đào tạo.
        </p>
      ) : (
        <ol className="space-y-4">
          {kh.chuong.map((c, i) => (
            <li key={c.moduleId}>
              <h2 className="text-sm font-semibold">
                {i + 1}. {c.title}
              </h2>
              {c.lessons.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Chương này chưa có bài nào.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {c.lessons.map((b) => (
                    <li
                      key={b.lessonId}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <span>
                        {b.moDuoc ? (
                          <Link
                            href={`/elearning/hoc/${kh.enrollmentId}/${b.lessonId}`}
                            className="underline"
                          >
                            {b.title}
                          </Link>
                        ) : (
                          // Không dựng link thì phải NÓI VÌ SAO ngay tại đây.
                          // Một dòng chữ xám không bấm được, không kèm lý do, đọc
                          // ra thành "bạn chưa được phép" — trong khi sự thật là
                          // bài này giảng viên điểm danh hộ.
                          <span className="text-muted-foreground">
                            {b.title}
                            {b.viSaoKhongMo ? (
                              <span className="ml-2 text-xs">
                                ({b.viSaoKhongMo})
                              </span>
                            ) : null}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {b.nhanLoai}
                          {b.batBuoc ? " · bắt buộc" : " · tuỳ chọn"}
                          {/* KHÔNG dán nhãn "chưa mở" ở đây nữa: lý do đã nằm
                              ngay cạnh tên bài, và với buổi trực tiếp thì "chưa
                              mở" là SAI — bài đó mở bình thường, chỉ là giảng
                              viên điểm danh hộ. Hai câu đá nhau trên cùng dòng. */}
                        </span>
                      </span>
                      <span
                        className={`text-xs ${
                          b.trangThai === "XONG"
                            ? "text-green-700"
                            : "text-muted-foreground"
                        }`}
                      >
                        {b.trangThai === "XONG"
                          ? "đã xong"
                          : b.trangThai === "DANG_HOC"
                            ? "đang học"
                            : "chưa học"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
