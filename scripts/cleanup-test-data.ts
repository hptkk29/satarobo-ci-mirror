/**
 * cleanup-test-data.ts — XOÁ dữ liệu test __TEST__ trên Supabase chung.
 *
 * AN TOÀN:
 *  - Mặc định DRY-RUN (chỉ in COUNT, KHÔNG xoá). Thêm cờ `--apply` để xoá thật.
 *  - Đọc DATABASE_URL từ .env.local (KHÔNG phải .env.test).
 *  - Chỉ đụng đúng các bản ghi test liệt kê dưới (id/email/code/marker __TEST__).
 *
 * Chạy:
 *   DRY-RUN: node_modules/.bin/tsx scripts/cleanup-test-data.ts
 *   XOÁ:     node_modules/.bin/tsx scripts/cleanup-test-data.ts --apply
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

// ── Load DATABASE_URL từ .env.local ─────────────────────────────────────────
function loadEnvLocal(): string {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
    if (m) {
      let v = m[1].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      return v
    }
  }
  throw new Error('DATABASE_URL không tìm thấy trong .env.local')
}

function withPgBouncer(url: string): string {
  // Transaction pooler (6543) không hỗ trợ prepared statements → pgbouncer=true tắt chúng.
  if (/pgbouncer=true/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true&connection_limit=1'
}

const DATABASE_URL = withPgBouncer(loadEnvLocal())
// fail-safe: KHÔNG cho phép trỏ vào DB test local (đây là dọn Supabase)
if (/127\.0\.0\.1|localhost|satarobo_test/.test(DATABASE_URL)) {
  throw new Error('DATABASE_URL trỏ local/test — script này dành cho Supabase. Dừng.')
}
console.log(`DB host: ${DATABASE_URL.replace(/:[^:@/]+@/, ':****@').split('@')[1]?.split('/')[0] ?? '?'}`)

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL })

// ── Markers test ────────────────────────────────────────────────────────────
const USER_EMAILS = [
  'test-admin@example.com',
  'test-cs1@example.com',
  'test-convert@example.com',
  'test-teacher@example.com',
]
const USER_IDS_KNOWN = [
  'cmqlm80st00017b5jfo53ajta', // test-admin
  'cmqlu0mxo0001o3iz2nblg8op', // test-cs1
  'cmqkn72ta003k1pmc1pbdfbhi', // test-convert (parent)
]
const LEAD_ID = 'cmqkflvjj003yr3o7gwyndp1o'
const LEAD_CHILD_IDS = ['cmqkfm2690048r3o7el6tiasa', 'cmqkfm42m004cr3o7rn7u88wd']
const STUDENT_CODES = ['CS2-26-K9J7X8', 'CS2-26-2F55FQ']
const ENROLLMENT_IDS = ['cmqkn73gr003o1pmct0iinmr2', 'cmqkn743b003s1pmct82i2vfd']
const CLASS_ID = 'cmqkkdp5a00fzr3o71w460hob' // CS2.SATA1.26.001
const ORDER_CODE = 'ORD-TEST-mqklsirf'
const RECEIPT_CODE = 'RCP-SR-26-0001'

type Counts = Record<string, number>
const dryCounts: Counts = {}
const delCounts: Counts = {}

async function main() {
  console.log(`\n=== MODE: ${APPLY ? 'APPLY (XOÁ THẬT)' : 'DRY-RUN (chỉ đếm)'} ===\n`)

  // ── Resolve dynamic IDs ───────────────────────────────────────────────────
  const testUsers = await prisma.user.findMany({
    where: { OR: [{ email: { in: USER_EMAILS } }, { id: { in: USER_IDS_KNOWN } }] },
    select: { id: true, email: true },
  })
  const userIds = [...new Set(testUsers.map((u) => u.id))]
  console.log('Test users resolved:', testUsers.map((u) => `${u.email}=${u.id}`).join(', ') || '(none)')

  const order = await prisma.order.findUnique({ where: { code: ORDER_CODE }, select: { id: true } })
  const orderId = order?.id ?? null
  console.log('Order:', orderId ?? '(not found)')

  const students = await prisma.student.findMany({
    where: { studentCode: { in: STUDENT_CODES } },
    select: { id: true, studentCode: true },
  })
  const studentIds = students.map((s) => s.id)
  console.log('Students:', students.map((s) => `${s.studentCode}=${s.id}`).join(', ') || '(none)')

  const enrollments = await prisma.enrollment.findMany({
    where: { OR: [{ id: { in: ENROLLMENT_IDS } }, { studentId: { in: studentIds.length ? studentIds : ['__none__'] } }] },
    select: { id: true },
  })
  const enrollmentIds = [...new Set([...ENROLLMENT_IDS, ...enrollments.map((e) => e.id)])].filter(Boolean)

  const payments = orderId
    ? await prisma.payment.findMany({ where: { orderId }, select: { id: true } })
    : []
  const paymentIds = payments.map((p) => p.id)
  console.log('Payments (of order):', paymentIds.length)

  const sessions = await prisma.classSession.findMany({ where: { classId: CLASS_ID }, select: { id: true } })
  const sessionIds = sessions.map((s) => s.id)
  console.log('ClassSessions (of class):', sessionIds.length)

  const reportCards = await prisma.reportCard.findMany({
    where: { enrollmentId: { in: enrollmentIds.length ? enrollmentIds : ['__none__'] } },
    select: { id: true },
  })
  const reportCardIds = reportCards.map((r) => r.id)
  console.log('ReportCards (of test enrollments):', reportCardIds.length)

  const criteria = await prisma.reportCardCriterion.findMany({
    where: { name: { startsWith: '__TEST__' } },
    select: { id: true, name: true },
  })
  const criterionIds = criteria.map((c) => c.id)
  console.log('ReportCardCriterion __TEST__:', criteria.map((c) => c.name).join(' | ') || '(none)')

  // DomainEvent payment.confirmed liên quan
  const allConfirmed = await prisma.domainEvent.findMany({
    where: { type: 'payment.confirmed' },
    select: { id: true, payloadJson: true, dedupeKey: true },
  })
  const refTokens = new Set<string>([...paymentIds, ...enrollmentIds, ...(orderId ? [orderId] : [])])
  const matchedEvents = allConfirmed.filter((e) => {
    const blob = JSON.stringify(e.payloadJson) + (e.dedupeKey ?? '')
    return [...refTokens].some((t) => blob.includes(t))
  })
  console.log(`DomainEvent payment.confirmed: total=${allConfirmed.length}, matched-test=${matchedEvents.length}`)
  const eventIds = matchedEvents.map((e) => e.id)

  // ── DRY-RUN counts ────────────────────────────────────────────────────────
  dryCounts.ReportCardScore = await prisma.reportCardScore.count({ where: { reportCardId: { in: orNone(reportCardIds) } } })
  dryCounts.ReportCard = reportCardIds.length
  dryCounts.ReportCardCriterion = criterionIds.length
  dryCounts.Receipt = await prisma.receipt.count({
    where: { OR: [{ code: RECEIPT_CODE }, { paymentId: { in: orNone(paymentIds) } }, { enrollmentId: { in: orNone(enrollmentIds) } }] },
  })
  dryCounts.Attendance = await prisma.attendance.count({ where: { OR: [{ sessionId: { in: orNone(sessionIds) } }, { studentId: { in: orNone(studentIds) } }] } })
  dryCounts.StudentSessionFeedback = await prisma.studentSessionFeedback.count({ where: { OR: [{ classSessionId: { in: orNone(sessionIds) } }, { studentId: { in: orNone(studentIds) } }] } })
  dryCounts.ClassSession = sessionIds.length
  dryCounts.MakeupNeed = await prisma.makeupNeed.count({ where: { OR: [{ studentId: { in: orNone(studentIds) } }, { classId: CLASS_ID }] } })
  dryCounts.Payment = paymentIds.length
  dryCounts.OrderItem = orderId ? await prisma.orderItem.count({ where: { orderId } }) : 0
  dryCounts.OrderStatusHistory = orderId ? await prisma.orderStatusHistory.count({ where: { orderId } }) : 0
  dryCounts.OrderInstallment = orderId ? await prisma.orderInstallment.count({ where: { orderId } }) : 0
  dryCounts.VoucherRedemption = orderId ? await prisma.voucherRedemption.count({ where: { orderId } }) : 0
  dryCounts.Order = orderId ? 1 : 0
  dryCounts.Enrollment = await prisma.enrollment.count({ where: { id: { in: orNone(enrollmentIds) } } })
  dryCounts.Student = studentIds.length
  dryCounts.LeadChild = await prisma.leadChild.count({ where: { OR: [{ id: { in: LEAD_CHILD_IDS } }, { leadId: LEAD_ID }] } })
  dryCounts.Lead = await prisma.lead.count({ where: { id: LEAD_ID } })
  dryCounts.Class = await prisma.class.count({ where: { id: CLASS_ID } })
  dryCounts.UserOrgRole = await prisma.userOrgRole.count({ where: { userId: { in: orNone(userIds) } } })
  dryCounts.DomainEvent = eventIds.length
  dryCounts.User = userIds.length

  console.log('\n── DRY-RUN COUNT (rows sẽ xoá) ──')
  for (const [k, v] of Object.entries(dryCounts)) console.log(`  ${k.padEnd(24)} ${v}`)

  // Baseline tổng thể (chứng minh không đụng data thật)
  const baseline = {
    UserTotal: await prisma.user.count(),
    StudentTotal: await prisma.student.count(),
    LeadTotal: await prisma.lead.count(),
    OrderTotal: await prisma.order.count(),
    PaymentTotal: await prisma.payment.count(),
    ClassTotal: await prisma.class.count(),
    RoleDefTotal: await prisma.roleDef.count(),
  }
  console.log('\n── Baseline tổng bảng (trước xoá) ──')
  for (const [k, v] of Object.entries(baseline)) console.log(`  ${k.padEnd(24)} ${v}`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] Không xoá gì. Chạy lại với --apply để xoá.\n')
    return
  }

  // ── XOÁ theo thứ tự FK an toàn (con → cha) ────────────────────────────────
  console.log('\n=== BẮT ĐẦU XOÁ ===')
  delCounts.ReportCardScore = (await prisma.reportCardScore.deleteMany({ where: { reportCardId: { in: orNone(reportCardIds) } } })).count
  delCounts.ReportCard = (await prisma.reportCard.deleteMany({ where: { id: { in: orNone(reportCardIds) } } })).count
  delCounts.ReportCardCriterion = (await prisma.reportCardCriterion.deleteMany({ where: { id: { in: orNone(criterionIds) } } })).count

  delCounts.Receipt = (await prisma.receipt.deleteMany({
    where: { OR: [{ code: RECEIPT_CODE }, { paymentId: { in: orNone(paymentIds) } }, { enrollmentId: { in: orNone(enrollmentIds) } }] },
  })).count

  delCounts.Attendance = (await prisma.attendance.deleteMany({ where: { OR: [{ sessionId: { in: orNone(sessionIds) } }, { studentId: { in: orNone(studentIds) } }] } })).count
  delCounts.StudentSessionFeedback = (await prisma.studentSessionFeedback.deleteMany({ where: { OR: [{ classSessionId: { in: orNone(sessionIds) } }, { studentId: { in: orNone(studentIds) } }] } })).count
  delCounts.MakeupNeed = (await prisma.makeupNeed.deleteMany({ where: { OR: [{ studentId: { in: orNone(studentIds) } }, { classId: CLASS_ID }] } })).count
  delCounts.ClassSession = (await prisma.classSession.deleteMany({ where: { id: { in: orNone(sessionIds) } } })).count

  // payments trước order (receipts đã xoá). adjustmentOf self-ref SetNull tự xử lý.
  delCounts.Payment = orderId ? (await prisma.payment.deleteMany({ where: { orderId } })).count : 0
  delCounts.OrderItem = orderId ? (await prisma.orderItem.deleteMany({ where: { orderId } })).count : 0
  delCounts.OrderStatusHistory = orderId ? (await prisma.orderStatusHistory.deleteMany({ where: { orderId } })).count : 0
  delCounts.OrderInstallment = orderId ? (await prisma.orderInstallment.deleteMany({ where: { orderId } })).count : 0
  delCounts.VoucherRedemption = orderId ? (await prisma.voucherRedemption.deleteMany({ where: { orderId } })).count : 0
  delCounts.Order = orderId ? (await prisma.order.deleteMany({ where: { id: orderId } })).count : 0

  delCounts.Enrollment = (await prisma.enrollment.deleteMany({ where: { id: { in: orNone(enrollmentIds) } } })).count
  delCounts.Student = (await prisma.student.deleteMany({ where: { id: { in: orNone(studentIds) } } })).count
  delCounts.LeadChild = (await prisma.leadChild.deleteMany({ where: { OR: [{ id: { in: LEAD_CHILD_IDS } }, { leadId: LEAD_ID }] } })).count
  delCounts.Lead = (await prisma.lead.deleteMany({ where: { id: LEAD_ID } })).count
  delCounts.Class = (await prisma.class.deleteMany({ where: { id: CLASS_ID } })).count

  delCounts.UserOrgRole = (await prisma.userOrgRole.deleteMany({ where: { userId: { in: orNone(userIds) } } })).count
  delCounts.DomainEvent = eventIds.length ? (await prisma.domainEvent.deleteMany({ where: { id: { in: eventIds } } })).count : 0
  delCounts.User = (await prisma.user.deleteMany({ where: { id: { in: orNone(userIds) } } })).count

  console.log('\n── ĐÃ XOÁ (rows mỗi bảng) ──')
  for (const [k, v] of Object.entries(delCounts)) console.log(`  ${k.padEnd(24)} ${v}`)

  // ── VERIFY: marker test = 0 ───────────────────────────────────────────────
  const verify = {
    User: await prisma.user.count({ where: { OR: [{ email: { in: USER_EMAILS } }, { id: { in: USER_IDS_KNOWN } }] } }),
    UserOrgRole: await prisma.userOrgRole.count({ where: { userId: { in: orNone(userIds) } } }),
    Lead: await prisma.lead.count({ where: { id: LEAD_ID } }),
    LeadChild: await prisma.leadChild.count({ where: { id: { in: LEAD_CHILD_IDS } } }),
    Student: await prisma.student.count({ where: { studentCode: { in: STUDENT_CODES } } }),
    Enrollment: await prisma.enrollment.count({ where: { id: { in: ENROLLMENT_IDS } } }),
    Class: await prisma.class.count({ where: { id: CLASS_ID } }),
    Order: await prisma.order.count({ where: { code: ORDER_CODE } }),
    Receipt: await prisma.receipt.count({ where: { code: RECEIPT_CODE } }),
    ReportCardCriterion: await prisma.reportCardCriterion.count({ where: { name: { startsWith: '__TEST__' } } }),
  }
  console.log('\n── VERIFY (phải = 0) ──')
  for (const [k, v] of Object.entries(verify)) console.log(`  ${k.padEnd(24)} ${v}  ${v === 0 ? 'OK' : '!! CÒN'}`)

  const after = {
    UserTotal: await prisma.user.count(),
    StudentTotal: await prisma.student.count(),
    LeadTotal: await prisma.lead.count(),
    OrderTotal: await prisma.order.count(),
    PaymentTotal: await prisma.payment.count(),
    ClassTotal: await prisma.class.count(),
    RoleDefTotal: await prisma.roleDef.count(),
  }
  console.log('\n── Tổng bảng (sau xoá) ──')
  for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(24)} ${v}`)
  console.log('\n  (RoleDefTotal phải giữ nguyên — KHÔNG xoá role)\n')
}

function orNone(arr: string[]): string[] {
  return arr.length ? arr : ['__none__']
}

main()
  .catch((e) => {
    console.error('LỖI:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
