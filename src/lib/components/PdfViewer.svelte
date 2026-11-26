<script lang="ts">
  import { onMount } from 'svelte';
  import ThumbnailSidebar from '$lib/components/ThumbnailSidebar.svelte';
  import PdfContinuousViewer from '$lib/components/PdfContinuousViewer.svelte';
  import { createPdfDocumentTask, createPdfTextLayerTask } from '$lib/pdf/pdfjs-client';
  import type { PdfDocument, PdfDocumentTask, PdfPage, PdfRenderTask, PdfTextLayerTask } from '$lib/pdf/pdfjs-client';
  import { clampPageNumber, clampZoom } from '$lib/pdf/viewer-utils';
  import { findTextMatches, type PdfTextMatch } from '$lib/pdf/pdf-search';
  import {
    AnnotationHistory,
    type NormalizedPoint,
    type NormalizedRect,
    type PdfAnnotation,
    type PdfHighlightAnnotation,
    type PdfTextNoteAnnotation
  } from '$lib/annotations/annotations';
  import {
    normalizedPointToViewport,
    normalizedRectToViewport,
    viewportPointToNormalized,
    viewportRectToNormalized,
    type PdfViewportTransform
  } from '$lib/annotations/annotation-geometry';
  import { exportAnnotatedPdf } from '$lib/pdf/export-annotations';
  import {
    createAnnotationDraftKey,
    deleteAnnotationDraft,
    loadAnnotationDraft,
    saveAnnotationDraft,
    type AnnotationDraft
  } from '$lib/annotations/annotation-drafts';

  export let file: File;
  export let onClose: () => void;

  const MAX_CANVAS_PIXELS = 16_000_000;

  let pdfDocument: PdfDocument | null = null;
  let loadingTask: PdfDocumentTask | null = null;
  let renderTask: PdfRenderTask | null = null;
  let textLayerTask: PdfTextLayerTask | null = null;
  let canvasElement: HTMLCanvasElement;
  let textLayerElement: HTMLDivElement;
  let viewerViewport: HTMLDivElement;
  let continuousViewer: PdfContinuousViewer;
  let continuousMode = true;
  let resizeObserver: ResizeObserver | undefined;
  let renderSequence = 0;
  let lastViewportWidth = 0;
  let destroyed = false;
  let fitToWidth = true;
  let isInfoOpen = false;
  let documentInfo = {
    title: '',
    author: '',
    subject: '',
    creator: '',
    producer: '',
    pdfVersion: ''
  };
  let isMobileViewport = false;
  let thumbnailsOpen = true;
  let isLoading = true;
  let isRendering = false;
  let currentPage = 1;
  let targetPage = 1;
  let totalPages = 0;
  let zoom = 1;
  let statusText = 'Preparing your document…';
  let errorMessage = '';
  let searchQuery = '';
  let searchResults: PdfTextMatch[] = [];
  let isSearching = false;
  let searchError = '';
  let searchSequence = 0;

  let annotationHistory = new AnnotationHistory();
  let annotations: PdfAnnotation[] = [];
  let annotationDraftKey: string | null = null;
  let availableAnnotationDraft: AnnotationDraft | null = null;
  let saveAnnotationDrafts = false;
  let isCheckingAnnotationDraft = false;
  let annotationDraftStatus = 'Local draft recovery is off. Enable it to save annotations on this device.';
  let draftSaveQueue: Promise<void> = Promise.resolve();
  let draftSaveSequence = 0;
  let draftLookupSequence = 0;
  let visibleAnnotations: PdfAnnotation[] = [];
  let selectedAnnotationId: string | null = null;
  let pendingHighlightRects: NormalizedRect[] = [];
  let isAddingNote = false;
  let drawingTool: 'rectangle' | 'arrow' | 'freehand' | null = null;
  let drawingStart: { pointerId: number; tool: 'rectangle' | 'arrow' | 'freehand'; point: NormalizedPoint; points: NormalizedPoint[] } | null = null;
  let drawingPreviewEnd: NormalizedPoint | null = null;
  let editingNoteId: string | null = null;
  let newNoteId: string | null = null;
  let noteDraft = '';
  let noteError = '';
  let canUndoAnnotations = false;
  let canRedoAnnotations = false;
  let isExportingAnnotations = false;
  let unrotatedPageViewport: PdfViewportTransform | null = null;
  let renderedPageViewport: PdfViewportTransform | null = null;
  let dragState: {
    annotation: PdfAnnotation;
    pointerId: number;
    startPoint: NormalizedPoint;
    startClientX: number;
    startClientY: number;
    hasMoved: boolean;
  } | null = null;
  let dragPreview: PdfAnnotation | null = null;
  let suppressAnnotationClick = false;

  $: visibleAnnotations = annotations.filter((annotation) => annotation.pageNumber === currentPage);

  onMount(() => {
    const mobileViewport = window.matchMedia('(max-width: 760px)');
    const syncViewportMode = () => {
      isMobileViewport = mobileViewport.matches;
      thumbnailsOpen = !isMobileViewport;
    };
    syncViewportMode();
    mobileViewport.addEventListener('change', syncViewportMode);

    const loadDocument = async () => {
      try {
        loadingTask = await createPdfDocumentTask(file);
        if (destroyed) {
          await loadingTask.destroy();
          return;
        }

        pdfDocument = await loadingTask.promise;
        // The component may have been closed while PDF.js was resolving the document.
        // Its loading task is destroyed by onMount cleanup; do not update stale UI.
        if (destroyed) return;
        totalPages = pdfDocument.numPages;
        void inspectLocalAnnotationDraft();

        try {
          const metadata = await pdfDocument.getMetadata();
          if (!destroyed) {
            const info = metadata.info as unknown as Record<string, unknown>;
            const textValue = (key: string) =>
              typeof info[key] === 'string' ? (info[key] as string).trim() : '';
            documentInfo = {
              title: textValue('Title'),
              author: textValue('Author'),
              subject: textValue('Subject'),
              creator: textValue('Creator'),
              producer: textValue('Producer'),
              pdfVersion: textValue('PDFFormatVersion')
            };
          }
        } catch {
          // Metadata is optional; a document that renders should still open if its info
          // dictionary or XMP metadata cannot be read.
        }

        if (destroyed) return;
        if (continuousMode) {
          await fitContinuousToWidth();
          currentPage = 1;
          targetPage = 1;
        }
        isLoading = false;
        statusText = continuousMode
          ? `Page 1 of ${totalPages} · ${Math.round(zoom * 100)}% · Scroll to read`
          : `${totalPages} ${totalPages === 1 ? 'page' : 'pages'} loaded`;
        if (!continuousMode) await renderPage(1, true);
      } catch {
        if (destroyed) return;
        isLoading = false;
        errorMessage = 'This PDF could not be opened. It may be damaged, unsupported, or password-protected.';
        statusText = 'Unable to open document';
      }
    };

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width && Math.abs(width - lastViewportWidth) > 1) {
        lastViewportWidth = width;
        if (fitToWidth && pdfDocument && !destroyed) {
          if (continuousMode) void fitContinuousToWidth();
          else void renderPage(targetPage, true);
        }
      }
    });
    if (viewerViewport) resizeObserver.observe(viewerViewport);

    void loadDocument();

    return () => {
      mobileViewport.removeEventListener('change', syncViewportMode);
      destroyed = true;
      renderSequence += 1;
      searchSequence += 1;
      resizeObserver?.disconnect();
      renderTask?.cancel();
      textLayerTask?.cancel();
      textLayerTask = null;
      if (loadingTask) {
        // Destroying the loading task also releases its resolved document and worker.
        // Swallow cleanup rejection because the component is already being removed.
        void loadingTask.destroy().catch(() => undefined);
        loadingTask = null;
      }
      pdfDocument = null;
    };
  });

  async function renderPage(requestedPage: number, recalculateFit = false) {
    const document = pdfDocument;
    if (!document || destroyed) return;

    const sequence = ++renderSequence;
    pendingHighlightRects = [];
    renderedPageViewport = null;
    unrotatedPageViewport = null;
    const previousTextLayerTask = textLayerTask;
    textLayerTask = null;
    previousTextLayerTask?.cancel();
    textLayerElement?.replaceChildren();

    const previousTask = renderTask;
    if (previousTask) {
      previousTask.cancel();
      try {
        await previousTask.promise;
      } catch {
        // A cancelled render rejects by design; the next render owns the canvas.
      }
    }
    if (destroyed || sequence !== renderSequence) return;

    isRendering = true;
    errorMessage = '';
    statusText = 'Rendering page…';
    let activeTask: PdfRenderTask | null = null;
    let pageToCleanup: PdfPage | null = null;

    try {
      const pageNumber = clampPageNumber(requestedPage, totalPages);
      targetPage = pageNumber;
      statusText = `Rendering page ${pageNumber} of ${totalPages}…`;
      const page = await document.getPage(pageNumber);
      pageToCleanup = page;
      if (destroyed || sequence !== renderSequence) {
        return;
      }

      const pageAtDefaultScale = page.getViewport({ scale: 1 });
      if (recalculateFit || fitToWidth) {
        const availableWidth = Math.max(240, (viewerViewport?.clientWidth ?? pageAtDefaultScale.width) - 52);
        zoom = clampZoom(availableWidth / pageAtDefaultScale.width);
      }

      const viewport = page.getViewport({ scale: zoom });
      unrotatedPageViewport = page.getViewport({ scale: 1, rotation: 0 });
      renderedPageViewport = viewport;
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelBudgetScale = Math.sqrt(
        MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)
      );
      const outputScale = Math.min(deviceScale, pixelBudgetScale);
      if (!canvasElement) {
        throw new Error('Canvas rendering is not available in this browser.');
      }

      canvasElement.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvasElement.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvasElement.style.width = `${Math.floor(viewport.width)}px`;
      canvasElement.style.height = `${Math.floor(viewport.height)}px`;
      activeTask = page.render({
        canvas: canvasElement,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      });
      renderTask = activeTask;
      await activeTask.promise;

      if (destroyed || sequence !== renderSequence) return;

      textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
      textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
      const nextTextLayerTask = await createPdfTextLayerTask(page, textLayerElement, viewport);
      if (destroyed || sequence !== renderSequence) {
        nextTextLayerTask.cancel();
        return;
      }

      textLayerTask = nextTextLayerTask;
      try {
        await nextTextLayerTask.promise;
      } catch (textLayerError) {
        if (destroyed || sequence !== renderSequence) return;
        throw textLayerError;
      }
      if (textLayerTask === nextTextLayerTask) textLayerTask = null;

      if (!destroyed && sequence === renderSequence) {
        currentPage = pageNumber;
        targetPage = pageNumber;
        statusText = `Page ${currentPage} of ${totalPages} · ${Math.round(zoom * 100)}%`;
      }
    } catch (error) {
      if (!destroyed && sequence === renderSequence) {
        const errorName = error instanceof Error ? error.name : '';
        if (errorName !== 'RenderingCancelledException') {
          errorMessage = 'This page could not be rendered. Try another page or reopen the file.';
          statusText = 'Page rendering failed';
        }
      }
    } finally {
      pageToCleanup?.cleanup();
      if (renderTask === activeTask) renderTask = null;
      if (!destroyed && sequence === renderSequence) isRendering = false;
    }
  }

  function goToPage(pageNumber: number) {
    const nextPage = clampPageNumber(pageNumber, totalPages);
    if (continuousMode) {
      targetPage = nextPage;
      currentPage = nextPage;
      statusText = `Page ${nextPage} of ${totalPages} · ${Math.round(zoom * 100)}% · Scroll to read`;
      continuousViewer?.scrollToPage(nextPage);
      return;
    }
    if (nextPage !== targetPage) {
      if (newNoteId) {
        annotationHistory.remove(newNoteId);
        refreshAnnotationState();
      }
      selectedAnnotationId = null;
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      noteError = '';
      isAddingNote = false;
      pendingHighlightRects = [];
      drawingTool = null;
      drawingStart = null;
    }
    targetPage = nextPage;
    void renderPage(targetPage);
  }

  function selectThumbnailPage(pageNumber: number) {
    goToPage(pageNumber);
    if (isMobileViewport) thumbnailsOpen = false;
  }

  function openPdfForPrinting() {
    if (isLoading || destroyed) return;

    const pdfUrl = URL.createObjectURL(file);
    const printWindow = window.open(pdfUrl, '_blank');
    if (!printWindow) {
      URL.revokeObjectURL(pdfUrl);
      statusText = 'The browser blocked the print tab. Allow pop-ups and try again.';
      return;
    }

    // Prevent the newly opened PDF tab from retaining a reference to the app.
    printWindow.opener = null;
    statusText = 'Opened the original PDF in a new tab. Use the browser’s Print control.';
    // Keep the Blob URL alive long enough for the browser PDF viewer to load and print.
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60 * 1000);
  }

  async function fitContinuousToWidth() {
    const document = pdfDocument;
    if (!document || !viewerViewport || destroyed) return;

    try {
      const firstPage = await document.getPage(1);
      if (destroyed) return;
      const pageWidth = firstPage.getViewport({ scale: 1 }).width;
      const styles = window.getComputedStyle(viewerViewport);
      const horizontalPadding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      const availableWidth = Math.max(240, viewerViewport.clientWidth - horizontalPadding - 12);
      zoom = clampZoom(availableWidth / pageWidth);
    } catch {
      // Keep the current zoom if the first page cannot be measured.
    }
  }

  function handleContinuousPageChange(pageNumber: number) {
    if (pageNumber < 1 || pageNumber > totalPages || destroyed) return;
    if (currentPage === pageNumber) return;
    currentPage = pageNumber;
    targetPage = pageNumber;
    statusText = `Page ${currentPage} of ${totalPages} · ${Math.round(zoom * 100)}% · Scroll to read`;
  }

  function toggleViewerMode() {
    if (continuousMode) {
      continuousMode = false;
      isAddingNote = false;
      drawingTool = null;
      drawingStart = null;
      drawingPreviewEnd = null;
      void renderPage(currentPage);
      return;
    }

    continuousMode = true;
    isAddingNote = false;
    drawingTool = null;
    drawingStart = null;
    drawingPreviewEnd = null;
    if (fitToWidth) void fitContinuousToWidth();
    statusText = `Page ${currentPage} of ${totalPages} · ${Math.round(zoom * 100)}% · Scroll to read`;
  }

  function changeZoom(amount: number) {
    fitToWidth = false;
    zoom = clampZoom(zoom + amount);
    if (!continuousMode) void renderPage(targetPage);
    else statusText = `Page ${currentPage} of ${totalPages} · ${Math.round(zoom * 100)}% · Scroll to read`;
  }

  function fitPageToWidth() {
    fitToWidth = true;
    if (continuousMode) void fitContinuousToWidth();
    else void renderPage(targetPage, true);
  }

  async function searchDocument() {
    const document = pdfDocument;
    const query = searchQuery.trim();
    const sequence = ++searchSequence;
    searchResults = [];
    searchError = '';

    if (!document || !query || destroyed) {
      isSearching = false;
      return;
    }

    isSearching = true;
    try {
      const results: PdfTextMatch[] = [];
      for (let pageNumber = 1; pageNumber <= totalPages && results.length < 100; pageNumber += 1) {
        if (destroyed || sequence !== searchSequence) return;
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ');
        results.push(...findTextMatches(pageText, query, pageNumber, 100 - results.length));
      }

      if (!destroyed && sequence === searchSequence) {
        searchResults = results.slice(0, 100);
        if (searchResults.length === 0) searchError = 'No matches found in this document.';
      }
    } catch {
      if (!destroyed && sequence === searchSequence) searchError = 'Text search could not complete for this document.';
    } finally {
      if (!destroyed && sequence === searchSequence) isSearching = false;
    }
  }

  function clearSearch() {
    searchSequence += 1;
    searchQuery = '';
    searchResults = [];
    searchError = '';
    isSearching = false;
  }

  function createAnnotationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'annotation-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function refreshAnnotationState() {
    annotations = [...annotationHistory.annotations];
    canUndoAnnotations = annotationHistory.canUndo;
    canRedoAnnotations = annotationHistory.canRedo;
    if (selectedAnnotationId && !annotations.some((item) => item.id === selectedAnnotationId)) {
      selectedAnnotationId = null;
    }
    if (
      editingNoteId &&
      !annotations.some((item) => item.id === editingNoteId && item.type === 'text-note')
    ) {
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      noteError = '';
    }
    queueAnnotationDraftSave();
  }

  async function inspectLocalAnnotationDraft() {
    const sequence = ++draftLookupSequence;
    isCheckingAnnotationDraft = true;
    try {
      const key = await createAnnotationDraftKey(file);
      if (destroyed || sequence !== draftLookupSequence) return;
      annotationDraftKey = key;
      const draft = await loadAnnotationDraft(key);
      if (destroyed || sequence !== draftLookupSequence) return;
      availableAnnotationDraft = draft;
      annotationDraftStatus = draft
        ? 'A saved annotation draft is available on this device.'
        : 'Local draft recovery is off. Enable it to save annotations on this device.';
    } catch (error) {
      if (destroyed || sequence !== draftLookupSequence) return;
      annotationDraftStatus = error instanceof Error
        ? error.message
        : 'Local annotation drafts are unavailable in this browser.';
    } finally {
      if (!destroyed && sequence === draftLookupSequence) isCheckingAnnotationDraft = false;
    }
  }

  function queueAnnotationDraftSave() {
    if (!saveAnnotationDrafts || !annotationDraftKey || destroyed || newNoteId) return;
    const sequence = ++draftSaveSequence;
    const snapshot = [...annotationHistory.annotations];
    const key = annotationDraftKey;
    draftSaveQueue = draftSaveQueue.catch(() => undefined).then(async () => {
      if (!saveAnnotationDrafts || destroyed || sequence !== draftSaveSequence) return;
      if (snapshot.length === 0) {
        await deleteAnnotationDraft(key);
        if (!destroyed && sequence === draftSaveSequence) {
          annotationDraftStatus = 'No annotations to save. Draft recovery remains enabled.';
        }
        return;
      }
      annotationDraftStatus = 'Saving annotations on this device…';
      await saveAnnotationDraft({
        key,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        updatedAt: Date.now(),
        annotations: snapshot
      });
      if (!destroyed && sequence === draftSaveSequence) {
        annotationDraftStatus = 'Saved on this device. The PDF itself is not stored.';
      }
    }).catch((error: unknown) => {
      if (!destroyed && sequence === draftSaveSequence) {
        saveAnnotationDrafts = false;
        annotationDraftStatus = error instanceof Error
          ? error.message
          : 'The annotation draft could not be saved on this device.';
      }
    });
  }

  function restoreAvailableAnnotationDraft() {
    if (!availableAnnotationDraft) return;
    if (availableAnnotationDraft.annotations.some((annotation) => annotation.pageNumber > totalPages)) {
      annotationDraftStatus = 'The saved draft does not match this document and was not restored.';
      return;
    }
    try {
      annotationHistory = new AnnotationHistory(availableAnnotationDraft.annotations);
      availableAnnotationDraft = null;
      selectedAnnotationId = null;
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      refreshAnnotationState();
      saveAnnotationDrafts = true;
      annotationDraftStatus = 'Draft restored. Future annotation changes will be saved on this device.';
      queueAnnotationDraftSave();
    } catch {
      annotationDraftStatus = 'The saved annotation draft could not be restored.';
    }
  }

  async function discardAvailableAnnotationDraft() {
    const key = annotationDraftKey;
    availableAnnotationDraft = null;
    saveAnnotationDrafts = false;
    draftSaveSequence += 1;
    await draftSaveQueue.catch(() => undefined);
    try {
      if (key) await deleteAnnotationDraft(key);
      annotationDraftStatus = 'Saved annotation draft discarded from this device.';
    } catch (error) {
      annotationDraftStatus = error instanceof Error
        ? error.message
        : 'The saved annotation draft could not be discarded.';
    }
  }

  async function toggleAnnotationDraftSaving(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    if (enabled) {
      if (!annotationDraftKey || availableAnnotationDraft) return;
      saveAnnotationDrafts = true;
      queueAnnotationDraftSave();
      return;
    }

    saveAnnotationDrafts = false;
    draftSaveSequence += 1;
    await draftSaveQueue.catch(() => undefined);
    try {
      if (annotationDraftKey) await deleteAnnotationDraft(annotationDraftKey);
      annotationDraftStatus = 'Local draft saving is off. The saved draft was removed from this device.';
    } catch (error) {
      annotationDraftStatus = error instanceof Error
        ? error.message
        : 'The saved annotation draft could not be removed.';
    }
  }

  function captureHighlightSelection() {
    if (!textLayerElement || !canvasElement || !renderedPageViewport || !unrotatedPageViewport) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (
      !textLayerElement.contains(range.startContainer) ||
      !textLayerElement.contains(range.endContainer)
    ) {
      return;
    }

    const pageBounds = canvasElement.getBoundingClientRect();
    pendingHighlightRects = Array.from(range.getClientRects())
      .map((rect) =>
        viewportRectToNormalized(
          {
            x: rect.left - pageBounds.left,
            y: rect.top - pageBounds.top,
            width: rect.width,
            height: rect.height
          },
          renderedPageViewport!,
          unrotatedPageViewport!
        )
      )
      .filter((rect): rect is NormalizedRect => rect !== null && rect.width > 0 && rect.height > 0);
  }

  function addHighlightFromSelection() {
    if (!pendingHighlightRects.length) return;
    const now = Date.now();
    const annotation: PdfHighlightAnnotation = {
      type: 'highlight',
      id: createAnnotationId(),
      pageNumber: currentPage,
      createdAt: now,
      updatedAt: now,
      color: '#f5c542',
      opacity: 0.38,
      rects: pendingHighlightRects.map((rect) => ({ ...rect }))
    };
    annotationHistory.add(annotation);
    refreshAnnotationState();
    selectedAnnotationId = annotation.id;
    pendingHighlightRects = [];
    window.getSelection()?.removeAllRanges();
  }

  function toggleNotePlacement() {
    isAddingNote = !isAddingNote;
    drawingTool = null;
    drawingStart = null;
    drawingPreviewEnd = null;
  }

  function toggleDrawingTool(tool: 'rectangle' | 'arrow' | 'freehand') {
    drawingTool = drawingTool === tool ? null : tool;
    isAddingNote = false;
    drawingStart = null;
    drawingPreviewEnd = null;
  }

  function handlePagePointerDown(event: PointerEvent) {
    if (
      drawingTool &&
      event.button === 0 &&
      canvasElement &&
      renderedPageViewport &&
      unrotatedPageViewport
    ) {
      const bounds = canvasElement.getBoundingClientRect();
      const point = viewportPointToNormalized(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        renderedPageViewport,
        unrotatedPageViewport
      );
      drawingStart = {
        pointerId: event.pointerId,
        tool: drawingTool,
        point,
        points: [point]
      };
      drawingPreviewEnd = point;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Window-level pointer listeners remain as a fallback.
      }
      event.preventDefault();
      return;
    }
    if (
      !isAddingNote ||
      event.button !== 0 ||
      !canvasElement ||
      !renderedPageViewport ||
      !unrotatedPageViewport
    ) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-annotation-id]')) return;

    const pageBounds = canvasElement.getBoundingClientRect();
    const anchor = viewportPointToNormalized(
      { x: event.clientX - pageBounds.left, y: event.clientY - pageBounds.top },
      renderedPageViewport,
      unrotatedPageViewport
    );
    const now = Date.now();
    const note: PdfTextNoteAnnotation = {
      type: 'text-note',
      id: createAnnotationId(),
      pageNumber: currentPage,
      createdAt: now,
      updatedAt: now,
      color: '#2463eb',
      opacity: 1,
      anchor,
      text: ''
    };
    annotationHistory.add(note);
    refreshAnnotationState();
    selectedAnnotationId = note.id;
    editingNoteId = note.id;
    newNoteId = note.id;
    noteDraft = '';
    noteError = '';
    isAddingNote = false;
    drawingTool = null;
    event.preventDefault();
  }

  function saveNote() {
    if (!editingNoteId) return;
    const note = annotations.find(
      (annotation): annotation is PdfTextNoteAnnotation =>
        annotation.id === editingNoteId && annotation.type === 'text-note'
    );
    if (!note) return;
    if (!noteDraft.trim()) {
      noteError = 'Enter note text before saving.';
      return;
    }

    annotationHistory.update({
      ...note,
      text: noteDraft.trim(),
      updatedAt: Math.max(Date.now(), note.createdAt)
    });
    refreshAnnotationState();
    newNoteId = null;
    editingNoteId = null;
    noteError = '';
    queueAnnotationDraftSave();
  }

  function cancelNoteEditing() {
    if (newNoteId) {
      annotationHistory.remove(newNoteId);
      refreshAnnotationState();
      selectedAnnotationId = null;
    }
    newNoteId = null;
    editingNoteId = null;
    noteDraft = '';
    noteError = '';
    queueAnnotationDraftSave();
  }

  function selectAnnotation(annotation: PdfAnnotation) {
    if (suppressAnnotationClick) {
      suppressAnnotationClick = false;
      return;
    }
    selectedAnnotationId = annotation.id;
    if (annotation.type === 'text-note') {
      editingNoteId = annotation.id;
      newNoteId = null;
      noteDraft = annotation.text;
      noteError = '';
    } else {
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      noteError = '';
    }
  }

  function deleteSelectedAnnotation() {
    if (!selectedAnnotationId) return;
    annotationHistory.remove(selectedAnnotationId);
    refreshAnnotationState();
    editingNoteId = null;
    newNoteId = null;
    noteDraft = '';
    noteError = '';
    queueAnnotationDraftSave();
  }

  function undoAnnotation() {
    if (annotationHistory.undo()) {
      refreshAnnotationState();
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      noteError = '';
    }
    queueAnnotationDraftSave();
  }

  function redoAnnotation() {
    if (annotationHistory.redo()) {
      refreshAnnotationState();
      editingNoteId = null;
      newNoteId = null;
      noteDraft = '';
      noteError = '';
    }
    queueAnnotationDraftSave();
  }

  function getDisplayedAnnotation(annotation: PdfAnnotation): PdfAnnotation {
    return dragPreview?.id === annotation.id ? dragPreview : annotation;
  }

  function beginAnnotationDrag(event: PointerEvent, annotation: PdfAnnotation) {
    if (
      event.button !== 0 ||
      !canvasElement ||
      !renderedPageViewport ||
      !unrotatedPageViewport
    ) return;
    // Existing annotations should be moved/selected, not treated as new drawing gestures.
    event.stopPropagation();
    const pageBounds = canvasElement.getBoundingClientRect();
    const startPoint = viewportPointToNormalized(
      { x: event.clientX - pageBounds.left, y: event.clientY - pageBounds.top },
      renderedPageViewport,
      unrotatedPageViewport
    );
    dragState = {
      annotation,
      pointerId: event.pointerId,
      startPoint,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasMoved: false
    };
    dragPreview = annotation;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer listeners still handle browsers without capture support.
    }
  }

  function moveAnnotationDrag(event: PointerEvent) {
    if (
      drawingStart &&
      drawingStart.pointerId === event.pointerId &&
      canvasElement &&
      renderedPageViewport &&
      unrotatedPageViewport
    ) {
      const bounds = canvasElement.getBoundingClientRect();
      const point = viewportPointToNormalized(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        renderedPageViewport,
        unrotatedPageViewport
      );
      drawingPreviewEnd = point;
      if (drawingStart.tool === 'freehand') {
        const last = drawingStart.points[drawingStart.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.001 && drawingStart.points.length < 10_000) {
          drawingStart.points = [...drawingStart.points, point];
        }
      }
      return;
    }

    if (
      !dragState ||
      dragState.pointerId !== event.pointerId ||
      !canvasElement ||
      !renderedPageViewport ||
      !unrotatedPageViewport
    ) return;
    const distance = Math.hypot(
      event.clientX - dragState.startClientX,
      event.clientY - dragState.startClientY
    );
    if (distance < 3) return;

    const pageBounds = canvasElement.getBoundingClientRect();
    const nextPoint = viewportPointToNormalized(
      { x: event.clientX - pageBounds.left, y: event.clientY - pageBounds.top },
      renderedPageViewport,
      unrotatedPageViewport
    );
    const dx = nextPoint.x - dragState.startPoint.x;
    const dy = nextPoint.y - dragState.startPoint.y;
    const original = dragState.annotation;
    let preview: PdfAnnotation;

    if (original.type === 'text-note') {
      preview = {
        ...original,
        anchor: {
          x: Math.max(0, Math.min(1, original.anchor.x + dx)),
          y: Math.max(0, Math.min(1, original.anchor.y + dy))
        }
      };
    } else if (original.type === 'highlight') {
      const minX = Math.min(...original.rects.map((rect) => rect.x));
      const minY = Math.min(...original.rects.map((rect) => rect.y));
      const maxX = Math.max(...original.rects.map((rect) => rect.x + rect.width));
      const maxY = Math.max(...original.rects.map((rect) => rect.y + rect.height));
      const boundedX = Math.max(-minX, Math.min(1 - maxX, dx));
      const boundedY = Math.max(-minY, Math.min(1 - maxY, dy));
      preview = {
        ...original,
        rects: original.rects.map((rect) => ({
          ...rect,
          x: rect.x + boundedX,
          y: rect.y + boundedY
        }))
      };
    } else if (original.type === 'rectangle') {
      const boundedX = Math.max(
        -original.rect.x,
        Math.min(1 - original.rect.x - original.rect.width, dx)
      );
      const boundedY = Math.max(
        -original.rect.y,
        Math.min(1 - original.rect.y - original.rect.height, dy)
      );
      preview = {
        ...original,
        rect: {
          ...original.rect,
          x: original.rect.x + boundedX,
          y: original.rect.y + boundedY
        }
      };
    } else if (original.type === 'arrow') {
      const minX = Math.min(original.start.x, original.end.x);
      const minY = Math.min(original.start.y, original.end.y);
      const maxX = Math.max(original.start.x, original.end.x);
      const maxY = Math.max(original.start.y, original.end.y);
      const boundedX = Math.max(-minX, Math.min(1 - maxX, dx));
      const boundedY = Math.max(-minY, Math.min(1 - maxY, dy));
      preview = {
        ...original,
        start: {
          x: original.start.x + boundedX,
          y: original.start.y + boundedY
        },
        end: {
          x: original.end.x + boundedX,
          y: original.end.y + boundedY
        }
      };
    } else {
      return;
    }

    dragState = { ...dragState, hasMoved: true };
    dragPreview = preview;
  }

  function finishAnnotationDrag(event: PointerEvent) {
    if (drawingStart && drawingStart.pointerId === event.pointerId) {
      const start = drawingStart;
      drawingStart = null;
      drawingPreviewEnd = null;
      if (!canvasElement || !renderedPageViewport || !unrotatedPageViewport) return;
      const bounds = canvasElement.getBoundingClientRect();
      const end = viewportPointToNormalized(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        renderedPageViewport,
        unrotatedPageViewport
      );
      const now = Date.now();
      if (Math.hypot(end.x - start.point.x, end.y - start.point.y) < 0.006) return;
      const base = {
        id: createAnnotationId(),
        pageNumber: currentPage,
        createdAt: now,
        updatedAt: now,
        color: '#2463eb',
        opacity: 1
      };
      if (start.tool === 'freehand') {
        const points = [...start.points];
        if (points.length < 2) points.push(end);
        if (points.length < 2) return;
        annotationHistory.add({
          ...base,
          type: 'freehand',
          points,
          strokeWidth: 0.004
        });
      } else if (start.tool === 'rectangle') {
        const x = Math.min(start.point.x, end.x);
        const y = Math.min(start.point.y, end.y);
        const width = Math.abs(end.x - start.point.x);
        const height = Math.abs(end.y - start.point.y);
        if (width <= 0 || height <= 0) return;
        annotationHistory.add({
          ...base,
          type: 'rectangle',
          rect: { x, y, width, height },
          strokeWidth: 0.003,
          fillOpacity: 0.08
        });
      } else {
        annotationHistory.add({
          ...base,
          type: 'arrow',
          start: start.point,
          end,
          strokeWidth: 0.003
        });
      }
      refreshAnnotationState();
      selectedAnnotationId = base.id;
      drawingTool = null;
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.hasMoved && dragPreview) {
      annotationHistory.update({
        ...dragPreview,
        updatedAt: Math.max(Date.now(), dragPreview.createdAt)
      });
      refreshAnnotationState();
      selectedAnnotationId = dragPreview.id;
      suppressAnnotationClick = true;
    }
    dragState = null;
    dragPreview = null;
  }

  function cancelAnnotationDrag(event: PointerEvent) {
    if (drawingStart?.pointerId === event.pointerId) {
      drawingStart = null;
      drawingPreviewEnd = null;
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    dragPreview = null;
  }

  async function exportAnnotations() {
    if (isExportingAnnotations || isLoading || annotations.length === 0) return;
    if (editingNoteId || newNoteId) {
      statusText = 'Save or cancel the open note before exporting annotations.';
      return;
    }

    isExportingAnnotations = true;
    errorMessage = '';
    statusText = 'Adding annotations to a new PDF copy…';
    try {
      const bytes = await exportAnnotatedPdf(file, annotations);
      if (destroyed) return;
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const baseName = file.name.replace(/\.pdf$/i, '') || 'document';
      anchor.href = url;
      anchor.download = baseName + '-annotated.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      statusText = 'Exported ' + annotations.length + ' annotation(s) to a new PDF. The original is unchanged.';
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The annotated PDF could not be exported. Try a smaller or different document.';
      statusText = 'Annotation export failed';
    } finally {
      isExportingAnnotations = false;
    }
  }

  function formatFileSize(size: number) {
    if (size < 1_048_576) return `${Math.max(1, Math.round(size / 1_024))} KB`;
    return `${(size / 1_048_576).toFixed(2)} MB`;
  }
</script>

<svelte:head>
  <title>{file.name} — PDF Utils</title>
</svelte:head>
<svelte:window
  onmouseup={captureHighlightSelection}
  onkeyup={captureHighlightSelection}
  onpointermove={moveAnnotationDrag}
  onpointerup={finishAnnotationDrag}
  onpointercancel={cancelAnnotationDrag}
/>

<section class="mx-auto my-7 mb-10 flex min-h-[min(78vh,900px)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_34px_rgb(29_35_51_/_0.05)] max-[760px]:my-[18px] max-[760px]:mb-[30px] max-[760px]:min-h-[74vh]" aria-label="PDF viewer">
  <header class="flex min-h-[76px] items-center justify-between gap-[18px] border-b border-[#e9ebf0] bg-white px-[18px] py-3 max-[760px]:flex-wrap max-[760px]:gap-3 max-[760px]:p-3 max-[420px]:p-[10px]">
    <div class="flex min-w-0 items-center gap-[11px] max-[760px]:basis-[calc(100%-100px)]">
      <span class="grid size-[42px] shrink-0 place-items-center rounded-lg border border-brand-200 bg-brand-50 text-[9px] font-extrabold tracking-[.3px] text-brand-600" aria-hidden="true">PDF</span>
      <div class="flex min-w-0 flex-col gap-1">
        <strong class="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-[#292d38] max-[760px]:max-w-[min(58vw,360px)]" title={file.name}>{file.name}</strong>
        <span class="text-[10px] text-subtle">{formatFileSize(file.size)} · {totalPages > 0 ? `${totalPages} pages` : 'Local document'}</span>
      </div>
    </div>

    <div class="flex items-center justify-center gap-[14px] max-[760px]:order-3 max-[760px]:w-full max-[760px]:flex-wrap max-[760px]:justify-between max-[760px]:gap-x-2 max-[760px]:gap-y-2 max-[760px]:border-t max-[760px]:border-[#f0f1f4] max-[760px]:pt-[10px]" aria-label="PDF controls">
      <button
      type="button"
      class="hidden min-h-[34px] items-center justify-center rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 max-[760px]:inline-flex"
      aria-label={thumbnailsOpen ? 'Hide pages' : 'Show pages'}
      aria-expanded={thumbnailsOpen}
      aria-controls="pdf-thumbnails"
      onclick={() => (thumbnailsOpen = !thumbnailsOpen)}
    >
      {thumbnailsOpen ? 'Hide pages' : 'Show pages'}
    </button>
    <div class="flex items-center gap-[7px] max-[420px]:gap-[3px]" aria-label="Page navigation">
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Previous page" title="Previous page" disabled={isLoading || targetPage <= 1} onclick={() => goToPage(targetPage - 1)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
        </button>
        <span class="flex min-w-[52px] items-center justify-center gap-1.5 text-[11px] text-[#7c8290]"><strong class="font-semibold text-[#303541] [font-variant-numeric:tabular-nums]">{totalPages ? currentPage : '—'}</strong><span>/</span>{totalPages || '—'}</span>
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Next page" title="Next page" disabled={isLoading || targetPage >= totalPages} onclick={() => goToPage(targetPage + 1)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
        </button>
      </div>

      <span class="h-6 w-px bg-[#e7e9ee] max-[760px]:hidden" aria-hidden="true"></span>

      <div class="flex items-center gap-[7px] max-[420px]:gap-[3px] max-[760px]:w-full max-[760px]:justify-end">
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Zoom out" title="Zoom out" disabled={isLoading || zoom <= 0.5} onclick={() => changeZoom(-0.25)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <span class="min-w-[43px] text-center text-[10px] text-[#6d7380] [font-variant-numeric:tabular-nums]" aria-live="off">{Math.round(zoom * 100)}%</span>
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Zoom in" title="Zoom in" disabled={isLoading || zoom >= 3} onclick={() => changeZoom(0.25)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" class={`inline-flex min-h-[30px] items-center justify-center rounded-lg border border-line bg-white px-[9px] text-[10px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf] max-[420px]:px-[7px] ${fitToWidth ? "border-brand-200 bg-brand-50 text-brand-600" : ""}` } aria-pressed={fitToWidth} disabled={isLoading} onclick={fitPageToWidth}>Fit width</button>
        <button type="button" class="inline-flex min-h-[30px] items-center justify-center rounded-lg border border-line bg-white px-[9px] text-[10px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label={continuousMode ? 'Switch to page tools' : 'Switch to continuous scroll'} disabled={isLoading} onclick={toggleViewerMode}>{continuousMode ? 'Page tools' : 'Scroll view'}</button>
      </div>
    </div>

    <button
      type="button"
      class="inline-flex min-h-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]"
      aria-label="Open PDF for printing"
      title="Open the original PDF in a new tab to print"
      disabled={isLoading}
      onclick={openPdfForPrinting}
    >Print</button>
    <button
      type="button"
      class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]"
      aria-label="Document info"
      aria-expanded={isInfoOpen}
      aria-controls="pdf-document-info"
      onclick={() => (isInfoOpen = !isInfoOpen)}
    >Info</button>
    <button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf] max-[760px]:ml-auto max-[420px]:min-h-8" aria-label="Close document" disabled={isExportingAnnotations} onclick={onClose}>
      <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      <span>Close</span>
    </button>
  </header>

  {#if isInfoOpen}
    <section
      id="pdf-document-info"
      class="border-b border-[#e9ebf0] bg-[#fbfbfd] px-4 py-4 max-[480px]:px-[10px]"
      aria-label="Document information"
      role="region"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="m-0 text-[12px] font-bold text-[#343946]">Document information</h2>
        <span class="text-[10px] text-subtle">Read locally from this PDF</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 max-[480px]:gap-x-3">
        <div class="min-w-0">
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">File name</dt>
          <dd class="m-0 overflow-hidden text-ellipsis text-[11px] text-[#3e4450]" title={file.name}>{file.name}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">File size</dt>
          <dd class="m-0 text-[11px] text-[#3e4450]">{formatFileSize(file.size)}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Pages</dt>
          <dd class="m-0 text-[11px] text-[#3e4450]">{totalPages}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">PDF version</dt>
          <dd class="m-0 text-[11px] text-[#3e4450]">{documentInfo.pdfVersion || 'Not available'}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Title</dt>
          <dd class="m-0 break-words text-[11px] text-[#3e4450]">{documentInfo.title || 'Not specified'}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Author</dt>
          <dd class="m-0 break-words text-[11px] text-[#3e4450]">{documentInfo.author || 'Not specified'}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Subject</dt>
          <dd class="m-0 break-words text-[11px] text-[#3e4450]">{documentInfo.subject || 'Not specified'}</dd>
        </div>
        <div>
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Creator</dt>
          <dd class="m-0 break-words text-[11px] text-[#3e4450]">{documentInfo.creator || 'Not specified'}</dd>
        </div>
        <div class="col-span-2 max-[480px]:col-span-2">
          <dt class="mb-1 text-[9px] font-semibold uppercase tracking-[.08em] text-subtle">Producer</dt>
          <dd class="m-0 break-words text-[11px] text-[#3e4450]">{documentInfo.producer || 'Not specified'}</dd>
        </div>
      </dl>
    </section>
  {/if}
  <form class="flex flex-wrap items-center gap-[9px] border-b border-[#e9ebf0] bg-white px-4 py-3 max-[480px]:p-[10px]" onsubmit={(event) => { event.preventDefault(); void searchDocument(); }}>
    <label class="text-[11px] font-bold text-[#535a68] max-[480px]:w-full" for="pdf-search-input">Find in document</label>
    <div class="flex min-w-[min(100%,260px)] flex-1 items-center gap-[7px] max-[480px]:min-w-0">
      <input class="h-[34px] min-w-0 flex-1 rounded-lg border border-[#e0e3ea] bg-[#fbfcfe] px-[10px] text-[12px] text-[#303541] outline-none placeholder:text-[#8a909c] focus-visible:border-brand-300 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1 disabled:bg-[#f6f7f9] disabled:text-[#9da2ad]" id="pdf-search-input" type="search" value={searchQuery} placeholder="Search text…" autocomplete="off" disabled={isLoading || !pdfDocument} oninput={(event) => (searchQuery = (event.currentTarget as HTMLInputElement).value)} />
      <button type="submit" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" disabled={isLoading || isSearching || !searchQuery.trim()}>Find</button>
      {#if searchQuery}<button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" onclick={clearSearch} aria-label="Clear search">Clear</button>{/if}
    </div>
  </form>
  {#if continuousMode}
    <div class="border-b border-[#e9ebf0] bg-[#fbfbfd] px-4 py-2 text-[10px] text-subtle max-[480px]:px-[10px]">Continuous reading view · Switch to Page tools to annotate.</div>
  {:else}
  <section class="flex flex-col gap-2 border-b border-[#e9ebf0] bg-[#fbfbfd] px-4 py-3 max-[480px]:px-[10px]" aria-label="Annotation tools">
    <div class="flex flex-wrap items-center gap-2" data-annotation-group="utility" role="group" aria-label="Annotation history actions">
      <span class="mr-1 text-[10px] font-semibold uppercase tracking-[.06em] text-[#858b98]">History</span>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Undo annotation" disabled={!canUndoAnnotations} onclick={undoAnnotation}>Undo</button>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Redo annotation" disabled={!canRedoAnnotations} onclick={redoAnnotation}>Redo</button>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Delete selected annotation" disabled={!selectedAnnotationId} onclick={deleteSelectedAnnotation}>Delete</button>
    </div>

    <div class="flex flex-wrap items-center gap-2" data-annotation-group="primary" role="group" aria-label="Annotation creation tools">
      <span class="mr-1 text-[11px] font-bold text-[#535a68]">Annotate</span>
      <button
        type="button"
        class={"inline-flex min-h-[32px] items-center justify-center rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf] " + (isAddingNote ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-white text-[#454b59] hover:border-brand-300 hover:bg-brand-50')}
        aria-label="Place note"
        aria-pressed={isAddingNote}
        disabled={isLoading}
        onclick={toggleNotePlacement}
      >{isAddingNote ? 'Click on page…' : 'Place note'}</button>
      <button
        type="button"
        class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]"
        aria-label="Highlight selection"
        disabled={isLoading || pendingHighlightRects.length === 0}
        onclick={addHighlightFromSelection}
      >Highlight selection</button>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Draw freehand" aria-pressed={drawingTool === 'freehand'} disabled={isLoading} onclick={() => toggleDrawingTool('freehand')}>Draw</button>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Draw rectangle" aria-pressed={drawingTool === 'rectangle'} disabled={isLoading} onclick={() => toggleDrawingTool('rectangle')}>Rectangle</button>
      <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Draw arrow" aria-pressed={drawingTool === 'arrow'} disabled={isLoading} onclick={() => toggleDrawingTool('arrow')}>Arrow</button>
    </div>

    <div class="flex flex-wrap items-center gap-2" data-annotation-group="export" role="group" aria-label="Annotation export">
      <button
        type="button"
        class="inline-flex min-h-[32px] items-center justify-center rounded-lg bg-brand-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#c8c5dc] disabled:text-white"
        aria-label="Export annotations into a new PDF"
        disabled={isLoading || isExportingAnnotations || annotations.length === 0 || editingNoteId !== null || newNoteId !== null}
        onclick={exportAnnotations}
      >{isExportingAnnotations ? 'Exporting…' : 'Export annotated PDF (' + annotations.length + ')'}</button>
      <span class="text-[10px] text-[#858b98]">Adds vector/text overlays to a new copy; the source PDF is unchanged.</span>
    </div>

    <div class="flex flex-wrap items-center gap-2" data-annotation-group="draft-recovery" role="group" aria-label="Local annotation draft recovery">
      <label class="inline-flex min-h-[32px] items-center gap-2 text-[10px] font-semibold text-[#535a68]" for="pdf-annotation-draft-toggle">
        <input
          id="pdf-annotation-draft-toggle"
          type="checkbox"
          class="size-4 accent-brand-600 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          checked={saveAnnotationDrafts}
          disabled={isLoading || isCheckingAnnotationDraft || !annotationDraftKey || availableAnnotationDraft !== null}
          onchange={(event) => void toggleAnnotationDraftSaving(event)}
        />
        Save annotation drafts on this device
      </label>
      {#if isCheckingAnnotationDraft}
        <span class="text-[10px] text-[#858b98]" role="status">Checking this device for a saved draft…</span>
      {:else if availableAnnotationDraft}
        <span class="text-[10px] text-[#858b98]" role="status">A saved draft has {availableAnnotationDraft.annotations.length} annotation(s).</span>
        <button type="button" class="inline-flex min-h-[30px] items-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-[10px] font-semibold text-brand-700 hover:bg-brand-100 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={restoreAvailableAnnotationDraft}>Restore saved draft</button>
        <button type="button" class="inline-flex min-h-[30px] items-center rounded-lg border border-line bg-white px-3 text-[10px] font-semibold text-[#555b68] hover:border-danger-300 hover:text-danger-600 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={() => void discardAvailableAnnotationDraft()}>Discard saved draft</button>
      {:else}
        <span class="text-[10px] text-[#858b98]" role="status">{annotationDraftStatus}</span>
      {/if}
      <span class="basis-full text-[9px] text-[#969ba6]">Opt-in storage uses this browser’s local database. Only annotations are saved; your PDF is never stored.</span>
    </div>

    {#if isAddingNote}
      <span class="text-[10px] text-brand-700" role="status">Select a point on the page to place a note.</span>
    {:else if drawingTool}
      <span class="text-[10px] text-brand-700" role="status">{drawingTool === 'freehand' ? 'Drag on the page to draw freehand.' : `Drag on the page to draw a ${drawingTool}.`}</span>
    {:else if pendingHighlightRects.length > 0}
      <span class="text-[10px] text-brand-700" role="status">Text selected. Add a highlight to save it.</span>
    {/if}
  </section>
  {#if editingNoteId}
    <form class="grid gap-2 border-b border-[#e9ebf0] bg-white px-4 py-3 max-[480px]:px-[10px]" aria-label="Text note editor" onsubmit={(event) => { event.preventDefault(); saveNote(); }}>
      <label for="pdf-note-editor" class="text-[11px] font-bold text-[#535a68]">Note text</label>
      <textarea id="pdf-note-editor" class="min-h-[76px] w-full resize-y rounded-lg border border-[#e0e3ea] bg-[#fbfcfe] px-3 py-2 text-[12px] text-[#303541] outline-none placeholder:text-[#8a909c] focus-visible:border-brand-300 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1" aria-label="Note text" value={noteDraft} oninput={(event) => { noteDraft = (event.currentTarget as HTMLTextAreaElement).value; noteError = ''; }} placeholder="Write a note about this page…"></textarea>
      {#if noteError}<p class="m-0 text-[10px] text-danger-600" role="alert">{noteError}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <button type="submit" class="inline-flex min-h-[32px] items-center justify-center rounded-lg bg-brand-600 px-3 text-[11px] font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2">Save note</button>
        <button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-[#454b59] hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={cancelNoteEditing}>Cancel</button>
        {#if !newNoteId}<button type="button" class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-danger-600 hover:border-danger-600 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={deleteSelectedAnnotation}>Delete note</button>{/if}
      </div>
    </form>
  {/if}
  {/if}
  {#if isSearching || searchResults.length > 0 || searchError}
    <section class="max-h-[250px] overflow-auto border-b border-[#e9ebf0] bg-[#fbfbfd]" aria-label="Search results" aria-live="polite">
      {#if isSearching}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]">Searching document text…</p>
      {:else if searchResults.length > 0}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]">{searchResults.length === 100 ? "100+ matches (showing first 100)" : `${searchResults.length} ${searchResults.length === 1 ? "match" : "matches"} found`}</p>
        <ol class="grid list-none gap-0.5 px-2 pb-2">
          {#each searchResults as result, index (`${result.pageNumber}-${result.index}-${index}`)}
            <li><button type="button" class="flex w-full items-start gap-3 rounded-lg border border-transparent bg-transparent px-2 py-[9px] text-left text-[#515765] hover:border-brand-100 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1 max-[480px]:gap-[7px] max-[480px]:px-[5px] max-[480px]:py-2" onclick={() => goToPage(result.pageNumber)}>
              <span class="w-[54px] shrink-0 text-[10px] font-bold text-brand-600 max-[480px]:w-12">Page {result.pageNumber}</span>
              <span class="min-w-0 text-[11px] leading-[1.5] text-[#6d7380] [overflow-wrap:anywhere]">{result.snippet.slice(0, result.matchStart)}<mark class="rounded-sm bg-brand-100 px-px text-brand-900">{result.matchText}</mark>{result.snippet.slice(result.matchStart + result.matchText.length)}</span>
            </button></li>
          {/each}
        </ol>
      {:else}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]" role="status">{searchError}</p>
      {/if}
    </section>
  {/if}
  <div class="flex min-h-[35px] items-center justify-center gap-2 border-b border-[#e9ebf0] bg-[#fbfbfd] text-[10px] text-subtle [font-variant-numeric:tabular-nums]" role="status" aria-live="polite" aria-atomic="true">
    {#if isLoading}
      <span class="size-[15px] animate-spin rounded-full border-2 border-brand-100 border-t-brand-600 motion-reduce:animate-none" aria-hidden="true"></span>
    {/if}
    {statusText}
  </div>

  {#if errorMessage}
    <div class="flex min-h-[320px] flex-1 flex-col items-center justify-center px-5 py-9 text-center" role="alert">
      <strong class="text-[14px] font-bold text-[#343946]">Unable to display this document</strong>
      <p class="mb-[18px] mt-2 max-w-[420px] text-[12px] leading-[1.6] text-[#7d8491]">{errorMessage}</p>
      <button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" onclick={onClose}>Return to tools</button>
    </div>
  {:else}
    <div class="flex min-h-[520px] min-w-0 flex-1 max-[760px]:min-h-[460px] max-[760px]:w-full">
      {#if pdfDocument && totalPages > 0}
        <div
          id="pdf-thumbnails"
          style:display={isMobileViewport && !thumbnailsOpen ? 'none' : 'contents'}
          aria-hidden={isMobileViewport && !thumbnailsOpen}
        >
          <ThumbnailSidebar
            document={pdfDocument}
            {totalPages}
            {currentPage}
            onSelectPage={selectThumbnailPage}
          />
        </div>
      {/if}
      <div class="flex min-h-[520px] min-w-0 w-full flex-1 flex-col items-center overflow-auto overscroll-contain bg-[#eef0f4] p-[26px] max-h-[78vh] max-[760px]:min-h-[460px] max-[760px]:max-h-[70vh] max-[760px]:items-start max-[760px]:p-3 max-[420px]:min-h-[390px] max-[420px]:p-[8px]" bind:this={viewerViewport} role="region" aria-label="Document page area">
        {#if continuousMode && pdfDocument && totalPages > 0}
          <PdfContinuousViewer
            bind:this={continuousViewer}
            pdfDocument={pdfDocument}
            {totalPages}
            {zoom}
            scrollRoot={viewerViewport}
            initialPage={currentPage}
            onPageChange={handleContinuousPageChange}
          />
        {:else}
        {#if isLoading}
          <div class="m-auto flex min-h-[180px] flex-col items-center justify-center gap-2 text-center text-[#5e6471]">
            <span class="size-7 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600 motion-reduce:animate-none" aria-hidden="true"></span>
            <strong class="mt-1.5 text-[13px] font-bold text-[#343946]">Opening your PDF</strong>
            <p class="m-0 text-[11px] text-[#89909d]">Your document is being processed on this device.</p>
          </div>
        {/if}
        <div data-page-surface role="group" aria-label="PDF page surface" class={`relative my-auto flex-none bg-white shadow-[0_4px_18px_rgb(29_35_51_/_0.13)] ${isRendering ? "opacity-80" : ""} ${isAddingNote || drawingTool ? "touch-none" : ""}` } style:cursor={isAddingNote || drawingTool ? 'crosshair' : undefined} onpointerdown={handlePagePointerDown}>
          <canvas bind:this={canvasElement} class="relative z-0 block max-w-none bg-white" aria-label={`Page ${currentPage} of ${totalPages || 'document'}`}></canvas>
          <div
            bind:this={textLayerElement}
            class={`textLayer absolute left-0 top-0 z-10 ${isAddingNote || drawingTool ? "pointer-events-none select-none" : "select-text"}`}
            role="group"
            aria-label={`Selectable text for page ${currentPage}`}
          ></div>
          {#if renderedPageViewport && unrotatedPageViewport}
            <div class="pointer-events-none absolute inset-0 z-20" aria-label="PDF annotations">
              {#if drawingStart && drawingPreviewEnd}
                {@const previewStart = normalizedPointToViewport(drawingStart.point, unrotatedPageViewport, renderedPageViewport)}
                {@const previewEnd = normalizedPointToViewport(drawingPreviewEnd, unrotatedPageViewport, renderedPageViewport)}
                {#if drawingStart.tool === 'freehand'}
                  {@const previewPoints = [...drawingStart.points, drawingPreviewEnd].map((point) => normalizedPointToViewport(point, unrotatedPageViewport!, renderedPageViewport!)).map((point) => `${point.x},${point.y}`).join(' ')}
                  <svg class="absolute inset-0 h-full w-full" viewBox={`0 0 ${renderedPageViewport.width} ${renderedPageViewport.height}`} aria-hidden="true">
                    <polyline points={previewPoints} fill="none" stroke="#2463eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                {:else if drawingStart.tool === 'rectangle'}
                  <div
                    class="absolute border-2 border-dashed border-blue-600 bg-blue-500/10"
                    style={`left:${Math.min(previewStart.x, previewEnd.x)}px;top:${Math.min(previewStart.y, previewEnd.y)}px;width:${Math.abs(previewEnd.x - previewStart.x)}px;height:${Math.abs(previewEnd.y - previewStart.y)}px;`}
                  ></div>
                {:else}
                  <svg class="absolute inset-0 h-full w-full" viewBox={`0 0 ${renderedPageViewport.width} ${renderedPageViewport.height}`} aria-hidden="true">
                    <line x1={previewStart.x} y1={previewStart.y} x2={previewEnd.x} y2={previewEnd.y} stroke="#2463eb" stroke-width="2.5" stroke-dasharray="6 4" />
                  </svg>
                {/if}
              {/if}
              {#each visibleAnnotations as annotation (annotation.id)}
                {@const displayed = getDisplayedAnnotation(annotation)}
                {#if displayed.type === 'highlight'}
                  {#each displayed.rects as rect, rectIndex (annotation.id + '-' + rectIndex)}
                    {@const mapped = normalizedRectToViewport(rect, unrotatedPageViewport, renderedPageViewport)}
                    <div
                      class="pointer-events-auto absolute cursor-move rounded-[2px] border border-transparent select-none"
                      data-annotation-id={annotation.id}
                      data-annotation-type="highlight"
                      style={"left:" + mapped.x + "px;top:" + mapped.y + "px;width:" + mapped.width + "px;height:" + mapped.height + "px;background:" + annotation.color + ";opacity:" + annotation.opacity + ";outline:" + (selectedAnnotationId === annotation.id ? "2px solid #7165d5" : "none") + ";outline-offset:1px;"}
                      role="button"
                      tabindex="0"
                      aria-label="Select highlight"
                      aria-pressed={selectedAnnotationId === annotation.id}
                      onpointerdown={(event) => beginAnnotationDrag(event, annotation)}
                      onclick={() => selectAnnotation(annotation)}
                      onkeydown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectAnnotation(annotation);
                        }
                      }}
                    ></div>
                  {/each}
                {:else if displayed.type === 'freehand'}
                  {@const mappedPoints = displayed.points.map((point) => normalizedPointToViewport(point, unrotatedPageViewport!, renderedPageViewport!))}
                  {@const pathPoints = mappedPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                  <svg
                    class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                    viewBox={`0 0 ${renderedPageViewport.width} ${renderedPageViewport.height}`}
                    data-annotation-id={annotation.id}
                    data-annotation-type="freehand"
                    aria-label="Freehand annotation"
                  >
                    <polyline points={pathPoints} fill="none" stroke={displayed.color} stroke-width={Math.max(2, displayed.strokeWidth * Math.min(renderedPageViewport.width, renderedPageViewport.height))} stroke-linecap="round" stroke-linejoin="round" opacity={displayed.opacity} />
                  </svg>
                {:else if displayed.type === 'rectangle'}
                  {@const mapped = normalizedRectToViewport(displayed.rect, unrotatedPageViewport, renderedPageViewport)}
                  <div class="pointer-events-auto absolute touch-none cursor-move border-2 border-blue-600 bg-blue-500/10" data-annotation-id={annotation.id} data-annotation-type="rectangle" style={`left:${mapped.x}px;top:${mapped.y}px;width:${mapped.width}px;height:${mapped.height}px;opacity:${displayed.opacity};outline:${selectedAnnotationId === annotation.id ? '2px solid #7165d5' : 'none'};outline-offset:2px;`} role="button" tabindex="0" aria-label="Select rectangle annotation" aria-pressed={selectedAnnotationId === annotation.id} onpointerdown={(event) => beginAnnotationDrag(event, annotation)} onclick={() => selectAnnotation(annotation)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAnnotation(annotation); } }}></div>
                {:else if displayed.type === 'arrow'}
                  {@const start = normalizedPointToViewport(displayed.start, unrotatedPageViewport, renderedPageViewport)}
                  {@const end = normalizedPointToViewport(displayed.end, unrotatedPageViewport, renderedPageViewport)}
                  <svg
                    class="pointer-events-auto absolute inset-0 h-full w-full overflow-visible touch-none"
                    viewBox={`0 0 ${renderedPageViewport.width} ${renderedPageViewport.height}`}
                    data-annotation-id={annotation.id}
                    data-annotation-type="arrow"
                    role="button"
                    tabindex="0"
                    aria-label="Select arrow annotation"
                    aria-pressed={selectedAnnotationId === annotation.id}
                    onpointerdown={(event) => beginAnnotationDrag(event, annotation)}
                    onclick={() => selectAnnotation(annotation)}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectAnnotation(annotation);
                      }
                    }}
                  >
                    <defs><marker id={`arrowhead-${annotation.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill={displayed.color} /></marker></defs>
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" stroke-width="20" stroke-linecap="round" pointer-events="stroke" />
                    <line class="pointer-events-none" x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={displayed.color} stroke-width={Math.max(2, displayed.strokeWidth * Math.min(renderedPageViewport.width, renderedPageViewport.height))} marker-end={`url(#arrowhead-${annotation.id})`} opacity={displayed.opacity} />
                  </svg>
                {:else if displayed.type === 'text-note'}
                  {@const mapped = normalizedPointToViewport(displayed.anchor, unrotatedPageViewport, renderedPageViewport)}
                  <button
                    type="button"
                    class="pointer-events-auto absolute touch-none grid size-7 place-items-center rounded-full border-2 border-white bg-[#2463eb] text-[11px] font-bold text-white shadow-[0_2px_7px_rgb(22_35_66_/_0.25)] transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 cursor-move"
                    data-annotation-id={annotation.id}
                    data-annotation-type="text-note"
                    style={"left:" + mapped.x + "px;top:" + mapped.y + "px;transform:translate(-50%,-50%);outline:" + (selectedAnnotationId === annotation.id ? "2px solid #7165d5" : "none") + ";outline-offset:2px;"}
                    aria-label={"Note: " + (displayed.text || "Untitled note")}
                    title={displayed.text || 'Untitled note'}
                    onpointerdown={(event) => beginAnnotationDrag(event, annotation)}
                    onclick={() => selectAnnotation(annotation)}
                  >N</button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        {/if}
      </div>
    </div>
  {/if}
</section>