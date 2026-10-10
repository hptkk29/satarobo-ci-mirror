import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { leadCreateSchema } from '@/lib/validators/lead'
import { sendMetaCapi, sendGa4Event } from '@/lib/tracking'
import { rateLimit } from '@/lib/rate-limit'
import { ipChoRateLimit } from '@/lib/security/client-ip'
import { findRecentDuplicate, logDuplicateAttempt } from '@/lib/lead/dedup'
import { autoAssignNewLead } from '@/lib/lead/auto-assign'
import { chiaChoLead } from '@/lib/lead/assign-lead'
import { resolveAffiliateByCode } from '@/lib/affiliate'
import { getSetting } from '@/lib/settings/service'
import { KHONG_CO_TIN_HIEU_NGUON } from '@/lib/nguon/tin-hieu'
import { chuanBiQuyNguon, ghiNguonDenSauChoLeadCu, ghiQuyNguonLeadMoi } from '@/lib/nguon/noi-day'

// Mã click quảng cáo vào SỔ NGUỒN (signals/touchpoint) bị cắt: endpoint công khai, không giới hạn độ dài ở zod (cắt thay vì từ chối — không được mất khách vì một mã dài).
const catMaClick = (v: string | undefined): string | null => (v ? v.slice(0, 200) : null)

// Rate limit — uses Upstash Redis when env vars set, in-memory fallback otherwise.
// Ngưỡng đọc động từ SystemSetting "public.leadRateLimit*" (default 5 / 60s).

