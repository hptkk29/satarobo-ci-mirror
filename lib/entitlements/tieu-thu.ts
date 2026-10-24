// lib/entitlements/tieu-thu.ts — "ĐÃ HỌC" LÀ SỔ CÁI TỪNG BÀI, KHÔNG PHẢI BỘ ĐẾM (BA §2.5 phương án O3).
//
// THUẦN. Lý do bỏ bộ đếm cộng dồn (`consumed++`): sửa điểm danh vắng → có mặt → vắng, hoặc hai
// người cùng lưu, làm bộ đếm lệch và không dựng lại được. Sổ cái khoá duy nhất theo
// `(entitlementId, lessonOrder)`: đổi trạng thái = bật/tắt `voidedAt`, và đếm lại luôn ra đúng.
//
//   consumedSessions = COUNT(dòng WHERE voidedAt IS NULL AND source <> 'GRACE')
//   remaining        = purchaseSessions − consumedSessions − skippedSessions − freeMakeupSessions   (SUY RA, không lưu)
//
// HỌC BÙ MIỄN PHÍ (FREE_MAKEUP — quyết định 1, 13/10/2026): gói trọn vào trễ trong ngưỡng, hoặc mua tiếp mà lớp đã đi qua vài bài, thì các
// bài đã qua VẪN nằm trong [start,end] nhưng học bù KHÔNG trừ quyền học chính. Chúng là một TIỀN TỐ liên tục của phạm vi (start..start+n−1, cùng
// khuôn `baiBoQuaTuSo`; hai tiền tố không bao giờ cùng khác 0 — CHECK SQL). Không có dòng sổ cái nào cho chúng (`quyetDinhGhiNhan` → `BO_SUNG`),
// và `tinhConLai` trừ chúng ra để quyền học VẪN hết đúng lúc lớp dạy xong bài cuối — nếu không, remaining kẹt ở D và quyền học không bao giờ
// EXHAUSTED qua điểm danh lớp (câu hỏi mở "Q" của XEP-LOP.md §6).
//
// Dòng `GRACE` (ân hạn) KHÔNG bao giờ vào `consumedSessions` của quyền học đang hết (INV-04).

/** Phải KHỚP KHÍT enum `UsageSource` của schema — lưới `[ENT-ENUM]`. */
export const NGUON_SO_CAI = ["CLASS", "MAKEUP", "CATCH_UP", "GRACE", "MANUAL"] as const;
export type NguonSoCai = (typeof NGUON_SO_CAI)[number];

export interface DongSoCai {
  readonly lessonOrder: number;
  readonly source: NguonSoCai;
  /** Có giá trị ⇒ dòng đã bị vô hiệu (điểm danh bị sửa/gỡ). */
  readonly voidedAt: Date | null;
}

export interface QuyenHocTomTat {
  readonly purchaseSessions: number;
  readonly startLessonOrder: number;
  readonly endLessonOrder: number;
  /** Bài nằm trong phạm vi nhưng không dạy (vượt trần học vượt). */
  readonly baiBoQua: readonly number[];
  /** Số bài học bù MIỄN PHÍ liền từ `startLessonOrder` — trong phạm vi, KHÔNG trừ quyền học chính. BẮT BUỘC (luật 7): quên truyền = remaining sai im lặng. */
  readonly freeMakeupSessions: number;
  /** Số buổi ân hạn được cấp (chụp lúc hết quyền). */
  readonly graceSessionsGranted: number;
}

/** Cache `consumedSessions`: CHỈ tính từ sổ cái. Hàm duy nhất được phép sinh con số này. */
export function tinhDaTieuThu(soCai: readonly DongSoCai[]): number {
  const daDem = new Set<number>();
  for (const d of soCai) {
    if (d.voidedAt === null && d.source !== "GRACE") daDem.add(d.lessonOrder);
  }
  return daDem.size;
}

