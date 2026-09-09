import { NextResponse } from 'next/server';
import { isNeonConfigured } from '../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    isNeon: isNeonConfigured(),
    timestamp: new Date().toISOString(),
  });
}
