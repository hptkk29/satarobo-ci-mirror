import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getWardsByProvince, provinces } from "vietnam-address-data";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { leadChildCenterOptions } from "@/lib/lead/child-center-options";
import {
  LEAD_CHILD_CLASS_FIND_ARGS,
  leadChildClassOptions,
} from "@/lib/lead/child-class-options";
import {
  provinceIdByName,
  toAddressOptions,
  toNameOptions,
} from "@/lib/address/vn-address";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { LeadForm } from "../../_components/lead-form";
import { LeadChildrenManager } from "../../_components/lead-children";
import { splitLeadNote } from "@/lib/lead/note-view";

export const metadata = { title: "Sửa lead | Admin" };
export const dynamic = "force-dynamic";

// P1-d — sửa hồ sơ lead (các field cơ bản). Dùng LeadForm ở chế độ edit
// (updateLeadFields đã có + ghi audit P2-1).
export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("leads:edit"))) redirect("/leads");
  // #11 T1 — cần biết actor có view-all không để check ownership sau khi load lead.
  const canViewAll = await checkPermission("leads:view-all");

  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS → sdb.lead tự inject `centerId IN visible`.
  // CENTER_MANAGER@CS1 sửa lead CS2 → findFirst trả null → notFound() (chống IDOR).
  // SUPER_ADMIN/HO bypass (ALL). Course không scoped → sdb pass-through.
  const sdb = scopedDb(actor);
  const [lead, orgUnits, courses, classRows] = await Promise.all([
    sdb.lead.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        assignedToId: true,
        parentName: true,
        phone: true,
        email: true,
        childName: true,
        childAge: true,
        centerId: true,
        orgUnitId: true,
        courseId: true,
        source: true,
        note: true,
        // G-01 — 5 ô mới ở cấp phụ huynh. Trang này đã chặn cứng người không có
        // `leads:view-pii` ở ngay dưới (redirect về chi tiết), nên `parentDob`
        // không rời server cho ai không được xem.
        parentGender: true,
        parentDob: true,
        city: true,
        ward: true,
        addressLine: true,
        // G-06 — mã campaign + ngày hẹn kế tiếp (không phải PII).
        campaignName: true,
        campaignId: true,
        adsetId: true,
        adId: true,
        nextFollowUpAt: true,
        children: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fullName: true,
            dob: true,
            ageYears: true,
            gender: true,
            schoolName: true,
            gradeLevel: true,
            interestedCourseId: true,
            interestedCenterId: true,
            classId: true,
            note: true,
            // G-06 — giá trị hợp đồng ĐÃ KÝ + mốc chốt.
            contractValue: true,
            closedAt: true,
            trialStatus: true,
          },
        },
      },
    }),
    // Hội sở KHÔNG nhận lead (chốt 04/08) — picker chỉ liệt kê cơ sở dạy học.
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
    sdb.course.findMany({ where: { isActive: true, isTeachable: true }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    // G-01 — lớp cho ô "Lớp tại trung tâm" của từng con (Class ∈ SCOPED_MODELS).
    sdb.class.findMany(LEAD_CHILD_CLASS_FIND_ARGS),
  ]);
  if (!lead) notFound();

  // G-01 — nạp SẴN phường/xã của tỉnh phiếu đang lưu. Làm ở server (gói danh mục
  // đã nằm sẵn ở đây) thay vì `useEffect` bên client: không có bước này thì ô
  // phường của phiếu cũ chỉ hiện đúng một mục và không đổi sang phường khác được
  // trừ khi bấm lại ô tỉnh.
  const maTinhDangLuu = provinceIdByName(provinces, lead.city);
  const phuongCuaTinh = maTinhDangLuu ? toNameOptions(getWardsByProvince(maTinhDangLuu)) : [];

  // #11 T1/T2 — 2 lớp chặn vào form edit (LeadForm prefill PII RAW từ DB):
  // (a) Ownership (Q2): lead "dùng chung" chỉ cho XEM + GHI CHÚ → shared-viewer
  //     KHÔNG được vào edit. Đồng thời vá lỗ pre-existing: sale cùng cơ sở đoán
  //     URL /edit của lead người khác (trước chỉ cần leads:edit + qua scope là lọt).
  if (!canViewAll && lead.assignedToId !== session.user.id) redirect(`/leads/${id}`);
  // (b) PII (Q7): non-holder leads:view-pii (vd MARKETING) vào form sẽ thấy PII raw
  //     + nguy cơ bấm Lưu đè bản mask ngược vào DB → chặn hẳn, về chi tiết (đã mask).
  if (!(await canViewLeadPii())) redirect(`/leads/${id}`);

  return (
    <div className="p-6">
      <Link href={`/leads/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Chi tiết lead
      </Link>
      <h1 className="mb-4 text-2xl font-bold text-foreground">Sửa thông tin lead</h1>
      {/* `leads:overwrite` hỏi ở SERVER rồi truyền xuống — client không gọi `can()` được,
          và tự suy từ role trong session là đúng thứ `no-inline-authz` cấm. Form chỉ KHOÁ
          Ô; cổng chặn thật nằm ở `updateLeadFields`. */}
      <LeadForm
        duocDe={await checkPermission("leads:overwrite")}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        // Chế độ SỬA không hiện khối con trong form (quản lý ở `LeadChildrenManager`
        // bên dưới) nhưng vẫn truyền đúng danh sách: prop bắt buộc để không ai
        // dựng lại được một LeadForm mượn nhầm `orgUnits` cho ô cơ sở của con.
        centers={leadChildCenterOptions(orgUnits)}
        courses={courses}
        initial={{
          id: lead.id,
          parentName: lead.parentName,
          phone: lead.phone,
          email: lead.email ?? undefined,
          childName: lead.childName ?? undefined,
          childAge: lead.childAge,
          orgUnitId: lead.orgUnitId,
          courseId: lead.courseId,
          source: lead.source,
          // 24/08 — ô này CHỈ nhận phần chữ người nhập gõ. Dòng máy ghi (mã NV,
          // cảnh báo chia lead) bị bốc ra và được `updateLeadFields` ráp lại lúc
          // lưu, nên sửa ghi chú không còn xoá mất dấu vết người nhập.
          note: splitLeadNote(lead.note).human,
          // G-01 — 5 ô mới. `parentDob` là `@db.Date`; cắt 10 ký tự đầu của ISO là
          // đúng chuỗi mà <input type="date"> cần.
          parentGender: lead.parentGender,
          parentDob: lead.parentDob ? lead.parentDob.toISOString().slice(0, 10) : null,
          city: lead.city,
          ward: lead.ward,
          addressLine: lead.addressLine,
          // G-06 — mã campaign + ngày hẹn kế tiếp. Không truyền xuống thì ô hiện
          // rỗng, và lượt bấm Lưu kế tiếp XOÁ TRẮNG giá trị đang có (payload gửi
          // chuỗi rỗng = "xoá") — mất dữ liệu im lặng, đúng bẫy đã vá ở G-01.
          campaignName: lead.campaignName,
          campaignId: lead.campaignId,
          adsetId: lead.adsetId,
          adId: lead.adId,
          nextFollowUpAt: lead.nextFollowUpAt
            ? lead.nextFollowUpAt.toISOString().slice(0, 10)
            : null,
        }}
        classes={leadChildClassOptions(classRows)}
        provinces={toAddressOptions(provinces)}
        initialWards={phuongCuaTinh}
        // Lead đã có con ⇒ "Khoá quan tâm" của lead là BẢN SAO lựa chọn của Sale ở
        // khối con bên dưới (đồng bộ trong syncLeadCourseFromChildren). Mở cho sửa
        // tay ở đây là dựng hai nguồn sự thật đánh nhau: lần ghi con kế tiếp sẽ đè
        // im lặng lên thứ người dùng vừa chọn.
        courseFromChildren={lead.children.length > 0}
      />

      {/* R7-01 — quản lý con đã lưu (thêm/sửa/xoá ngay) */}
      <div className="mt-6 max-w-xl">
        <LeadChildrenManager
          leadId={lead.id}
          childrenList={lead.children.map((c) => ({
            id: c.id,
            fullName: c.fullName,
            dob: c.dob ? c.dob.toISOString() : null,
            ageYears: c.ageYears,
            gender: c.gender,
            schoolName: c.schoolName,
            gradeLevel: c.gradeLevel,
            interestedCourseId: c.interestedCourseId,
            interestedCenterId: c.interestedCenterId,
            classId: c.classId,
            note: c.note,
            // G-06 — giá trị hợp đồng ĐÃ KÝ + mốc chốt. Không phải PII, không phải
            // doanh thu: hai chuyện đều đã nói rõ ở lib/lead/contract-value.ts.
            contractValue: c.contractValue,
            closedAt: c.closedAt ? c.closedAt.toISOString() : null,
            trialStatus: c.trialStatus,
          }))}
          classes={leadChildClassOptions(classRows)}
          // V-4 G-01b — TRƯỚC 25/08 chỗ này map `o.orgUnitId`. Ô "Cơ sở quan tâm"
          // ghi vào `LeadChild.interestedCenterId`, vốn trỏ sang bảng **Center**
          // (schema: "tham chiếu Center"), nên sửa một con ở đây là lưu OrgUnit.id
          // — ra màn chi tiết tra trong danh sách Center không thấy, tên cơ sở
          // biến mất không lời nào. Chiều ngược lại còn tệ hơn: con do luồng nhận
          // lead ngoài / nhập Excel tạo (đang giữ đúng Center.id) mở lên đây thì
          // `<select>` không khớp option nào, tụt về "— Chưa chọn —", bấm Lưu là
          // xoá trắng cơ sở đúng.
          centers={leadChildCenterOptions(orgUnits)}
          courses={courses}
          legacyChildName={lead.childName}
          legacyChildAge={lead.childAge}
          readOnly={lead.status === "DA_MAT"}
        />
      </div>
    </div>
  );
}
