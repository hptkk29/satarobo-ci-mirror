"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HopXepCase } from "./hop-xep-case";
import type { MoHopXep } from "./hop-xep-tai";

// Hộp "Xếp vào case dạy bù" MỞ SẴN khi vào /hoc-bu?xep=<id dòng cần bù> (13/11/2026 — Sale bấm "Xếp học bù" ở màn Yêu cầu phụ huynh).
// Dữ liệu hộp do TRANG SERVER dựng (`taiHopXep`, qua đúng các Server Action kiểm quyền + phạm vi) và truyền xuống làm trạng thái ĐẦU — không `useEffect`.
// Dòng không xếp được (đã xếp / đã huỷ / ngoài phạm vi / còn chờ thu phí) ⇒ hộp mở ra và NÓI LÝ DO thay vì im lặng.
// Đóng hộp ⇒ gỡ tham số `xep` khỏi địa chỉ để tải lại trang không bật hộp lần nữa. Không duyệt/đóng đơn nào ở đây: đơn xin bù tự đóng khi dòng được xếp lịch.
export function HopXepTuLienKet({ mo, hrefDong }: { mo: MoHopXep; hrefDong: string }) {
  const router = useRouter();
  const [daDong, setDaDong] = useState(false);
  if (daDong) return null;
  return (
    <HopXepCase
      mo={mo}
      onDong={() => {
        setDaDong(true);
        router.replace(hrefDong, { scroll: false });
      }}
    />
  );
}
