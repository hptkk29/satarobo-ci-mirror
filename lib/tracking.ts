import { createHash } from 'crypto'
import { canonicalPhone } from '@/lib/phone'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetaCapiUserData {
  phone?: string | null
  email?: string | null
  fbp?: string | null
  fbc?: string | null
  clientIpAddress?: string
  clientUserAgent?: string
}

interface MetaCapiEvent {
  eventName: string
  eventId?: string | null
  eventSourceUrl?: string | null
  userData?: MetaCapiUserData
  customData?: Record<string, string | number | null | undefined>
}

interface Ga4Event {
  clientId?: string | null
  eventName: string
  params?: Record<string, string | number | null | undefined>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

// AUTH-SĐT P1 — Meta CAPI đòi E.164 không dấu `+`, tức đúng canonical `84…` của
// repo. Chuẩn hoá sai ⇒ hash sai ⇒ Meta không match được người dùng, và lỗi này
// hoàn toàn câm: API vẫn trả 200, chỉ có tỉ lệ match tụt dần.
const toCapiPhone = (phone: string) => canonicalPhone(phone) ?? phone.replace(/\D/g, '')

// ─── Meta Conversions API ─────────────────────────────────────────────────────

export async function sendMetaCapi(event: MetaCapiEvent): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN

  if (!pixelId || !token) return

  const ud = event.userData ?? {}

  const userData: Record<string, string | string[]> = {
    client_ip_address: ud.clientIpAddress ?? '',
    client_user_agent: ud.clientUserAgent ?? '',
  }

  if (ud.fbp) userData.fbp = ud.fbp
  if (ud.fbc) userData.fbc = ud.fbc
  if (ud.phone) userData.ph = sha256(toCapiPhone(ud.phone))
  if (ud.email) userData.em = sha256(ud.email)

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId ?? undefined,
        event_source_url: event.eventSourceUrl ?? undefined,
        action_source: 'website',
        user_data: userData,
        custom_data: event.customData ?? {},
      },
    ],
  }

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[CAPI error]', res.status, text)
  }
}

// ─── GA4 Measurement Protocol ─────────────────────────────────────────────────

export async function sendGa4Event(event: Ga4Event): Promise<void> {
  const measurementId = process.env.NEXT_PUBLIC_GA4_ID
  const apiSecret = process.env.GA4_API_SECRET

  if (!measurementId || !apiSecret) return

  // GA4 MP requires a client_id — fallback to a random ID
  const clientId = event.clientId ?? `server-${Date.now()}`

  const payload = {
    client_id: clientId,
    events: [
      {
        name: event.eventName,
        params: event.params ?? {},
      },
    ],
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // GA4 MP returns 204 on success
  if (!res.ok && res.status !== 204) {
    console.error('[GA4 MP error]', res.status)
  }
}
