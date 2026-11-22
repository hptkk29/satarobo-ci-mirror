import "server-only";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { vnParts } from "@/lib/time/vn";
import {
  TOI_DA_LAN_SAI,
  chamNguongKhoa,
  giayConKhoa,
  lanThuConLai,
  mocKhoaDen,
} from "@/lib/portal/hv-ma-thuan";

// Mã thoát Cổng học sinh — phần có DB. Luật thuần (mã dễ đoán, ngưỡng khoá, đồng hồ) ở `hv-ma-thuan.ts`.
//
// ⚠️ THỨ TỰ trong `kiemMaCoDem` là phần bảo mật, đừng "gọn" lại:
//   1. dọn khoá ĐÃ HẾT HẠN;
//   2. ĐẶT CHỖ một lần thử bằng MỘT câu `UPDATE … WHERE khoaDen IS NULL AND soLanSai < 5 … soLanSai + 1` (nguyên tử);
//   3. mới so bcrypt.
// Đặt chỗ TRƯỚC khi so ⇒ nhiều yêu cầu song song không bao giờ có được lần thử thứ sáu (so rồi mới đếm thì năm yêu cầu
// cùng đọc "0 lần sai" đều được so). Hết chỗ ⇒ trả "khoá" mà KHÔNG chạm bcrypt.

export type LoaiNhatKy =
  | "VAO"
  | "THOAT_DUNG_MA"
  | "NHAP_SAI"
  | "KHOA"
  | "TAO_MA"
  | "DOI_MA"
  | "DAT_LAI_MA"
  | "XAC_MINH_SAI";

export async function ghiNhatKy(parentUserId: string, studentId: string | null, loai: LoaiNhatKy, chiTiet?: string): Promise<void> {
  await db.hocSinhCheDoNhatKy.create({ data: { parentUserId, studentId, loai, chiTiet: chiTiet ?? null } });
}

export async function coMaThoat(parentUserId: string): Promise<boolean> {
  const r = await db.hocSinhMaThoat.findUnique({ where: { parentUserId }, select: { id: true } });
  return r !== null;
}

/** Mã ứng viên có TRÙNG mã đang dùng không (Đổi mã đòi mã mới khác mã cũ). KHÔNG đếm lần sai — đây là so với mã người gõ vừa chứng minh biết. */
export async function trungMaHienTai(parentUserId: string, ma: string): Promise<boolean> {
  const r = await db.hocSinhMaThoat.findUnique({ where: { parentUserId }, select: { maBam: true } });
  return r ? bcrypt.compare(ma, r.maBam) : false;
}

/** Đặt mã (lần đầu hoặc đổi). Luôn xoá bộ đếm sai + khoá — đặt lại mã là xác minh ba mẹ vừa qua. */
export async function luuMaThoat(parentUserId: string, ma: string): Promise<void> {
  const maBam = await bcrypt.hash(ma, 10);
  await db.hocSinhMaThoat.upsert({
    where: { parentUserId },
    create: { parentUserId, maBam },
    update: { maBam, soLanSai: 0, khoaDen: null },
  });
}

export type KetQuaKiemMa =
  | { ket: "dung" }
  | { ket: "sai"; conLai: number }
  | { ket: "khoa"; giayCon: number; vuaKhoa: boolean }
  | { ket: "chua-co-ma" };

/**
 * Kiểm mã thoát VÀ đếm lần sai. Dùng chung cho MỌI chỗ đòi mã (thoát chế độ học sinh, bước "nhập mã hiện tại" của Đổi mã):
 * một bộ đếm duy nhất, nếu không bước đổi mã sẽ là cỗ máy đoán mã không giới hạn.
 */
