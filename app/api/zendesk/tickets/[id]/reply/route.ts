import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const email = process.env.ZENDESK_EMAIL
  const token = process.env.ZENDESK_API_TOKEN
  const sub   = process.env.ZENDESK_SUBDOMAIN
  if (!email || !token || !sub) return NextResponse.json({ error: 'Missing ZenDesk credentials.' }, { status: 500 })

  const credentials = Buffer.from(`${email}/token:${token}`).toString('base64')
  const headers = { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }
  const { body, isPublic } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Reply body is required.' }, { status: 400 })

  try {
    const res = await fetch(`https://${sub}.zendesk.com/api/v2/tickets/${id}.json`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ticket: { comment: { body: body.trim(), public: isPublic ?? true } } }),
    })
    if (!res.ok) return NextResponse.json({ error: `ZenDesk returned ${res.status}` }, { status: res.status })
    const data = await res.json()
    return NextResponse.json({ ticket: data.ticket })
  } catch (err) {
    console.error('ZenDesk reply failed:', err)
    return NextResponse.json({ error: 'Failed to post reply' }, { status: 500 })
  }
}
