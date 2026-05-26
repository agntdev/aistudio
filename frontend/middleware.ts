import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/train(.*)',
  '/generate(.*)',
  '/gallery(.*)',
])

// Skip Clerk entirely when a real publishable key isn't configured so
// local dev / demos can run without signing up for Clerk.
const HAS_REAL_CLERK =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.endsWith('placeholder')

export default HAS_REAL_CLERK
  ? clerkMiddleware((auth, req) => {
      if (isProtectedRoute(req)) auth.protect()
    })
  : () => NextResponse.next()

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