export async function kiemMaCoDem(
  parentUserId: string,
  ma: string,
  now: Date,
  boiCanh: { studentId: string | null; tenCon: string | null },
): Promise<KetQuaKiemMa> {
  // 1. khoá đã hết hạn ⇒ làm sạch để con có đủ 5 lần thử mới
  await db.hocSinhMaThoat.updateMany({
    where: { parentUserId, khoaDen: { lte: now } },
    data: { soLanSai: 0, khoaDen: null },
  });

  // 2. đặt chỗ nguyên tử
  let sauKhiDat;
  try {
    sauKhiDat = await db.hocSinhMaThoat.update({
      where: { parentUserId, khoaDen: null, soLanSai: { lt: TOI_DA_LAN_SAI } },
      data: { soLanSai: { increment: 1 } },
      select: { maBam: true, soLanSai: true },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2025") throw e;
    const dong = await db.hocSinhMaThoat.findUnique({ where: { parentUserId }, select: { khoaDen: true, soLanSai: true } });
    if (!dong) return { ket: "chua-co-ma" };
    // Đủ 5 lần mà chưa có mốc khoá (lượt thứ 5 đang giữa chừng) ⇒ tự đặt mốc, không để khe hở. Ai THẮNG phép đặt có điều kiện thì
    // người đó ghi nhật ký + báo chuông (dedupeKey theo mốc nên không bao giờ báo đôi).
    let khoaDen = dong.khoaDen;
    let vuaKhoa = false;
    if (!khoaDen) {
      const moc = mocKhoaDen(now);
      const dat = await db.hocSinhMaThoat.updateMany({ where: { parentUserId, khoaDen: null }, data: { khoaDen: moc } });
      if (dat.count === 1) {
        khoaDen = moc;
        vuaKhoa = true;
        await ghiNhatKy(parentUserId, boiCanh.studentId, "KHOA", `Khoá ${giayConKhoa(moc, now)} giây`);
        await baoKhoaVaoChuong(parentUserId, boiCanh, moc);
      } else {
        khoaDen = (await db.hocSinhMaThoat.findUnique({ where: { parentUserId }, select: { khoaDen: true } }))?.khoaDen ?? moc;
      }
    }
    return { ket: "khoa", giayCon: giayConKhoa(khoaDen, now), vuaKhoa };
  }

  // 3. so mã
  const dung = await bcrypt.compare(ma, sauKhiDat.maBam);
  if (dung) {
    await db.hocSinhMaThoat.updateMany({ where: { parentUserId, khoaDen: null }, data: { soLanSai: 0 } });
    return { ket: "dung" };
  }

  await ghiNhatKy(parentUserId, boiCanh.studentId, "NHAP_SAI");
  if (!chamNguongKhoa(sauKhiDat.soLanSai)) return { ket: "sai", conLai: lanThuConLai(sauKhiDat.soLanSai) };

  const khoaDen = mocKhoaDen(now);
  const dat = await db.hocSinhMaThoat.updateMany({ where: { parentUserId, khoaDen: null }, data: { khoaDen } });
  const vuaKhoa = dat.count === 1;
  if (vuaKhoa) {
    await ghiNhatKy(parentUserId, boiCanh.studentId, "KHOA", `Khoá ${giayConKhoa(khoaDen, now)} giây`);
    await baoKhoaVaoChuong(parentUserId, boiCanh, khoaDen);
  }
  return { ket: "khoa", giayCon: giayConKhoa(khoaDen, now), vuaKhoa };
}

/**
 * "Báo vào chuông thông báo của ba mẹ": một `Notification` audience STUDENT gắn đúng con đang dùng. Nguồn thông báo của
 * phụ huynh (`getParentNotifications`) đã đọc audience này nên KHÔNG cần sửa feed. `dedupeKey` theo mốc khoá ⇒ một đợt khoá
 * chỉ một thông báo dù gọi lặp. Lỗi tạo thông báo KHÔNG được làm hỏng việc khoá.
 */
async function baoKhoaVaoChuong(
  parentUserId: string,
  boiCanh: { studentId: string | null; tenCon: string | null },
  khoaDen: Date,
): Promise<void> {
  if (!boiCanh.studentId) return;
  try {
    await db.notification.create({
      data: {
        title: "Có người nhập sai mã thoát Cổng học sinh 5 lần",
        body: `Ai đó đã nhập sai mã thoát ${boiCanh.tenCon ? `ở Cổng học sinh của ${boiCanh.tenCon} ` : ""}5 lần liên tiếp. Màn thoát đã tạm khoá 5 phút. Nếu không phải ba mẹ, hãy kiểm tra xem con có đang thử mã không. Ba mẹ có thể đặt lại mã ở Hồ sơ gia đình.`,
        audience: "STUDENT",
        studentId: boiCanh.studentId,
        isPublished: true,
        createdByName: "Hệ thống",
        dedupeKey: `hv-khoa:${parentUserId}:${khoaDen.getTime()}`,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // đã có thông báo của đợt khoá này
    console.error("[hv-ma] không tạo được thông báo khoá mã", e instanceof Error ? e.message : "lỗi lạ");
  }
}

export type KetQuaMatKhau = { ket: "dung" } | { ket: "sai" } | { ket: "qua-nhieu-lan" } | { ket: "khong-co-mat-khau" };

/**
 * "Quên mã" xác minh bằng mật khẩu đăng nhập. Đây là một CỬA THỬ MẬT KHẨU nằm ngoài màn đăng nhập (không qua giới hạn của
 * đăng nhập) ⇒ tự giới hạn theo userId: 5 lần / 15 phút, kể cả lần đúng (cùng một khoá đếm).
 */
export async function kiemMatKhauPhuHuynh(parentUserId: string, matKhau: string): Promise<KetQuaMatKhau> {
  const gioiHan = await rateLimit({ key: `hv-mk:${parentUserId}`, max: 5, windowMs: 15 * 60 * 1000 });
  if (!gioiHan.success) return { ket: "qua-nhieu-lan" };
  const u = await db.user.findUnique({ where: { id: parentUserId }, select: { password: true } });
  if (!u?.password) return { ket: "khong-co-mat-khau" };
  const dung = await bcrypt.compare(matKhau, u.password);
  if (!dung) {
    await ghiNhatKy(parentUserId, null, "XAC_MINH_SAI");
    return { ket: "sai" };
  }
  return { ket: "dung" };
}

export type DongNhatKy = { id: string; loai: LoaiNhatKy; studentId: string | null; chiTiet: string | null; luc: Date };

export async function docNhatKy(parentUserId: string, soDong = 8): Promise<DongNhatKy[]> {
  const rows = await db.hocSinhCheDoNhatKy.findMany({
    where: { parentUserId },
    orderBy: [{ taoLuc: "desc" }, { id: "desc" }],
    take: soDong,
    select: { id: true, loai: true, studentId: true, chiTiet: true, taoLuc: true },
  });
  return rows.map((r) => ({ id: r.id, loai: r.loai as LoaiNhatKy, studentId: r.studentId, chiTiet: r.chiTiet, luc: r.taoLuc }));
}

/** Năm sinh của MỌI con của phụ huynh (mã dùng chung cả nhà ⇒ chặn năm sinh của bất kỳ con nào). */
export async function docNamSinhCacCon(parentUserId: string): Promise<number[]> {
  const rows = await db.student.findMany({
    where: { parentUserId, deletedAt: null, dateOfBirth: { not: null } },
    select: { dateOfBirth: true },
  });
  return rows.flatMap((r) => (r.dateOfBirth ? [vnParts(r.dateOfBirth).year] : []));
}

export async function docTrangThaiKhoa(parentUserId: string, now: Date): Promise<{ coMa: boolean; giayKhoa: number }> {
  const r = await db.hocSinhMaThoat.findUnique({ where: { parentUserId }, select: { khoaDen: true } });
  return { coMa: r !== null, giayKhoa: giayConKhoa(r?.khoaDen ?? null, now) };
}
