import { NextResponse } from 'next/server';
import { dao } from '../../../lib/db';

export const dynamic = 'force-dynamic';

// Beacon endpoint specifically designed for unload/pagehide/visibilitychange auto-save
export async function POST(request) {
  try {
    let body;
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // navigator.sendBeacon often sends as text/plain
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }

    const { id, title, content } = body || {};
    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    const updated = await dao.updateNote(id, { title, content });
    return NextResponse.json({ success: true, note: updated });
  } catch (error) {
    console.error('POST /api/notes/save-beacon error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save note via beacon' }, { status: 500 });
  }
}
