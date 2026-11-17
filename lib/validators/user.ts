import { z } from 'zod'

// PATCH /api/users/me — only these profile fields may be updated.
export const updateProfileSchema = z
    .object({
        name: z.string().trim().min(1, 'Name is required').max(50).optional(),
        avatarUrl: z.string().url('Invalid avatar URL').nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one field to update',
    })
