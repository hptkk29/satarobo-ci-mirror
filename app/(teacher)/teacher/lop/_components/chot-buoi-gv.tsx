"use client";

// Vỏ client cho nút chốt buổi ở site GV: nối `<ChotBuoiButton>` (dùng chung với admin)
// với Server Action của site này. Tồn tại vì `hub-sessions-tab.tsx` là Server Component
// — không truyền được closure xuống client, nên phải có một chỗ import action.
import { useRouter } from "next/navigation";

import { ChotBuoiButton } from "@/components/lms/chot-buoi-button";
import { chotBuoiAction } from "../_actions";

export function ChotBuoiGV({
  sessionId,
  sanSang,
  thieu,
}: {
  sessionId: string;
  sanSang: boolean;
  thieu: string[];
}) {
  const router = useRouter();
  return (
    <ChotBuoiButton
      sessionId={sessionId}
      daChot={false}
      sanSang={sanSang}
      thieu={thieu}
      chot={chotBuoiAction}
      onXong={() => router.refresh()}
    />
  );
}
