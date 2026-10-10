import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChartsTestClient } from "./client";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Test Recharts | Admin" };

export default async function ChartsTestPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          Test Recharts (Admin charts library)
        </h1>
      </div>

      <PageHelp>
        <p>
          Verify Recharts wrappers hoạt động đúng (LineChart / BarChart /
          FunnelChart). Sau khi confirm OK, page này có thể giữ làm reference
          cho Phase 4.1 Dashboard.
        </p>
      </PageHelp>

      <ChartsTestClient />
    </div>
  );
}
