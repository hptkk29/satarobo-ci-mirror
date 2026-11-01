// lib/entitlements/diem-danh-so-cai.ts — "ĐIỂM DANH VỪA ĐỔI ⇒ SỔ CÁI QUYỀN HỌC PHẢI LÀM GÌ": phần THUẦN (không DB, không đồng hồ).
//
// Phần đọc/ghi DB nằm ở `dong-bo-bai-db.ts`. Tách đôi để luật chọn quyền học / lọc cơ sở / kế hoạch ghi–huỷ test được không cần Postgres.
//
// ── BA LUẬT Ở ĐÂY ───────────────────────────────────────────────────────────────────────────────────────────────────
// 1. LỌC CƠ SỞ TRƯỚC KHI GỌI TẦNG GHI. `ghiNhanBaiTrongTx` / `huyGhiNhanBaiTrongTx` ném `DAU_VAO` khi cờ đã đọc cho cơ sở A mà quyền học
//    thuộc cơ sở B — và ném TRONG transaction điểm danh thì cuộn ngược cả lô điểm danh. Nên quyền học khác cơ sở bị LOẠI Ở ĐÂY (`locTheoCoSo`),
//    không bao giờ tới được tầng ghi. Cờ bật theo TỪNG cơ sở: quyền học của cơ sở chưa đọc cờ = cờ TẮT = không ghi (fail-closed).
// 2. CHỌN QUYỀN HỌC CHO MỘT BÀI: quyền ĐANG DẠY (ACTIVE/EXHAUSTED) mà [start,end] chứa bài; không thì dải ân hạn. Cùng luật `timQuyenHocChoBai`.
//    Một bài đã có dòng sổ cái ở quyền học nào thì quyền học ĐÓ quyết định (kể cả dòng đã vô hiệu — bật lại, không chèn dòng thứ hai).
// 3. HỘI TỤ, KHÔNG THEO SỰ KIỆN: ghi/huỷ do `quyetDinhDongBoBai` (bằng chứng hiện có), không do "điểm danh vừa đổi từ A sang B". Lưu lại lưới
//    nhiều lần cho cùng kết quả; học bù xong rồi lưu lại lưới (vẫn VẮNG) KHÔNG huỷ nhầm dòng MAKEUP.
import { laBaiBoSung, type NguonSoCai } from "./tieu-thu";
import { quyetDinhDongBoBai, type BangChungBai, type NguonBangChung } from "./dong-bo-bai";
import type { TrangThaiQuyenHoc } from "./trang-thai";

/** Quyền học ở dạng tối thiểu cho việc đồng bộ. `startLessonOrder`/`endLessonOrder` ĐÃ khác null (người nạp loại quyền chưa chốt phạm vi). */
export interface QuyenHocChoDongBo {
  readonly id: string;
  readonly centerId: string;
  readonly status: TrangThaiQuyenHoc;
  readonly startLessonOrder: number;
  readonly endLessonOrder: number;
  readonly graceSessionsGranted: number;
  readonly freeMakeupSessions: number;
  /** Chỉ để xếp thứ tự ổn định khi hai quyền học trùng `startLessonOrder`. */
  readonly createdAt: Date;
}

/** Dòng sổ cái của MỘT bài (mọi quyền học của học viên trong khoá). */
export interface DongSoCaiChoBai {
  readonly entitlementId: string;
  readonly source: NguonSoCai;
  readonly voidedAt: Date | null;
}

export type ViecDongBo =
  | { readonly viec: "GHI"; readonly entitlementId: string; readonly nguon: NguonBangChung; readonly baiBoSung: boolean }
  | { readonly viec: "HUY"; readonly entitlementId: string };

export type LyDoKhongDongBo = "NGOAI_PHAM_VI";

export interface KeHoachBai {
  readonly viec: readonly ViecDongBo[];
  /** Có bằng chứng học nhưng KHÔNG quyền học nào (cùng cơ sở) của học viên chứa bài ⇒ không ghi sổ, báo lên. */
  readonly khongDongBo: readonly LyDoKhongDongBo[];
}

/** Quyền học nhận bài mới: đang dạy được. Khác trạng thái ⇒ `ghiNhanBaiTrongTx` cũng từ chối (`KHONG_NHAN_BAI`). */
const TRANG_THAI_NHAN_BAI: ReadonlySet<TrangThaiQuyenHoc> = new Set<TrangThaiQuyenHoc>(["ACTIVE", "EXHAUSTED"]);

/**
 * Tách quyền học theo cơ sở của cờ đã đọc. `khac` KHÔNG BAO GIỜ được đưa tới tầng ghi — xem luật 1 ở đầu tệp.
 */
