// lib/actions/define.ts — R6-D1: binding Next cho action factory.
// Tách khỏi factory.ts để runAction() (lõi thuần) test được trong node context
// mà không kéo theo next-auth/next-cache.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { runAction, actionFail, type ActionConfig, type ActionResult } from "@/lib/actions/factory";

/**
 * Bọc ActionConfig thành Server Action. Trả về `(input, opts?) => ActionResult`.
 * `opts.reason` cho action yêu cầu lý do (đổi cấu hình/tiền).
 */
export function defineAction<I, T>(cfg: ActionConfig<I, T>) {
  return async function action(
    rawInput: unknown,
    opts?: { reason?: string },
  ): Promise<ActionResult<T>> {
    const session = await auth();
    if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
    const actor = await resolveActor(session.user.id);
    const actorName = session.user.name ?? session.user.email ?? session.user.id;
    const { res, paths } = await runAction(cfg, actor, rawInput, {
      actorName,
      reason: opts?.reason,
    });
    if (res.ok) for (const p of paths) revalidatePath(p);
    return res;
  };
}
