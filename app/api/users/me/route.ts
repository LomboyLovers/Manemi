import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth/getAuthUser'
import { updateProfileSchema } from '@/lib/validators/user'

export async function GET(request: Request) {
  const { user, supabase } = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('User')
    .select('userId, userCode, name, email, avatarUrl')
    .eq('userId', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const { user, supabase } = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = updateProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('User')
    .update(parsed.data)
    .eq('userId', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}