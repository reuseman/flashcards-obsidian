export interface TextEdit {
  end: number;
  start: number;
  text: string;
}

export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.start - left.start);

  let output = source;
  for (const edit of sorted) {
    if (edit.start > edit.end) {
      throw new Error(`Invalid edit range: ${edit.start} > ${edit.end}`);
    }

    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }

  return output;
}
