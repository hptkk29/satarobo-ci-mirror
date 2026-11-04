// lib/cham-cong/cong-day.ts — quy BUỔI DẠY ra CÔNG DẠY.
//
// THUẦN — không `@/lib/db`, không `next/*`. Nhận buổi đã đọc sẵn + danh mục loại, trả về dòng
// công dạy. Nhờ vậy luật quy đổi test được mà không cần Postgres, và chỉ có MỘT nơi giữ luật.
//
// ── Vì sao có (yêu cầu chủ dự án 06/09) ─────────────────────────────────────────────────
// "Hiện tại chỉ tính giờ dạy lớp chính của giáo viên để tính công dạy; vẫn phải dev thêm các
// mục linh hoạt công dạy khác để dự phòng BLĐ yêu cầu có công dạy cho trial, bù, vượt… tự tạo
// tự add được qua hệ thống chứ không cần code."
//
// Cơ chế: hệ số và công tắc nằm trong DỮ LIỆU (`TeachingCreditType`), không trong mã. BLĐ muốn
// tính công cho buổi trải nghiệm thì bật dòng đó và đặt hệ số — không cần deploy.
//
// ── Ba điều đã cân nhắc ────────────────────────────────────────────────────────────────
//  1. KHÔNG đụng tới tiền. Hệ thống chưa có module lương (schema không có bảng nào chứa mức
//     lương); `period.ts` cũng đã tự ghi ranh giới "đơn giá gõ tay ở module lương — ở đây chỉ
//     đếm". Và hoa hồng GV dạy trải nghiệm đã có đường RIÊNG tính theo % học phí — gộp hai thứ
//     đó là trả hai lần cho cùng một buổi.
//  2. KHÔNG đổi nghĩa `teachingSessions` đang có. Kỳ đã chốt đọc lại `summaryJson` theo đúng
//     hình cũ; đổi nghĩa một cột cũ là làm sai con số đã trả lương.
//  3. Cơ sở của dòng lấy theo NGƯỜI, không theo lớp — xem ghi chú ở `congDayCuaNguoi`.
import type { TeachingCreditBasis, TeachingCreditSource, TeachingRole } from "@prisma/client";

/** Một dòng danh mục, rút gọn còn phần luật cần. */
export type LoaiCongDay = {
  code: string;
  name: string;
  source: TeachingCreditSource;
  role: TeachingRole;
  basis: TeachingCreditBasis;
  factor: number;
  countsInPeriod: boolean;
  isActive: boolean;
  /** Phân loại buổi mà dòng này áp cho. null = dòng BAO SÂN (mọi phân loại chưa có dòng riêng). */
  categoryCode: string | null;
};

/** Một buổi dạy đã quy về dạng chung, bất kể đến từ lớp chính hay lớp trải nghiệm. */
export type BuoiDay = {
  /** Khoá để chống đếm hai lần. */
  id: string;
  source: TeachingCreditSource;
  userId: string;
  role: TeachingRole;
  /** "YYYY-MM-DD" giờ VN. */
  ymd: string;
  /** Số phút dạy. null = không suy được giờ ⇒ loại tính theo GIỜ sẽ bỏ qua buổi này. */
  minutes: number | null;
  /**
   * Phân loại buổi ĐÃ QUY ĐỔI — chỗ gọi phải thay `null` (buổi chưa phân loại) bằng mã của dòng
   * mặc định trước khi đưa vào đây. Để `null` lọt xuống thì buổi chưa phân loại rơi thẳng vào
   * dòng bao sân, tức dòng mặc định người vận hành chọn bị bỏ qua im lặng.
   */
  categoryCode: string | null;
};

export type DongCongDay = {
  code: string;
  name: string;
  /** Số buổi thuộc loại này. */
  buoi: number;
  /** Tổng phút (chỉ có nghĩa với loại tính theo giờ). */
  phut: number;
  /** Công dạy đã nhân hệ số. */
  cong: number;
  /** Loại đang tắt "cộng vào kỳ" ⇒ liệt kê để theo dõi nhưng không vào tổng. */
  tinhVaoKy: boolean;
  /** Buổi bị bỏ vì loại tính theo GIỜ mà buổi không suy được giờ. */
  boQuaThieuGio: number;
};

export type CongDayNguoi = {
  dong: DongCongDay[];
  /** Tổng công dạy — CHỈ cộng loại đang bật `countsInPeriod`. */
  tongCong: number;
  /** Tổng số buổi mọi loại (kể cả loại không tính vào kỳ) — để đối chiếu. */
  tongBuoi: number;
};

