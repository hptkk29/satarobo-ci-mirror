import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { R2TestClient } from "./client";

export const metadata = {
  title: "Test R2 Storage",
};

export default async function R2TestPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const allowedRoles = ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"];
  if (!allowedRoles.includes(session.user.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Test R2 Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trang này dùng để verify R2 storage hoạt động đúng. Upload file → URL phải
          hiển thị được qua{" "}
          <code className="text-primary">https://cdn.satarobo.vn</code>.
        </p>
      </div>

      <div className="bg-state-info-soft border border-state-info-soft rounded-lg p-4 mb-6">
        <p className="text-sm font-medium text-state-info-ink">📋 Test checklist:</p>
        <ul className="text-sm text-state-info-ink mt-2 space-y-1 list-disc list-inside">
          <li>Upload ảnh JPG/PNG/WEBP (max 5MB)</li>
          <li>Upload PDF (max 20MB)</li>
          <li>Upload Word/Excel (max 20MB)</li>
          <li>Upload video MP4 nhỏ (max 500MB)</li>
          <li>Upload ZIP test (max 1GB)</li>
          <li>Click vào URL trả về → verify file hiển thị được trên browser</li>
          <li>Thử upload file vượt giới hạn → phải bị reject</li>
          <li>Thử upload file MIME không hỗ trợ (.exe, .dmg) → phải bị reject</li>
        </ul>
      </div>

      <R2TestClient />
    </div>
  );
}
