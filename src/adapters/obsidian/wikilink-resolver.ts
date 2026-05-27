import type { MetadataCache } from "obsidian";

export function createWikilinkResolver(
  metadataCache: MetadataCache,
): (target: string, sourcePath: string) => string | null {
  return (target, sourcePath) => {
    const file = metadataCache.getFirstLinkpathDest(target, sourcePath);
    return file === null ? null : file.path;
  };
}
