// lib/lead/sale-leads.ts — "Khách của tôi" trên site Sale.
//
// Vì sao là module riêng chứ không dùng lại truy vấn của `/admin/leads`: trang
// admin phục vụ CẢ quản lý (xem toàn cơ sở) lẫn sale (xem của mình), nên `where`
// của nó là một cây điều kiện có nhánh. Trang này chỉ có MỘT người dùng và MỘT
// câu hỏi — "khách nào của tôi" — nên viết thẳng, ít nhánh, dễ đọc lại sau này.
//
// Cách ly cơ sở KHÔNG nằm ở đây: `Lead ∈ SCOPED_MODELS` nên `scopedDb(actor)` tự
// chèn `centerId IN visibleCenterIds`. Ở đây chỉ lọc THÊM "của tôi".
//
// ⚠️ Điều kiện "của tôi" đi qua `leadOwnershipWhere()` thay vì gõ `assignedToId`
// tại chỗ: chính sách lead độc quyền (Q8, 22/08) đổi được bằng env
// `LEAD_SHARING_ENABLED`, và nếu chỗ này gõ tay thì bật lại chính sách cũ sẽ chỉ
// đúng ở trang admin còn trang này thì không.
//
// S-8 (27/08/2026) — hai mệnh đề đó nay ở `lib/lead/ownership.ts`, KHÔNG còn
// được định nghĩa ở file này. Lý do: trang quản trị và ô tìm toàn hệ thống cũng
// cần đúng mệnh đề ấy, mà bắt chúng import từ một module tên "sale-leads" thì
// hoặc là kỳ, hoặc là họ chép tay — và chép tay chính là cách bản thứ ba ra đời
// với hai vế thay vì ba. Xem đầu `ownership.ts`.
import "server-only";
import type { LeadStatus, Prisma } from "@prisma/client";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { leadOwnershipWhere } from "@/lib/lead/ownership";
import { phoneSearchTerm } from "@/lib/phone";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { LEAD_KHONG_NHAN_THEM_CON } from "@/lib/leads/status";

/** Trạng thái coi là ĐÃ ĐÓNG — mặc định không hiện trong danh sách việc đang làm. */
export const TRANG_THAI_DA_DONG: LeadStatus[] = [...LEAD_KHONG_NHAN_THEM_CON];

export type SaleLeadRow = {
  id: string;
  parentName: string | null;
  phone: string | null;
  childName: string | null;
  status: LeadStatus;
  source: string | null;
  createdAt: Date;
  /** Lần chạm gần nhất — dùng để người xem tự thấy khách nào đang bị bỏ quên. */
  lastActivityAt: Date | null;
  /** Việc follow-up còn mở, sắp tới hạn nhất. `null` = không có việc nào. */
  viecSapToi: { id: string; title: string; dueAt: Date } | null;
};

export type SaleLeadListInput = {
  actor: Actor;
  userId: string;
  /** Lọc theo một trạng thái cụ thể. Bỏ trống = mọi trạng thái ĐANG MỞ. */
  status?: LeadStatus;
  /** Tìm theo tên phụ huynh / tên con / số điện thoại. */
  q?: string;
  /**
   * Ô tìm có được quét cột SĐT không — S-1 (26/08/2026).
   *
   * Đây là rò GIÁN TIẾP, và là chỗ site Sale quên chép mẫu của khu quản trị
   * (`/admin/leads`, `/admin/search` đều gác từ #11). Không hiện số nhưng cho DÒ:
   * gõ `0905123456`, thấy một khách hiện lên là biết ngay số đó của ai. Che cột
   * hiển thị mà để ô tìm quét cột ấy thì việc che chỉ còn là hình thức.
   *
   * Phải là KẾT QUẢ của `canViewLeadPii()` (và không bị DENY cấp trường), không
   * phải suy theo vai. Mặc định `false` — quên truyền thì mất tính năng tìm, chứ
   * không mất dữ liệu cá nhân.
   */
  canSearchPhone?: boolean;
  /** `true` = lấy cả lead đã đóng (đã ghi danh / đã mất / trùng). */
  gomDaDong?: boolean;
  take?: number;
};

/** Số dòng tối đa MỘT lượt đọc. Xem `SaleLeadList.tong` về việc phải nói ra khi cắt. */
export const SO_DONG_TOI_DA = 200;

/**
 * Dựng `where` của danh sách "Khách của tôi". THUẦN — tách ra để test được.
 *
 * Vì sao không để inline trong `getMyLeads`: mệnh đề này là chỗ duy nhất quyết
 * định ai đọc được gì trên site Sale, mà nó lại nằm trong một hàm chạm DB nên
 * không có cách nào soi được bằng test không-DB. Tách ra rồi thì test S-4 dựng
 * đúng cái `where` thật, đẩy qua `injectScope` và chứng minh được cách ly cơ sở
 * còn nguyên sau khi nới vế "người nhập".
 */
export function buildMyLeadsWhere(
  input: Pick<SaleLeadListInput, "userId" | "status" | "q" | "gomDaDong" | "canSearchPhone">,
): Prisma.LeadWhereInput {
  const { userId, status, q, gomDaDong = false, canSearchPhone = false } = input;
  const timKiem = q?.trim();
  // SĐT lưu 2 dạng (`0…` cũ / `84…` mới) — tìm theo phần lõi để không sót.
  const loiSdt = canSearchPhone && timKiem ? (phoneSearchTerm(timKiem) ?? timKiem) : undefined;

  return {
    deletedAt: null,
    // Gói trong AND để nhánh "của tôi" và nhánh "tìm kiếm" không đè key OR của nhau.
    AND: [
      leadOwnershipWhere(userId),
      ...(status ? [{ status }] : gomDaDong ? [] : [{ status: { notIn: TRANG_THAI_DA_DONG } }]),
      ...(timKiem
        ? [
            {
              OR: [
                { parentName: { contains: timKiem, mode: "insensitive" as const } },
                { childName: { contains: timKiem, mode: "insensitive" as const } },
                ...(loiSdt ? [{ phone: { contains: loiSdt } }] : []),
              ],
            },
          ]
        : []),
    ],
  };
}

