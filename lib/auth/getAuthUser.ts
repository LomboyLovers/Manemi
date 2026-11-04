import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createClient as createJsClient } from '@supabase/supabase-js'

export async function getAuthUser(request: Request) {
    const bearer = request.headers.get('authorization')

  // Postman / API clients: Authorization: Bearer <access_token>
    if (bearer?.startsWith('Bearer ')) {
    const supabase = createJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: bearer } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    return { user, supabase }
    }

  // Web app: cookie session
const supabase = await createServerSupabase()
const { data: { user } } = await supabase.auth.getUser()
return { user, supabase }
}