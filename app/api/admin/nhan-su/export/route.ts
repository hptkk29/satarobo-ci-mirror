// GET /api/admin/nhan-su/export?q=&department=&centerId=&status= — xuất hồ sơ nhân sự (xlsx).
//
// ─────────────────────────────────────────────────────────────────────────────
// BA CỔNG, BỎ CÁI NÀO CŨNG LÀ RÒ THẬT
//
// 1. **Quyền màn**: `employees:view-all` tại cơ sở đang lọc — CÙNG cổng với
//    `nhan-su/page.tsx`. Ai không mở được màn thì không tải được tệp.
// 2. **Cách ly cơ sở**: đọc qua `scopedDb`. `Employee` ∈ `SCOPED_MODELS`, nên quản lý cấp
//    cơ sở chỉ lấy được người của cơ sở mình. Dùng `db` trần ở đây là xuất cả công ty.
// 3. **Quyền TRƯỜNG**: `getEmployeeFieldVisibility` + `redactEmployeeFields`, rồi `cotXuatNhanSu`
//    BỎ HẲN cột ngoài quyền. Hai tầng có chủ đích: redact làm rỗng giá trị, bỏ cột làm mất
//    cả tiêu đề — quên tầng nào thì tầng kia vẫn đỡ.
//
// Bộ lọc nhận y nguyên của màn (`q` · `department` · `centerId` · `status`) để tệp khớp đúng
// thứ người ta đang nhìn.
//
// ⚠️ KHÔNG có `take: 200` như màn: màn cắt để render nhanh, còn tệp mà im lặng cắt ở dòng
// 200 là người ta gửi đi một bản THIẾU mà không biết. Số dòng ghi trong `_watermark`.
import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireLiveSession } from "@/lib/auth/live-session";
import { chanXuat } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getEmployeeFieldVisibility, redactEmployeeFields } from "@/lib/auth/permissions";
import { roleLabel } from "@/lib/labels";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { phoneSearchTerm } from "@/lib/phone";
import { dungWorkbook, tenTepAnToan } from "@/lib/cham-cong/xuat-bang";
import {
  cotXuatNhanSu,
  nhanBoPhan,
  nhanTrangThai,
  nhomBiCat,
  type DongNhanSu,
} from "@/lib/hr/xuat-nhan-su";

