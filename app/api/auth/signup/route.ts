import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signupSchema } from '@/lib/validators/auth'

export async function POST(request: Request) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const { email, password, name } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  })

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status ?? 400 }
    )
  }

  return NextResponse.json(
    {
      user: { id: data.user?.id, email: data.user?.email },
      access_token: data.session?.access_token ?? null,
      message: data.session ? 'Signed up' : 'Check your email to confirm your account',
    },
    { status: 201 }
  )
}