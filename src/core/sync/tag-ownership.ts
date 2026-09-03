const ANKI_REVIEW_TAGS = new Set(["leech", "marked"]);

function unique(tags: string[]): string[] {
  return [...new Set(tags)];
}

export function desiredAnkiTags(
  sourceTags: string[],
  liveTags: string[],
): string[] {
  const desired = unique(sourceTags);
  const desiredSet = new Set(desired);

  for (const tag of liveTags) {
    if (ANKI_REVIEW_TAGS.has(tag.toLowerCase()) && !desiredSet.has(tag)) {
      desired.push(tag);
      desiredSet.add(tag);
    }
  }

  return desired;
}

export function diffTags(
  liveTags: string[],
  desiredTags: string[],
): { add: string[]; remove: string[] } {
  const live = new Set(liveTags);
  const desired = new Set(desiredTags);
  return {
    add: [...desired].filter((tag) => !live.has(tag)),
    remove: [...live].filter((tag) => !desired.has(tag)),
  };
}

export function sameTagSet(left: string[], right: string[]): boolean {
  const diff = diffTags(left, right);
  return diff.add.length === 0 && diff.remove.length === 0;
}
