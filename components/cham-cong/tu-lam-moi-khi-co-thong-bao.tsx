"use client";

// components/cham-cong/tu-lam-moi-khi-co-thong-bao.tsx — P2.7: màn chấm công TỰ LÀM MỚI khi người xem có
// thông báo mới (đơn mới cần duyệt, đơn của mình vừa có kết quả, khiếu nại có trả lời…).
//
// KHÔNG dựng kênh realtime mới: dùng lại hub `user:{id}` của chat (SSE) — `notifyStaff` vốn đã bắn
// `notification.bumped` cho đúng người nhận sau mỗi thông báo. Nhận tín hiệu ⇒ gom cụm ⇒ ĐÚNG MỘT
// `router.refresh()` (các màn đều `force-dynamic` nên refresh dựng lại RSC thật — số liệu do SERVER dựng, không
// có bản sao logic ở client). Khuôn: `components/chat/chat-list-refresher.tsx`.
//
// Chỉ nghe `noti` (chuông) + `resync` (kênh vừa nối lại). Tin CHAT (`bump`) bỏ qua — không liên quan màn này,
// refresh theo nó là bắn RSC vô ích mỗi lần ai nhắn tin.
//
// Thư mục dùng chung với site GV ⇒ không import `components/admin/**`.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBumpScheduler } from "@/components/chat/bump-scheduler";
import { userChannelHub, type UserChannelHub } from "@/components/chat/user-channel";

const REFRESH_DEBOUNCE_MS = 1_000;
const REFRESH_MIN_INTERVAL_MS = 5_000;

export function TuLamMoiKhiCoThongBao({ userId, hub }: { userId: string; /** DI cho test. */ hub?: UserChannelHub }) {
  const router = useRouter();
  const hubRef = useRef(hub ?? userChannelHub);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!userId) return;
    const scheduler = createBumpScheduler({
      debounceMs: REFRESH_DEBOUNCE_MS,
      minIntervalMs: REFRESH_MIN_INTERVAL_MS,
      run: () => routerRef.current.refresh(),
    });
    const unsubscribe = hubRef.current.subscribe(userId, (e) => {
      if (e.type === "noti" || e.type === "resync") scheduler.ping();
    });
    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [userId]);

  return null;
}
