export interface SelectedUrl {
  url: string
  index: number
}

export function selectPending(urls: string[], pending?: boolean[]): SelectedUrl[] {
  return urls
    .map((url, index) => ({ url, index }))
    .filter(({ index }) => !pending || pending[index])
}

export function emptyScatter<T>(urls: string[]): Array<T | null> {
  return urls.map(() => null)
}

export function hasAny<T>(items: Array<T | null>): boolean {
  return items.some(Boolean)
}