/** Số dòng ân hạn còn hiệu lực. */
export function tinhAnHanDaDung(soCai: readonly DongSoCai[]): number {
  const daDem = new Set<number>();
  for (const d of soCai) {
    if (d.voidedAt === null && d.source === "GRACE") daDem.add(d.lessonOrder);
  }
  return daDem.size;
}

/**
 * Danh sách bài bị bỏ qua, SUY từ `startLessonOrder` + `skippedSessions` (DB chỉ lưu SỐ ĐẾM).
 *
 * Đúng cho cả hai chính sách vượt trần (MT-03b): KEEP_LATEST bỏ bài CŨ nhất, DROP_ALL bỏ toàn bộ bài đã
 * qua — cả hai đều bỏ một TIỀN TỐ liên tục của phạm vi, bắt đầu ở `start`. Nếu sau này có chính sách bỏ
 * bài ở GIỮA phạm vi thì hàm này sai và phải lưu danh sách thật.
 */
export function baiBoQuaTuSo(startLessonOrder: number, skippedSessions: number): number[] {
  const ra: number[] = [];
  for (let i = 0; i < skippedSessions; i++) ra.push(startLessonOrder + i);
  return ra;
}

/** Bài học bù miễn phí, SUY từ `startLessonOrder` + `freeMakeupSessions` (DB chỉ lưu SỐ ĐẾM; danh sách thật nằm ở `configSnapshot.xepLop.freeMakeupLessons`). */
export function baiBoSungTuSo(startLessonOrder: number, freeMakeupSessions: number): number[] {
  const ra: number[] = [];
  for (let i = 0; i < freeMakeupSessions; i++) ra.push(startLessonOrder + i);
  return ra;
}

export function laBaiBoSung(q: Pick<QuyenHocTomTat, "startLessonOrder" | "freeMakeupSessions">, lessonOrder: number): boolean {
  return q.freeMakeupSessions > 0 && lessonOrder >= q.startLessonOrder && lessonOrder < q.startLessonOrder + q.freeMakeupSessions;
}

export function tinhConLai(q: Pick<QuyenHocTomTat, "purchaseSessions" | "baiBoQua" | "freeMakeupSessions">, daTieuThu: number): number {
  return q.purchaseSessions - daTieuThu - q.baiBoQua.length - q.freeMakeupSessions;
}

export type KetQuaPhanLoaiBai =
  | "TRONG_PHAM_VI" //   bài thuộc [start,end], dạy được
  | "BO_QUA" //          bài thuộc [start,end] nhưng bị bỏ qua (vượt trần học vượt)
  | "AN_HAN" //          bài nằm ngay sau `end`, trong số buổi ân hạn được cấp
  | "NGOAI_PHAM_VI"; //  còn lại — hiển thị "ngoài phạm vi đăng ký" (QĐ-54), KHÔNG tính

export function phanLoaiBai(q: QuyenHocTomTat, lessonOrder: number): KetQuaPhanLoaiBai {
  if (lessonOrder >= q.startLessonOrder && lessonOrder <= q.endLessonOrder) {
    return q.baiBoQua.includes(lessonOrder) ? "BO_QUA" : "TRONG_PHAM_VI";
  }
  if (lessonOrder > q.endLessonOrder && lessonOrder <= q.endLessonOrder + q.graceSessionsGranted) return "AN_HAN";
  return "NGOAI_PHAM_VI";
}

