"use client";

// Mở trang Thông báo = đã đọc những tin đang hiện trên đó.
//
// Trang này in ĐẦY ĐỦ tiêu đề + nội dung từng tin (không phải danh sách link phải bấm
// vào mới xem được), nên "mở trang" đúng là "đã đọc" — không bắt phụ huynh bấm thêm
// một nút "đánh dấu đã đọc" cho việc họ vừa làm xong.
//
// Không render gì cả; chỉ tồn tại để chạy một lượt ghi sau khi trang đã hiện.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { baoDaDocThongBao } from "@/lib/portal/su-kien-thong-bao";
import { danhDauDaDocAction } from "../_actions";

export function DanhDauDaDoc({ ids }: { ids: string[] }) {
  const router = useRouter();
  // Chốt chặn chạy-một-lần, NHƯNG bám theo khoá chứ không phải cờ boolean: cờ trần
  // thì `ids` đổi thật (có tin mới, phụ huynh đổi con) cũng không ghi nữa. React 18+
  // ở chế độ dev gọi effect hai lần, và `router.refresh()` lại dựng lại trang — nên
  // vẫn cần chốt, chỉ là chốt đúng thứ.
  const daXong = useRef<string | null>(null);
  const khoa = ids.join(",");

  useEffect(() => {
    if (ids.length === 0 || daXong.current === khoa) return;
    daXong.current = khoa;
    let con = true;
    void danhDauDaDocAction(ids).then((res) => {
      // Chỉ làm mới khi THẬT SỰ có tin vừa chuyển sang đã đọc — lần mở thứ hai
      // trả 0 nên trang đứng yên.
      if (!con || !res.ok || res.soMoi === 0) return;
      // Trừ badge NGAY ở client (layout không tự dựng lại trong cùng lượt xem),
      // rồi vẫn gọi refresh để mọi con số khác của layout khớp lại với server.
      baoDaDocThongBao();
      router.refresh();
    });
    return () => {
      con = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoa]);

  return null;
}
