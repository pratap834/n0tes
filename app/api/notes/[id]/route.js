import { NextResponse } from 'next/server';
import { dao } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { title, content, sectionId } = body || {};
    
    const note = await dao.updateNote(id, { title, content, sectionId });
    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error(`PATCH /api/notes/${params.id} error:`, error);
    return NextResponse.json({ error: error.message || 'Failed to update note' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params;
    await dao.deleteNote(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error(`DELETE /api/notes/${params.id} error:`, error);
    return NextResponse.json({ error: error.message || 'Failed to delete note' }, { status: 500 });
  }
}
