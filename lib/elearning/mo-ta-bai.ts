import { NHAN_LOAI_BAI } from "@/lib/elearning/lesson-kind";

/**
 * QtSoanKhoa — dòng mô tả dưới tên bài trong dàn bài ("Bài đọc · ngưỡng đọc 3 phút", "Video YouTube · 11:04"). CHỈ NÓI số đo THẬT của bài:
 * thiếu số thì bỏ phần đó, không bịa (không "2 câu hỏi giữa bài" khi không đếm được ở đây).
 */
export function moTaBaiTrongDanBai(b: {
  kind: string;
  youtubeId?: string | null;
  videoKey?: string | null;
  durationSec?: number | null;
  minReadSeconds?: number | null;
}): string {
  const nhan = NHAN_LOAI_BAI[b.kind] ?? b.kind;
  if (b.kind === "READ") {
    return typeof b.minReadSeconds === "number" && b.minReadSeconds > 0 ? `${nhan} · ngưỡng đọc ${Math.max(1, Math.round(b.minReadSeconds / 60))} phút` : nhan;
  }
  if (b.kind === "VIDEO") {
    const nguon = b.youtubeId ? "Video YouTube" : b.videoKey ? "Video tải lên" : nhan;
    if (typeof b.durationSec === "number" && b.durationSec > 0) {
      const p = Math.floor(b.durationSec / 60);
      const g = b.durationSec % 60;
      return `${nguon} · ${p}:${String(g).padStart(2, "0")}`;
    }
    return nguon;
  }
  if (b.kind === "LIVE_SESSION") return `${nhan} · điểm danh`;
  return nhan;
}

/** Thời lượng đọc cho người soạn: dưới 1 phút nói bằng giây ("30 giây"), từ 1 phút trở lên nói bằng phút ("3 phút", "1 phút 30 giây"). */
export function chuThoiLuongDoc(giay: number): string {
  const g = Math.max(0, Math.round(giay));
  if (g < 60) return `${g} giây`;
  const p = Math.floor(g / 60);
  const du = g % 60;
  return du === 0 ? `${p} phút` : `${p} phút ${du} giây`;
}
