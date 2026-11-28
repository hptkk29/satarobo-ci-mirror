'use server'

import { auth } from '@/lib/auth'
import { resolveActor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import { getAuditActor } from '@/lib/audit/log'
import { thuHoiMoiPhienDiDong } from '@/lib/mobile-api/xac-thuc/thu-hoi-hang-loat'
import type { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
  newPassword: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
  confirmPassword: z.string(),
})

export async function changePassword(formData: FormData): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Chưa đăng nhập' }
  // User ∈ SCOPE_EXEMPT → scopedDb pass-through (#03).
  const sdb = scopedDb(await resolveActor(session.user.id))

  const raw = {
    currentPassword: formData.get('currentPassword') as string,
    newPassword: formData.get('newPassword') as string,
    confirmPassword: formData.get('confirmPassword') as string,
  }

  const parsed = changePasswordSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }

  const { currentPassword, newPassword, confirmPassword } = parsed.data

  if (newPassword !== confirmPassword) return { error: 'Mật khẩu xác nhận không khớp' }

  const user = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })

  if (!user?.password) return { error: 'Tài khoản này không sử dụng mật khẩu' }

  const valid = await bcrypt.compare(currentPassword, user.password)
  if (!valid) return { error: 'Mật khẩu hiện tại không đúng' }

  const hashed = await bcrypt.hash(newPassword, 12)
  // KHÔNG tăng tokenVersion (giữ phiên WEB hiện tại), nhưng thu hồi MỌI phiên di động trong CÙNG giao dịch (B3.5).
  // Thu hồi hỏng ⇒ giao dịch cuộn lại ⇒ mật khẩu KHÔNG đổi và người dùng nhận lỗi (không báo thành công nửa vời).
  const { actorId, actorName } = getAuditActor(session)
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient
      await tx.user.update({ where: { id: session.user.id }, data: { password: hashed } })
      await thuHoiMoiPhienDiDong(tx, session.user.id, 'tai-khoan', { id: actorId, name: actorName }, new Date())
    })
  } catch {
    return { error: 'Không đổi được mật khẩu lúc này. Vui lòng thử lại.' }
  }

  return {}
}
