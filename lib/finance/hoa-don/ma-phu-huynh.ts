// lib/finance/hoa-don/ma-phu-huynh.ts — MÃ PHỤ HUYNH làm «Mã khách hàng» trên hoá đơn: `CS1-PH-AB3K9P`. 08/11/2026.
//
// Chủ dự án chốt: kế toán từng lấy ID học viên làm Mã KH — sai khi một đơn có hai học viên (hai con của cùng một phụ huynh), vì hoá đơn chỉ
// có MỘT người mua. Mã nay thuộc về PHỤ HUYNH: sinh ngẫu nhiên như mã học viên nhưng thay năm bằng `PH`, mã cơ sở đứng đầu.
//   · «cùng phụ huynh» = cùng (cơ sở, SĐT ba/mẹ dạng nội địa). Hai đơn cùng SĐT cùng cơ sở ra CÙNG một mã; con ở hai cơ sở ⇒ hai mã.
//   · Sinh lúc lưu khối «Người mua trên hoá đơn» mà ô còn trống, TRONG transaction lưu (`ghiNguoiMuaHoaDon`) — KHÔNG sinh khi chỉ xem trang.
//   · Không có SĐT ⇒ KHÔNG có mã (không bịa khoá khác); màn nói rõ.
//   · Mã không bao giờ ghi sang `Student.studentCode`.
// Phần đọc/ghi DB nhận `tx` KHÔNG scope (`db.$transaction`) vì khoá nhận ra phụ huynh đi xuyên hồ sơ; quyền + cơ sở đã kiểm ở action.

import { nationalPhone } from "@/lib/phone";
import { STUDENT_CODE_V2_CHARSET, chuanHoaMaCoSo } from "@/lib/students/ma-hoc-vien-dang";

/** `CS1-PH-AB3K9P`: mã cơ sở viết hoa chữ số · `PH` · 6 ký tự của bộ ký tự mã học viên (không có 0/1/I/L/O). */
export const DANG_MA_PHU_HUYNH = new RegExp(`^([A-Z0-9]+)-PH-([${STUDENT_CODE_V2_CHARSET}]{6})$`);

/** Thân 6 ký tự ngẫu nhiên (THUẦN — inject `rand` để test). */
export function thanMaPhuHuynh(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += STUDENT_CODE_V2_CHARSET[Math.floor(rand() * STUDENT_CODE_V2_CHARSET.length)];
  return s;
}

export function dinhDangMaPhuHuynh(maCoSo: string, than: string): string {
  return `${chuanHoaMaCoSo(maCoSo)}-PH-${than}`;
}

/** Khoá nhận ra phụ huynh: SĐT dạng nội địa; `null` nếu không chuẩn hoá được. */
export function khoaSdtPhuHuynh(...ungVien: ReadonlyArray<string | null | undefined>): string | null {
  for (const v of ungVien) {
    const k = nationalPhone(v);
    if (k) return k;
  }
  return null;
}

type Client = {
  center: { findUnique(a: { where: { id: string }; select: { code: true } }): Promise<{ code: string | null } | null> };
  maPhuHuynh: {
    findUnique(a: { where: { centerId_soDienThoai: { centerId: string; soDienThoai: string } }; select: { ma: true } }): Promise<{ ma: string } | null>;
    createMany(a: { data: { centerId: string; orgUnitId: string | null; soDienThoai: string; ma: string }[]; skipDuplicates: true }): Promise<{ count: number }>;
  };
};

/** ĐỌC mã đã cấp cho phụ huynh (không tạo). Dùng để điền sẵn ô khi mở hộp thoại. */
export async function docMaPhuHuynh(
  c: Pick<Client, "maPhuHuynh">,
  p: { centerId: string | null | undefined; soDienThoai: string | null },
): Promise<string | null> {
  if (!p.centerId || !p.soDienThoai) return null;
  const r = await c.maPhuHuynh.findUnique({ where: { centerId_soDienThoai: { centerId: p.centerId, soDienThoai: p.soDienThoai } }, select: { ma: true } });
  return r?.ma ?? null;
}

