import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const bearer = request.headers.get('authorization')

  // Postman / API clients
  if (bearer?.startsWith('Bearer ')) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: bearer,
      },
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }
    return NextResponse.json({ message: 'Logged out' })
  }

  // Web app (cookie session)
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: 'Logged out' })
}