// lib/classes/mo-lai-buoi-quyet-dinh.ts — phần THUẦN của "Mở lại buổi" (không DB, không server-only: màn hình dùng chung).
//
// LUẬT 12: nút "Mở lại" chỉ vẽ khi server CÓ THỂ nhận; cả hai cùng hỏi `quyetDinhMoLaiBuoi` / `buoiCoTheMoLai` ở đây. Phần ghi
// DB nằm ở `mo-lai-buoi.ts`.
import { vnYmd } from "@/lib/time/vn";

/** Tiền tố `topic` mà "Nghỉ & lùi lịch" (`lui-lich.ts`) gắn vào buổi nó huỷ. */
export const TIEN_TO_TOPIC_LOP_NGHI = "Lớp nghỉ — ";

export type BuoiBuMoLai = {
  id: string;
  status: string;
  date: Date;
  /** Tên các thứ đã bám vào buổi bù (`duLieuBamVaoBuoi`) — rỗng = sạch. */
  duLieu: readonly string[];
};

export type DauVaoQuyetDinhMoLai = {
  status: string;
  date: Date;
  /** Buổi đã bị huỷ bởi "Nghỉ & lùi lịch" (xem `laBuoiLopNghi`). */
  lopNghi: boolean;
  /** Buổi bù tìm được; null = không tìm thấy (buổi huỷ bằng đường khác / buổi bù đã bị xoá). */
  buoiBu: BuoiBuMoLai | null;
  now: Date;
};

export type QuyetDinhMoLai = { ok: true; goBuoiBu: boolean } | { ok: false; error: string };

/** THUẦN — buổi do "Nghỉ & lùi lịch" huỷ: nó đổi `topic` thành "Lớp nghỉ — …" (dấu cứng trong `nghiBuoiLop`). */
export function laBuoiLopNghi(topic: string | null | undefined): boolean {
  return typeof topic === "string" && topic.startsWith(TIEN_TO_TOPIC_LOP_NGHI);
}

/**
 * THUẦN — nút "Mở lại" có hiện không. Chỉ những vế màn hình BIẾT (trạng thái, ngày, topic): buổi bù có dữ liệu thì chỉ server
 * mới biết và từ chối kèm câu nói rõ.
 */
export function buoiCoTheMoLai(b: { status: string; date: Date; topic: string | null | undefined; now: Date }): boolean {
  return b.status === "CANCELLED" && vnYmd(b.date) >= vnYmd(b.now) && !laBuoiLopNghi(b.topic);
}

/**
 * THUẦN — "buổi này có mở lại được không, và có phải gỡ buổi bù không". Nơi DUY NHẤT nói những câu từ chối.
 */
export function quyetDinhMoLaiBuoi(d: DauVaoQuyetDinhMoLai): QuyetDinhMoLai {
  if (d.status !== "CANCELLED") return { ok: false, error: "Buổi này không ở trạng thái đã huỷ — không có gì để mở lại" };
  if (vnYmd(d.date) < vnYmd(d.now)) {
    return { ok: false, error: "Buổi đã qua ngày học — không mở lại được (buổi đã diễn ra thì ghi nhận theo thực tế, không dựng lại)" };
  }
  if (d.lopNghi) {
    return {
      ok: false,
      error:
        "Buổi này bị huỷ bằng \"Nghỉ & lùi lịch\" — bài của nó và các buổi sau đã lùi một buổi, mở lại sẽ làm lệch giáo trình. Xử lý trên màn kế hoạch lịch học của lớp",
    };
  }
  const bu = d.buoiBu;
  if (!bu) return { ok: true, goBuoiBu: false };
  if (bu.status === "CANCELLED") return { ok: true, goBuoiBu: false };
  if (bu.status !== "SCHEDULED") {
    return { ok: false, error: "Không mở lại được vì buổi học bù đã bắt đầu hoặc hoàn tất — xử lý trên màn lớp học" };
  }
  if (bu.date.getTime() <= d.now.getTime()) {
    return { ok: false, error: "Không mở lại được vì buổi học bù đã diễn ra" };
  }
  if (bu.duLieu.length > 0) {
    return { ok: false, error: `Không mở lại được vì buổi học bù đã phát sinh dữ liệu (${bu.duLieu.join(", ")})` };
  }
  return { ok: true, goBuoiBu: true };
}
