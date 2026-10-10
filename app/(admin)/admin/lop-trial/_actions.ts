"use server";

// app/(admin)/admin/lop-trial/_actions.ts — GĐ2.
//
// Lớp action RIÊNG của màn "Lớp Trial". CỐ Ý không import bất cứ thứ gì từ
// `../trials/**` hay `../trial-classes/**`: hai màn cũ phải chạy nguyên vẹn suốt
// giai đoạn nghiệm thu song song, và ở GĐ6 xoá chúng phải không kéo theo màn này.
// Logic dùng chung nằm ở `@/lib/trial/service.ts`; phần nào action cũ tự làm thì
// được CHÉP sang đây kèm ghi chú nguồn.
//
// Hậu tố `LopTrial` trong tên hàm là có chủ đích: suốt giai đoạn chạy song song,
// log và audit sẽ có hai bộ action làm việc giống nhau — trùng tên là nguồn nhầm lẫn.
import { revalidatePath } from "next/cache";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { laLeadCuaToi, leadCuaToiOrClause } from "@/lib/lead/sharing";
import {
  quyenChuyenCase,
  quyenDiemDanhCase,
  quyenDoiGioCase,
  quyenGoHocVien,
  quyenSuaCase,
  quyenXoaCase,
} from "@/lib/trial/quyen-case";
import { laLopTheoKhung, thuocCase } from "@/lib/trial/nghia-null";
import { kiemKhoaTruocKhiVaoCase } from "@/lib/trial/khoa-truoc-case";
import { khoaHieuLucCuaBe } from "@/lib/lead/khoa-quan-tam";
import { datKhoaHocChoBeTrial } from "@/lib/trial/khoa-hoc-db";
import { layGvVangChoCase } from "@/lib/trial/gv-vang-case-db";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { leadStatusLabel } from "@/lib/leads/status";
import { phoneSearchTerm } from "@/lib/phone";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { locGiaoVienChoBuoi, type DongGv } from "@/lib/trial/gv-kha-dung";
import { layCaCuaNhieuNguoi } from "@/lib/trial/gv-kha-dung-db";
import {
  createTrialClass,
  addTrialSession,
  enrollLeadChild,
  unenrollLeadChild,
  markAttendance,
  completeTrialSession,
  cancelTrialClass,
  rescheduleTrialEnrollment,
  goHocVienKhoiCase,
  notifyTrialTeacherAssigned,
} from "@/lib/trial/service";
import { getSetting } from "@/lib/settings/service";
import { layCauHinhKhung } from "@/lib/trial/khung-gio-db";
import { vnWeekday, vnYmd } from "@/lib/time/vn";
import {
  khungChoNgay,
  kiemCaseThuocLop,
  kiemKhungLop,
  sinhNgayTheoThu,
  TEN_THU,
  THU_KHOA,
  type CauHinhKhung,
} from "@/lib/trial/khung-gio-mo-lop";
import { getAuditActor } from "@/lib/audit/log";
import {
  ghiTuongTacNhieuLead,
  ghiTuongTacTheoConLead,
  layConTheoGhiDanhTrial,
  layLeadTrongLopTrial,
  layLeadTrongCaseTrial,
} from "@/lib/lead/tuong-tac/ghi";
import {
  actorCanUseCenter,
  loadScopedTrialClass,
  loadScopedTrialSession,
  requireActor,
} from "./_lib/guards";
import {
  addSessionSchema,
  updateSessionSchema,
  cancelSessionSchema,
  attendanceSchema,
  createClassSchema,
  taoTheoThuSchema,
  gvChoBuoiSchema,
  ngoaiCuaSoNgayGvBuoi,
} from "./_lib/schemas";
import { ngayVnSangUtc } from "./_lib/filters";
import { quyRaCheDo } from "./_lib/che-do-gv";
import { gvXepDuocTheoDanhSach } from "./_lib/gv-hop-le";
import { layLichBanGiaoVien } from "./_lib/queries";
import type { ActionResult, Candidate } from "./_lib/types";

const CHUA_DANG_NHAP = "Chưa đăng nhập" as const;
const KHONG_THAY_LOP = "Không tìm thấy lớp trải nghiệm" as const;


// ═══════════════════════════════════════════════════════════════════════════
// 2b) Danh sách giáo viên chọn được cho MỘT khung giờ (chốt 17/09/2026)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Giáo viên đang được gán ở BẤT KỲ buổi nào của lớp — luôn phải giữ trong ô chọn.
 *
 * Không có vế này thì người đã nghỉ việc (hoặc hôm nay không có ca) bị lọc mất khỏi
 * `<select>` trong khi tên họ vẫn in ở thẻ bên cạnh, và lần lưu kế tiếp `<select>` âm
 * thầm đổi sang người khác. Đó đúng là gốc của bug "gán từ trang Giáo viên nhưng Lớp
 * học hiện trống" đã gặp hai lần.
 */
async function gvDangGanTrongLop(
  actor: Actor,
  trialClassId: string,
): Promise<string[]> {
  const rows = await scopedDb(actor).trialClassSession.findMany({
    where: { trialClassId, teacherId: { not: null } },
    select: { teacherId: true },
    take: 200,
  });
  return rows.map((r) => r.teacherId).filter((id): id is string => Boolean(id));
}

/**
 * Ai được điểm danh / hoàn tất một buổi trải nghiệm.
 *
 * Người quản lý cơ sở làm được mọi lớp trong tầm nhìn; ngoài ra chỉ giáo viên phụ
 * trách chính lớp đó.
 *
 * ⚠️ Màn cũ viết rào này là `!isManager && hasRole(user, "TEACHER") && ...`. Bản mới
 * BỎ vế `hasRole` vì hai lý do: (1) luật cứng Nền Hệ thống #1 cấm so vai thủ công
 * trong Server Action — file cũ chỉ chạy được nhờ nằm trong danh sách miễn trừ, và
 * code mới không xin miễn trừ; (2) bỏ vế đó làm rào CHẶT hơn theo hướng fail-closed:
 * vai nào có `trials:feedback` mà không có `trials:manage` thì nay cũng chỉ thao tác
 * được lớp mình dạy. Hôm nay điều đó KHÔNG đổi hành vi của ai — trong seed vai, vai
 * duy nhất có feedback mà không có manage đúng là TEACHER.
 */
async function duocThaoTacBuoi(ses: {
  centerId: string;
  classTeacherId: string | null;
}): Promise<boolean> {
  if (await checkPermission("trials:manage", { centerId: ses.centerId })) return true;
  const ctx = await requireActor();
  return Boolean(ctx && ses.classTeacherId === ctx.session.user.id);
}

/**
 * Làm mới màn "Lớp Trial".
 *
 * Giai đoạn chạy song song hai màn đã kết thúc ở GĐ6a: `/trial-classes` và `/trials`
 * nay chỉ là `redirect()`, làm mới chúng là làm mới một trang không có gì để làm mới.
 */
