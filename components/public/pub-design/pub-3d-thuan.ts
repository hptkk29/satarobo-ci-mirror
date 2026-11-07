// Hàm thuần của khối 3D (test được không cần trình duyệt).

/** Mô hình linh vật của artifact: GIFT ôm hộp quà (hero trang chủ), HEART tạo trái tim, WAVE vẫy tay. */
export type MoHinh3D = "gift" | "heart" | "wave";

export const DUONG_DAN_MO_HINH: Record<MoHinh3D, string> = {
  gift: "/pub/models/gift.glb",
  heart: "/pub/models/heart.glb",
  wave: "/pub/models/wave.glb",
};

export interface MayYeu {
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * Chế độ nhẹ — đúng công thức MỚI của fx.js (`LITE`, chủ dự án chốt 03/11/2026): Save-Data, HOẶC mạng slow-2g/2g (KHÔNG tính 3g), HOẶC (≤ 2 nhân CPU
 * VÀ (không biết RAM hoặc RAM ≤ 2GB)) ⇒ KHÔNG tải 3D, chỉ để ảnh poster. Bản cũ (có 3g; RAM ≤ 2GB HOẶC ≤ 2 nhân) làm máy bàn mạng tốt cũng mất 3D. `daDat` là `window.__sataLite` nếu fx.js đã tính (thắng mọi thứ).
 */
export function laCheDoNhe(m: MayYeu, daDat?: boolean | null): boolean {
  if (daDat != null) return !!daDat;
  return !!(
    m.saveData ||
    /^(slow-2g|2g)$/.test(m.effectiveType ?? "") ||
    (m.hardwareConcurrency && m.hardwareConcurrency <= 2 && (!m.deviceMemory || m.deviceMemory <= 2))
  );
}

/** Có được tải three + mô hình không? Nhẹ / giảm chuyển động / không WebGL ⇒ chỉ poster. */
export function duocTai3D(o: { nhe: boolean; giamChuyenDong: boolean; coWebgl: boolean }): boolean {
  return !o.nhe && !o.giamChuyenDong && o.coWebgl;
}
