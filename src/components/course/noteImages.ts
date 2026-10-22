import { open } from '@tauri-apps/plugin-dialog';
import { addNoteImageFromPath, addPastedImage } from '../../lib/courses';
import { courseImageRef } from '../../lib/markdown';
import type { ImageSupport } from '../MarkdownEditor';

/** Image support for markdown notes inside a course: pasted or picked images live in its folder. */
export function courseNoteImages(courseId: number): ImageSupport {
  return {
    savePasted: async (blob) => `![screenshot](${courseImageRef(await addPastedImage(courseId, blob))})`,
    pick: async () => {
      const picked = await open({
        multiple: true,
        title: 'Insert images',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      });
      if (!picked) return null;
      const paths = Array.isArray(picked) ? picked : [picked];
      const lines: string[] = [];
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() ?? 'image';
        lines.push(`![${name}](${courseImageRef(await addNoteImageFromPath(courseId, p))})`);
      }
      return lines.join('\n');
    },
  };
}
