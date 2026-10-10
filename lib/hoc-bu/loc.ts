import type { Prisma } from "@prisma/client";

// Tìm học viên ở màn Học bù (07/10/2026). THUẦN — không chạm DB, test được không cần Postgres.
//
// Khớp theo TÊN học viên, MÃ học viên, TÊN lớp. CỐ Ý không khớp SĐT phụ huynh: màn Đăng ký học chỉ
// cho tìm theo SĐT khi người xem thấy được SĐT thật (NỢ #11 — tìm theo SĐT là một "máy dò" SĐT),
// mà màn này không mang cổng đó.

/** Chuẩn hoá chuỗi tìm từ URL: bỏ khoảng trắng thừa, cắt 80 ký tự; rỗng ⇒ `undefined` (không lọc). */
export function chuanHoaTim(raw: string | undefined | null): string | undefined {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || undefined;
}

/** Điều kiện "dòng cần bù / đã huỷ của học viên khớp chuỗi tìm". */
export function timHocVienBu(tim: string): Prisma.MakeupNeedWhereInput {
  return {
    OR: [
      { student: { name: { contains: tim, mode: "insensitive" } } },
      { student: { studentCode: { contains: tim, mode: "insensitive" } } },
      { class: { name: { contains: tim, mode: "insensitive" } } },
    ],
  };
}
