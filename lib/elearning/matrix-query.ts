import type { ScopedDb } from "@/lib/actions/factory";
import type { NguoiDeKhop, YeuCauDeKhop } from "@/lib/elearning/requirement-match";
import { dungMaTran, tinhNSM, tinhNSMTheoNguoi, type ODat } from "@/lib/elearning/training-matrix";

/**
 * EL-17 — nạp dữ liệu cho MA TRẬN ĐÀO TẠO R3.
 *
 * ⚠️ CHỨNG CỨ "ĐÃ ĐẠT" là CHỨNG NHẬN CÒN HIỆU LỰC, và chỉ nó.
 *
 * Không phải "đã từng hoàn thành khoá": một chứng nhận hết hạn nghĩa là người ấy
 * CHƯA ĐẠT lại — đó là toàn bộ lý do chu kỳ tái chứng nhận tồn tại. Đếm "đã từng
 * học" là báo cáo tuân thủ nói dối theo hướng dễ chịu.
 *
 * ⚠️ Và cố ý KHÔNG cộng thêm nguồn thứ hai ("lượt ghi danh đã COMPLETED"). Người học
 * xong mà chưa có chứng nhận — thường vì khoá chưa có phiên bản xuất bản — sẽ hiện
 * CHƯA ĐẠT ở đây, và đó là ĐÚNG cách để lỗ ấy lộ ra. Nhóm này đã có chỗ đếm riêng
 * trên màn `/elearning/chung-nhan` ("lượt đã hoàn thành nhưng chưa có chứng nhận")
 * kèm nút cấp tay. Nhận hai nguồn sự thật cho cùng một câu hỏi là cách chắc chắn để
 * hai con số lệch nhau mà không ai biết cái nào đúng.
 */

export type DuLieuMaTran = {
  nguoi: (NguoiDeKhop & { hoTen: string; maNhanVien: string })[];
  yeuCau: (YeuCauDeKhop & { tenKhoa: string; dueDays: number })[];
  o: ODat[];
  nsm: ReturnType<typeof tinhNSM>;
  nsmNguoi: ReturnType<typeof tinhNSMTheoNguoi>;
  /** Nhân sự đang làm, trong tầm nhìn, nhưng CHƯA CÓ tài khoản ⇒ ngoài ma trận. */
  soNguoiChuaCoTaiKhoan: number;
};

