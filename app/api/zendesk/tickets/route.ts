import { NextResponse } from 'next/server'

export async function GET() {
  const email  = process.env.ZENDESK_EMAIL
  const token  = process.env.ZENDESK_API_TOKEN
  const sub    = process.env.ZENDESK_SUBDOMAIN
  const orgId  = process.env.ZENDESK_ORG_ID

  if (!email || !token || !sub || !orgId) {
    return NextResponse.json({ error: 'Missing ZenDesk credentials — check environment variables.' }, { status: 500 })
  }

  const credentials = Buffer.from(`${email}/token:${token}`).toString('base64')
  const headers = { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }

  try {
    const query = encodeURIComponent(`type:ticket organization_id:${orgId}`)
    const url   = `https://${sub}.zendesk.com/api/v2/search.json?query=${query}&sort_by=created_at&sort_order=desc&per_page=50`
    const res   = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ error: `ZenDesk returned ${res.status}` }, { status: res.status })
    const data = await res.json()
    const tickets = (data.results ?? [])
      .filter((t: { result_type: string }) => t.result_type === 'ticket')
      .map((t: { id: number; subject: string; status: string; priority: string | null; created_at: string; updated_at: string }) => ({
        id: t.id, subject: t.subject, status: t.status,
        priority: t.priority, created_at: t.created_at, updated_at: t.updated_at,
      }))
    return NextResponse.json({ tickets })
  } catch (err) {
    console.error('ZenDesk fetch failed:', err)
    return NextResponse.json({ error: 'Failed to reach ZenDesk' }, { status: 500 })
  }
}
