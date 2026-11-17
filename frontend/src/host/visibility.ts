// Document-visibility auto-pause (M3 E5): pauses the sim when the tab
// goes hidden; never auto-resumes on visible. Duck-typed so the listener
// wiring is unit-testable without a DOM.

export interface DocumentLike {
  hidden: boolean;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

// Calls `onHidden` each time the document transitions to hidden.
// Returns an uninstaller.
export function installVisibilityPause(doc: DocumentLike, onHidden: () => void): () => void {
  const listener = (): void => {
    if (doc.hidden) {
      onHidden();
    }
  };
  doc.addEventListener('visibilitychange', listener);
  return () => {
    doc.removeEventListener('visibilitychange', listener);
  };
}