const BO_PHAN = new Set([
  "BAN_GIAM_DOC", "DAO_TAO", "MARKETING", "KINH_DOANH", "IT",
  "HANH_CHANH_NHAN_SU", "KE_TOAN", "TUYEN_SINH", "GIAO_VU", "GIANG_DAY",
]);
const TRANG_THAI = new Set(["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"]);

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const centerIdParam = sp.get("centerId")?.trim() ?? "";
  const deptParam = sp.get("department") ?? "";
  const rawStatus = sp.get("status") ?? "";

  // Cổng xuất: vai được giao ở Cấu hình vận hành → Quyền xuất dữ liệu, CỘNG với quyền đọc
  // dữ liệu (`employees:view-all`). Xem `lib/export/quyen-xuat.ts`.
  const chan = await chanXuat("nhan-su", session, {
    centerId: centerIdParam || session.user.centerId || null,
  });
  if (chan) return chan;

  // Mặc định `ACTIVE`, y như màn — "ALL" mới lấy hết.
  const statusParam =
    rawStatus === "ALL" ? undefined : TRANG_THAI.has(rawStatus) ? rawStatus : "ACTIVE";

  const where: Prisma.EmployeeWhereInput = {};
  if (BO_PHAN.has(deptParam)) where.department = deptParam as Prisma.EmployeeWhereInput["department"];
  if (centerIdParam) where.centerId = centerIdParam;
  if (statusParam) where.status = statusParam as Prisma.EmployeeWhereInput["status"];
  if (q) {
    // SĐT lưu 2 dạng (`0…` cũ / `84…` mới) — tìm theo phần lõi để không sót, y như màn.
    const qPhone = phoneSearchTerm(q) ?? q;
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { phone: { contains: qPhone } },
      { email: { contains: q, mode: "insensitive" } },
      { employeeCode: { contains: q, mode: "insensitive" } },
    ];
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const rows = await sdb.employee.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { fullName: "asc" }],
    include: {
      center: { select: { name: true } },
      manager: { select: { fullName: true } },
      userAccount: { select: { role: true, roles: true } },
    },
  });

  // Màn danh sách cố ý giữ `contact` (bảng in 2 cột Email/SĐT cho mọi người có view-all —
  // ghi chú SEC-H04 ở `nhan-su/page.tsx`). Tệp KHỚP màn: giấu ở tệp trong khi màn vẫn hiện
  // thì không bảo vệ được gì. Xem thêm khối chú thích đầu `lib/hr/xuat-nhan-su.ts`.
  const visibility = { ...getEmployeeFieldVisibility(session.user.role), contact: true };
  const cot = cotXuatNhanSu(visibility);

  const dong: DongNhanSu[] = rows.map((e) => {
    const r = redactEmployeeFields(e, visibility);
    const vai = r.userAccount
      ? [...new Set([r.userAccount.role, ...r.userAccount.roles])].map(roleLabel).join(", ")
      : null;
    return {
      employeeCode: r.employeeCode,
      fullName: r.fullName,
      jobTitle: r.jobTitle,
      department: r.department,
      centerName: r.center?.name ?? null,
      status: r.status,
      joinedAt: r.joinedAt,
      managerName: r.manager?.fullName ?? null,
      vaiTro: vai,
      isActive: r.isActive,
      email: r.email,
      phone: r.phone,
      salaryRank: r.salaryRank,
      salaryLevel: r.salaryLevel,
      bhxhBase: r.bhxhBase,
      dateOfBirth: r.dateOfBirth,
      gender: r.gender,
      contractType: r.contractType,
      endDate: r.endDate,
      address: r.address,
      emergencyContact: r.emergencyContact,
      notes: r.notes,
    };
  });

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);
  const cat = nhomBiCat(visibility);

  const moTaLoc = [
    q ? `tìm "${q}"` : null,
    BO_PHAN.has(deptParam) ? `bộ phận ${nhanBoPhan(deptParam)}` : null,
    centerIdParam ? "một cơ sở" : null,
    statusParam ? nhanTrangThai(statusParam) : "mọi trạng thái",
  ]
    .filter(Boolean)
    .join(" · ");

  const wb = dungWorkbook<DongNhanSu>({
    tieuDe: `HỒ SƠ NHÂN SỰ — ${dong.length} người${moTaLoc ? ` · ${moTaLoc}` : ""}`,
    tenSheet: "Nhan su",
    cot,
    dong,
    watermark: exportWatermark(actorName, actorId, dong.length, now),
    ghiChu: [
      `Bộ lọc: ${moTaLoc || "không lọc"}.`,
      // Tệp TỰ KHAI nó không đầy đủ. Không có dòng này thì người nhận kết luận "công ty
      // không có dữ liệu đó" và đi hỏi vòng, hoặc tệ hơn là tin bản thiếu.
      cat.length > 0
        ? `Bản RÚT GỌN theo quyền của người xuất — đã lược nhóm: ${cat.join(" · ")}.`
        : "Bản đầy đủ theo quyền của người xuất.",
      "Số căn cước/CCCD KHÔNG bao giờ nằm trong bản xuất — tra trên màn hồ sơ khi cần.",
    ],
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  // Doc 15: export nhạy cảm có watermark + audit lại. Ghi CẢ nhóm bị lược để sau này truy
  // được "tệp hôm đó có lương hay không".
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr",
    entityType: "Employee",
    entityId: `export:${now.toISOString().slice(0, 10)}`,
    action: "EXPORT",
    newValues: {
      man: "nhan-su",
      soDong: dong.length,
      loc: { q, department: deptParam, centerId: centerIdParam, status: statusParam ?? "ALL" },
      nhomDuocXem: { contact: visibility.contact, salary: visibility.salary, personal: visibility.personal },
    },
  });

  const ten = tenTepAnToan(`ho-so-nhan-su-${now.toISOString().slice(0, 10)}`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ten}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
