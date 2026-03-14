<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { resolveVolume } from '$lib/riksarkivet';
  import { fetchTranscriptions } from '$lib/api';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import DocumentViewer from '$lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from '$lib/components/TranscriptionPanel.svelte';
  import CatalogPanel from '$lib/components/CatalogPanel.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import LinePreview from '$lib/components/LinePreview.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { LineGroup, Line, BBox } from '$lib/types';

  let leftWidth = $state(20);
  let rightWidth = $state(25);
  let leftCollapsed = $state(false);
  let rightCollapsed = $state(false);
  let draggingDivider = $state<'left' | 'right' | null>(null);
  let docViewer: DocumentViewer;

  // Redirect to home if models not loaded (wait for cache check first)
  $effect(() => {
    if (appState.htr.cacheChecked && !appState.htr.modelsReady && appState.htr.stage === 'idle') goto('/');
  });

  // Active document derived state
  let activeDoc = $derived(appState.activeDocument);
  let lines = $derived(activeDoc?.lines ?? []);
  let groups = $derived(activeDoc?.groups ?? []);

  function handleSelectLine(index: number, additive: boolean) {
    if (index < 0) { appState.selectedLines = new Set(); return; }
    if (additive) {
      const next = new Set(appState.selectedLines);
      if (next.has(index)) next.delete(index); else next.add(index);
      appState.selectedLines = next;
    } else {
      appState.selectedLines = new Set([index]);
    }
  }

  function handleMarqueeSelect(indices: number[]) {
    appState.selectedLines = new Set(indices);
  }

  function createGroup() {
    if (!activeDoc || appState.selectedLines.size === 0) return;
    const sel = appState.selectedLines;
    for (const g of activeDoc.groups) {
      g.lineIndices = g.lineIndices.filter(i => !sel.has(i));
    }
    activeDoc.groups = activeDoc.groups.filter(g => g.lineIndices.length > 0);
    activeDoc.groupCounter++;
    const newGroup: LineGroup = {
      id: `group-${activeDoc.groupCounter}`,
      name: `Group ${activeDoc.groupCounter}`,
      lineIndices: [...sel].sort((a, b) => a - b),
      collapsed: false,
    };
    activeDoc.groups = [...activeDoc.groups, newGroup];
    appState.documents = [...appState.documents];
    appState.selectedLines = new Set();
  }

  function deleteSelectedLines() {
    if (!activeDoc || appState.selectedLines.size === 0) return;
    const removed = appState.selectedLines;
    const remap = new Map<number, number>();
    let newIdx = 0;
    for (let i = 0; i < activeDoc.lines.length; i++) {
      if (!removed.has(i)) remap.set(i, newIdx++);
    }
    activeDoc.lines = activeDoc.lines.filter((_, i) => !removed.has(i));
    for (const g of activeDoc.groups) {
      g.lineIndices = g.lineIndices.filter(i => !removed.has(i)).map(i => remap.get(i)!);
    }
    for (const g of activeDoc.groups) {
      if (g.lineIndices.length === 0 && g.regionId) {
        appState.htr.cancelRegion(g.regionId);
      }
    }
    activeDoc.groups = activeDoc.groups.filter(g => g.lineIndices.length > 0);
    appState.documents = [...appState.documents];
    appState.selectedLines = new Set();
    if (activeDoc.manifestId) appState.scheduleAutoSave();
  }

  function deleteGroup(groupId: string) {
    if (!activeDoc) return;
    const group = activeDoc.groups.find(g => g.id === groupId);
    if (!group) return;
    if (group.regionId) {
      appState.htr.cancelRegion(group.regionId);
    }
    const removed = new Set(group.lineIndices);
    if (removed.size > 0) {
      const remap = new Map<number, number>();
      let newIdx = 0;
      for (let i = 0; i < activeDoc.lines.length; i++) {
        if (!removed.has(i)) remap.set(i, newIdx++);
      }
      activeDoc.lines = activeDoc.lines.filter((_, i) => !removed.has(i));
      for (const g of activeDoc.groups) {
        if (g.id !== groupId) {
          g.lineIndices = g.lineIndices.filter(i => !removed.has(i)).map(i => remap.get(i)!);
        }
      }
    }
    activeDoc.groups = activeDoc.groups.filter(g => g.id !== groupId);
    appState.documents = [...appState.documents];
    if (activeDoc.manifestId) appState.scheduleAutoSave();
  }

  function renameGroup(groupId: string, name: string) {
    if (!activeDoc) return;
    activeDoc.groups = activeDoc.groups.map(g => g.id === groupId ? { ...g, name } : g);
    appState.documents = [...appState.documents];
  }

  function toggleGroup(groupId: string) {
    if (!activeDoc) return;
    activeDoc.groups = activeDoc.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
    appState.documents = [...appState.documents];
  }

  function onKeyDown(e: KeyboardEvent) {
    // Skip when focused on an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedLines.size > 0) {
      e.preventDefault();
      deleteSelectedLines();
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); appState.navigatePage(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); appState.navigatePage(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); appState.navigateLine(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); appState.navigateLine(1); }
  }

  let catalogLoading = $state('');
  let catalogError = $state('');

  function handleRiksarkivetResolved(manifestId: string, pages: number[]) {
    const existingPages = new Set(
      appState.documents.filter(d => d.manifestId === manifestId).map(d => d.pageNumber)
    );
    const newPages = pages.filter(p => !existingPages.has(p));

    for (const page of newPages) {
      const padded = String(page).padStart(5, '0');
      const docId = appState.addPlaceholderDocument(
        `${manifestId}_${padded}.jpg`, manifestId, page
      );
      if (!appState.activeDocumentId) {
        appState.activeDocumentId = docId;
        appState.loadDocumentImage(docId);
      }
    }

    appState.selectMode = true;

    if (newPages.length > 0) {
      fetchTranscriptions(manifestId).then(groups => {
        if (groups.length > 0) appState.populateFromBackend(manifestId, groups);
      }).catch(() => {});
    }
  }

  async function handleCatalogLoad(referenceCode: string) {
    if (catalogLoading) return;
    catalogLoading = 'Resolving...';
    catalogError = '';
    try {
      const { manifestId, pages } = await resolveVolume(referenceCode, (p) => {
        if (p.stage === 'resolving') catalogLoading = 'Resolving reference code...';
        else if (p.stage === 'manifest') catalogLoading = `Found ${p.manifestId}, loading manifest...`;
        else if (p.stage === 'done') catalogLoading = `Loading ${p.totalPages} pages...`;
      });
      handleRiksarkivetResolved(manifestId, pages);
    } catch (e) {
      catalogError = e instanceof Error ? e.message : 'Failed to load volume';
    } finally {
      catalogLoading = '';
    }
  }

  function handleAddImages() {
    goto('/');
  }

  onMount(() => {
    // Route region detections to the right document
    appState.htr.onRegionDetected = (imageId, regionId, startIndex, bboxes) => {
      docViewer?.clearRedetecting(regionId);
      const newLines: Line[] = bboxes.map((bbox) => ({
        bbox,
        text: '',
        confidence: 0,
        complete: false,
      }));
      appState.updateDocumentLines(imageId, (doc) => {
        doc.lines = [...doc.lines, ...newLines];
        const lineIndices = Array.from({ length: bboxes.length }, (_, i) => startIndex + i);
        doc.groups = doc.groups.map(g =>
          g.regionId === regionId ? { ...g, lineIndices } : g
        );
      });
    };

    // Route token updates to the right document
    appState.htr.onToken = (imageId, lineIndex, token) => {
      const doc = appState.documents.find(d => d.id === imageId);
      if (doc?.lines[lineIndex]) {
        doc.lines[lineIndex].text += token;
        appState.documents = [...appState.documents];
      }
    };

    // Route line completions to the right document
    appState.htr.onLineDone = (imageId, lineIndex, text, confidence) => {
      const doc = appState.documents.find(d => d.id === imageId);
      if (doc?.lines[lineIndex]) {
        doc.lines[lineIndex].text = text;
        doc.lines[lineIndex].confidence = confidence;
        doc.lines[lineIndex].complete = true;
        appState.documents = [...appState.documents];
      }
    };

    // Route region completion
    appState.htr.onRegionDone = (imageId, regionId) => {
      // Check if all lines across all documents are complete
      const anyIncomplete = appState.documents.some(d =>
        d.lines.some(l => !l.complete && l.text === '')
      );
      if (!anyIncomplete && appState.htr.stage === 'transcribing') {
        appState.htr.stage = 'done';
      }
      // Auto-save when a region finishes transcribing
      const doc = appState.documents.find(d => d.id === imageId);
      if (doc?.manifestId) appState.scheduleAutoSave();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  });

  function onDividerPointerDown(side: 'left' | 'right', e: PointerEvent) {
    draggingDivider = side;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!draggingDivider) return;
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (draggingDivider === 'left') {
      leftWidth = Math.min(40, Math.max(12, pct));
    } else {
      rightWidth = Math.min(40, Math.max(12, 100 - pct));
    }
  }
  function onDividerPointerUp(e: PointerEvent) {
    draggingDivider = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<AppHeader
  onZoomIn={() => docViewer?.zoomIn()}
  onZoomOut={() => docViewer?.zoomOut()}
  onResetView={() => docViewer?.resetView()}
  onNewImage={handleAddImages}
/>

{#if appState.htr.error}
  <div class="bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">{appState.htr.error}</div>
{/if}
{#if catalogLoading}
  <div class="bg-muted px-4 py-1.5 text-xs text-muted-foreground animate-pulse shrink-0">{catalogLoading}</div>
{/if}
{#if catalogError}
  <div class="bg-destructive/10 px-4 py-1.5 text-xs text-destructive shrink-0">{catalogError}</div>
{/if}


{#if appState.selectedLines.size > 0}
  <div class="flex items-center gap-2 border-b border-yellow-400/20 bg-yellow-400/[0.08] px-4 py-1.5 shrink-0">
    <span class="text-xs text-yellow-400">{appState.selectedLines.size} line{appState.selectedLines.size > 1 ? 's' : ''} selected</span>
    <Button size="sm" onclick={createGroup}>Group selected</Button>
    <Button size="sm" variant="destructive" onclick={deleteSelectedLines}>Delete</Button>
    <Button size="sm" variant="outline" onclick={() => appState.selectedLines = new Set()}>Clear</Button>
  </div>
{/if}

<div class="flex flex-1 overflow-hidden">
  <!-- Left: Catalog browser -->
  {#if leftCollapsed}
    <button
      class="shrink-0 flex items-center justify-center px-1 border-r border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
      onclick={() => leftCollapsed = false}
      title="Show catalog"
    >
      <span class="text-[0.55rem] [writing-mode:vertical-lr] tracking-widest uppercase select-none">catalog</span>
    </button>
  {:else}
    <div class="overflow-hidden border-r border-border flex flex-col" style="width: {leftWidth}%">
      <CatalogPanel onLoadVolume={handleCatalogLoad} />
      <button
        class="shrink-0 w-full py-0.5 text-center text-[0.55rem] text-muted-foreground hover:text-foreground hover:bg-muted/30 border-t border-border cursor-pointer transition-colors"
        onclick={() => leftCollapsed = true}
      >&laquo; hide</button>
    </div>
    <div
      class="w-[5px] shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary"
      class:bg-primary={draggingDivider === 'left'}
      onpointerdown={(e) => onDividerPointerDown('left', e)}
      onpointermove={onDividerPointerMove}
      onpointerup={onDividerPointerUp}
      role="separator"
    ></div>
  {/if}

  <!-- Center: Document viewer -->
  <div class="relative overflow-hidden flex-1">
    <DocumentViewer
      bind:this={docViewer}
      imageUrl={activeDoc?.imageUrl ?? null}
      lines={lines}
      currentLine={-1}
      hoveredLine={appState.hoveredLine}
      onHoverLine={(i) => appState.hoveredLine = i}
      stage={appState.htr.stage}
      selectedLines={appState.selectedLines}
      onSelectLine={handleSelectLine}
      onMarqueeSelect={handleMarqueeSelect}
      onRedetectRegion={(x, y, w, h) => {
        if (!activeDoc) return '';
        const regionId = appState.htr.redetectRegion(activeDoc.id, x, y, w, h);
        activeDoc.groupCounter++;
        activeDoc.groups = [...activeDoc.groups, {
          id: `group-${activeDoc.groupCounter}`,
          name: `Group ${activeDoc.groupCounter}`,
          lineIndices: [],
          collapsed: false,
          regionId,
          rect: { x, y, w, h },
        }];
        appState.documents = [...appState.documents];
        return regionId;
      }}
      groups={groups}
      selectMode={appState.selectMode}
    />
  </div>

  <!-- Right: Transcription tree -->
  {#if rightCollapsed}
    <button
      class="shrink-0 flex items-center justify-center px-1 border-l border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
      onclick={() => rightCollapsed = false}
      title="Show transcriptions"
    >
      <span class="text-[0.55rem] [writing-mode:vertical-lr] tracking-widest uppercase select-none">transcriptions</span>
    </button>
  {:else}
    <div
      class="w-[5px] shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary"
      class:bg-primary={draggingDivider === 'right'}
      onpointerdown={(e) => onDividerPointerDown('right', e)}
      onpointermove={onDividerPointerMove}
      onpointerup={onDividerPointerUp}
      role="separator"
    ></div>
    <div class="overflow-hidden border-l border-border flex flex-col" style="width: {rightWidth}%">
      <TranscriptionPanel
        documents={appState.documents}
        activeDocumentId={appState.activeDocumentId}
        onSwitchDocument={(id) => appState.switchDocument(id)}
        hoveredLine={appState.hoveredLine}
        onHoverLine={(i) => appState.hoveredLine = i}
        selectedLines={appState.selectedLines}
        onSelectLine={handleSelectLine}
        onToggleGroup={toggleGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onFocusGroup={(indices, rect) => {
          if (indices.length > 0) docViewer?.focusLines(indices);
          else if (rect) docViewer?.focusRect(rect.x, rect.y, rect.w, rect.h);
        }}
        onFocusLine={(i) => docViewer?.focusLines([i])}
        onEditLine={(i, text) => {
          if (activeDoc?.lines[i]) {
            activeDoc.lines[i].text = text;
            appState.documents = [...appState.documents];
            if (activeDoc.manifestId) appState.scheduleAutoSave();
          }
        }}
        selectMode={appState.selectMode}
        activeRegions={appState.htr.activeRegions}
        activeImageIds={appState.htr.activeImageIds}
      />
      <button
        class="shrink-0 w-full py-0.5 text-center text-[0.55rem] text-muted-foreground hover:text-foreground hover:bg-muted/30 border-t border-border cursor-pointer transition-colors"
        onclick={() => rightCollapsed = true}
      >hide &raquo;</button>
    </div>
  {/if}
</div>

<LinePreview
  imageUrl={activeDoc?.imageUrl ?? null}
  bbox={appState.hoveredLine >= 0 ? (activeDoc?.lines[appState.hoveredLine]?.bbox ?? null) : null}
/>

<footer class="flex items-center gap-3 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground shrink-0">
  {#if activeDoc?.manifestId}
    {@const siblings = appState.documents.filter(d => d.manifestId === activeDoc.manifestId)}
    {@const pageIdx = siblings.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0)).findIndex(d => d.id === activeDoc.id)}
    <span class="font-mono">p. {activeDoc.pageNumber ?? '?'} / {siblings.length}</span>
    <span class="text-muted-foreground/50">|</span>
    <span>{activeDoc.manifestId}</span>
    <span class="text-muted-foreground/50">|</span>
    <span class="text-[0.65rem]">&larr;&rarr; pages &uarr;&darr; lines</span>
  {/if}

  <span class="ml-auto">
    {#if appState.saving}
      <span class="animate-pulse">Saving...</span>
    {:else if appState.saveError}
      <span class="text-destructive">{appState.saveError}</span>
    {:else if appState.lastSaved}
      <span>{appState.lastSaved}</span>
    {/if}
  </span>

  {#if appState.htr.stage !== 'idle' || appState.htr.modelsReady}
    <span class="text-muted-foreground/50">|</span>
    <StatusBar
      stage={appState.htr.stage}
      documents={appState.documents}
      activeImageIds={appState.htr.activeImageIds}
      activeTranscriptions={appState.htr.activeTranscriptions}
      poolSize={appState.htr.poolSize}
    />
  {/if}
</footer>
