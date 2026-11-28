import type { PrismaClient } from "@prisma/client";
import { formatStudentCodeV2, randomStudentCodeBody } from "@/lib/codegen";
import { loiMaHocVien } from "@/lib/students/ma-hoc-vien-dang";
import { cauThieuHoSo, thieuHoSoHocVien, thieuHoSoPhuHuynh } from "./ho-so-mua";

/**
 * WORKSTREAM A — HỌC VIÊN CHỈ HỌC ONLINE: tạo hồ sơ học viên KHÔNG thuộc cơ sở nào, mã `SR-YY-XXXXXX`.
 *
 * ĐÃ ĐO (20/11/2026, DB local `ci_test_el_onl`, trigger `Student_studentCode_dang_trg` NGUYÊN VẸN):
 *  · trigger chỉ đối chiếu tiền tố với `Center.code` KHI `centerId IS NOT NULL`; `centerId = NULL` ⇒ chỉ kiểm HÌNH DẠNG, và `SR-26-7KQ4MD`
 *    khớp mẫu ⇒ INSERT qua. KHÔNG cần cơ sở giả `SR`, KHÔNG sửa trigger.
 *  · `genStudentCodeV2ChoCoSo` NÉM LỖI khi thiếu cơ sở (cố ý — chống mã lệch tiền tố) nên KHÔNG dùng được ở đây; hàm này là lối sinh mã
 *    thứ tư, tự kiểm lại bằng `loiMaHocVien(code, "SR")`. Lưới `[OHV-W*]` ghim: đúng MỘT nơi sinh mã `SR`, và nó không gọi
 *    `genStudentCodeV2ChoCoSo`.
 *
 * ⚠️ HỆ QUẢ ĐÃ BIẾT của `centerId = NULL` (không phải lỗi — đã đo, xem `ONLINE-ORDER-CONTRACT.md` §2):
 *  · `Student` ∈ SCOPED_MODELS ⇒ actor CẤP CƠ SỞ KHÔNG thấy học viên online (đúng ý: không thuộc cơ sở nào); actor cấp Hội sở/ADMIN thấy.
 *  · Cổng phụ huynh đọc theo `parentUserId` (không theo cơ sở) ⇒ không ảnh hưởng. `PortalChild.centerId` vốn nullable.
 *  · Nếu sau này một cơ sở thật có `Center.code = "SR"`, học viên online vẫn không bị ràng buộc (centerId null) — chỉ trùng TIỀN TỐ về mặt đọc.
 *
 * Học viên tại trung tâm KHÔNG bị chạm: hàm này chỉ TẠO mới (không sửa Student có sẵn), phụ huynh đã có con ở trung tâm chọn con đó
 * ở giỏ hàng bằng `studentId` (một con có thể vừa học offline vừa học online — hai hệ quyền học tách bạch).
 */

export const MA_CO_SO_ONLINE = "SR";

export type KetQuaTaoHocVienOnline =
  | { ok: true; studentId: string; studentCode: string; daCo: boolean }
  | { ok: false; ma: "SAI_PHU_HUYNH" | "THIEU_HO_SO_PHU_HUYNH" | "THIEU_HO_SO_HOC_VIEN" | "KHONG_SINH_DUOC_MA"; thongBao: string };

const laP2002 = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const chuanTen = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

export async function taoHocVienChiOnline(
  db: PrismaClient,
  input: { parentUserId: string; name: string; dateOfBirth?: Date | null; now: Date; rand?: () => number },
): Promise<KetQuaTaoHocVienOnline> {
  const rand = input.rand ?? Math.random;
  const thieuHv = thieuHoSoHocVien({ name: input.name });
  if (thieuHv.length > 0) return { ok: false, ma: "THIEU_HO_SO_HOC_VIEN", thongBao: cauThieuHoSo(thieuHv, "học viên") };

  // Va khoá duy nhất của mã (2 lượt song song sinh trùng) ⇒ thử lại với mã mới; tối đa vài lần.
  for (let lan = 0; lan < 5; lan++) {
    try {
      return await db.$transaction(async (tx) => {
        // Khoá dòng phụ huynh: hai lượt tạo cùng tên (bấm đúp) xếp hàng ⇒ lượt sau thấy con vừa tạo (idempotent theo tên).
        const ph = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${input.parentUserId} FOR UPDATE`;
        if (ph.length === 0) return { ok: false, ma: "SAI_PHU_HUYNH", thongBao: "Không tìm thấy tài khoản phụ huynh" } as const;
        const user = await tx.user.findFirst({
          where: { id: input.parentUserId, isActive: true, deletedAt: null, OR: [{ role: "PARENT" }, { roles: { has: "PARENT" } }] },
          select: { name: true, phone: true, email: true },
        });
        if (!user) return { ok: false, ma: "SAI_PHU_HUYNH", thongBao: "Tài khoản không phải phụ huynh đang hoạt động" } as const;
        const thieuPh = thieuHoSoPhuHuynh(user);
        if (thieuPh.length > 0) return { ok: false, ma: "THIEU_HO_SO_PHU_HUYNH", thongBao: cauThieuHoSo(thieuPh, "phụ huynh") } as const;

        const cung = chuanTen(input.name);
        const conDaCo = await tx.student.findMany({ where: { parentUserId: input.parentUserId, deletedAt: null }, select: { id: true, name: true, studentCode: true } });
        const trung = conDaCo.find((c) => chuanTen(c.name) === cung);
        if (trung) return { ok: true, studentId: trung.id, studentCode: trung.studentCode ?? "", daCo: true } as const;

        let ma = "";
        for (let i = 0; i < 10; i++) {
          const thu = formatStudentCodeV2(MA_CO_SO_ONLINE, randomStudentCodeBody(rand), input.now);
          if (!(await tx.student.findUnique({ where: { studentCode: thu }, select: { id: true } }))) {
            ma = thu;
            break;
          }
        }
        if (!ma) return { ok: false, ma: "KHONG_SINH_DUOC_MA", thongBao: "Không sinh được mã học viên duy nhất — thử lại" } as const;
        const loi = loiMaHocVien(ma, MA_CO_SO_ONLINE);
        if (loi) throw new Error(`Mã học viên online sinh ra không hợp lệ (${ma}): ${loi}`);

        const sv = await tx.student.create({
          data: {
            name: input.name.trim().replace(/\s+/g, " "),
            studentCode: ma,
            dateOfBirth: input.dateOfBirth ?? null,
            parentUserId: input.parentUserId,
            // Sao chép từ tài khoản phụ huynh — cùng nghĩa với convert-lead; CHƯA có phiếu lead nào để đồng bộ (không có dòng nào cho `dongBoTuHocVien`).
            parentName: user.name,
            parentPhone: user.phone,
            parentEmail: user.email,
            centerId: null,
          },
          select: { id: true, studentCode: true },
        });
        return { ok: true, studentId: sv.id, studentCode: sv.studentCode ?? ma, daCo: false } as const;
      });
    } catch (e) {
      if (laP2002(e) && lan < 4) continue;
      throw e;
    }
  }
  return { ok: false, ma: "KHONG_SINH_DUOC_MA", thongBao: "Không sinh được mã học viên duy nhất — thử lại" };
}