export function locTheoCoSo<T extends { readonly centerId: string }>(
  quyen: readonly T[],
  centerIdCuaCo: string,
): { readonly dung: readonly T[]; readonly khac: readonly T[] } {
  const dung: T[] = [];
  const khac: T[] = [];
  for (const q of quyen) (q.centerId === centerIdCuaCo ? dung : khac).push(q);
  return { dung, khac };
}

const theoThuTu = (a: QuyenHocChoDongBo, b: QuyenHocChoDongBo): number =>
  a.startLessonOrder - b.startLessonOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/**
 * Quyền học nhận MỘT bài chưa có dòng sổ cái: nằm trong [start,end] thì ưu tiên (mua tiếp có thể chồng dải ân hạn của quyền cũ lên dải của quyền mới);
 * không thì dải ân hạn ngay sau `end`. `null` = không quyền nào chứa bài.
 */
export function chonQuyenHocChoBai(quyen: readonly QuyenHocChoDongBo[], lessonOrder: number): QuyenHocChoDongBo | null {
  const dayDu = quyen.filter((q) => TRANG_THAI_NHAN_BAI.has(q.status)).sort(theoThuTu);
  return (
    dayDu.find((q) => lessonOrder >= q.startLessonOrder && lessonOrder <= q.endLessonOrder) ??
    dayDu.find((q) => lessonOrder > q.endLessonOrder && lessonOrder <= q.endLessonOrder + q.graceSessionsGranted) ??
    null
  );
}

/**
 * Kế hoạch cho MỘT (học viên, khoá, bài). `quyen` đã lọc cơ sở + loại quyền VOIDED/chưa chốt phạm vi; `dong` là dòng sổ cái của bài này ở các quyền đó.
 *
 *  · Có dòng ở quyền nào ⇒ quyền đó quyết (HUY / GHI-bật-lại / không làm gì) qua `quyetDinhDongBoBai`.
 *  · Không dòng nào ⇒ chọn quyền học chứa bài, hỏi `quyetDinhDongBoBai({ dong: null })`.
 *  · Bài miễn phí (FREE_MAKEUP) không bao giờ có dòng sổ cái, nên `GHI` cho nó luôn mang `baiBoSung = true` — người ghi PHẢI khử trùng audit `BONUS_LEARN`.
 */
export function keHoachBai(vao: {
  readonly quyen: readonly QuyenHocChoDongBo[];
  readonly dong: readonly DongSoCaiChoBai[];
  readonly bangChung: BangChungBai;
  readonly lessonOrder: number;
}): KeHoachBai {
  const { quyen, dong, bangChung, lessonOrder } = vao;
  const viec: ViecDongBo[] = [];
  const idQuyen = new Set(quyen.map((q) => q.id));

  for (const d of [...dong].sort((a, b) => a.entitlementId.localeCompare(b.entitlementId))) {
    const q = quyen.find((x) => x.id === d.entitlementId);
    if (!q) continue; // dòng của quyền học đã bị loại (khác cơ sở / VOIDED): KHÔNG đụng.
    const qd = quyetDinhDongBoBai({ dong: { source: d.source, voidedAt: d.voidedAt }, bangChung });
    if (qd.hanhDong === "HUY") viec.push({ viec: "HUY", entitlementId: q.id });
    else if (qd.hanhDong === "GHI" || qd.hanhDong === "BAT_LAI") {
      viec.push({ viec: "GHI", entitlementId: q.id, nguon: qd.nguon, baiBoSung: laBaiBoSung(q, lessonOrder) });
    }
  }

  // Đã có dòng ở một quyền học hợp lệ ⇒ quyền đó đã quyết ở trên; KHÔNG chọn thêm quyền khác (sẽ sinh dòng thứ hai cho cùng bài).
  if (dong.some((d) => idQuyen.has(d.entitlementId))) return { viec, khongDongBo: [] };

  const qd = quyetDinhDongBoBai({ dong: null, bangChung });
  if (qd.hanhDong !== "GHI") return { viec, khongDongBo: [] };
  const chon = chonQuyenHocChoBai(quyen, lessonOrder);
  if (!chon) {
    // Học viên CÓ quyền học (cùng cơ sở) nhưng không quyền nào chứa bài này. Không có quyền học nào cả ⇒ học viên cũ (LEGACY), không phải bất thường.
    return { viec, khongDongBo: quyen.length > 0 ? ["NGOAI_PHAM_VI"] : [] };
  }
  viec.push({ viec: "GHI", entitlementId: chon.id, nguon: qd.nguon, baiBoSung: laBaiBoSung(chon, lessonOrder) });
  return { viec, khongDongBo: [] };
}

/** Lý do ghi vào sổ khi huỷ vì bằng chứng không còn — `huyGhiNhanBaiTrongTx` ném nếu rỗng. */
export const LY_DO_HUY_MAT_BANG_CHUNG = "Điểm danh/học bù của bài này không còn là bằng chứng đã học";