export type SaleLeadList = {
  rows: SaleLeadRow[];
  /** TỔNG số khách khớp bộ lọc — có thể lớn hơn `rows.length`. */
  tong: number;
  /** Câu nói thẳng "còn N khách chưa hiện", hoặc `null` khi không cắt. */
  canhBaoCat: string | null;
};

/**
 * Câu cảnh báo khi danh sách bị cắt. THUẦN.
 *
 * S-4 (27/08/2026) — trước đây truy vấn cắt cứng ở 200 dòng và KHÔNG nói gì.
 * `PhanTrangBang` phân trang ở tầng hiển thị nên nó chỉ đếm được số dòng đã
 * nhận: có 237 khách thì thanh dưới bảng in "/ 200 khách". Đó không phải giới
 * hạn hiển thị, đó là một con số SAI — và người dùng dựa vào nó để nói "tôi có
 * 200 khách".
 *
 * Trả `null` khi `tong <= daHien`: hai truy vấn chạy cách nhau vài mili giây nên
 * `tong` có thể nhỏ hơn số dòng đã lấy; in "còn -3 khách" thì thà im.
 */
export function moTaCatDanhSach(daHien: number, tong: number): string | null {
  if (tong <= daHien) return null;
  return `Đang hiện ${daHien} khách chạm gần đây nhất trong tổng số ${tong} — còn ${
    tong - daHien
  } khách chưa hiện. Dùng ô tìm hoặc bộ lọc để thu hẹp.`;
}

/**
 * Danh sách khách của một tư vấn viên.
 *
 * Sắp theo `lastActivityAt` GIẢM DẦN chứ không theo `createdAt`: câu hỏi mở đầu
 * ngày của sale là "hôm nay chạm ai", và khách mới tạo mà chưa chạm thì
 * `lastActivityAt` rỗng nên tự rơi xuống cuối — đúng chỗ cần nhìn lại.
 *
 * Trả kèm `tong` (đếm bằng CHÍNH `where` đó) để tầng trên nói được sự thật khi
 * số khách vượt `take`.
 */
export async function getMyLeads(input: SaleLeadListInput): Promise<SaleLeadList> {
  const { actor, take = SO_DONG_TOI_DA } = input;
  const sdb = scopedDb(actor);
  const where = buildMyLeadsWhere(input);

  const [rows, tong] = await Promise.all([
    sdb.lead.findMany({
      where,
      orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        parentName: true,
        phone: true,
        childName: true,
        status: true,
        source: true,
        createdAt: true,
        lastActivityAt: true,
        // Chỉ lấy MỘT việc còn mở gần hạn nhất — danh sách không cần cả sổ việc,
        // và lấy hết là kéo theo hàng nghìn dòng cho một cột hiển thị.
        tasks: {
          where: { status: "OPEN" },
          orderBy: { dueAt: "asc" },
          take: 1,
          select: { id: true, title: true, dueAt: true },
        },
      },
    }),
    // Cùng `where`, không phải một bộ lọc khác: đếm bằng điều kiện khác là ra
    // một con số không liên quan tới thứ đang hiện, còn tệ hơn không đếm.
    sdb.lead.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      parentName: r.parentName,
      phone: r.phone,
      childName: r.childName,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt,
      lastActivityAt: r.lastActivityAt,
      viecSapToi: r.tasks[0] ?? null,
    })),
    tong,
    canhBaoCat: moTaCatDanhSach(rows.length, tong),
  };
}

export type SaleLeadDetail = NonNullable<Awaited<ReturnType<typeof getMyLeadDetail>>>;

/**
 * Chi tiết một khách — chỉ trả khi khách đó THẬT SỰ của người đang xem.
 *
 * Trả `null` cho cả hai ca "không tồn tại" và "không phải của bạn", cố ý không
 * phân biệt: phân biệt ra là biến trang này thành công cụ dò xem lead nào tồn tại.
 */
export async function getMyLeadDetail(
  actor: Actor,
  userId: string,
  leadId: string,
  canViewPii: boolean,
) {
  const sdb = scopedDb(actor);
  const lead = await sdb.lead.findFirst({
    where: { id: leadId, deletedAt: null, AND: [leadOwnershipWhere(userId)] },
    select: {
      id: true,
      parentName: true,
      phone: true,
      email: true,
      childName: true,
      note: true,
      status: true,
      source: true,
      facebookUrl: true,
      createdAt: true,
      lastActivityAt: true,
      assignedToId: true,
      centerId: true,
      center: { select: { name: true } },
      course: { select: { name: true } },
      children: {
        select: { id: true, fullName: true, ageYears: true, gradeLevel: true, trialStatus: true },
        orderBy: { createdAt: "asc" },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, content: true, actorName: true, createdAt: true },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        take: 50,
        select: { id: true, title: true, description: true, dueAt: true, status: true },
      },
    },
  });
  if (!lead) return null;

  // Mask PII ở SERVER trước khi xuống client — che ở UI là vẫn lộ qua payload RSC.
  // Sale vốn có `leads:view-pii`, nhưng quyền có thể bị thu bằng grant cấp người.
  const masked = maskLeadPiiFields(lead, canViewPii);
  return { ...lead, ...masked };
}
