import { NextResponse } from 'next/server';
import { dao } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { name } = body;
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Section name is required' }, { status: 400 });
    }
    const section = await dao.updateSection(id, name.trim());
    return NextResponse.json({ section });
  } catch (error) {
    console.error(`PATCH /api/sections/${params.id} error:`, error);
    return NextResponse.json({ error: error.message || 'Failed to update section' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = params;
    await dao.deleteSection(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error(`DELETE /api/sections/${params.id} error:`, error);
    return NextResponse.json({ error: error.message || 'Failed to delete section' }, { status: 500 });
  }
}