export async function napMaTran(
  db: ScopedDb,
  now: Date = new Date(),
): Promise<DuLieuMaTran> {
  // ── Người: nhân sự ĐANG LÀM và CÓ tài khoản ────────────────────────────────
  //
  // ⚠️ Đòi có tài khoản là có chủ đích: người không có tài khoản thì không vào khu
  // học được (cổng layout chặn), nên đặt họ vào mẫu số là tạo ra một khoản nợ không
  // ai trả được. Đo prod 20/08/2026: 24 tài khoản staff / 14 hồ sơ nhân sự — độ lệch
  // này có thật và nó chạy theo cả hai chiều.
  const nhanSu = await db.employee.findMany({
    where: {
      isActive: true,
      status: "ACTIVE",
      userAccount: { is: {} },
      // `Employee` KHÔNG có cột `deletedAt` — nghỉ việc thể hiện bằng
      // `isActive`/`status`, đã lọc ở trên.
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      departmentId: true,
      orgUnitId: true,
      userAccount: { select: { id: true } },
    },
    orderBy: { fullName: "asc" },
    take: 500,
  });

  const idDonVi = [
    ...new Set(nhanSu.map((n) => n.orgUnitId).filter((v): v is string => v != null)),
  ];

  const yeuCauTho = await db.trnRequirement.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      effectiveFrom: { lte: now },
      // Hết hiệu lực rồi thì thôi — nhưng `effectiveTo = null` nghĩa là VÔ HẠN, phải
      // lọt qua. Viết thiếu nhánh `null` là làm biến mất mọi yêu cầu thường trực.
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    select: {
      id: true,
      courseId: true,
      scopeKind: true,
      positionId: true,
      departmentId: true,
      levelTag: true,
      orgUnitId: true,
      validityMonths: true,
      dueDays: true,
    },
    take: 200,
  });

  for (const y of yeuCauTho) if (y.orgUnitId) idDonVi.push(y.orgUnitId);

  const pathCua = new Map(
    idDonVi.length === 0
      ? []
      : (
          await db.orgUnit.findMany({
            where: { id: { in: [...new Set(idDonVi)] } },
            select: { id: true, path: true },
          })
        ).map((r) => [r.id, r.path] as const),
  );

  const tenKhoa = new Map(
    yeuCauTho.length === 0
      ? []
      : (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(yeuCauTho.map((y) => y.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title] as const),
  );

  const nguoi = nhanSu.map((n) => ({
    userId: n.userAccount!.id,
    departmentId: n.departmentId,
    orgUnitPath: n.orgUnitId ? pathCua.get(n.orgUnitId) ?? null : null,
    positionId: null,
    hoTen: n.fullName,
    maNhanVien: n.employeeCode,
  }));

  const yeuCau = yeuCauTho.map((y) => ({
    id: y.id,
    scopeKind: String(y.scopeKind),
    positionId: y.positionId,
    departmentId: y.departmentId,
    levelTag: y.levelTag == null ? null : String(y.levelTag),
    orgUnitPath: y.orgUnitId ? pathCua.get(y.orgUnitId) ?? null : null,
    validityMonths: y.validityMonths,
    tenKhoa: tenKhoa.get(y.courseId) ?? "(khoá đã gỡ)",
    dueDays: y.dueDays,
  }));

  // ── Chứng cứ: chứng nhận CÒN HIỆU LỰC ──────────────────────────────────────
  //
  // ⚠️ Lọc hạn bằng `validUntil`, KHÔNG bằng cột `status`. Cột ấy là bộ nhớ đệm do
  // cron cập nhật mỗi ngày; hạn thì trôi qua vào một khoảnh khắc. Đọc cột là để ma
  // trận vẽ ĐẠT cho một chứng nhận đã hết hạn từ sáng nay.
  const chungNhan =
    nguoi.length === 0 || yeuCau.length === 0
      ? []
      : await db.trnCertificate.findMany({
          where: {
            userId: { in: nguoi.map((n) => n.userId) },
            courseId: { in: [...new Set(yeuCauTho.map((y) => y.courseId))] },
            revokedAt: null,
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { userId: true, courseId: true },
        });

  const o = dungMaTran({
    nguoi,
    yeuCau,
    daDat: chungNhan,
    khoaCuaYeuCau: new Map(yeuCauTho.map((y) => [y.id, y.courseId] as const)),
  });

  // ⚠️ Đếm người BỊ LOẠI khỏi mẫu số, và nói ra.
  //
  // Nhân sự đang làm nhưng CHƯA CÓ TÀI KHOẢN không vào được khu học (cổng layout
  // chặn), nên họ không nằm trong ma trận. Đó là quyết định đúng — nhưng im lặng bỏ
  // họ đi thì mẫu số hụt mà không ai biết hụt bao nhiêu. Kế hoạch nói đúng nguyên
  // tắc này cho ô "chưa gán quản lý" của R4: đếm được, không được lặng lẽ bỏ.
  //
  // Chỉ đếm trong TẦM NHÌN của người đang xem (`db` đã scoped) — con số này không
  // được là một đường rò rỉ cho biết cơ sở khác có bao nhiêu người.
  const tongNhanSu = await db.employee.count({
    where: { isActive: true, status: "ACTIVE" },
  });

  return {
    nguoi,
    yeuCau,
    o,
    nsm: tinhNSM(o),
    nsmNguoi: tinhNSMTheoNguoi(o),
    soNguoiChuaCoTaiKhoan: Math.max(0, tongNhanSu - nguoi.length),
  };
}
