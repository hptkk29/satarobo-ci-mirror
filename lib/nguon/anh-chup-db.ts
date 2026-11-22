/**
 * lib/nguon/anh-chup-db.ts — ĐỌC dữ liệu cho ẢNH CHỤP người giới thiệu khi ĐỔI nguồn bằng tay (MỘT lead). Đường nhập lead dùng bản theo LÔ
 * ở `thu-thap-tin-hieu.ts`; hai nơi dùng CÙNG hàm quyết định thuần (`suyVaiNguon`, `chonSaleCuaPhuHuynh`) nên không lệch luật.
 *
 * Client `db` KHÔNG scope (T11): nhân sự / học viên cơ sở khác vẫn phải thấy được — kết quả chỉ chui vào cột ảnh chụp, không trả ra giao diện.
 * `luc` BẮT BUỘC (luật 19): vai tính TẠI thời điểm đó, lead/Sale sau thời điểm đó bị loại.
 */
import type { db } from "@/lib/db";
import { VAI_SANG_NGUON_MAC_DINH, suyVaiNguon } from "./danh-muc-goc";
import { chonSaleCuaPhuHuynh } from "./sale-cua-phu-huynh";
import { vaiTaiThoiDiem } from "./thu-thap-tin-hieu";
import { ANH_CHUP_TRONG, type AnhChupNguon } from "./tin-hieu";

type Db = typeof db;

/** Ảnh chụp của MỘT nhân sự giới thiệu: vai ngữ nghĩa tại `luc` + dấu vết không PII. Nhân sự không tồn tại ⇒ ảnh chụp rỗng. */
export async function docAnhChupNhanSu(client: Db, employeeId: string, luc: Date): Promise<AnhChupNguon> {
  const e = await client.employee.findUnique({
    where: { id: employeeId },
    select: { employeeCode: true, orgUnitId: true, userAccount: { select: { id: true } } },
  });
  if (!e) return ANH_CHUP_TRONG;
  const userId = e.userAccount?.id ?? null;
  const vai = userId
    ? await client.userOrgRole.findMany({
        where: { userId, status: "ACTIVE" },
        select: { effectiveFrom: true, effectiveTo: true, role: { select: { code: true } } },
      })
    : [];
  const roleCodes = vaiTaiThoiDiem(vai, luc);
  return {
    referrerRoleCode: suyVaiNguon(roleCodes, VAI_SANG_NGUON_MAC_DINH),
    referrerSaleUserId: null,
    nguoiGioiThieu: { employeeCode: e.employeeCode, roleCodes, orgUnitId: e.orgUnitId },
    nguon: null,
  };
}

/** Sale phụ trách của phụ huynh giới thiệu tại `luc`; null = không tìm được (người gọi ghi cờ xem tay `THIEU_SALE_PH`). */
export async function docSaleCuaPhuHuynh(
  client: Db,
  p: { studentId: string | null; parentUserId: string | null },
  luc: Date,
): Promise<string | null> {
  if (!p.studentId && !p.parentUserId) return null;
  const chon = {
    id: true,
    parentUserId: true,
    lead: { select: { id: true, convertedById: true, assignedToId: true, convertedAt: true, createdAt: true, deletedAt: true } },
  } as const;
  const hocVien = await client.student.findMany({
    where: {
      deletedAt: null,
      OR: [...(p.studentId ? [{ id: p.studentId }] : []), ...(p.parentUserId ? [{ parentUserId: p.parentUserId }] : [])],
    },
    select: chon,
  });
  // Chỉ biết học viên: anh/chị/em cùng phụ huynh của bé ấy cũng là ứng viên (một câu nữa, chỉ khi cần).
  const phuHuynhCuaBe = !p.parentUserId && p.studentId ? (hocVien.find((h) => h.id === p.studentId)?.parentUserId ?? null) : null;
  if (phuHuynhCuaBe) {
    hocVien.push(...(await client.student.findMany({ where: { deletedAt: null, parentUserId: phuHuynhCuaBe }, select: chon })));
  }
  return chonSaleCuaPhuHuynh({ studentId: p.studentId, parentUserId: p.parentUserId, hocVien, bayGio: luc });
}
