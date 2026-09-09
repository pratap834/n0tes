import { NextResponse } from 'next/server';
import { dao } from '../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sections = await dao.getSections();
    return NextResponse.json({ sections });
  } catch (error) {
    console.error('GET /api/sections error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch sections' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Section name is required' }, { status: 400 });
    }
    const section = await dao.createSection(name.trim());
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    console.error('POST /api/sections error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create section' }, { status: 500 });
  }
}
