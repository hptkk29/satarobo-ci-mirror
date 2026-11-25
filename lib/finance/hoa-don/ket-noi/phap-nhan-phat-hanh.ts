import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { phapNhanPhatHanhChoCoSo } from "../cau-hinh-co-so";
import { docCauHinhDangBat } from "../cau-hinh-co-so-db";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";

// lib/finance/hoa-don/ket-noi/phap-nhan-phat-hanh.ts — mã PHÁP NHÂN mà một lần phát hành sẽ đứng tên, để chọn đúng tài khoản kết nối (theo pháp nhân).
// CÙNG hàm thuần `phapNhanPhatHanhChoCoSo` với máy phát hành (`batDauPhatHanh`) và nút trên màn — ba nơi không thể nói ba điều khác nhau.

/** Pháp nhân phát hành hôm nay của một cơ sở theo cấu hình ĐANG BẬT; `null` = chưa cấu hình / chồng chéo (máy phát hành cũng sẽ từ chối). */
export async function phapNhanMaPhatHanhChoCoSo(actor: Actor, centerId: string, homNay: string): Promise<string | null> {
  const cauHinh = await docCauHinhDangBat(actor, [centerId]);
  const r = phapNhanPhatHanhChoCoSo({ cauHinh, centerId, ngay: homNay, danhSachPhapNhan: cauHinhHoaDonChoMoiTruong().phapNhan });
  return r.ok ? r.phapNhan.ma : null;
}

/** Pháp nhân ĐÃ CHỤP trên một hoá đơn (bản đã tạo) — dùng cho "Kiểm tra lại" / "Phát hành lại". `null` = bản cũ không có mã. */
export async function phapNhanMaCuaHoaDon(hoaDonId: string): Promise<string | null> {
  const h = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { phapNhanMa: true } });
  return h?.phapNhanMa ?? null;
}
