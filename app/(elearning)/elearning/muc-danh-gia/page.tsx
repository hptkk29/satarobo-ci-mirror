import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { isElearningEvalLinkEnabled } from "@/lib/flags";
import { cauMucGan, mucGanHienHanh } from "@/lib/elearning/eval-link";
import { EvalLinkForm } from "./_components/eval-link-form";

/**
 * EL-21 — MỨC GẮN ĐÁNH GIÁ theo chương trình (QĐ-CDA-06b).
 *
 * ⚠️ Màn này tồn tại vì chủ dự án chốt HAI vế: giai đoạn đầu chỉ báo cáo, và "sau này
 * admin sẽ setup mức đánh giá để xét lương". Vế thứ hai là TÍNH NĂNG PHẢI XÂY, không
 * phải một hằng số trong mã — nếu để nó là hằng số thì ngày BGĐ quyết bật, việc ấy
 * thành một lần sửa mã và một lần deploy, chứ không phải một quyết định có người ký.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mức gắn đánh giá | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  // Cờ riêng (đặc tả EL-21): OFF ⇒ như thể màn không tồn tại, kể cả với người có quyền.
  if (!isElearningEvalLinkEnabled()) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:program:manage")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Cấu hình mức gắn đánh giá thuộc phòng Đào tạo.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);
  const now = new Date();

  const ct = await db.trnProgram.findMany({
    select: { id: true, title: true, code: true },
    orderBy: { title: "asc" },
    take: 200,
  });

  const cauHinh = new Map(
    ct.length === 0
      ? []
      : (
          await db.trnEvalLinkConfig.findMany({
            where: { programId: { in: ct.map((c) => c.id) } },
            select: {
              programId: true,
              mode: true,
              effectiveFrom: true,
              criteria: true,
              weightOnTime: true,
              weightExamScore: true,
              decisionDocCode: true,
              hrApprovedByUserId: true,
            },
          })
        ).map((c) => [c.programId, c] as const),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/chuong-trinh" className="underline">
          Chương trình
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Mức gắn đánh giá</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kết quả học có ảnh hưởng tới đánh giá tháng hay không, theo từng chương
          trình. Mặc định là <strong>CHỈ BÁO CÁO</strong>.
        </p>
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-xs">
        {/* Nói rõ "chỉ báo cáo" KHÔNG có nghĩa là im lặng — nếu không, người vận hành
            tưởng bật chế độ này là tắt luôn nhắc nhở. */}
        <p>
          <strong>CHỈ BÁO CÁO nghĩa là:</strong> quá hạn <em>vẫn</em> gửi thông báo cho
          người học, quản lý trực tiếp và Đào tạo, và <em>vẫn</em> vào báo cáo tuân
          thủ — chỉ là không leo thang kỷ luật và không ảnh hưởng đánh giá tháng.
        </p>
        <p className="mt-1">
          <strong>Bật liên kết cần đủ sáu thứ:</strong> số hiệu quyết định sửa
          SR.QD.231 · ngày hiệu lực của quyết định · ngày bắt đầu áp dụng · ít nhất
          một tiêu chí · tổng trọng số bằng 100 · và chữ ký đồng phê duyệt của Nhân sự.
        </p>
      </div>

      {ct.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Chưa có chương trình nào để cấu hình.
        </p>
      ) : (
        <ul className="space-y-3">
          {ct.map((c) => {
            const ch = cauHinh.get(c.id) ?? null;
            const muc = mucGanHienHanh(ch, now);
            return (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {c.title}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {c.code}
                    </span>
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      muc === "LINKED"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {muc === "LINKED" ? "Có liên kết" : "Chỉ báo cáo"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {cauMucGan(muc, ch)}
                </p>
                <div className="mt-2">
                  <EvalLinkForm
                    programId={c.id}
                    tenChuongTrinh={c.title}
                    hienTai={
                      ch
                        ? {
                            mode: String(ch.mode),
                            criteria: ch.criteria.map(String),
                            weightOnTime: ch.weightOnTime,
                            weightExamScore: ch.weightExamScore,
                            decisionDocCode: ch.decisionDocCode,
                          }
                        : null
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