function lamTron(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Loại khớp với một buổi: ĐÚNG phân loại trước, rồi mới tới dòng bao sân.
 *
 * Hai tầng chứ không phải một, vì đó là thứ giữ cho việc THÊM một dòng không làm đổi số của
 * những buổi không liên quan: BLĐ thêm "(Lớp, chính, Workshop) hệ số 1,2" thì chỉ buổi Workshop
 * đổi, còn mọi buổi khác vẫn ăn dòng bao sân "(Lớp, chính, —)" như hôm qua.
 *
 * Không có tầng thứ ba: buổi mang phân loại mà cả hai tầng đều trượt thì rơi ra hẳn (không tính
 * công). Đó là cách tắt một nhóm buổi — bỏ "Đang dùng" ở dòng danh mục.
 */
export function loaiCua(buoi: BuoiDay, danhMuc: readonly LoaiCongDay[]): LoaiCongDay | null {
  const hop = danhMuc.filter(
    (l) => l.isActive && l.source === buoi.source && l.role === buoi.role,
  );
  return (
    (buoi.categoryCode != null
      ? hop.find((l) => l.categoryCode === buoi.categoryCode)
      : undefined) ??
    hop.find((l) => l.categoryCode == null) ??
    null
  );
}

/**
 * Quy toàn bộ buổi của MỘT người ra công dạy.
 *
 * Buổi không khớp loại nào đang bật thì rơi ra hẳn — đó là cách tắt một nhóm buổi: người vận
 * hành bỏ "Đang dùng" ở dòng danh mục, không cần ai sửa mã.
 */
export function congDayCuaNguoi(
  buoi: readonly BuoiDay[],
  danhMuc: readonly LoaiCongDay[],
): CongDayNguoi {
  const theoLoai = new Map<string, DongCongDay>();
  // Chống đếm hai lần: cùng một buổi có thể lọt vào danh sách hai lần nếu chỗ gọi gộp nhiều
  // truy vấn (vd người vừa là GV chính vừa được ghi `actualTeacherId`).
  const daThay = new Set<string>();

  for (const b of buoi) {
    const khoa = `${b.source}|${b.id}|${b.userId}`;
    if (daThay.has(khoa)) continue;
    daThay.add(khoa);

    const l = loaiCua(b, danhMuc);
    if (!l) continue;

    const d = theoLoai.get(l.code) ?? {
      code: l.code,
      name: l.name,
      buoi: 0,
      phut: 0,
      cong: 0,
      tinhVaoKy: l.countsInPeriod,
      boQuaThieuGio: 0,
    };

    if (l.basis === "PER_HOUR") {
      // Không suy được giờ thì KHÔNG đoán bừa 1 buổi = 1 giờ — đếm riêng để màn nói ra được
      // "N buổi chưa có giờ nên chưa tính", thay vì im lặng ra một con số nhỏ hơn sự thật.
      if (b.minutes == null || b.minutes <= 0) {
        d.boQuaThieuGio += 1;
        theoLoai.set(l.code, d);
        continue;
      }
      d.phut += b.minutes;
      d.cong += (b.minutes / 60) * l.factor;
    } else {
      d.cong += l.factor;
      if (b.minutes != null && b.minutes > 0) d.phut += b.minutes;
    }
    d.buoi += 1;
    theoLoai.set(l.code, d);
  }

  const dong = [...theoLoai.values()].map((d) => ({ ...d, cong: lamTron(d.cong) }));
  return {
    dong,
    tongCong: lamTron(dong.filter((d) => d.tinhVaoKy).reduce((s, d) => s + d.cong, 0)),
    tongBuoi: dong.reduce((s, d) => s + d.buoi, 0),
  };
}

/** "HH:mm" → phút trong ngày. Sai định dạng ⇒ null (dữ liệu do người nhập). */
export function phutCuaGio(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Số phút của một buổi từ hai chuỗi "HH:mm". Qua nửa đêm ⇒ null (không đoán hộ, ca dạy đêm là
 * chuyện phải khai chứ không phải suy).
 */
export function phutGiuaHaiGio(tu: string | null | undefined, den: string | null | undefined): number | null {
  const a = phutCuaGio(tu);
  const b = phutCuaGio(den);
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

/** Số phút từ hai mốc thời gian thực. Thiếu một đầu hoặc âm ⇒ null. */
export function phutGiuaHaiMoc(tu: Date | null | undefined, den: Date | null | undefined): number | null {
  if (!tu || !den) return null;
  const p = Math.round((den.getTime() - tu.getTime()) / 60_000);
  return p > 0 ? p : null;
}