export async function POST(req: NextRequest) {
  try {
    const headersList = await headers()
    // IP qua luật dùng chung (28/09/2026) — bản cũ lấy phần tử ĐẦU của XFF, tức phần khách viết
    // ⇒ trần gửi form theo IP đổi khoá theo ý người gửi.
    const ip = ipChoRateLimit(headersList)

    // Read body before rate limiting so validation probes and bot traps do not
    // consume the real lead submission quota.
    const body = await req.json()

    if (typeof body?.website === 'string' && body.website.length > 0) {
      console.warn('[POST /api/leads] honeypot triggered, ip:', ip)
      return NextResponse.json({ ok: true, leadId: 'hp-' + Date.now() })
    }

    const parsed = leadCreateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Dữ liệu không hợp lệ', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const data = parsed.data

    if (data.timeOnPage !== undefined && data.timeOnPage < 3) {
      console.warn('[POST /api/leads] suspicious timeOnPage:', data.timeOnPage, 'ip:', ip)
      return NextResponse.json({ ok: true, leadId: 'ab-' + Date.now() })
    }

    const [rlMax, rlWindowMs] = await Promise.all([
      getSetting('public.leadRateLimitMax'),
      getSetting('public.leadRateLimitWindowMs'),
    ])
    const limit = await rateLimit({
      key: `leads:${ip}`,
      max: rlMax,
      windowMs: rlWindowMs,
    })

    if (!limit.success) {
      return NextResponse.json(
        { ok: false, error: 'Quá nhiều request, vui lòng thử lại sau 1 phút' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Remaining': String(limit.remaining),
            'X-RateLimit-Reset': String(limit.resetAt),
          },
        },
      )
    }

    // ─── Chống trùng SĐT trong 90 ngày (Phase T1.3) ─────────────────
    // Nếu trùng → KHÔNG tạo lead mới, log vào lead gốc + trả về lead cũ.
    const duplicate = await findRecentDuplicate(data.phone)
    if (duplicate) {
      await logDuplicateAttempt(duplicate.id, data.phone, data.source ?? null, { kieu: 'gop' })
      // PR2 — tín hiệu đến SAU (kể cả mã giới thiệu `?ref=`) chỉ thành TOUCHPOINT trên lead cũ; attribution KHÔNG đổi (D3).
      // Hành vi hiện hành (trả lead cũ kể cả DA_MAT trong cửa sổ) giữ nguyên — gộp vào luật 26/09 là việc riêng (03 §2.5).
      await ghiNguonDenSauChoLeadCu(
        db,
        duplicate.id,
        {
          kind: 'NHAP_LAI',
          conversionEntry: data.source ?? null,
          nhanKhai: null,
          ref: data.ref ?? null,
          quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao, fbclid: catMaClick(data.fbclid), gclid: catMaClick(data.gclid) },
          utm: {
            source: data.utmSource ?? null,
            medium: data.utmMedium ?? null,
            campaign: data.utmCampaign ?? null,
            term: data.utmTerm ?? null,
            content: data.utmContent ?? null,
          },
          pageId: null,
          nguoiGioiThieu: null,
        },
        null,
        'api/leads',
      )
      return NextResponse.json({ ok: true, leadId: duplicate.id, duplicate: true })
    }

    // ─── CƠ SỞ KHÁCH CHỌN ─────────────────────────────────────────────
    // 03/09/2026 — biểu mẫu công khai gửi MÃ cơ sở (`Center.code`); quy ra id ở
    // đây. `centerId` gửi thẳng (nguồn nội bộ) vẫn thắng nếu có.
    //
    // Mã không khớp cơ sở nào đang hoạt động ⇒ để `null` và đi nhánh "hệ thống
    // tự chọn cơ sở". KHÔNG từ chối phiếu: lỗi cấu hình danh sách cơ sở không
    // phải lý do để mất một lead thật đang gõ số vào form.
    let centerId = data.centerId ?? null
    if (!centerId && data.centerCode) {
      const c = await db.center.findFirst({
        where: { code: data.centerCode, isActive: true },
        select: { id: true },
      })
      centerId = c?.id ?? null
      if (!c) {
        console.warn(
          `[/api/leads] mã cơ sở "${data.centerCode}" không khớp cơ sở nào đang hoạt động — để hệ thống tự chia.`,
        )
      }
    }

    let courseId = data.courseId
    if (!courseId && data.source) {
      const course = await db.course.findUnique({ where: { slug: data.source } })
      courseId = course?.id
    }

    // BGĐ 31/07 — link giới thiệu `?ref=<code>` → gắn lead về đúng người giới thiệu.
    // Mã sai/đã tắt → null (vẫn tạo lead bình thường).
    const affiliate = await resolveAffiliateByCode(data.ref)

    // ── QUY NGUỒN (PR2) — TRƯỚC transaction, tra bằng `db` không scope. Cờ TẮT ⇒ `{ bat: false }`: 0 bản ghi mới.
    // Đường vào "web" (D11): khách tự nhập không có tín hiệu nào khác ⇒ nhóm Quảng cáo (nhóm 2); ref/quảng cáo thắng nó.
    const [nguon] = await chuanBiQuyNguon(db, [
      {
        bayGio: new Date(),
        duongVao: 'web',
        conversionEntry: data.source ?? null,
        nhanKhai: null,
        laNhapExcel: false,
        sdtKhach: data.phone,
        maNvNguoiNhap: null,
        nguoiNhapUserId: null,
        nhanSuGioiThieuEmployeeId: null,
        phuHuynhGioiThieu: null,
        ref: data.ref ?? null,
        refSau: [],
        quangCao: { ...KHONG_CO_TIN_HIEU_NGUON.quangCao, fbclid: catMaClick(data.fbclid), gclid: catMaClick(data.gclid) },
        utm: {
          source: data.utmSource ?? null,
          medium: data.utmMedium ?? null,
          campaign: data.utmCampaign ?? null,
          term: data.utmTerm ?? null,
          content: data.utmContent ?? null,
        },
        pageId: null,
        orgUnitId: null,
        centerId,
      },
    ])

    // Lead + nguồn của nó CÙNG một transaction (T5): sống/chết cùng nhau.
    const lead = await db.$transaction(async (tx) => {
      const created = await tx.lead.create({
      data: {
        affiliateId: affiliate?.id,
        parentName: data.parentName.trim(),
        childName: data.childName?.trim(),
        childAge: data.childAge,
        phone: data.phone,
        email: data.email || undefined,
        // 15/09/2026 — BẮT BUỘC. Danh sách /leads sắp theo `lastInboundAt` với
        // `nulls: 'last'`, nên lead tạo mà bỏ trống cột này bị đẩy xuống CUỐI mọi
        // trang — người dùng báo "nhập xong không thấy lead đâu", nhưng tìm theo
        // SĐT/nguồn thì lại ra (tập kết quả nhỏ nên nó lọt trang 1).
        // Quy ước: lúc tạo, `lastInboundAt` = `createdAt`; `laNhapLai()` chỉ đúng
        // khi nó LỚN HƠN `createdAt`. Xem `lib/tables/lead-columns.ts`.
        lastInboundAt: new Date(),
        centerId,
        courseId,
        source: data.source,
        status: 'MOI',
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmTerm: data.utmTerm,
        utmContent: data.utmContent,
        fbclid: data.fbclid,
        gclid: data.gclid,
        fbp: data.fbp,
        fbc: data.fbc,
        landingPage: data.landingPage,
        referrer: data.referrer,
        eventId: data.eventId,
        consentMarketing: data.consentMarketing,
        ipAddress: ip,
        userAgent: headersList.get('user-agent') ?? undefined,
        note: data.note,
      },
      })
      await ghiQuyNguonLeadMoi(tx, created.id, nguon!, null)
      return created
    })

    // ─── Consult lead notification (Phase 5.13.1.FINAL) ──────────────
    // Chỉ gửi cho lead từ ConsultModal — detect qua source là course slug.
    const CONSULT_SLUGS = new Set([
      'sata1', 'sata2', 'sata3', 'sata4', 'sata5',
      'sata6', 'sata7', 'sata8', 'combo-sata1-sata2',
    ])
    if (data.source && CONSULT_SLUGS.has(data.source.toLowerCase())) {
      const noteText = data.note ?? ''
      const courseNameMatch = noteText.match(/Khóa quan tâm:\s*(.+?)(?:\n|$)/)
      const courseName = courseNameMatch?.[1]?.trim() ?? data.source
      const preferredTimeMatch = noteText.match(/Thời gian muốn liên hệ:\s*(.+?)(?:\n|$)/)
      const preferredTime = preferredTimeMatch?.[1]?.trim()

      const { sendConsultLeadNotification } = await import(
        '@/lib/email/consult-notification'
      )

      sendConsultLeadNotification({
        leadId: lead.id,
        parentName: lead.parentName,
        phone: lead.phone,
        email: lead.email,
        childName: lead.childName,
        courseSlug: data.source,
        courseName,
        preferredTime,
        landingPage: lead.landingPage,
        createdAt: lead.createdAt,
      }).catch((err) =>
        console.error('[/api/leads] consult notification error:', err),
      )
    }

    // ─── CHIA LEAD ────────────────────────────────────────────────────
    // 03/09/2026 — lead từ biểu mẫu web (`/lien-he`, ConsultModal, landing) là
    // LEAD DO MARKETING MANG VỀ, nên phải đi qua ĐÚNG cơ chế chia như mọi nguồn
    // khác (chủ dự án chốt).
    //
    // Trước đợt này chỗ này gọi `autoAssignNewLead`. Hàm đó có dùng sổ lượt,
    // nhưng KHÔNG đi qua pool (`layPoolDangBat`) và KHÔNG ghi
    // `LeadAssignmentLog` ⇒ lead web không bao giờ hiện trong màn "Sổ chia
    // lead". Người vận hành mở sổ ra không thấy nguồn web ở đâu cả.
    //
    // `entryPoint: "LANDING"` — cùng giá trị `ingestIntakeLead` dùng cho nguồn web.
    //
    // `aff: null` CÓ CHỦ ĐÍCH, không phải bỏ sót: mã `?ref=` ở đây là chương
    // trình GIỚI THIỆU (phụ huynh/học viên cũ), và `resolveAffiliateByCode` chỉ
    // tra `{id, code, name}` — không tra ra người dùng nào. Công giới thiệu vẫn
    // được ghi nhận qua `Lead.affiliateId` ở trên; còn CHỦ lead thì để vòng chia
    // quyết định, đúng hành vi đang chạy. Muốn mã NV của sale tự nhận lead thì
    // đó là việc khác (ca [7]–[10] của ma trận) và phải tra thêm user + vai.
    //
    // Còn `centerId` rỗng (khách không chọn cơ sở, hoặc nguồn không có ô đó) thì
    // giữ đường cũ: `autoAssignNewLead` có nhánh "tự chọn cơ sở đều tay" mà
    // `chiaChoLead` cố ý không có — nó đòi biết cơ sở trước để có sổ lượt mà ghi.
    if (lead.centerId) {
      await chiaChoLead(lead.id, {
        targetCenterId: lead.centerId,
        createdById: null,
        entryPoint: 'LANDING',
        aff: null,
      }).catch((err) => console.error('[/api/leads] chia lead error:', err))
    } else {
      // Await để đảm bảo gán (serverless có thể kill fire-and-forget).
      await autoAssignNewLead(lead.id, {
        actorId: null,
        actorName: 'Hệ thống (web)',
      }).catch((err) => console.error('[/api/leads] auto-assign error:', err))
    }

    Promise.all([
      sendMetaCapi({
        eventName: 'Lead',
        eventId: data.eventId,
        eventSourceUrl: data.landingPage,
        userData: {
          phone: data.phone,
          email: data.email,
          fbp: data.fbp,
          fbc: data.fbc,
          clientIpAddress: ip,
          clientUserAgent: headersList.get('user-agent') ?? undefined,
        },
        customData: {
          content_name: data.source,
          content_category: 'lead',
        },
      }),
      sendGa4Event({
        clientId: data.fbp ?? data.eventId,
        eventName: 'generate_lead',
        params: {
          source: data.source,
          utm_source: data.utmSource,
          utm_medium: data.utmMedium,
          utm_campaign: data.utmCampaign,
        },
      }),
    ]).catch((err) => {
      console.error('[tracking-error]', err)
    })

    return NextResponse.json({ ok: true, leadId: lead.id })
  } catch (error) {
    console.error('[POST /api/leads]', error)
    return NextResponse.json({ ok: false, error: 'Lỗi hệ thống' }, { status: 500 })
  }
}
