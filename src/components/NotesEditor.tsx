import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** An item's notes: markdown with code blocks, checklists and links. */
export function NotesEditor({ value, onChange }: Props) {
  return <MarkdownEditor label="Notes" value={value} onChange={onChange} minHeight={200} />;
}