export type QuyetDinhGhiNhan =
  // `kichHoatLai` = đã có dòng cho bài này nhưng đang bị vô hiệu ⇒ BẬT LẠI (bỏ `voidedAt`), KHÔNG
  // chèn dòng mới (khoá duy nhất `(entitlementId, lessonOrder)`).
  | { readonly loai: "TIEU_THU"; readonly nguon: "CLASS" | "MAKEUP" | "CATCH_UP"; readonly kichHoatLai: boolean }
  | { readonly loai: "AN_HAN"; readonly kichHoatLai: boolean }
  | { readonly loai: "DA_CO" } //          idempotent: bài này đã có dòng còn hiệu lực
  // Học bù MIỄN PHÍ (FREE_MAKEUP): KHÔNG vào sổ cái của quyền chính — người gọi ghi nhận RIÊNG (audit `BONUS_LEARN`), không `StudyEntitlementUsage`.
  | { readonly loai: "BO_SUNG" }
  | { readonly loai: "TU_CHOI"; readonly lyDo: "NGOAI_PHAM_VI" | "BO_QUA" | "HET_BUOI" | "HET_AN_HAN" };

/**
 * Điểm danh / học bù / học vượt xong một bài ⇒ sổ cái phải làm gì.
 * Chỉ QUYẾT ĐỊNH, không ghi. Người gọi ghi trong cùng transaction với `Attendance`.
 */
export function quyetDinhGhiNhan(
  q: QuyenHocTomTat,
  soCai: readonly DongSoCai[],
  lessonOrder: number,
  nguon: "CLASS" | "MAKEUP" | "CATCH_UP",
): QuyetDinhGhiNhan {
  const cu = soCai.find((d) => d.lessonOrder === lessonOrder);
  if (cu && cu.voidedAt === null) return { loai: "DA_CO" };
  const kichHoatLai = cu !== undefined;
  // Học bù miễn phí đi TRƯỚC mọi nhánh còn lại: nó nằm trong [start,end] nên `phanLoaiBai` sẽ gọi nó là TRONG_PHAM_VI và trừ quyền chính.
  if (laBaiBoSung(q, lessonOrder)) return { loai: "BO_SUNG" };
  const phanLoai = phanLoaiBai(q, lessonOrder);
  if (phanLoai === "NGOAI_PHAM_VI") return { loai: "TU_CHOI", lyDo: "NGOAI_PHAM_VI" };
  if (phanLoai === "BO_QUA") return { loai: "TU_CHOI", lyDo: "BO_QUA" };
  if (phanLoai === "AN_HAN") {
    return tinhAnHanDaDung(soCai) < q.graceSessionsGranted
      ? { loai: "AN_HAN", kichHoatLai }
      : { loai: "TU_CHOI", lyDo: "HET_AN_HAN" };
  }
  return tinhConLai(q, tinhDaTieuThu(soCai)) > 0
    ? { loai: "TIEU_THU", nguon, kichHoatLai }
    : { loai: "TU_CHOI", lyDo: "HET_BUOI" };
}

/**
 * Chuyển các dòng ân hạn sang quyền học mua tiếp theo R1 (MT-07): dòng nào có `lessonOrder` rơi vào
 * `[start,end]` của quyền mới thì đổi nguồn GRACE → `nguonMoi` (CLASS/MAKEUP) — đó là điều làm dòng
 * vào `consumed` của quyền mới. Thiếu bước đổi nguồn thì R1 mất tác dụng (còn 12 buổi thay vì 10).
 */
export function chuyenAnHanSangQuyenMoi(
  soCaiCu: readonly DongSoCai[],
  quyenMoi: Pick<QuyenHocTomTat, "startLessonOrder" | "endLessonOrder">,
  nguonMoi: "CLASS" | "MAKEUP",
): { readonly chuyen: readonly DongSoCai[]; readonly giuLai: readonly DongSoCai[] } {
  const chuyen: DongSoCai[] = [];
  const giuLai: DongSoCai[] = [];
  for (const d of soCaiCu) {
    const roiVaoMoi =
      d.source === "GRACE" &&
      d.voidedAt === null &&
      d.lessonOrder >= quyenMoi.startLessonOrder &&
      d.lessonOrder <= quyenMoi.endLessonOrder;
    if (roiVaoMoi) chuyen.push({ ...d, source: nguonMoi });
    else giuLai.push(d);
  }
  return { chuyen, giuLai };
}
