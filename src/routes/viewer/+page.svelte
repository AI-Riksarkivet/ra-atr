<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import DocumentViewer from '$lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from '$lib/components/TranscriptionPanel.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import LinePreview from '$lib/components/LinePreview.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { LineGroup, Line, BBox } from '$lib/types';

  let dividerX = $state(60);
  let isDraggingDivider = $state(false);
  let docViewer: DocumentViewer;

  // Redirect to home if no documents loaded
  $effect(() => {
    if (appState.documents.length === 0 && appState.htr.modelsReady) goto('/');
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedLines.size > 0) {
      e.preventDefault();
      deleteSelectedLines();
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
    };

    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  });

  function onDividerPointerDown(e: PointerEvent) {
    isDraggingDivider = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!isDraggingDivider) return;
    const container = (e.target as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    dividerX = Math.min(85, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
  }
  function onDividerPointerUp(e: PointerEvent) {
    isDraggingDivider = false;
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

{#if appState.contributeSuccess}
  <div class="bg-green-500/10 px-4 py-2 text-sm text-green-500 shrink-0 flex items-center justify-between">
    <span>{appState.contributeSuccess}</span>
    <button class="text-xs underline" onclick={() => appState.contributeSuccess = null}>dismiss</button>
  </div>
{/if}

{#if appState.contributeError}
  <div class="bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0 flex items-center justify-between">
    <span>Contribute failed: {appState.contributeError}</span>
    <button class="text-xs underline" onclick={() => appState.contributeError = null}>dismiss</button>
  </div>
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
  <div class="relative overflow-hidden" style="width: {dividerX}%">
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
  <div
    class="w-[5px] shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary"
    class:bg-primary={isDraggingDivider}
    onpointerdown={onDividerPointerDown}
    onpointermove={onDividerPointerMove}
    onpointerup={onDividerPointerUp}
    role="separator"
  ></div>
  <div class="overflow-hidden border-l border-border" style="width: {100 - dividerX}%">
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
        }
      }}
      selectMode={appState.selectMode}
      activeRegions={appState.htr.activeRegions}
    activeImageIds={appState.htr.activeImageIds}
    />
  </div>
</div>

<LinePreview
  imageUrl={activeDoc?.imageUrl ?? null}
  bbox={appState.hoveredLine >= 0 ? (activeDoc?.lines[appState.hoveredLine]?.bbox ?? null) : null}
/>

{#if appState.htr.stage !== 'idle' || appState.htr.modelsReady}
  <StatusBar
    stage={appState.htr.stage}
    documents={appState.documents}
    activeImageIds={appState.htr.activeImageIds}
    activeTranscriptions={appState.htr.activeTranscriptions}
    poolSize={appState.htr.poolSize}
  />
{/if}
