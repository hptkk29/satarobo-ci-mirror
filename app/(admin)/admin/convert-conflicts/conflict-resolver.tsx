'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { mergeConflictIntoA, dismissConflict } from './actions'

export function ConflictResolver({
  conflictId,
  parentAName,
}: {
  conflictId: string
  parentAName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')

  function run(fn: typeof mergeConflictIntoA, label: string) {
    startTransition(async () => {
      const res = await fn({ conflictId, note })
      if (res.ok) {
        toast.success(label)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Lỗi xử lý')
      }
    })
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Ghi chú / lý do xử lý</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: cùng một phụ huynh, gộp hồ sơ"
          className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(mergeConflictIntoA, `Đã gộp học viên vào ${parentAName}`)}
          className="rounded-lg bg-state-success-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
        >
          Gộp hồ sơ B → A (giữ hồ sơ email)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(dismissConflict, 'Đã đánh dấu xử lý')}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Đánh dấu đã xử lý (ghi lý do)
        </button>
      </div>
    </div>
  )
}
