export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function arraysEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  a.sort();
  b.sort();

  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function escapeMarkdown(string: string, skips: string[] = []) {
  const replacements: any = [
    // [/\*/g, "\\*", "asterisks"],
    [/#/g, "#", "number signs"],
    // [/\//g, "\\/", "slashes"],
    [/\\/g, "\\\\", "backslash"],
    [/\(/g, "\\(", "parentheses"],
    [/\)/g, "\\)", "parentheses"],
    [/\[/g, "\\[", "square brackets"],
    [/\]/g, "\\]", "square brackets"],
    [/</g, "&lt;", "angle brackets"],
    [/>/g, "&gt;", "angle brackets"],
    [/_/g, "\\_", "underscores"],
  ];

  return replacements.reduce(function (s: string, replacement: any) {
    const name = replacement[2];
    return name && skips.indexOf(name) !== -1
      ? s
      : s.replace(replacement[0], replacement[1]);
  }, string);
}


  export function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
  }

export function substituteSep(str: string): string {
  return str.replace("/", "__")
}
