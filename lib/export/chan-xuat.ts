// lib/export/chan-xuat.ts — một dòng gác cho mỗi route xuất.
//
// Tồn tại để route KHÔNG phải tự ghép hai cổng. Mỗi chỗ tự ghép là một chỗ có thể quên một
// nửa, và nửa hay bị quên là nửa mới (`duocXuat`) vì nửa cũ đã nằm đó sẵn rồi.
//
// Dùng:
//   const chan = await chanXuat("nhan-su", session, { centerId });
//   if (chan) return chan;
//
// Trả `null` = cho qua. Trả `NextResponse` = từ chối, và **câu từ chối nói rõ thiếu gì** —
// DESIGN.md §5 xếp "không có quyền" là trạng thái hạng nhất, một chữ "Forbidden" trần buộc
// người dùng đi hỏi vòng mới biết phải xin ai cấp gì.
import { NextResponse } from "next/server";
import { duocXuat, vaiCuaPhien } from "./quyen-xuat";
import { timManXuat } from "./danh-muc-xuat";

type PhienToiThieu = { user: { role?: string | null; roles?: string[] | null } };

export async function chanXuat(
  ma: string,
  session: PhienToiThieu,
  target?: { centerId?: string | null; classId?: string | null },
): Promise<NextResponse | null> {
  const nguoi = vaiCuaPhien(session.user);
  if (await duocXuat(ma, nguoi, target)) return null;

  const man = timManXuat(ma);
  return NextResponse.json(
    {
      error: "Forbidden",
      message: man
        ? `Bạn chưa được phép xuất "${man.ten}". Quản trị tối cao cấp quyền này ở Cấu hình vận hành → Quyền xuất dữ liệu.`
        : "Đường xuất này chưa được khai trong danh mục quyền xuất.",
    },
    { status: 403 },
  );
}

/**
 * Chỉ gác VAI, bỏ qua cổng đọc dữ liệu.
 *
 * Dùng ĐÚNG cho route mà cổng đọc là phức hợp và route ĐÃ tự kiểm: `classes/export` nhận cả
 * `classes:view-all` lẫn `classes:view-own`, còn `bang-cong-thang/export` kiểm
 * `hr_attendance:export` theo từng cơ sở (quyền scope CENTER, hỏi không kèm cơ sở thì luôn
 * false cho vai cấp cơ sở).
 *
 * ⚠️ Những màn đó PHẢI khai `quyenGoc: null` trong danh mục, kèm `quyenGocGhiChu`. Khai một
 * `quyenGoc` rồi gọi hàm này là để danh mục hứa một cổng mà cổng ấy không chạy.
 */
export async function chanXuatVai(
  ma: string,
  session: PhienToiThieu,
): Promise<NextResponse | null> {
  const man = timManXuat(ma);
  if (man && man.quyenGoc !== null) {
    throw new Error(
      `chanXuatVai("${ma}") sai chỗ: màn này khai quyenGoc="${man.quyenGoc}" nên phải dùng chanXuat() để cổng đó được kiểm.`,
    );
  }
  return chanXuat(ma, session);
}