/**
 * Lấy mã của phụ huynh, CHƯA có thì cấp. Gọi TRONG transaction.
 *
 * Đua nhau: hai lượt cùng lúc cấp cho cùng phụ huynh → `createMany({ skipDuplicates })` (= ON CONFLICT DO NOTHING) KHÔNG làm hỏng transaction
 * như bắt `P2002` (Postgres huỷ cả transaction tương tác sau lỗi unique), rồi đọc lại: dòng thắng cuộc là mã chung. Trùng chính chuỗi mã
 * với phụ huynh khác (xác suất ~1/10⁹ mỗi lần) ⇒ đọc lại thấy không phải mình ⇒ thử thân khác.
 * Cơ sở thiếu `Center.code` ⇒ NÉM LỖI (không rơi về mã lệch dạng — như `genStudentCodeV2ChoCoSo`).
 */
export async function layHoacCapMaPhuHuynh(
  tx: Client,
  p: { centerId: string | null | undefined; orgUnitId?: string | null; soDienThoai: string | null },
  opts?: { rand?: () => number; toiDaLanThu?: number },
): Promise<string | null> {
  if (!p.centerId || !p.soDienThoai) return null;
  const co = await docMaPhuHuynh(tx, { centerId: p.centerId, soDienThoai: p.soDienThoai });
  if (co) return co;

  const center = await tx.center.findUnique({ where: { id: p.centerId }, select: { code: true } });
  const maCoSo = center?.code ? chuanHoaMaCoSo(center.code) : "";
  if (!maCoSo) throw new Error(`Không cấp được mã phụ huynh: cơ sở ${p.centerId} chưa có mã (Center.code)`);

  const rand = opts?.rand ?? Math.random;
  for (let i = 0; i < (opts?.toiDaLanThu ?? 10); i++) {
    const ma = dinhDangMaPhuHuynh(maCoSo, thanMaPhuHuynh(rand));
    if (!DANG_MA_PHU_HUYNH.test(ma)) throw new Error(`Mã phụ huynh sinh ra không hợp lệ (${ma})`);
    await tx.maPhuHuynh.createMany({
      data: [{ centerId: p.centerId, orgUnitId: p.orgUnitId ?? null, soDienThoai: p.soDienThoai, ma }],
      skipDuplicates: true,
    });
    const doc = await docMaPhuHuynh(tx, { centerId: p.centerId, soDienThoai: p.soDienThoai });
    if (doc) return doc; // của mình, hoặc của lượt đua thắng — cùng là MỘT mã cho phụ huynh này
  }
  throw new Error("Không cấp được mã phụ huynh duy nhất sau nhiều lần thử");
}

/**
 * Cấp mã cho phụ huynh NGAY KHI LEAD VÀO [chủ dự án 08/11/2026: «Mã KH là ID của khách — lead vào là đã có sẵn, lúc thanh toán chỉ lấy lại»].
 * Gọi CÙNG transaction với `lead.create` ở các đường tạo lead. KHÔNG BAO GIỜ làm hỏng việc nhận lead: thiếu cơ sở / thiếu SĐT / cơ sở chưa có mã
 * ⇒ trả `null` (mã sẽ được cấp ở lần Lưu khối «Người mua trên hoá đơn», hoặc đợt cấp bù cho lead cũ).
 */
export async function capMaChoLeadMoi(
  c: Client,
  lead: { centerId: string | null | undefined; orgUnitId?: string | null; phone: string | null | undefined },
): Promise<string | null> {
  try {
    const sdt = khoaSdtPhuHuynh(lead.phone);
    if (!lead.centerId || !sdt) return null;
    const center = await c.center.findUnique({ where: { id: lead.centerId }, select: { code: true } });
    if (!center?.code) return null;
    return await layHoacCapMaPhuHuynh(c, { centerId: lead.centerId, orgUnitId: lead.orgUnitId ?? null, soDienThoai: sdt });
  } catch (e) {
    // Lead đã vào thì không được mất vì chuyện mã: nuốt lỗi phía mã, ghi log; mã được cấp bù ở lần Lưu khối người mua / đợt cấp bù.
    console.error("[ma-phu-huynh] không cấp được mã lúc lead vào:", e instanceof Error ? e.message : e);
    return null;
  }
}
