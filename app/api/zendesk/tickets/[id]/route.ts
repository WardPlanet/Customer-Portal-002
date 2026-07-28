import { NextResponse } from 'next/server'

function authHeaders() {
  const email = process.env.ZENDESK_EMAIL
  const token = process.env.ZENDESK_API_TOKEN
  const sub   = process.env.ZENDESK_SUBDOMAIN
  if (!email || !token || !sub) return null
  return {
    Authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString('base64')}`,
    'Content-Type': 'application/json',
    _sub: sub,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const h = authHeaders()
  if (!h) return NextResponse.json({ error: 'Missing ZenDesk credentials.' }, { status: 500 })
  const { _sub, ...headers } = h
  const base = `https://${_sub}.zendesk.com/api/v2`

  try {
    const [ticketRes, commentsRes] = await Promise.all([
      fetch(`${base}/tickets/${id}.json`, { headers, cache: 'no-store' }),
      fetch(`${base}/tickets/${id}/comments.json?include=users`, { headers, cache: 'no-store' }),
    ])
    if (!ticketRes.ok || !commentsRes.ok)
      return NextResponse.json({ error: 'Failed to fetch ticket data.' }, { status: 500 })

    const { ticket } = await ticketRes.json()
    const { comments, users } = await commentsRes.json()
    const publicComments = (comments as { public: boolean }[]).filter(c => c.public === true)
    const userNames: Record<number, string> = {}
    ;(users as { id: number; name: string }[] ?? []).forEach(u => { userNames[u.id] = u.name })

    return NextResponse.json({ ticket, comments: publicComments, userNames })
  } catch (err) {
    console.error('ZenDesk ticket fetch failed:', err)
    return NextResponse.json({ error: 'Failed to reach ZenDesk' }, { status: 500 })
  }
}