function lamMoi(trialClassId?: string): void {
  revalidatePath("/lop-trial");
  if (trialClassId) revalidatePath(`/lop-trial/${trialClassId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) Tạo lớp
// ═══════════════════════════════════════════════════════════════════════════

export async function createLopTrialClassAction(
  input: unknown,
): Promise<ActionResult<{ id?: string }>> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  // 22/09/2026 — cổng ĐỔI từ `trials:manage` sang `trials:create-class`.
  //
  // Chủ dự án: "chỉ cho QL tạo và sale chỉ vào chọn lớp trial theo ngày đặt lịch và add
  // học viên". Sale VẪN giữ `trials:manage` (họ cần nó để thêm case + xếp học viên), nên
  // giữ cổng cũ ở đây là không chặn được ai — phải là khoá riêng.
  if (!(await checkPermission("trials:create-class"))) {
    return {
      ok: false,
      error:
        "Chỉ Quản lý cơ sở hoặc Đào tạo mở được lớp trải nghiệm — bạn chọn lớp đã mở rồi thêm case",
    };
  }

  const parsed = createClassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  if (!actorCanUseCenter(ctx.actor, data.centerId)) {
    return { ok: false, error: "Bạn không có quyền tạo lớp tại cơ sở này" };
  }

  const ngay = ngayVnSangUtc(data.date);
  if (!ngay) return { ok: false, error: "Ngày mở lớp không hợp lệ" };

  const kiem = await kiemKhungLopTheoCauHinh({
    ngay,
    startTime: data.startTime,
    endTime: data.endTime,
  });
  if (!kiem.ok) return { ok: false, error: kiem.loi };

  const res = await createTrialClass({
    centerId: data.centerId,
    courseId: data.courseId ?? null,
    // Tên do người dùng gõ; bỏ trống ⇒ server sinh theo quy ước (xem `createTrialClass`).
    name: data.name ?? null,
    configId: null,
    // ĐẢO QĐ-R2-1: lớp nay CÓ ngày + khung giờ (xem `createClassSchema`).
    startDate: ngay,
    startTime: data.startTime,
    endTime: data.endTime,
    actorId: ctx.session.user.id,
  });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Tạo lớp thất bại" };

  lamMoi();
  return { ok: true, id: res.trialClassId };
}

/**
 * Mở lớp cho CẢ KỲ theo thứ — "sinh theo thứ" (chủ dự án 22/09/2026).
 *
 * Mỗi ngày khớp thứ sẽ mở ĐÚNG các khung đã cấu hình của thứ đó, nên thứ 7 tự ra hai
 * lớp (sáng + chiều). Không nhận giờ từ client: xem lý do ở `taoTheoThuSchema`.
 *
 * Tạo TUẦN TỰ, không `Promise.all` — `createTrialClass` lấy mã lớp từ bộ đếm dùng chung
 * (`nextSeq`) trong transaction, chạy song song là tranh nhau cùng một khoá đếm.
 */
export async function taoLopTrialTheoThuAction(
  input: unknown,
): Promise<ActionResult<{ daTao?: number; boQua?: string[] }>> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:create-class"))) {
    return { ok: false, error: "Chỉ Quản lý cơ sở hoặc Đào tạo mở được lớp trải nghiệm" };
  }

  const parsed = taoTheoThuSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Khử trùng + kiểm quyền TỪNG cơ sở TRƯỚC khi tạo lớp nào: một cơ sở ngoài quyền thì
  // từ chối cả lượt, không mở dở cho các cơ sở còn lại rồi mới báo lỗi.
  const coSos = [...new Set(data.centerIds)];
  const ngoaiQuyen = coSos.filter((id) => !actorCanUseCenter(ctx.actor, id));
  if (ngoaiQuyen.length > 0) {
    return { ok: false, error: "Bạn không có quyền tạo lớp tại một trong các cơ sở đã chọn" };
  }
  // Tên cơ sở cho dòng "bỏ qua" — chỉ cần khi áp dụng cho nhiều cơ sở.
  const tenCoSo = new Map<string, string>();
  if (coSos.length > 1) {
    const rows = await scopedDb(ctx.actor).center.findMany({
      where: { id: { in: coSos } },
      select: { id: true, name: true },
    });
    for (const r of rows) tenCoSo.set(r.id, r.name);
  }

  const tu = ngayVnSangUtc(data.tu);
  const den = ngayVnSangUtc(data.den);
  if (!tu || !den) return { ok: false, error: "Khoảng ngày không hợp lệ" };

  const boQua: string[] = [];
  let daTao = 0;

  // Khử trùng theo (ngày, giờ bắt đầu, giờ kết thúc): hai tuỳ chọn chồng nhau (ví dụ một
  // dòng tick T7 và một dòng tick cả tuần, cùng khung sáng) sẽ ra hai lớp y hệt cho cùng
  // một ngày — Sale nhìn vào không biết chọn cái nào.
  const daMo = new Set<string>();

  for (const centerId of coSos) {
    const tienTo = coSos.length > 1 ? `${tenCoSo.get(centerId) ?? centerId} · ` : "";
    for (const qt of data.quyTac) {
      const ngays = sinhNgayTheoThu({ tu, den, thu: qt.thu });
      if (!ngays.ok) {
        boQua.push(`${tienTo}${qt.startTime}–${qt.endTime}: ${ngays.loi}`);
        continue;
      }
      for (const ngay of ngays.ngay) {
        const khoa = `${centerId}|${vnYmd(ngay)}|${qt.startTime}|${qt.endTime}`;
        if (daMo.has(khoa)) continue;

        // Cổng khung giờ chạy cho TỪNG NGÀY, không phải một lần cho cả tuỳ chọn: cùng một
        // khung có thể hợp lệ ở thứ 3 mà không hợp lệ ở thứ 7.
        const kiem = await kiemKhungLopTheoCauHinh({
          ngay,
          startTime: qt.startTime,
          endTime: qt.endTime,
        });
        if (!kiem.ok) {
          boQua.push(`${tienTo}${vnYmd(ngay)} ${qt.startTime}–${qt.endTime}: ${kiem.loi}`);
          continue;
        }

        const res = await createTrialClass({
          centerId,
          // KHÔNG nhận khoá trải nghiệm (chủ dự án 22/09 vòng 2): "qlcs không biết khung giờ
          // đó sẽ có học viên trải nghiệm nào nên cũng không biết khoá trải nghiệm nào".
          courseId: null,
          name: null, // mở hàng loạt thì tên tay không có nghĩa — để server đặt theo quy ước
          configId: null,
          startDate: ngay,
          startTime: qt.startTime,
          endTime: qt.endTime,
          actorId: ctx.session.user.id,
        });
        if (res?.ok) {
          daTao += 1;
          daMo.add(khoa);
        } else {
          boQua.push(`${tienTo}${vnYmd(ngay)} ${qt.startTime}–${qt.endTime}: ${res?.error ?? "tạo thất bại"}`);
        }
      }
    }
  }

  lamMoi();
  return { ok: true, daTao, boQua };
}

/**
 * Cổng khung giờ dùng chung cho MỌI đường mở lớp: form một ngày, sinh theo thứ, và
 * import Excel.
 *
 * Gom vào một hàm vì ba đường mà ba bản kiểm là ba chỗ để lệch — và đường dễ quên nhất
 * (import Excel) lại là đường đẻ ra nhiều lớp nhất một lúc.
 *
 * KHÔNG `export`: tệp này mang `"use server"`, nên export ra là đẻ thêm một endpoint mà
 * bảng cổng quyền phải khai. Đây là hàm nội bộ của chính tệp.
 */
async function kiemKhungLopTheoCauHinh(p: {
  ngay: Date;
  startTime: string;
  endTime: string;
}): Promise<{ ok: true } | { ok: false; loi: string }> {
  const cauHinh = await layCauHinhKhung();
  const khung = khungChoNgay(p.ngay, cauHinh);
  if (!khung.ok) return { ok: false, loi: khung.loi };
  const thu = TEN_THU[THU_KHOA[vnWeekday(p.ngay)]!];
  const r = kiemKhungLop({
    khungHopLe: khung.giaTri,
    startTime: p.startTime,
    endTime: p.endTime,
    tenThu: thu ?? "Ngày này",
  });
  return r.ok ? { ok: true } : { ok: false, loi: r.loi };
}

/**
 * Ai chọn được cho buổi trải nghiệm ngày `date`, khung `startTime`–`endTime`.
 *
 * Vì sao là Server Action chứ không phải prop bơm sẵn từ trang: ngày và giờ do người
 * dùng chọn TỰ DO, nên bơm sẵn nghĩa là bơm cả lưới ca của mọi giáo viên mọi ngày xuống
 * trình duyệt — vừa nặng vừa là dữ liệu chấm công của người khác nằm trong bundle.
 *
 * ⚠️ Đây là đường ĐỌC nhưng vẫn gác bằng `trials:manage`, CÙNG khoá với cửa ghi: nó trả
 * về tên người kèm trạng thái lịch dạy, và nó là thứ cửa ghi dùng để tự gác. Hai bên
 * lệch khoá là hoặc rò danh sách, hoặc lọc trang trí.
 *
 * Thứ tự cố ý: `requireActor` → `loadScopedTrialClass` (lọc theo tầm nhìn, ngoài phạm vi
 * là "không tìm thấy") → `checkPermission` KÈM `centerId` của lớp. Nạp lớp trước chỉ để
 * có `centerId` thật mà hỏi quyền — và nó đã bị `scopedDb` cắt theo tầm nhìn nên không
 * mở thêm đường dò id nào.
 */
export async function layGvChoBuoiAction(input: {
  trialClassId: string;
  /** "YYYY-MM-DD" theo lịch VN — đúng giá trị của `<input type="date">`. */
  date: string;
  startTime: string;
  endTime: string;
  /** Buổi ĐANG SỬA, loại khỏi phép so trùng. `null`/bỏ trống khi đang THÊM buổi mới. */
  excludeSessionId?: string | null;
  /**
   * Công tắc "Hiện tất cả giáo viên" của lượt chọn này.
   *
   * ⚠️ **BẮT BUỘC trong chữ ký TS** (luật 7) để `tsc` liệt kê mọi chỗ gọi — mắt thấy hai
   * cửa (thêm buổi / sửa buổi), và cả hai đi qua CÙNG một hook, nhưng chữ ký là thứ duy
   * nhất bảo đảm cửa thứ ba sau này không lặng lẽ bỏ trống.
   *
   * Zod thì ngược lại, `.default(false)`: đây là endpoint, payload thiếu khoá đến từ
   * ngoài phải rơi về vế ĐANG LỌC, không phải vế mở.
   */
  hienTatCa: boolean;
}): Promise<ActionResult<{ ds: DongGv[]; lyDoRong: string | null }>> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };

  // Chữ ký ở trên là lời hứa của `tsc` với hai chỗ gọi TRONG repo, KHÔNG phải cổng: đây
  // là endpoint, ai cũng POST payload bất kỳ vào được. Không `safeParse` thì `date: 123`
  // làm `ngayVnSangUtc` gọi `.trim()` trên số ⇒ action NÉM ⇒ client nhận promise bị từ
  // chối chứ không nhận `error`, và ô chọn giáo viên đứng im với danh sách CŨ (luật 12).
  const parsed = gvChoBuoiSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const cls = await loadScopedTrialClass(ctx.actor, data.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  if (!(await checkPermission("trials:manage", { centerId: cls.centerId }))) {
    return { ok: false, error: "Không có quyền xếp giáo viên cho buổi trải nghiệm" };
  }

  const workDate = ngayVnSangUtc(data.date);
  if (!workDate) return { ok: false, error: "Ngày buổi học không hợp lệ" };

  // ⚠️ CỬA SỔ NGÀY (vá 17/09/2026) — zod chỉ kiểm HÌNH DẠNG `YYYY-MM-DD`, không buộc ngày
  // dính vào buổi nào của lớp. Endpoint này trả trạng thái ca của TỪNG giáo viên cho ngày
  // được hỏi, nên gọi lặp theo từng ngày là dựng lại lưới ca nhiều năm. Luật nằm ở hàm
  // THUẦN `ngoaiCuaSoNgayGvBuoi` (phép tính hai con số ghi ở đó); `now` truyền từ ĐÂY —
  // đây là ranh giới được phép đọc đồng hồ, hàm thuần thì không (luật 19).
  if (ngoaiCuaSoNgayGvBuoi({ ymd: data.date, now: new Date() })) {
    return { ok: false, error: "Ngày buổi học nằm ngoài khoảng xếp lịch cho phép" };
  }

  // BA TẦNG (V1-d) — hỏi quyền, rồi quy ra tầng bằng hàm THUẦN. Không `if (role === …)`.
  // `trials:assign-teacher` hỏi TRẦN (khoá của Đào tạo, phạm vi toàn hệ thống);
  // `trials:assign-teacher-center` hỏi KÈM cơ sở của chính lớp này.
  //
  // `hr_attendance:view` là khoá của MODULE CHẤM CÔNG (`lib/cham-cong/module-scope.ts`),
  // hỏi KÈM cơ sở của lớp y như màn chấm công hỏi theo từng khối. Nó KHÔNG gác endpoint
  // này — Sale cố ý không có khoá đó mà vẫn phải xếp được giáo viên (tầng 3 của đặc tả).
  // Nó chỉ quyết định có được biết LÝ DO một người không nhận buổi hay không.
  const [toanHe, theoCoSo, batLoc, gvMien, xemLichCa] = await Promise.all([
    checkPermission("trials:assign-teacher"),
    checkPermission("trials:assign-teacher-center", { centerId: cls.centerId }),
    getSetting("trial.locGvTheoCaLamViec"),
    getSetting("trial.gvMienLocTheoCa"),
    checkPermission("hr_attendance:view", { centerId: cls.centerId }),
  ]);
  const cheDo = quyRaCheDo({ toanHe, theoCoSo });

  // ⛔ KHÔNG truyền `centerIds` cho `getAssignableTeachers` — đó đúng là bug prod 28/08
  // ("lớp CS1 KHÔNG hiện ai"): bộ lọc đó đọc `User.centerId`, cột trống hoặc trỏ Hội sở ở
  // phần lớn tài khoản giáo viên. Phạm vi cơ sở áp ở tầng LUẬT (`coSoChoPhep`), nơi nó
  // đọc cơ sở LÀM VIỆC HÔM ĐÓ trên lưới ca chứ không đọc cơ sở biên chế.
  const luonGiu = await gvDangGanTrongLop(ctx.actor, cls.id);
  const teachers = await getAssignableTeachers({ includeIds: luonGiu });
  const ids = teachers.map((t) => t.id);

  const [{ theoNguoi, luoiDaSinh, coTrongLuoi }, banTheoGv] = await Promise.all([
    layCaCuaNhieuNguoi(ctx.actor, ids, workDate),
    layLichBanGiaoVien(ctx.actor, {
      ymd: data.date,
      excludeSessionId: data.excludeSessionId ?? null,
    }),
  ]);

  const { ds, lyDoRong } = locGiaoVienChoBuoi({
    giaoVien: teachers.map((t) => ({ id: t.id, name: t.name ?? "(không tên)" })),
    caTheoGv: theoNguoi,
    banTheoGv,
    khung: { ymd: data.date, startTime: data.startTime, endTime: data.endTime },
    // Ai đã có mặt trong lưới THÁNG — thiếu ở đây là `CHUA_VAO_LUOI`, tức GIỮ kèm nhãn
    // thay vì ẩn câm. Giáo viên mới tuyển đi qua đúng đường này.
    coTrongLuoi,
    mienLuat: new Set(gvMien),
    luonGiu: new Set(luonGiu),
    // Phạm vi cơ sở lấy từ CHÍNH lớp (luôn đúng một cơ sở), KHÔNG lấy
    // `actor.visibleCenterIds`: chỉ cần MỘT dòng `UserOrgRole` neo tại Hội sở là tập đó
    // nở ra thành "mọi cơ sở" và câu "cơ sở mình nắm" mất nghĩa — im lặng.
    // Tầng Đào tạo mới được `null` (= mọi cơ sở), và phải viết ra chữ `null` (luật 7).
    coSoChoPhep: cheDo === "TAT_CA" ? null : new Set([cls.centerId]),
    cheDo,
    luoiDaSinh,
    batLoc,
    // ĐƯỜNG THOÁT của người dùng. CHỈ tắt bộ lọc HIỂN THỊ — mọi câu đọc ở trên vẫn đi qua
    // `scopedDb(ctx.actor)`, và cửa GHI (`gvXepDuoc`) không đọc cờ này. Xem chú thích của
    // `hienTatCa` trong `lib/trial/gv-kha-dung.ts` về việc vì sao đây không phải nới quyền.
    //
    // ⚠️ SALE KHÔNG ĐƯỢC dùng công tắc này (chốt 18/09/2026) — và phải chặn Ở ĐÂY, không
    // chỉ ẩn ô tích. Ẩn ở giao diện chỉ giấu cái NÚT; cờ vẫn nằm trong payload của một
    // Server Action, nên POST thẳng `hienTatCa: true` là xem được nguyên danh sách. Đúng
    // lớp lỗi "lọc ở trang là lọc trang trí" mà màn này đã dính một lần.
    //
    // Không ném lỗi, chỉ BỎ QUA: người dùng hợp lệ không bao giờ gửi cờ này (ô tích đã
    // không được vẽ), nên gửi tới đây nghĩa là payload dựng tay — trả về đúng thứ họ được
    // phép thấy là phản ứng đủ, và không dạy người dò biết mình vừa chạm phải cái gì.
    hienTatCa: cheDo === "LOC_THEO_CA" ? false : data.hienTatCa,
    // Che LÝ DO, KHÔNG che người: thiếu khoá chấm công thì ba nhãn nói về lịch nghỉ/lịch
    // làm cá nhân gộp về một chữ trung tính. Xem `duocXemLyDoNghi` ở `gv-kha-dung.ts`.
    duocXemLyDoNghi: xemLichCa,
  });

  return { ok: true, ds, lyDoRong };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2b) Hai câu hỏi quyền dùng chung cho cả màn — hỏi ở MỘT chỗ
// ═══════════════════════════════════════════════════════════════════════════
//
// Diễn đạt bằng QUYỀN chứ không so vai (luật cứng #1). Hai khoá đã tồn tại và đã
// đúng tập vai cần phân biệt, không phải thêm khoá mới:
//
//   `trials:create-class` → Quản lý cơ sở · Đào tạo · Quản trị tối cao. Đây cũng là
//       khoá mở lớp (22/09), nên "ai mở được lớp thì dọn được case trong lớp" —
//       một câu, một khoá.
//   "Quản lý KHÁCH trong lớp" (gắn / gỡ / chuyển case bé của BẤT KỲ Sale nào) =
//       `trials:create-class` HOẶC `leads:view-all`.
//
// ~~Chỉ `leads:view-all`, và "Đào tạo giữ khoá đó".~~ **[SỬA 23/09/2026]** Câu đó SAI
// trên cả hai ma trận: `leads:view-all` là SUPER_ADMIN · CENTER_MANAGER · MARKETING
// (v1, `lib/auth/permissions.ts`) và HO_MARKETING · CENTER_MANAGER (v2, seed-roles).
// Đào tạo KHÔNG có. Đo trên app thật: Đào tạo huỷ được cả lớp và xoá được case đang
// giữ khách của Sale khác, nhưng KHÔNG gỡ nổi một bé, ô tìm học viên luôn rỗng — trong
// khi câu lỗi của cửa gắn còn bảo Sale "nhờ Đào tạo xếp hộ" (luật 12).
//
// Không vá bằng cách cấp `leads:view-all` cho Đào tạo: khoá đó còn mở toàn bộ màn
// `/leads`. Nguồn chốt: chủ dự án 23/09 "qlcs/đào tạo hoặc admin gắn thì sale chủ lead
// vẫn gỡ bth", và seed-roles 08/09 "Đào tạo được sử dụng FULL quyền trong màn Lớp
// Trial". Vế `leads:view-all` giữ lại để Marketing Hội sở không mất cái đang có.

/** Có quyền dọn case của người khác trong lớp này không. */
async function laQuanLyLop(centerId: string): Promise<boolean> {
  return checkPermission("trials:create-class", { centerId });
}

/**
 * Có quyền đụng vào khách của Sale khác trong lớp này không — MỘT định nghĩa cho cả
 * bốn cửa: gắn, tìm ứng viên, gỡ, chuyển case. Hai cửa của một việc mà dùng hai khoá
 * khác nhau là chỗ lệch vừa đo được ở trên.
 */
async function laQuanLyLead(centerId: string): Promise<boolean> {
  if (await checkPermission("trials:create-class", { centerId })) return true;
  return checkPermission("leads:view-all", { centerId });
}

/**
 * Đếm học viên trong một case mà NGƯỜI ĐANG BẤM không có quyền gỡ.
 *
 * Đếm bằng CHÍNH `quyenGoHocVien` — cùng hàm mà cửa gỡ dùng. Một phép đếm riêng
 * ("lead.assignedToId !== me") trông tương đương nhưng bỏ mất vế lead chia sẻ và vế
 * người tạo lead, nên cổng xoá case sẽ chặn đúng những ca mà cửa gỡ vẫn cho qua.
 */
async function demHocVienNguoiKhac(
  actor: Actor,
  opts: {
    sessionId: string;
    trialClassId: string;
    /** Bắt buộc — quyết định bé NULL có tính là "trong case" không (luật 7). */
    lopTheoKhung: boolean;
    userId: string;
    quanLyLead: boolean;
  },
): Promise<number> {
  if (opts.quanLyLead) return 0;
  const rows = await scopedDb(actor).trialEnrollment.findMany({
    // Tập "bé trong case" theo `thuocCase` (lib/trial/nghia-null.ts): ở lớp CŨ bé NULL
    // học cả lớp nên CŨNG ở trong case này — dời giờ case là dời giờ của cả những bé đó.
    where: {
      status: "ACTIVE",
      OR: [
        { scheduledSessionId: opts.sessionId },
        ...(opts.lopTheoKhung
          ? []
          : [{ scheduledSessionId: null, trialClassId: opts.trialClassId }]),
      ],
    },
    select: {
      leadChild: {
        select: {
          lead: {
            select: { assignedToId: true, createdById: true, isSharedWithTeam: true },
          },
        },
      },
    },
  });
  return rows.filter(
    (r) =>
      quyenGoHocVien({
        lead: r.leadChild?.lead ?? null,
        userId: opts.userId,
        laQuanLy: false,
      }).duoc === false,
  ).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) Thêm case trial (buổi)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cổng "người mở case" cho điểm danh + hoàn tất (chủ dự án 23/09: Sale KHÔNG làm thay
 * Sale khác). Luật ở `quyenDiemDanhCase`; hàm này chỉ gom đầu vào để hai cửa ghi hỏi
 * đúng một câu. Lớp cũ: luôn cho qua (xem lý do tại hàm luật).
 */
async function quyenDiemDanhCuaBuoi(
  actor: Actor,
  ses: { trialClassId: string; centerId: string; createdById: string | null },
  userId: string,
): Promise<{ duoc: true } | { duoc: false; lyDo: string }> {
  const lop = await loadScopedTrialClass(actor, ses.trialClassId);
  if (!lop) return { duoc: false, lyDo: KHONG_THAY_LOP };
  return quyenDiemDanhCase({
    theoKhung: lop.theoKhung,
    nguoiTaoId: ses.createdById,
    userId,
    laQuanLy: await laQuanLyLop(ses.centerId),
  });
}

// `kiemCaseThuocLop` — luật "case trong khung + đúng ngày lớp" — nằm ở
// `lib/trial/khung-gio-mo-lop.ts` (hàm thuần, có test). KHÔNG định nghĩa lại ở đây: tệp
// này mang "use server", và mọi hàm export ra từ đây là một endpoint.

/**
 * Cổng GHI cho ô "Giáo viên": id gửi lên có phải một giáo viên THẬT không.
 *
 * Lọc ở trang là lọc TRANG TRÍ — `<select>` chỉ là gợi ý, ai cũng POST thẳng được một
 * `teacherId` bất kỳ. Trước cổng này, `addTrialSession` nhận mọi `User.id`: gán một tài
 * khoản phụ huynh làm giáo viên buổi trải nghiệm là việc làm được, và nó hỏng CÂM (buổi
 * ra đời bình thường, chỉ có người không bao giờ tới lớp).
 *
 * ⚠️ CỐ Ý **không** chặn theo lịch ca, và cũng **không** chặn theo cơ sở:
 *   · Theo ca — chủ dự án 17/09 viết rõ "chỉ HIỂN THỊ" và "note đỏ lên để BIẾT". Form
 *     vốn cố ý không chặn: người xếp lịch biết điều hệ thống không biết.
 *   · Theo cơ sở — cột dùng để suy cơ sở của một giáo viên là `User.centerId`, và nó
 *     trống hoặc trỏ Hội sở ở phần lớn tài khoản GV (đo trên prod 28/08). Chặn ghi bằng
 *     cột đó là dựng lại đúng bug "lớp CS1 không xếp được ai", lần này ở cửa GHI nên
 *     người dùng không có đường vòng nào. Giáo viên là nguồn lực chung từ 06/08.
 *
 * @param giuThem giáo viên đang gán sẵn trên buổi — luôn coi là hợp lệ, nếu không thì
 *   người đã nghỉ việc làm cho mọi lượt sửa buổi cũ bị từ chối.
 */
async function gvXepDuoc(
  teacherId: string,
  giuThem: (string | null)[],
): Promise<boolean> {
  const ds = await getAssignableTeachers({ includeIds: giuThem });
  // Luật quyết định nằm ở hàm THUẦN `_lib/gv-hop-le.ts` — ở đó nó kiểm được bằng vitest,
  // và ở đó có khối bằng chứng vì sao `ds` KHÔNG đáng tin cho câu hỏi "giữ nguyên được
  // không" (vá 17/09/2026: `deletedAt: null` của `getAssignableTeachers` AND đè cả nhánh
  // `includeIds`, nên tài khoản đã xoá mềm khoá cứng mọi lượt sửa buổi cũ).
  return gvXepDuocTheoDanhSach({
    teacherId,
    dsChonDuoc: ds.map((t) => t.id),
    giuThem,
  });
}

const GV_KHONG_HOP_LE =
  "Người được chọn không phải giáo viên đang hoạt động — chọn lại trong danh sách" as const;

export async function addLopTrialSessionAction(
  input: unknown,
): Promise<ActionResult<{ sessionId?: string }>> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền thêm buổi trải nghiệm" };
  }

  const parsed = addSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const cls = await loadScopedTrialClass(ctx.actor, data.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  // Cổng GHI cho ô "Giáo viên" — xem chú thích của `gvXepDuoc`. `undefined` = kế thừa
  // GV của lớp (service tự lo), `null` = cố ý bỏ trống; chỉ id THẬT mới phải kiểm.
  if (data.teacherId != null && !(await gvXepDuoc(data.teacherId, []))) {
    return { ok: false, error: GV_KHONG_HOP_LE };
  }

  // Cột `date` là `@db.Date` → lưu UTC 00:00 của NGÀY VN. Không dùng `new Date(str)`:
  // hàm đó đọc múi giờ tiến trình, Vercel chạy UTC còn máy dev +07 nên lệch một ngày.
  const date = ngayVnSangUtc(data.date);
  if (!date) return { ok: false, error: "Ngày buổi học không hợp lệ" };

  // ── CỔNG KHUNG GIỜ (22/09/2026) ─────────────────────────────────────────────────────
  // Chủ dự án: Sale "tạo case trial (chỉ chọn giờ trong khung giờ của qly tạo)".
  //
  // Gác ở SERVER chứ không chỉ giới hạn ô `<input type="time">` trên form: action này là
  // endpoint riêng, ai cũng POST thẳng một khung giờ bất kỳ vào được — đúng bài học của
  // cửa "Sale chỉ thêm học viên thuộc lead của mình" ngay dưới ("lọc ở ô TÌM là lọc
  // TRANG TRÍ").
  //
  // Lớp CŨ (`startTime` null) KHÔNG bị chặn: khoá hồi tố là khoá cứng mọi lớp đang chạy dở.
  {
    const k = kiemCaseThuocLop(cls, data);
    if (!k.ok) return k;
  }

  const res = await addTrialSession({
    trialClassId: data.trialClassId,
    date,
    startTime: data.startTime,
    endTime: data.endTime,
    // undefined = kế thừa GV/phòng của lớp; null = cố ý bỏ trống. Quy ước của service.
    teacherId: data.teacherId === undefined ? undefined : data.teacherId,
    roomId: data.roomId === undefined ? undefined : data.roomId,
    actorId: ctx.session.user.id,
  });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Thêm buổi thất bại" };

  lamMoi(data.trialClassId);
  return { ok: true, sessionId: res.sessionId };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3b) Sửa / huỷ một buổi — kèm LÝ DO, và lý do đó đi thẳng sang giáo viên
// ═══════════════════════════════════════════════════════════════════════════

/** Nhãn ngày VN cho nội dung thông báo (cột `@db.Date` = UTC-midnight ngày VN). */
function nhanNgayVn(d: Date): string {
  return d.toLocaleDateString("vi-VN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Sửa buổi: ngày · giờ · phòng · giáo viên.
 *
 * Chủ dự án 28/08: "nếu sửa lịch học của buổi thì cần xác nhận và ghi chú là dời lịch
 * … lấy chính ghi chú này đẩy qua thông báo cho giáo viên".
 *
 * Ai được báo: giáo viên MỚI (buổi của bạn đổi / bạn nhận buổi này) VÀ giáo viên CŨ nếu
 * bị thay người. Bỏ sót người cũ là họ vẫn giữ buổi đó trong đầu và có thể tới lớp.
 */
export async function updateLopTrialSessionAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền sửa buổi trải nghiệm" };
  }

  const parsed = updateSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const ses = await loadScopedTrialSession(ctx.actor, data.sessionId);
  if (!ses) return { ok: false, error: "Không tìm thấy buổi học" };
  // 23/09 — chỉ case CHƯA diễn ra mới sửa được (khớp điều kiện vẽ nút trên màn). Bản
  // cũ chỉ chặn CANCELLED, nên POST thẳng vẫn sửa được giờ của case ĐÃ XONG — tức
  // viết lại lịch sử của một buổi đã điểm danh.
  if (ses.status === "CANCELLED") {
    return { ok: false, error: "Buổi đã huỷ — không sửa được nữa" };
  }
  if (ses.status !== "SCHEDULED") {
    return { ok: false, error: "Case đã xong — không sửa được nữa" };
  }
  const lopCuaBuoi = await loadScopedTrialClass(ctx.actor, ses.trialClassId);
  if (!lopCuaBuoi) return { ok: false, error: KHONG_THAY_LOP };

  // ── CỔNG CHỦ CASE (23/09/2026) ────────────────────────────────────────────────────
  // Chủ dự án: Sale "sửa + xoá case của mình, xem case người khác". Trước hôm nay mọi
  // người có `trials:manage` (tức MỌI Sale) sửa được giờ mọi buổi trong lớp — và sửa
  // giờ case của người khác là đổi lịch hẹn với phụ huynh của họ mà họ không biết.
  //
  // Gác Ở ĐÂY chứ không chỉ khoá nút: action là endpoint riêng, POST thẳng vào được.
  const quyen = quyenSuaCase({
    nguoiTaoId: ses.createdById,
    userId: ctx.session.user.id,
    laQuanLy: await laQuanLyLop(ses.centerId),
  });
  // Trả NGUYÊN VĂN `lyDo` — đúng câu mà nút bị khoá trên màn đang hiển thị. Viết lại
  // ở đây là để hai cửa của một luật nói hai kiểu.
  if (!quyen.duoc) return { ok: false, error: quyen.lyDo };

  const date = ngayVnSangUtc(data.date);
  if (!date) return { ok: false, error: "Ngày buổi học không hợp lệ" };

  // Cổng GHI cho ô "Giáo viên". `giuThem` mang người ĐANG gán trên buổi: lượt sửa chỉ
  // đổi ghi chú của một buổi cũ không được vỡ vì giáo viên hôm nay đã nghỉ việc.
  if (data.teacherId != null && !(await gvXepDuoc(data.teacherId, [ses.teacherId]))) {
    return { ok: false, error: GV_KHONG_HOP_LE };
  }

  const gvMoi = data.teacherId === undefined ? ses.teacherId : data.teacherId;
  const doiLich =
    date.getTime() !== ses.date.getTime() ||
    data.startTime !== ses.startTime ||
    data.endTime !== ses.endTime;


  // ── CỔNG KHÁCH CỦA NGƯỜI KHÁC khi DỜI GIỜ (23/09/2026) ─────────────────────────
  // Dời giờ một case là dời giờ hẹn của MỌI phụ huynh có bé trong đó. Cửa chuyển case
  // (`xepCaseHocVienAction`) và cửa huỷ case đã chặn Sale làm việc đó với khách của
  // Sale khác; để cửa SỬA mở thì chủ case vẫn đổi được giờ hẹn của khách người khác —
  // chỉ là qua một cửa khác. Chỉ đổi phòng/giáo viên thì phụ huynh không phải đi đâu,
  // nên cổng chỉ bật khi `doiLich`.
  const lopTheoKhung = laLopTheoKhung(lopCuaBuoi);
  if (doiLich) {
    // ── CỔNG KHUNG + NGÀY — đúng hàm cửa THÊM dùng (23/09/2026) ───────────────────
    // CHỈ khi ngày/giờ thật sự đổi. Lượt sửa chỉ đổi phòng / giáo viên thì giờ cũ vốn
    // đã qua cổng lúc thêm; gác lại nó là khoá cứng việc đổi giáo viên của một buổi cũ
    // nằm ngoài "khung" (đo được 23/09 với lớp tạo trước 28/08).
    const k = kiemCaseThuocLop(lopCuaBuoi, data);
    if (!k.ok) return k;

    const soKhac = await demHocVienNguoiKhac(ctx.actor, {
      sessionId: data.sessionId,
      trialClassId: ses.trialClassId,
      lopTheoKhung,
      userId: ctx.session.user.id,
      quanLyLead: await laQuanLyLead(ses.centerId),
    });
    // Câu chữ lấy từ `quyenDoiGioCase` — ĐÚNG câu mà ô giờ bị khoá trên form đang in.
    const doiGio = quyenDoiGioCase({ sua: quyen, soHocVienNguoiKhac: soKhac });
    if (!doiGio.duoc) return { ok: false, error: doiGio.lyDo };
  }

  const sdb = scopedDb(ctx.actor);
  // ⚠️ update KHÔNG được scopedDb che — an toàn nhờ `loadScopedTrialSession` ở trên.
  await sdb.trialClassSession.update({
    where: { id: data.sessionId },
    data: {
      date,
      startTime: data.startTime,
      endTime: data.endTime,
      roomId: data.roomId === undefined ? ses.roomId : data.roomId,
      teacherId: gvMoi,
    },
  });

  // Dòng lịch sử cho các lead có con trong lớp — CHỈ khi lịch thật sự dời. `doiLich` đã
  // được tính ở trên cho việc gửi thông báo giáo viên; dùng lại chính nó, vì lượt sửa chỉ
  // đổi phòng/giáo viên/ghi chú thì phụ huynh không phải đi đâu và không có gì để kể.
  if (doiLich) {
    await ghiTuongTacNhieuLead({
      // ~~Mọi lead trong LỚP~~ **[SỬA 23/09/2026]** chỉ lead có bé TRONG CASE NÀY. Một
      // lớp nay chứa nhiều case của nhiều Sale; ghi "đổi lịch" vào hồ sơ của cả lớp là
      // báo giờ mới cho phụ huynh ở case KHÁC — Sale đọc hồ sơ rồi gọi báo sai giờ.
      leadIds: await layLeadTrongCaseTrial({
        sessionId: data.sessionId,
        trialClassId: ses.trialClassId,
        lopTheoKhung,
      }),
      ...getAuditActor(ctx.session),
      moc: new Date(),
      sk: {
        viec: "trial.doi-lich",
        tenLop: lopCuaBuoi.name,
        ngayTruoc: ses.date,
        gioTruoc: `${ses.startTime}–${ses.endTime}`,
        ngaySau: date,
        gioSau: `${data.startTime}–${data.endTime}`,
        lyDo: data.reason,
      },
    });
  }

  const moTa = `Buổi ${ses.seq} · ${nhanNgayVn(date)} ${data.startTime}–${data.endTime}`;
  // Người CŨ bị thay: báo là buổi không còn của họ nữa.
  if (ses.teacherId && ses.teacherId !== gvMoi) {
    await notifyTrialTeacherAssigned({
      teacherId: ses.teacherId,
      title: "Bạn không còn phụ trách một buổi trải nghiệm",
      body: `${moTa} đã chuyển cho người khác. Lý do: ${data.reason}`,
      // Mốc thời gian trong khoá: một buổi có thể đổi nhiều lần, khử trùng theo id
      // buổi thôi thì lần đổi thứ hai bị nuốt.
      dedupeKey: `trial-session.moved-out:${data.sessionId}:${Date.now()}`,
      entityId: data.sessionId,
    });
  }
  if (gvMoi) {
    await notifyTrialTeacherAssigned({
      teacherId: gvMoi,
      title: doiLich ? "Buổi trải nghiệm đã dời lịch" : "Buổi trải nghiệm vừa được sửa",
      body: `${moTa}. Lý do: ${data.reason}`,
      dedupeKey: `trial-session.updated:${data.sessionId}:${Date.now()}`,
      entityId: data.sessionId,
    });
  }

  lamMoi(ses.trialClassId);
  return { ok: true };
}

/**
 * Huỷ một buổi. Buổi CANCELLED biến khỏi lịch giáo viên ngay: mọi truy vấn lịch/roster
 * đều lọc `status: { not: "CANCELLED" }` (`lib/lms/teacher-schedule.ts`).
 *
 * KHÔNG xoá dòng: điểm danh và phiếu đã chấm của buổi đó vẫn phải tra lại được.
 */
export async function cancelLopTrialSessionAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền huỷ buổi trải nghiệm" };
  }

  const parsed = cancelSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const ses = await loadScopedTrialSession(ctx.actor, data.sessionId);
  if (!ses) return { ok: false, error: "Không tìm thấy buổi học" };
  if (ses.status === "CANCELLED") return { ok: true }; // idempotent
  const lopCuaBuoi = await loadScopedTrialClass(ctx.actor, ses.trialClassId);
  if (!lopCuaBuoi) return { ok: false, error: KHONG_THAY_LOP };
  const lopTheoKhung = laLopTheoKhung(lopCuaBuoi);

  // ── CỔNG CHỦ CASE + CỔNG KHÁCH CỦA NGƯỜI KHÁC (23/09/2026) ────────────────────────
  // Huỷ case là một lượt GỠ HÀNG LOẠT trá hình: mọi bé trong case rơi khỏi lịch hẹn.
  // Nên cổng ở đây PHẢI chặt hơn cổng sửa — chủ case vẫn không được huỷ một case đang
  // giữ khách của Sale khác. Xem `quyenXoaCase`.
  {
    const quanLyLop = await laQuanLyLop(ses.centerId);
    const quyen = quyenXoaCase({
      nguoiTaoId: ses.createdById,
      userId: ctx.session.user.id,
      laQuanLy: quanLyLop,
      soHocVienNguoiKhac: await demHocVienNguoiKhac(ctx.actor, {
        sessionId: data.sessionId,
        trialClassId: ses.trialClassId,
        lopTheoKhung,
        userId: ctx.session.user.id,
        quanLyLead: await laQuanLyLead(ses.centerId),
      }),
    });
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  const sdb = scopedDb(ctx.actor);
  await sdb.trialClassSession.update({
    where: { id: data.sessionId },
    data: { status: "CANCELLED" },
  });

  {
    // Huỷ case KHÔNG đụng ghi danh (khác huỷ LỚP) — cố ý: bé vẫn trỏ vào case đã huỷ để
    // còn vết "từng ở case nào", và màn lớp đưa những bé đó vào khối "Chưa xếp case"
    // (`laChuaXepCase`, lib/trial/nghia-null.ts) để xếp sang case khác. Đọc sau `update`
    // vì thế vẫn ra đủ lead.
    //
    // ~~Mọi lead trong LỚP~~ **[SỬA 23/09/2026]** chỉ lead có bé TRONG CASE NÀY — huỷ
    // case của Sale 2 không phải chuyện của phụ huynh ở case của Sale 1.
    await ghiTuongTacNhieuLead({
      leadIds: await layLeadTrongCaseTrial({
        sessionId: data.sessionId,
        trialClassId: ses.trialClassId,
        lopTheoKhung,
      }),
      ...getAuditActor(ctx.session),
      moc: new Date(),
      sk: {
        viec: "trial.huy-buoi",
        tenLop: lopCuaBuoi.name,
        ngay: ses.date,
        lyDo: data.reason,
      },
    });
  }

  if (ses.teacherId) {
    await notifyTrialTeacherAssigned({
      teacherId: ses.teacherId,
      title: "Buổi trải nghiệm đã bị huỷ",
      body:
        `Buổi ${ses.seq} · ${nhanNgayVn(ses.date)} ${ses.startTime}–${ses.endTime} đã huỷ ` +
        `và đã gỡ khỏi lịch dạy của bạn. Lý do: ${data.reason}`,
      dedupeKey: `trial-session.cancelled:${data.sessionId}`,
      entityId: data.sessionId,
    });
  }

  lamMoi(ses.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) Xếp học viên vào lớp
// ═══════════════════════════════════════════════════════════════════════════

export async function enrollLeadChildLopTrialAction(input: {
  trialClassId: string;
  leadChildId: string;
  allowOverride?: boolean;
  totalSessions?: number;
  sessionId?: string | null;
}): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền xếp chỗ học trải nghiệm" };
  }

  const allowOverride = input.allowOverride === true;
  if (allowOverride && !(await checkPermission("trials:override-capacity"))) {
    return { ok: false, error: "Không có quyền vượt sĩ số" };
  }
  if (!input.trialClassId || !input.leadChildId) {
    return { ok: false, error: "Thiếu lớp hoặc học viên" };
  }

  // GĐ3 (chốt câu 5) — trần đọc từ cấu hình hệ thống, mặc định 4. Admin đổi được ở
  // /admin/cau-hinh-van-hanh mà không cần deploy. Dữ liệu cũ vượt trần KHÔNG bị đụng:
  // trần chỉ kiểm lúc ghi mới.
  let totalSessions: number | undefined;
  if (input.totalSessions != null) {
    const tran = await getSetting("crm.trialMaxSessions");
    const n = Number(input.totalSessions);
    if (!Number.isInteger(n) || n < 1 || n > tran) {
      return {
        ok: false,
        error: `Số buổi học thử phải là số nguyên từ 1 đến ${tran}`,
      };
    }
    totalSessions = n;
  }

  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  // CỬA GHI của luật "Sale chỉ thêm học viên thuộc lead của mình" (chốt 17/09/2026).
  //
  // ⚠️ Lọc ở ô TÌM là lọc TRANG TRÍ — `searchLopTrialCandidatesAction` chỉ gợi ý, còn đây
  // là endpoint riêng và ai cũng POST thẳng một `leadChildId` bất kỳ vào được. Hai cửa
  // phải dùng CÙNG một định nghĩa "của tôi", nếu không thì cửa hẹp hơn là cửa không ai đi.
  if (!(await laQuanLyLead(cls.centerId))) {
    const con = await scopedDb(ctx.actor).leadChild.findUnique({
      where: { id: input.leadChildId },
      select: { lead: { select: { assignedToId: true, createdById: true, isSharedWithTeam: true } } },
    });
    if (!con?.lead || !laLeadCuaToi(con.lead, ctx.session.user.id)) {
      return {
        ok: false,
        error: "Chỉ xếp được học viên thuộc lead bạn phụ trách — nhờ Quản lý cơ sở hoặc Đào tạo xếp hộ",
      };
    }
  }

  // 26/09 — gắn THẲNG vào một case của lớp theo khung thì bé phải có khoá học trước
  // (`lib/trial/khoa-truoc-case.ts`). Cùng cổng với `xepCaseHocVienAction` — hai cửa đưa bé
  // vào case mà theo hai luật là chỗ để lọt.
  if (input.sessionId) {
    const be = await scopedDb(ctx.actor).leadChild.findUnique({
      where: { id: input.leadChildId },
      select: { interestedCourseId: true, lead: { select: { courseId: true } } },
    });
    const khoa = kiemKhoaTruocKhiVaoCase({
      lopTheoKhung: laLopTheoKhung(cls),
      khoaCuaBe: be ? khoaHieuLucCuaBe(be) : null,
    });
    if (!khoa.duoc) return { ok: false, error: khoa.lyDo };
  }

  // Buổi được chọn phải thuộc ĐÚNG lớp đang xếp — chống POST thẳng buổi của lớp khác.
  if (input.sessionId) {
    const ses = await scopedDb(ctx.actor).trialClassSession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        trialClassId: true,
        date: true,
        startTime: true,
        endTime: true,
        teacherId: true,
        status: true,
      },
    });
    if (!ses || ses.trialClassId !== input.trialClassId) {
      return { ok: false, error: "Buổi học không thuộc lớp đã chọn" };
    }
    // 29/09 — case có GV vắng vì đơn nghỉ / đổi ca đã duyệt KHÔNG nhận thêm bé (cùng luật
    // với cửa xếp case bên dưới; `lib/trial/gv-vang-case.ts`).
    const vang = (await layGvVangChoCase(scopedDb(ctx.actor), [ses])).get(ses.id);
    if (vang) return { ok: false, error: vang.lyDo };
  }

  const res = await enrollLeadChild({
    trialClassId: input.trialClassId,
    leadChildId: input.leadChildId,
    allowOverride,
    addedById: ctx.session.user.id,
    totalSessions,
    sessionId: input.sessionId ?? null,
  });
  if (!res?.ok) {
    // Surface cờ overCapacity để UI mời người có quyền bấm xác nhận vượt sĩ số.
    return {
      ok: false,
      error: res?.error ?? "Xếp chỗ thất bại",
      overCapacity: res?.overCapacity === true,
    };
  }

  // Dòng lịch sử trên hồ sơ lead. `enrollLeadChild` đã commit nên đây là đường BỎ QUA LỖI
  // (xem `ghi.ts`): một lỗi ghi lịch sử không được biến lượt xếp chỗ ĐÃ THÀNH CÔNG thành
  // thông báo thất bại, vì người dùng sẽ bấm xếp lại và lần đó mới sinh dữ liệu sai.
  await ghiTuongTacTheoConLead({
    leadChildId: input.leadChildId,
    ...getAuditActor(ctx.session),
    moc: new Date(),
    sk: (tenCon) => ({ viec: "trial.xep-lop", tenCon, tenLop: cls.name }),
  });

  lamMoi(input.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) Tìm học viên để xếp
// ═══════════════════════════════════════════════════════════════════════════

export async function searchLopTrialCandidatesAction(input: {
  trialClassId: string;
  query: string;
}): Promise<ActionResult<{ candidates: Candidate[] }>> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền tìm học viên" };
  }

  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  const q = (input.query ?? "").trim();
  // SĐT lưu 2 dạng trong DB (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = phoneSearchTerm(q) ?? q;
  // S-1 — `trials:manage` KHÔNG kéo theo quyền đọc SĐT lead: Quản lý cơ sở có quyền này
  // nhưng mất `leads:view-pii` từ Q9. Không gác thì ô tìm ứng viên là MÁY DÒ SỐ: gõ đủ
  // 10 số, thấy ai hiện lên là biết số đó của khách nào.
  // (Cấy lại khi hợp nhất `main` → `test` 16/09/2026 — nhánh `main` chưa có chốt S-1.)
  const canViewPii = await canViewLeadPii();
  const sdb = scopedDb(ctx.actor);
  // Chỉ con CHƯA ở lớp ACTIVE nào (partial-unique cho phép đúng 1 lớp ACTIVE / con).
  const childFree = { trialEnrollments: { none: { status: "ACTIVE" as const } } };

  // Chốt 17/09/2026 — Sale chỉ thêm được học viên thuộc LEAD CỦA MÌNH.
  //
  // Diễn đạt bằng QUYỀN, không so vai (luật cứng #1). ~~`leads:view-all` … HO_MARKETING
  // · TRAINING · CENTER_MANAGER giữ nó~~ **[SỬA 23/09/2026]** TRAINING không giữ khoá
  // đó (xem `laQuanLyLead`); ô tìm của Đào tạo vì thế luôn rỗng. Nay dùng ĐÚNG hàm mà
  // cửa gắn / gỡ / chuyển case dùng.
  //
  // `leadCuaToiOrClause` là định nghĩa DÙNG CHUNG với `/admin/leads` và `/admin/search`;
  // đừng chép ba vế của nó ra đây (xem chú thích tại hàm).
  const xemMoiLead = await laQuanLyLead(cls.centerId);

  const leads = await sdb.lead.findMany({
    where: {
      centerId: cls.centerId,
      ...(xemMoiLead ? {} : { OR: leadCuaToiOrClause(ctx.session.user.id) }),
      // GĐ5 — bốn giá trị cũ gộp còn hai: ENROLLED+REGISTERED → DA_DANG_KY,
      // LOST+DUPLICATE → DA_MAT. Tập lead bị loại khỏi danh sách ứng viên KHÔNG đổi.
      status: { notIn: ["DA_DANG_KY", "DA_MAT"] },
      children: { some: childFree },
      ...(q
        ? {
            OR: [
              { parentName: { contains: q, mode: "insensitive" as const } },
              ...(canViewPii ? [{ phone: { contains: qPhone } }] : []),
              {
                children: {
                  some: { fullName: { contains: q, mode: "insensitive" as const } },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      parentName: true,
      phone: true,
      status: true,
      children: { where: childFree, select: { id: true, fullName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const candidates: Candidate[] = leads.flatMap((l) => {
    const che = maskLeadPiiFields({ parentName: l.parentName, phone: l.phone }, canViewPii);
    return l.children.map((c) => ({
      leadChildId: c.id,
      childName: c.fullName,
      parentName: che.parentName ?? "",
      phone: che.phone ?? "",
      leadStatus: leadStatusLabel(l.status),
    }));
  });
  return { ok: true, candidates };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6) Gỡ học viên khỏi lớp
// ═══════════════════════════════════════════════════════════════════════════

export async function unenrollLeadChildLopTrialAction(input: {
  trialClassId: string;
  leadChildId: string;
}): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền gỡ học viên" };
  }
  if (!input.trialClassId || !input.leadChildId) {
    return { ok: false, error: "Thiếu lớp hoặc học viên" };
  }

  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  // ── CỔNG CHỦ LEAD (23/09/2026) ────────────────────────────────────────────────────
  // Chủ dự án: "sale 1 không thể gỡ học viên của sale 2 được".
  //
  // LỖ ĐÃ ĐO ĐƯỢC trước hôm nay: hàm này chỉ hỏi `trials:manage`, mà MỌI Sale đều có
  // khoá đó (`prisma/seed-roles.ts`, vai CENTER_SALES_CSM) ⇒ bất kỳ Sale nào cũng gỡ
  // được khách của bất kỳ Sale nào, im lặng, không dấu vết trên màn.
  //
  // ĐO BẰNG CHỦ LEAD, KHÔNG BẰNG NGƯỜI GẮN (`addedById`) — chốt của chủ dự án: "chủ
  // của lead thì gắn gỡ, ngoài ra qlcs/đào tạo hoặc admin gắn thì sale chủ lead vẫn gỡ
  // bth". Đo bằng người gắn thì Quản lý gắn hộ một lần là Sale mất quyền gỡ khách của
  // chính mình.
  {
    const con = await scopedDb(ctx.actor).leadChild.findUnique({
      where: { id: input.leadChildId },
      select: {
        lead: {
          select: {
            assignedToId: true,
            createdById: true,
            isSharedWithTeam: true,
            assignedTo: { select: { name: true } },
          },
        },
      },
    });
    const quyen = quyenGoHocVien({
      lead: con?.lead ?? null,
      userId: ctx.session.user.id,
      laQuanLy: await laQuanLyLead(cls.centerId),
      tenSale: con?.lead?.assignedTo?.name ?? null,
    });
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  // ── PHẢI GỠ KHỎI CASE TRƯỚC (lớp theo khung, 23/09/2026) ─────────────────────────
  // Chủ dự án: "học viên khi bị gỡ khỏi case thì phải về chưa xếp case, rồi từ chưa xếp
  // case mới gỡ khỏi lớp". Bé đang ở một case CÒN SỐNG thì từ chối, và nói bước kế tiếp.
  // Bé trỏ vào case ĐÃ HUỶ thì coi như đã "chưa xếp case" (lib/trial/nghia-null.ts).
  if (cls.theoKhung) {
    const dangO = await scopedDb(ctx.actor).trialEnrollment.findFirst({
      where: {
        trialClassId: input.trialClassId,
        leadChildId: input.leadChildId,
        status: "ACTIVE",
        scheduledSessionId: { not: null },
      },
      select: { scheduledSessionId: true },
    });
    if (dangO?.scheduledSessionId) {
      const ca = await scopedDb(ctx.actor).trialClassSession.findUnique({
        where: { id: dangO.scheduledSessionId },
        select: { startTime: true, endTime: true, status: true },
      });
      if (ca && ca.status !== "CANCELLED") {
        return {
          ok: false,
          error: `Bé đang ở case ${ca.startTime}–${ca.endTime} — gỡ bé khỏi case trước (bé về "Chưa xếp case"), rồi mới gỡ khỏi lớp.`,
        };
      }
    }
  }

  const res = await unenrollLeadChild({
    trialClassId: input.trialClassId,
    leadChildId: input.leadChildId,
    actorId: ctx.session.user.id,
  });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Gỡ học viên thất bại" };

  await ghiTuongTacTheoConLead({
    leadChildId: input.leadChildId,
    ...getAuditActor(ctx.session),
    moc: new Date(),
    sk: (tenCon) => ({ viec: "trial.go-lop", tenCon, tenLop: cls.name }),
  });

  lamMoi(input.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6b) Chuyển một học viên sang case khác (hoặc xếp bé CHƯA có case)
// ═══════════════════════════════════════════════════════════════════════════
//
// Chủ dự án 23/09/2026: "làm sao để sale có thể linh hoạt xếp các học viên trial vào
// các case của mình vào khung giờ mà sale chọn".
//
// KHÔNG viết lại luật dời lịch: `rescheduleTrialEnrollment` đã là đường DUY NHẤT (nó
// ghi `rescheduledFromSessionId`, tăng `rescheduleCount`, gỡ phân công giáo viên cũ và
// báo đúng người bị thay). Một bản thứ hai ở đây sẽ đổi `scheduledSessionId` mà bỏ hết
// phần còn lại — bé đứng ở case mới nhưng giáo viên case cũ vẫn thấy bé trong bảng.

export async function xepCaseHocVienAction(input: {
  trialClassId: string;
  trialEnrollmentId: string;
  toSessionId: string;
  reason?: string | null;
}): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền xếp học viên vào case" };
  }
  if (!input.trialClassId || !input.trialEnrollmentId || !input.toSessionId) {
    return { ok: false, error: "Thiếu lớp, học viên hoặc case đích" };
  }

  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  // Ca phải thuộc ĐÚNG lớp này — chống POST thẳng id ca của lớp khác. (`toSessionId`
  // thì `rescheduleTrialEnrollment` tự kiểm, không kiểm hai lần ở đây.)
  const sdb = scopedDb(ctx.actor);
  const enr = await sdb.trialEnrollment.findUnique({
    where: { id: input.trialEnrollmentId },
    select: {
      trialClassId: true,
      // Case CŨ — để báo giáo viên cũ rằng bé đã rời ca của họ (xem cuối hàm).
      scheduledSessionId: true,
      leadChild: {
        select: {
          fullName: true,
          interestedCourseId: true,
          lead: {
            select: {
              assignedToId: true,
              createdById: true,
              isSharedWithTeam: true,
              assignedTo: { select: { name: true } },
              courseId: true,
            },
          },
        },
      },
    },
  });
  if (!enr || enr.trialClassId !== input.trialClassId) {
    return { ok: false, error: "Học viên không thuộc lớp này" };
  }

  // ── CỔNG: dùng ĐÚNG luật của cửa GỠ, không phải luật của cửa GẮN ──────────────────
  //
  // Chuyển case là ĐỔI GIỜ HẸN của phụ huynh. Nếu gác bằng luật cửa gắn ("ai cũng gắn
  // được vào case bất kỳ") thì Sale 1 dời được khách của Sale 2 sang giờ khác — hại
  // ngang gỡ, mà không để lại dấu trên màn của Sale 2. Nên chuyển case đòi đúng thứ mà
  // gỡ đòi: là chủ lead, hoặc là Quản lý.
  {
    // `quyenChuyenCase` = đúng luật của `quyenGoHocVien`, câu chữ nói về CHUYỂN — cùng
    // câu mà ô "Xếp vào case" bị khoá trên màn đang in.
    const quyen = quyenChuyenCase({
      lead: enr.leadChild?.lead ?? null,
      userId: ctx.session.user.id,
      laQuanLy: await laQuanLyLead(cls.centerId),
      tenSale: enr.leadChild?.lead?.assignedTo?.name ?? null,
    });
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  // 26/09 — lớp theo khung không có khoá của lớp ⇒ bé vào case phải mang khoá của mình
  // (khoá quan tâm), để giáo viên biết bé học thử khoá gì. Chọn ở ô "Khoá học" ngay trên
  // dòng của bé. Ô "Xếp vào case" trên màn khoá sẵn với đúng câu này; đây là cửa thật.
  {
    const khoa = kiemKhoaTruocKhiVaoCase({
      lopTheoKhung: laLopTheoKhung(cls),
      khoaCuaBe: enr.leadChild ? khoaHieuLucCuaBe(enr.leadChild) : null,
    });
    if (!khoa.duoc) return { ok: false, error: khoa.lyDo };
  }

  // 29/09 — case đích có GV vắng vì đơn nghỉ / đổi ca đã duyệt ⇒ không xếp thêm bé vào.
  // Ô chọn trên màn khoá sẵn case đó kèm cùng lý do; đây là cửa thật (POST thẳng vẫn tới).
  {
    const dich = await sdb.trialClassSession.findUnique({
      where: { id: input.toSessionId },
      select: { id: true, date: true, startTime: true, endTime: true, teacherId: true, status: true },
    });
    const vang = dich ? (await layGvVangChoCase(sdb, [dich])).get(dich.id) : undefined;
    if (vang) return { ok: false, error: vang.lyDo };
  }

  const res = await rescheduleTrialEnrollment({
    trialEnrollmentId: input.trialEnrollmentId,
    toSessionId: input.toSessionId,
    reason: input.reason ?? null,
    actorId: ctx.session.user.id,
  });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Chuyển case thất bại" };

  // ── BÁO GIÁO VIÊN (23/09/2026) ─────────────────────────────────────────────────────
  // `rescheduleTrialEnrollment` KHÔNG tự gửi tin — nó chỉ trả `gvBiGoId`. Phần báo tin
  // từng nằm ở `rescheduleLopTrialAction`, và biến mất cùng hàm đó khi bị gỡ ngày 28/08.
  // Hệ quả đo được: gắn thẳng bé vào case (EnrollPanel) thì giáo viên của case được báo,
  // còn xếp một bé "chưa xếp case" vào case — cùng một việc — thì không ai được báo.
  //
  // Gửi SAU khi ghi đã commit, và lỗi gửi không được biến lượt chuyển THÀNH CÔNG thành
  // thất bại (người dùng sẽ bấm lại và lần đó mới sinh dữ liệu sai).
  try {
    const [den, di] = await Promise.all([
      sdb.trialClassSession.findUnique({
        where: { id: input.toSessionId },
        select: { teacherId: true, date: true, startTime: true, endTime: true },
      }),
      enr.scheduledSessionId
        ? sdb.trialClassSession.findUnique({
            where: { id: enr.scheduledSessionId },
            select: { teacherId: true, status: true },
          })
        : Promise.resolve(null),
    ]);
    const tenBe = enr.leadChild?.fullName ?? "Một học viên";
    const me = ctx.session.user.id;
    const moTaDen = den ? `${nhanNgayVn(den.date)} ${den.startTime}–${den.endTime}` : "";
    // Mốc thời gian trong khoá: một bé có thể được chuyển qua lại nhiều lần giữa hai
    // case — khử trùng theo cặp id thôi thì lần chuyển thứ hai bị nuốt.
    const moc = Date.now();
    if (den?.teacherId && den.teacherId !== me) {
      await notifyTrialTeacherAssigned({
        teacherId: den.teacherId,
        title: "Có học viên mới trong ca trải nghiệm của bạn",
        body: `${tenBe} vừa được xếp vào ca ${moTaDen} · lớp ${cls.name}.`,
        dedupeKey: `trial-case.moved-in:${input.trialEnrollmentId}:${input.toSessionId}:${moc}`,
        entityId: input.toSessionId,
      });
    }
    // Giáo viên CŨ — chỉ khi case cũ còn sống (case đã huỷ thì giáo viên đã nhận tin
    // huỷ rồi) và là một người khác người mới.
    if (
      di?.teacherId &&
      di.status !== "CANCELLED" &&
      di.teacherId !== den?.teacherId &&
      di.teacherId !== me
    ) {
      await notifyTrialTeacherAssigned({
        teacherId: di.teacherId,
        title: "Một học viên đã chuyển khỏi ca của bạn",
        body: `${tenBe} đã chuyển sang ca khác trong lớp ${cls.name}.`,
        dedupeKey: `trial-case.moved-out:${input.trialEnrollmentId}:${input.toSessionId}:${moc}`,
        entityId: enr.scheduledSessionId ?? undefined,
      });
    }
  } catch (e) {
    console.error("[lop-trial] bao giao vien khi chuyen case that bai", input.trialEnrollmentId, e);
  }

  // Lịch sử tương tác — chủ dự án: mọi thao tác của Sale với lead đều phải vào lịch sử.
  {
    const den = await sdb.trialClassSession.findUnique({
      where: { id: input.toSessionId },
      select: { startTime: true, endTime: true },
    });
    const leadChildId = await sdb.trialEnrollment.findUnique({
      where: { id: input.trialEnrollmentId },
      select: { leadChildId: true },
    });
    if (den && leadChildId) {
      await ghiTuongTacTheoConLead({
        leadChildId: leadChildId.leadChildId,
        ...getAuditActor(ctx.session),
        moc: new Date(),
        sk: (tenCon) => ({
          viec: "trial.xep-case",
          tenCon,
          tenLop: cls.name,
          gio: `${den.startTime}–${den.endTime}`,
        }),
      });
    }
  }

  lamMoi(input.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6c) Gỡ một học viên khỏi CASE — bé vẫn ở trong lớp
// ═══════════════════════════════════════════════════════════════════════════
//
// Chủ dự án 23/09/2026: "học viên khi bị gỡ khỏi case thì phải về chưa xếp case, rồi từ
// chưa xếp case mới gỡ khỏi lớp". Nút "Gỡ" trong một case gọi hàm NÀY, không gọi
// `unenrollLeadChildLopTrialAction` — gỡ khỏi lớp chỉ còn ở khối "Chưa xếp case".

export async function goKhoiCaseAction(input: {
  trialClassId: string;
  trialEnrollmentId: string;
}): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền gỡ học viên khỏi case" };
  }
  if (!input.trialClassId || !input.trialEnrollmentId) {
    return { ok: false, error: "Thiếu lớp hoặc học viên" };
  }
  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  const sdb = scopedDb(ctx.actor);
  const enr = await sdb.trialEnrollment.findUnique({
    where: { id: input.trialEnrollmentId },
    select: {
      trialClassId: true,
      leadChildId: true,
      leadChild: {
        select: {
          lead: {
            select: {
              assignedToId: true,
              createdById: true,
              isSharedWithTeam: true,
              assignedTo: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!enr || enr.trialClassId !== input.trialClassId) {
    return { ok: false, error: "Học viên không thuộc lớp này" };
  }

  // Cùng luật với gỡ khỏi lớp: chủ lead, hoặc Quản lý / Đào tạo. Gỡ khỏi case là huỷ lịch
  // hẹn giờ đó với phụ huynh — việc của người phụ trách khách.
  {
    const quyen = quyenGoHocVien({
      lead: enr.leadChild?.lead ?? null,
      userId: ctx.session.user.id,
      laQuanLy: await laQuanLyLead(cls.centerId),
      tenSale: enr.leadChild?.lead?.assignedTo?.name ?? null,
    });
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  const res = await goHocVienKhoiCase({
    trialEnrollmentId: input.trialEnrollmentId,
    actorId: ctx.session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Gỡ khỏi case thất bại" };

  // Báo giáo viên của case vừa rời (case còn sống, không phải chính người bấm). Gửi SAU
  // khi ghi đã commit; lỗi gửi không được biến lượt gỡ THÀNH CÔNG thành thất bại.
  const caseCu = res.caseCu;
  if (caseCu?.teacherId && !caseCu.daHuy && caseCu.teacherId !== ctx.session.user.id) {
    try {
      await notifyTrialTeacherAssigned({
        teacherId: caseCu.teacherId,
        title: "Một học viên đã rời ca của bạn",
        body: `Một học viên đã được gỡ khỏi ca ${caseCu.gio} · lớp ${cls.name}.`,
        dedupeKey: `trial-case.go:${input.trialEnrollmentId}:${caseCu.id}:${Date.now()}`,
        entityId: caseCu.id,
      });
    } catch (e) {
      console.error("[lop-trial] bao giao vien khi go khoi case that bai", input.trialEnrollmentId, e);
    }
  }

  if (caseCu) {
    await ghiTuongTacTheoConLead({
      leadChildId: enr.leadChildId,
      ...getAuditActor(ctx.session),
      moc: new Date(),
      sk: (tenCon) => ({ viec: "trial.go-case", tenCon, tenLop: cls.name, gio: caseCu.gio }),
    });
  }

  lamMoi(input.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7) Gán giáo viên phụ trách LỚP — ĐÃ GỠ 14/09/2026
// ═══════════════════════════════════════════════════════════════════════════
//
// `assignLopTrialTeacherAction` gỡ hẳn. Nó là action CHẾT: grep toàn repo chỉ ra chính nó và
// một dòng trong `_lib/permissions.test.ts` — không component/page nào gọi, và cũng không thể
// gọi, vì giao diện không có chỗ nào gán giáo viên ở cấp LỚP.
//
// Đó không phải thiếu sót mà là chốt kiến trúc 28/08: giáo viên là thuộc tính của TỪNG BUỔI
// (`createTrialClass` đặt thẳng `teacherId: null`, xem chú thích tại `lib/trial/service.ts`).
// Lớp trải nghiệm là slot tái sử dụng, mỗi buổi có thể một người dạy khác nhau.
//
// Hệ quả kéo theo, và là lý do đợt này đụng tới nó: tiền tố `trial-class.assigned:` vẫn nằm
// trong danh mục thông báo nên màn Cấu hình thông báo đẩy BÀY RA một công tắc không nối vào
// đâu — chủ dự án đã bật thật rồi ngồi chờ. Gỡ action ⇒ gỡ luôn tiền tố ⇒ màn hình thôi hứa.
//
// ═══════════════════════════════════════════════════════════════════════════
// 8) Huỷ lớp
// ═══════════════════════════════════════════════════════════════════════════

export async function cancelLopTrialClassAction(
  trialClassId: string,
): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };

  const cls = await loadScopedTrialClass(ctx.actor, trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };

  // ── ĐỔI KHOÁ 23/09/2026: `trials:manage` → `trials:create-class` ──────────────────
  // Chủ dự án: "sale cũng không thể xoá hoặc huỷ lớp".
  //
  // LỖ ĐÃ ĐO ĐƯỢC: `trials:manage` là khoá của MỌI Sale, nên mọi Sale huỷ được cả lớp
  // — kéo theo TOÀN BỘ ghi danh sang CANCELLED, tức gỡ sạch khách của mọi Sale khác
  // trong lớp bằng một cú bấm. Nút cũng đang hiện với họ trên màn.
  //
  // Khoá mới là ĐÚNG khoá mở lớp (22/09): ai mở được lớp thì đóng được lớp. Hỏi KÈM
  // cơ sở của lớp — không kèm thì một dòng vai neo tại Hội sở là huỷ được lớp mọi cơ sở.
  if (!(await checkPermission("trials:create-class", { centerId: cls.centerId }))) {
    return {
      ok: false,
      error: "Chỉ Quản lý cơ sở hoặc Đào tạo mới huỷ được lớp trải nghiệm. Cần huỷ thì nhờ họ.",
    };
  }

  // ĐỌC TRƯỚC KHI HUỶ. `cancelTrialClass` đẩy mọi ghi danh sang CANCELLED, nên đọc sau
  // là ra danh sách RỖNG và không lead nào biết vì sao con mình rơi khỏi lớp — lỗ hoàn
  // toàn im lặng (không lỗi, không dòng nào, panel vẫn hiện bình thường).
  const leadIds = await layLeadTrongLopTrial(trialClassId);

  const res = await cancelTrialClass({ trialClassId, actorId: ctx.session.user.id });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Huỷ lớp thất bại" };

  // Ghi SAU khi huỷ thành công: huỷ lỗi mà đã ghi thì lịch sử kể một việc không xảy ra.
  await ghiTuongTacNhieuLead({
    leadIds,
    ...getAuditActor(ctx.session),
    moc: new Date(),
    sk: { viec: "trial.huy-lop", tenLop: cls.name, lyDo: null },
  });

  lamMoi(trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9) Điểm danh buổi trải nghiệm
// ═══════════════════════════════════════════════════════════════════════════

export async function markLopTrialAttendanceAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  // GĐ4 — điểm danh là việc của SALE, gác bằng quyền riêng `trials:attendance`.
  // Trước GĐ4 gác bằng `trials:feedback` (quyền của giáo viên) nên Sale không làm được
  // đúng việc quy trình giao cho họ.
  if (!(await checkPermission("trials:attendance"))) {
    return { ok: false, error: "Không có quyền điểm danh" };
  }

  const parsed = attendanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const ses = await loadScopedTrialSession(ctx.actor, parsed.data.trialSessionId);
  if (!ses) return { ok: false, error: "Không tìm thấy buổi học" };

  if (!(await duocThaoTacBuoi(ses))) {
    return { ok: false, error: "Bạn chỉ được điểm danh lớp được phân công" };
  }
  // 23/09 — chủ dự án: Sale KHÔNG điểm danh case của Sale khác (lớp theo khung).
  {
    const quyen = await quyenDiemDanhCuaBuoi(ctx.actor, ses, ctx.session.user.id);
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  // ── KIỂM CẢ LÔ TRƯỚC KHI GHI BÉ NÀO (23/09/2026) ──────────────────────────────────
  // Cổng "bé phải thuộc case này" ở `markAttendance` từ chối TỪNG bé — mà vòng lặp dưới
  // ghi lần lượt, nên một bé vừa bị chuyển case giữa lúc Sale đang điểm danh sẽ làm lượt
  // lưu dừng giữa chừng: bé trước đã ghi, bé sau không, người dùng chỉ thấy một lỗi. Kiểm
  // cả lô bằng CÙNG luật (`thuocCase`) trước, để lô hoặc ghi đủ hoặc không ghi gì.
  {
    const lop = await loadScopedTrialClass(ctx.actor, ses.trialClassId);
    if (!lop) return { ok: false, error: KHONG_THAY_LOP };
    const ghiDanh = await scopedDb(ctx.actor).trialEnrollment.findMany({
      where: { id: { in: parsed.data.records.map((r) => r.trialEnrollmentId) } },
      select: { id: true, trialClassId: true, scheduledSessionId: true },
    });
    const theoId = new Map(ghiDanh.map((g) => [g.id, g]));
    const lech = parsed.data.records.filter((r) => {
      const g = theoId.get(r.trialEnrollmentId);
      return (
        !g ||
        g.trialClassId !== ses.trialClassId ||
        !thuocCase(g, parsed.data.trialSessionId, laLopTheoKhung(lop))
      );
    });
    if (lech.length > 0) {
      return {
        ok: false,
        error:
          `${lech.length} học viên không còn thuộc case này (vừa được chuyển hoặc gỡ) — ` +
          "chưa ghi điểm danh cho ai. Tải lại trang rồi điểm danh lại.",
      };
    }
  }

  // ⚠️ KHÔNG atomic cả buổi: service ghi 1 bản ghi mỗi lần gọi nên vòng lặp này dừng ở
  // lỗi đầu tiên và để lại nửa lớp đã ghi. Đây là hành vi của màn cũ, chép nguyên có
  // chủ đích — đổi sang transaction là thay đổi nghiệp vụ, không thuộc phạm vi GĐ2. Khối
  // kiểm cả lô ngay trên đóng đúng đường mà cổng mới 23/09 mở ra.
  for (const r of parsed.data.records) {
    const res = await markAttendance({
      trialSessionId: parsed.data.trialSessionId,
      trialEnrollmentId: r.trialEnrollmentId,
      status: r.status,
      note: r.note ?? null,
      actorId: ctx.session.user.id,
    });
    if (!res?.ok) return { ok: false, error: res?.error ?? "Điểm danh thất bại" };
  }

  // Dòng lịch sử cho từng lead có con trong buổi. Vòng lặp trên có thể dừng giữa đường
  // (chú thích ngay trên: không atomic cả buổi) — nhưng nếu dừng thì nó `return` ngay
  // nên chỗ này chỉ chạy khi CẢ buổi đã ghi xong. Đừng dời nó vào trong vòng lặp: điểm
  // danh lại một học viên là chuyện thường, và mỗi lượt sửa sẽ đẻ thêm một dòng.
  const lopCuaBuoi = await loadScopedTrialClass(ctx.actor, ses.trialClassId);
  const conTheoGhiDanh = await layConTheoGhiDanhTrial(
    parsed.data.records.map((r) => r.trialEnrollmentId),
  );
  const nguoiGhi = getAuditActor(ctx.session);
  for (const r of parsed.data.records) {
    const con = conTheoGhiDanh.get(r.trialEnrollmentId);
    if (!con) continue;
    await ghiTuongTacNhieuLead({
      leadIds: [con.leadId],
      ...nguoiGhi,
      moc: new Date(),
      sk: {
        viec: "trial.diem-danh",
        tenCon: con.tenCon,
        tenLop: lopCuaBuoi?.name ?? "(không rõ lớp)",
        coMat: r.status === "PRESENT",
        ngay: ses.date,
      },
    });
  }

  lamMoi(ses.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10) Hoàn tất buổi
// ═══════════════════════════════════════════════════════════════════════════

export async function completeLopTrialSessionAction(
  trialSessionId: string,
): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  // "Hoàn tất buổi" đóng vòng đời buổi sau khi đã điểm danh xong ⇒ đi cùng cổng với
  // điểm danh, không phải cổng nộp phiếu đánh giá.
  if (!(await checkPermission("trials:attendance"))) {
    return { ok: false, error: "Không có quyền hoàn tất buổi" };
  }
  if (!trialSessionId) return { ok: false, error: "Thiếu buổi học" };

  const ses = await loadScopedTrialSession(ctx.actor, trialSessionId);
  if (!ses) return { ok: false, error: "Không tìm thấy buổi học" };

  if (!(await duocThaoTacBuoi(ses))) {
    return { ok: false, error: "Bạn chỉ được thao tác lớp được phân công" };
  }
  // 23/09 — "Hoàn tất" khoá case vĩnh viễn: chỉ người mở case (hoặc Quản lý) được bấm.
  {
    const quyen = await quyenDiemDanhCuaBuoi(ctx.actor, ses, ctx.session.user.id);
    if (!quyen.duoc) return { ok: false, error: quyen.lyDo };
  }

  const res = await completeTrialSession({
    trialSessionId,
    actorId: ctx.session.user.id,
  });
  if (!res?.ok) return { ok: false, error: res?.error ?? "Hoàn tất buổi thất bại" };

  lamMoi(ses.trialClassId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 11) Cập nhật buổi hẹn học thử (mặt phẳng V1)
// ═══════════════════════════════════════════════════════════════════════════
// ĐÃ GỠ 28/08/2026 — ba action không còn đường gọi nào
// ═══════════════════════════════════════════════════════════════════════════
//
//   · rescheduleLopTrialAction        — dời lịch theo TỪNG HỌC VIÊN
//   · proposeLopTrialTeacherAction    — Sale ĐỀ XUẤT giáo viên cho một ca
//   · assignLopTrialCaseTeacherAction — Đào tạo PHÂN CÔNG giáo viên cho một ca
//
// Chủ dự án 28/08 gỡ cả ba khỏi giao diện: học viên vào lớp là học TOÀN BỘ buổi (nên
// không còn "dời một em sang buổi khác"), và giáo viên đặt ở TỪNG BUỔI (nên không còn
// đề xuất/phân công theo ca). Server Action không còn ai gọi mà vẫn export là một
// endpoint sống — ai biết tên hàm vẫn POST được và sửa được dữ liệu qua đường đã bỏ.
//
// Cột `gvDeXuatId` / `gvPhanCongId` và bảng `TrialReschedule` GIỮ NGUYÊN trong DB (nếp
// 2 pha): dữ liệu cũ còn đọc được, và `gvPhanCongId` vẫn là một trong ba đường nối học
// viên ↔ giáo viên ở roster site GV.

// ═══════════════════════════════════════════════════════════════════════════
// Khoá học của bé trong lớp trial (26/09/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Chủ dự án: "thêm ô chọn khoá học ở chỗ chưa xếp case, để chọn khoá học trước khi thêm vào
// case". Khoá của bé = KHOÁ QUAN TÂM của bé (`LeadChild.interestedCourseId`) — ghi thẳng vào
// đó chứ không mở cột mới, vì site giáo viên và màn lead vốn đã đọc đúng cột này. Luật +
// lý do đầy đủ: `lib/trial/khoa-truoc-case.ts`.
//
// Cổng: CÙNG luật với "Xếp vào case" (`quyenChuyenCase` — chủ lead hoặc Quản lý). Chọn
// khoá là việc chuẩn bị để xếp case; ai không xếp được thì đổi khoá của bé cũng không phải
// việc của họ (đổi khoá quan tâm còn đổi luôn khoá trên hồ sơ lead của Sale khác).

export async function datKhoaHocTrialAction(input: {
  trialClassId: string;
  trialEnrollmentId: string;
  courseId: string;
}): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx) return { ok: false, error: CHUA_DANG_NHAP };
  if (!(await checkPermission("trials:manage"))) {
    return { ok: false, error: "Không có quyền chọn khoá học cho học viên" };
  }
  if (!input.trialClassId || !input.trialEnrollmentId || !input.courseId) {
    return { ok: false, error: "Thiếu lớp, học viên hoặc khoá học" };
  }

  const cls = await loadScopedTrialClass(ctx.actor, input.trialClassId);
  if (!cls) return { ok: false, error: KHONG_THAY_LOP };
  if (cls.status === "CANCELLED" || cls.status === "COMPLETED") {
    return { ok: false, error: "Lớp trải nghiệm đã kết thúc — không đổi khoá học được nữa" };
  }

  const sdb = scopedDb(ctx.actor);
  const [enr, khoa] = await Promise.all([
    sdb.trialEnrollment.findUnique({
      where: { id: input.trialEnrollmentId },
      select: {
        trialClassId: true,
        status: true,
        leadChildId: true,
        leadChild: {
          select: {
            lead: {
              select: {
                assignedToId: true,
                createdById: true,
                isSharedWithTeam: true,
                assignedTo: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    sdb.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, isActive: true },
    }),
  ]);
  if (!enr || enr.trialClassId !== input.trialClassId || !enr.leadChildId) {
    return { ok: false, error: "Học viên không thuộc lớp này" };
  }
  if (enr.status !== "ACTIVE") {
    return { ok: false, error: "Bé đã học xong lớp này — không đổi khoá học ở đây nữa" };
  }
  if (!khoa || !khoa.isActive) {
    return { ok: false, error: "Khoá học không tồn tại hoặc đã ngừng" };
  }

  const quyen = quyenChuyenCase({
    lead: enr.leadChild?.lead ?? null,
    userId: ctx.session.user.id,
    laQuanLy: await laQuanLyLead(cls.centerId),
    tenSale: enr.leadChild?.lead?.assignedTo?.name ?? null,
  });
  if (!quyen.duoc) return { ok: false, error: quyen.lyDo };

  const { actorId, actorName } = getAuditActor(ctx.session);
  await datKhoaHocChoBeTrial({
    leadChildId: enr.leadChildId,
    courseId: khoa.id,
    actorId,
    actorName,
  });

  lamMoi(input.trialClassId);
  return { ok: true };
}
