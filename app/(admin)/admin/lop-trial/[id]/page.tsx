// app/(admin)/admin/lop-trial/[id]/page.tsx — GĐ2. Chi tiết một lớp trải nghiệm.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { getSetting } from "@/lib/settings/service";
import { layChiTietLop, layPhongTheoCoSo } from "../_lib/queries";
import { quyRaCheDo } from "../_lib/che-do-gv";
import { BangCase } from "../_components/bang-case";
import { CancelClassButton } from "../_components/cancel-class-button";
import { vnYmd } from "@/lib/time/vn";

export const dynamic = "force-dynamic";

const NHAN_TRANG_THAI: Record<string, string> = {
  OPEN: "Đang mở",
  RUNNING: "Đang chạy",
  COMPLETED: "Đã xong",
  CANCELLED: "Đã huỷ",
};
const MAU_TRANG_THAI: Record<string, string> = {
  OPEN: "bg-emerald-100 text-emerald-700",
  RUNNING: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-gray-200 text-gray-600",
  CANCELLED: "bg-red-100 text-red-700",
};

export default async function ChiTietLopTrialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("trials:view"))) redirect("/dashboard");

  const { id } = await params;
  const actor = await resolveActor(session.user.id);

  // ⚠️ Hai câu hỏi quyền này phải hỏi TRƯỚC khi nạp chi tiết lớp: `layChiTietLop` quy
  // chúng ra `quyenSua`/`quyenXoa`/`quyenGo` của từng dòng. Hỏi KÈM cơ sở thì phải biết
  // cơ sở, mà cơ sở nằm trong chính bản ghi lớp — nên vòng đầu hỏi KHÔNG kèm cơ sở và
  // vòng sau (dưới) hỏi lại kèm cơ sở để gác đúng. Ở đây chỉ dùng cho HIỂN THỊ; cửa GHI
  // tự hỏi lại kèm `centerId` trong `_actions.ts`, nên một lượt hỏi rộng ở đây không nới
  // quyền thật của ai.
  const [quanLyLopSoBo, xemMoiLeadSoBo] = await Promise.all([
    checkPermission("trials:create-class"),
    checkPermission("leads:view-all"),
  ]);
  // "Quản lý khách trong lớp" = create-class HOẶC view-all — ĐÚNG công thức của
  // `laQuanLyLead` ở `_actions.ts`. Lệch công thức là nút sáng mà cửa ghi chặn (hoặc
  // ngược lại), và đó chính là lỗi vừa đo được với vai Đào tạo 23/09.
  const quanLyLeadSoBo = quanLyLopSoBo || xemMoiLeadSoBo;
  const canViewPii = await canViewLeadPii();
  const cls = await layChiTietLop(
    actor,
    id,
    {
      userId: session.user.id,
      laQuanLyLop: quanLyLopSoBo,
      laQuanLyLead: quanLyLeadSoBo,
    },
    canViewPii,
  );
  // layChiTietLop đã lọc theo scopedDb → ngoài cơ sở là 404, không phải "cấm truy cập".
  if (!cls) notFound();

  // ~~28/08 — KHÔNG còn kiểm `trials:assign-teacher` ở màn này~~ **[ĐẢO 17/09/2026]**
  // Câu trên đúng cho giai đoạn 28/08–16/09 (ô "Đề xuất GV" và "Phân công (Đào tạo)"
  // theo từng học viên đã gỡ; quyền GHI của buổi vẫn là `trials:manage`, KHÔNG đổi).
  // Từ 17/09 khoá `trials:assign-teacher` quay lại màn này với vai trò KHÁC: nó không
  // còn quyết định ĐƯỢC GHI HAY KHÔNG, mà quyết định THẤY BAO NHIÊU NGƯỜI trong ô chọn.
  //
  // BA TẦNG chọn giáo viên (chốt V1-d, 17/09/2026) — hỏi quyền MỘT lần ở đây, rồi quy
  // ra tầng bằng hàm THUẦN `quyRaCheDo`. KHÔNG `if (role === …)` ở bất kỳ đâu (luật #1).
  //
  //   `trials:assign-teacher`        → Đào tạo, toàn hệ thống ⇒ hỏi TRẦN.
  //   `trials:assign-teacher-center` → Quản lý cơ sở ⇒ hỏi KÈM cơ sở của chính lớp này.
  //
  // ⚠️ Phạm vi cơ sở của tầng giữa lấy từ `cls.centerId` (một lớp ⇒ đúng một cơ sở),
  // KHÔNG lấy `actor.visibleCenterIds`: chỉ cần MỘT dòng `UserOrgRole` neo tại Hội sở là
  // tập đó nở thành "mọi cơ sở" và câu "cơ sở mình nắm" mất nghĩa — im lặng, không lỗi.
  const [
    isManager,
    canAttendance,
    gvToanHe,
    gvTheoCoSo,
    locGvTheoCa,
    gvMienLoc,
    // 23/09 — khoá MỞ LỚP nay cũng là khoá ĐÓNG LỚP. Trước hôm nay nút huỷ lớp hiện
    // với mọi người có `trials:manage`, tức mọi Sale — và bấm vào là đẩy TOÀN BỘ ghi
    // danh của mọi Sale trong lớp sang CANCELLED.
    canHuyLop,
  ] =
    await Promise.all([
      checkPermission("trials:manage", { centerId: cls.centerId }),
      checkPermission("trials:attendance", { centerId: cls.centerId }),
      checkPermission("trials:assign-teacher"),
      checkPermission("trials:assign-teacher-center", { centerId: cls.centerId }),
      // Hai khoá cấu hình vận hành. `getSetting` có cache 300s ⇒ đổi ở
      // /admin/cau-hinh-van-hanh ăn trong ≤5 PHÚT, không tức thì.
      getSetting("trial.locGvTheoCaLamViec"),
      getSetting("trial.gvMienLocTheoCa"),
      checkPermission("trials:create-class", { centerId: cls.centerId }),
    ]);
  const cheDoChonGv = quyRaCheDo({ toanHe: gvToanHe, theoCoSo: gvTheoCoSo });
  // GĐ4 — điểm danh là việc của Sale phụ trách khách (`trials:attendance`), tách khỏi
  // `trials:feedback` của giáo viên. Trước GĐ4 hai việc dùng chung một cờ nên ai điểm
  // danh được thì cũng chấm được và ngược lại — ngược hẳn quy trình đã chốt.
  //
  // 27/08 — màn này KHÔNG còn đường chấm phiếu (khối SESSION_EVAL đã gỡ), nên
  // `trials:feedback` không còn phải kiểm ở đây. Việc chấm nằm trọn ở site giáo viên;
  // màn này chỉ ĐỌC phiếu đã chấm, và quyền đọc là `trials:view` — đã gác ở đầu hàm.
  const canDiemDanh = canAttendance;

  // ⚠️ Danh sách GV phải nạp cho MỌI người xem, không chỉ người có quyền gán.
  //
  // Bản cũ trả mảng rỗng khi thiếu `trials:assign-teacher`, mà chính mảng đó là nơi
  // tra TÊN giáo viên đang phụ trách — nên sau khi GĐ3 gỡ quyền khỏi Quản lý cơ sở,
  // Sale/QLCS/GV đều thấy mọi lớp là "Chưa gán" kể cả lớp đã có giáo viên.
  // Đọc tên không phải là quyền ghi; quyền chỉ quyết định có render <select> hay không.
  //
  // MỘT danh sách dùng chung cho cả ba ô (gán lớp · thêm buổi · phân công từng ca).
  // Trước đây tách hai danh sách theo quyền, và ô "Thêm buổi học" ăn phải danh sách
  // rỗng khi GĐ3 gỡ `trials:assign-teacher` khỏi Quản lý cơ sở → QLCS không xếp được
  // giáo viên cho buổi ad-hoc. Base list giống hệt nhau, chỉ khác `includeIds`, nên
  // gộp là hết cả lớp bug đó.
  //
  // 28/08 — BỎ LỌC THEO CƠ SỞ (chủ dự án chốt: "hiển thị tất cả giáo viên để gán
  // luôn, không cần rule nào nữa cả").
  //
  // Đây là chỗ sót của đợt đổi chính sách 06/08: từ hôm đó GV là NGUỒN LỰC CHUNG,
  // điều đi theo lịch chứ không thuộc một cơ sở cố định — `filterTeachersByCenter`
  // (lib/teachers/center-filter.ts) đã thành no-op và guard ghi cũng đã chấp nhận GV
  // khác cơ sở ([TRIAL-05]). Nhưng riêng màn này vẫn lọc NGAY Ở TRUY VẤN bằng
  // `centerIds`, nên cửa GHI mở mà cửa CHỌN vẫn đóng: bốn màn Lớp học đều gọi
  // `getAssignableTeachers({})` không kèm cơ sở, chỉ mình nó kèm.
  //
  // Hệ quả đo được trên prod: lớp CS2 chỉ hiện đúng một người, lớp CS1 KHÔNG hiện ai —
  // vì bộ lọc đọc `User.centerId`, mà cột đó trống hoặc trỏ Hội sở ở phần lớn tài
  // khoản giáo viên. Người vận hành không xếp nổi giáo viên cho buổi trải nghiệm nào.
  const teachers = await getAssignableTeachers({
    includeIds: [
      // 28/08 — KHÔNG còn `cls.teacherId`: giáo viên đặt ở TỪNG BUỔI. Vẫn phải giữ
      // người đang gán ở buổi và ở từng ca, nếu không họ rớt khỏi danh sách (đổi cơ sở,
      // nghỉ việc) và `<select>` hiện TRỐNG trong khi tên vẫn in ở thẻ bên cạnh.
      ...cls.sessions.map((se) => se.teacherId),
      ...cls.enrollments.flatMap((e) => [e.gvDeXuatId, e.gvPhanCongId]),
    ],
  });
  const teacherOptions = teachers.map((t) => ({ id: t.id, name: t.name ?? "(không tên)" }));

  // Phòng của form THÊM BUỔI. ~~kèm `busyByTeacher` để ĐÁNH DẤU giáo viên đang vướng
  // buổi khác~~ **[ĐẢO 17/09/2026]** — prop đó ĐÃ GỠ.
  //
  // Vì sao gỡ: nó bơm sẵn cả lịch bận của giáo viên xuống client để client tự đối chiếu.
  // Cách đó chỉ đủ khi luật chỉ có "ai vướng buổi khác"; từ 17/09 luật còn phải đọc LƯỚI
  // CA, mà ngày/giờ buổi thì người dùng chọn TỰ DO — bơm sẵn nghĩa là bơm cả bảng chấm
  // công của mọi người mọi ngày vào bundle trình duyệt. Nay hỏi qua Server Action
  // `layGvChoBuoiAction` mỗi khi đủ ba ô ngày+giờ, và đó cũng chính là đường mà cửa GHI
  // dùng để tự gác — hai bên không thể lệch luật.
  const roomOptions = await layPhongTheoCoSo(actor, cls.centerId);

  const activeUsed = cls.enrollments.filter((e) => e.status === "ACTIVE").length;
  // 28/08 — `capacity === null` là KHÔNG giới hạn sĩ số, không phải sức chứa 0.
  const full = cls.capacity !== null && activeUsed >= cls.capacity;
  const daKetThuc = cls.status === "COMPLETED" || cls.status === "CANCELLED";

  // Khung giờ + ngày của LỚP — ràng buộc mà mọi case bên trong phải nằm trọn trong đó.
  // `null` với lớp tạo trước 22/09/2026; đường đọc phải chịu được null và KHÔNG bịa.
  //
  // ⚠️ Đọc cột `theoKhung`, KHÔNG suy từ `startTime`/`endTime`: lớp tạo trước 28/08 vẫn
  // mang giờ ở cấp lớp (lib/trial/nghia-null.ts). Suy từ giờ là vẽ "khung" cho lớp
  // slot cũ và đẩy bé "học cả lớp" của nó vào khối "Chưa xếp case" — đo được 23/09.
  const khungLop =
    cls.theoKhung && cls.startTime && cls.endTime
      ? { startTime: cls.startTime, endTime: cls.endTime }
      : null;
  const ngayLop = cls.theoKhung && cls.startDate ? vnYmd(cls.startDate) : null;

  // 27/08 — khối "Phiếu đánh giá buổi học" (hệ SESSION_EVAL) ĐÃ GỠ khỏi màn này.
  //
  // Nó là CỬA THỨ HAI cho cùng một việc, và là cửa sai: giáo viên thật sự chấm bằng
  // phiếu rubric ở site giáo viên (`TrialRubricEval`), còn khối kia đọc kho
  // `EvalResponse`. Hai kho khác nhau nên Sale mở khối kia ra luôn thấy trống dù giáo
  // viên đã chấm xong — đúng lỗi người dùng báo.
  //
  // Thay bằng: mỗi dòng điểm danh có nút lấy phiếu (xem `_components/attendance-board`).
  // Component `TrialSessionEvalFill` KHÔNG xoá — site giáo viên còn dùng
  // (`lib/lms/teacher-schedule.ts`).

  // Trần 1600px cho cả màn: khung admin KHÔNG có trần bề ngang nào (đo
  // `app/(admin)/admin/layout.tsx`), nên trên màn siêu rộng bảng kéo hết cỡ và mắt phải
  // quét cả mét để ghép tên bé ở cột đầu với nút ở cột cuối. Đặt ở ĐÂY chứ không sửa
  // layout chung — đổi layout là đổi mọi màn admin cùng lúc, cần một lượt rà riêng.
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5">
      <Link
        href="/lop-trial"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-foreground">{cls.name}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                MAU_TRANG_THAI[cls.status] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {NHAN_TRANG_THAI[cls.status] ?? cls.status}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{cls.code}</p>
          {/* ~~28/08 — KHÔNG in giờ ở đây nữa: giờ là thuộc tính của TỪNG BUỔI.~~
              **[ĐẢO 22/09/2026]** Lớp nay LÀ một ngày × một khung giờ do Quản lý cơ sở
              mở, và mọi case bên trong phải nằm trong khung đó. Không in ra thì người
              dùng không biết mình đang bị ràng buộc bởi cái gì. Lớp CŨ (`startTime`
              null) thì không in — đừng bịa một khung cho nó. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            {khungLop && (
              <span className="whitespace-nowrap font-semibold text-foreground tabular-nums">
                {ngayLop ? `${ngayLop} · ` : ""}
                {khungLop.startTime}–{khungLop.endTime}
              </span>
            )}
            <span className="whitespace-nowrap">
              Sĩ số{" "}
              <span
                className={
                  full ? "font-semibold text-state-danger-ink" : "font-semibold text-foreground"
                }
              >
                {activeUsed}
                {cls.capacity === null ? "" : `/${cls.capacity}`}
              </span>
            </span>
            <span className="whitespace-nowrap">· {cls.sessions.length} case</span>
          </p>
        </div>
        {/* 23/09 — cổng đổi từ `trials:manage` sang `trials:create-class`. Nút này
            từng hiện với MỌI Sale, và bấm vào là đẩy toàn bộ ghi danh của mọi Sale
            trong lớp sang CANCELLED. Cửa GHI cũng đã đổi theo (`_actions.ts`) — khoá
            nút mà không khoá action là khoá cái cửa đang mở toang. */}
        {canHuyLop && !daKetThuc && <CancelClassButton trialClassId={cls.id} />}
      </div>

      {full && (
        <p className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Lớp đã đủ sĩ số. Xếp thêm học viên cần quyền vượt sĩ số.
        </p>
      )}

      {/* 23/09/2026 — BA KHỐI CŨ ("Thêm buổi học" · "Học viên" · "Buổi học & điểm danh")
          gộp làm một. Hình cũ giấu mất đúng quan hệ người dùng cần đọc: CASE NÀO CÓ AI.
          Danh sách học viên là danh sách PHẲNG cấp lớp, còn buổi là một khối riêng, nên
          muốn biết bé nào ở case nào thì phải bấm từng chip buổi rồi đọc lại bảng.

          `RosterList` không còn được màn này dùng — nó vẽ đúng cái danh sách phẳng đó.
          Component vẫn ở lại repo, chưa xoá: gỡ một component khỏi một màn KHÁC với xoá
          nó khỏi repo, và việc thứ hai cần một lượt rà riêng. */}
      <BangCase
        trialClassId={cls.id}
        khungLop={khungLop}
        ngayLop={ngayLop}
        sessions={cls.sessions}
        enrollments={cls.enrollments}
        teachers={teacherOptions}
        rooms={roomOptions}
        meId={session.user.id}
        canMark={canDiemDanh}
        canManage={isManager}
        canThemCase={isManager}
        canOverride={await checkPermission("trials:override-capacity", {
          centerId: cls.centerId,
        })}
        full={full}
        // Trần số buổi học thử đọc ở cấp GLOBAL — khớp NGUYÊN chỗ server action kiểm
        // (`lop-trial/_actions.ts`). Ô nhập chặn khác server là đẩy người dùng vào cảnh
        // gõ hợp lệ ở client rồi bị từ chối ở server.
        maxSessions={await getSetting("crm.trialMaxSessions")}
        cheDoChonGv={cheDoChonGv}
        locGvTheoCa={locGvTheoCa}
        soGvMienLoc={gvMienLoc.length}
        lopDaKetThuc={daKetThuc}
        khoaHocOptions={cls.khoaHocOptions}
      />
    </div>
  );
}
