import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napLuotNopDeCham } from "@/lib/elearning/task-grading-queue";
import { TaskGradingForm } from "../_components/task-grading-form";

/**
 * EL-15c — CHẤM MỘT LƯỢT NỘP.
 *
 * ⚠️ Lượt nộp đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Chấm bài của
 * cơ sở khác là can thiệp vào hồ sơ nhân sự của họ, và không ai ở đó biết.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài tập | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ submissionId: string }>;
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
  if (!can(actor, "elearning:exam:grade")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền chấm bài</h1>
      </div>
    );
  }

  const { submissionId } = await params;
  const luot = await napLuotNopDeCham(scopedDb(actor), submissionId);

  if (!luot) {
    // Không phân biệt "không có" với "đã chấm rồi" thì người chấm bấm vào một dòng
    // cũ sẽ gặp trang trắng và tưởng hỏng. Nói cả hai khả năng.
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center text-sm">
        <p>Không mở được lượt nộp này — có thể đã có người chấm xong.</p>
        <Link href="/elearning/cham-bai-tap" className="underline">
          Về hàng chờ chấm bài tập
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning/cham-bai-tap" className="underline">
          Hàng chờ chấm bài tập
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">{luot.tenNguoiHoc}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {luot.tenBai} · lượt {luot.attemptNo} · chấm theo {luot.tenKhung}
          {luot.nopLuc ? ` · nộp ${luot.nopLuc.toLocaleDateString("vi-VN")}` : ""}
        </p>
      </div>

      <TaskGradingForm luot={luot} />
    </div>
  );
}
