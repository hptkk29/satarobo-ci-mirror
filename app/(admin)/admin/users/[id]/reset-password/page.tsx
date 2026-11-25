import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, KeyRound } from "lucide-react";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ResetPasswordForm } from "../../_components/reset-password-form";

export const metadata = { title: "Đổi mật khẩu | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ResetPasswordPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // User SCOPE_EXEMPT (identity toàn cục) → sdb pass-through, hành vi y nguyên.
  const sdb = scopedDb(await resolveActor(session.user.id));

  const { id } = await params;
  const user = await sdb.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) notFound();

  return (
    <div className="max-w-xl">
      <Link
        href={`/users/${user.id}/edit`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại sửa tài khoản
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Đổi mật khẩu</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {user.name ?? "—"} · <code>{user.email}</code>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <ResetPasswordForm userId={user.id} userEmail={user.email ?? user.id} />
      </div>
    </div>
  );
}
