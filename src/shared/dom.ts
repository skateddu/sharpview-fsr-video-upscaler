/** Element by id, typed by the caller; the pages own their markup, so the element exists. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
