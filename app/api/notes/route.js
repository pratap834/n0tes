import { NextResponse } from 'next/server';
import { dao } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get('sectionId');
    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId query parameter is required' }, { status: 400 });
    }
    const notes = await dao.getNotes(sectionId);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error('GET /api/notes error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch notes' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { sectionId, title, content } = body;
    if (!sectionId) {
      return NextResponse.json({ error: 'sectionId is required' }, { status: 400 });
    }
    const note = await dao.createNote(sectionId, title, content);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error('POST /api/notes error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create note' }, { status: 500 });
  }
}
