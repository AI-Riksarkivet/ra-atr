<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import DocumentViewer from '$lib/components/DocumentViewer.svelte';
  import TranscriptionPanel from '$lib/components/TranscriptionPanel.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { LineGroup } from '$lib/types';

  let dividerX = $state(60);
  let isDraggingDivider = $state(false);
  let docViewer: DocumentViewer;


  // Redirect to home if no image loaded
  $effect(() => {
    if (!appState.imageUrl) goto('/');
  });

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
    if (appState.selectedLines.size === 0) return;
    const sel = appState.selectedLines;
    for (const g of appState.groups) {
      g.lineIndices = g.lineIndices.filter(i => !sel.has(i));
    }
    appState.groups = appState.groups.filter(g => g.lineIndices.length > 0);
    appState.groupCounter++;
    const newGroup: LineGroup = {
      id: `group-${appState.groupCounter}`,
      name: `Group ${appState.groupCounter}`,
      lineIndices: [...sel].sort((a, b) => a - b),
      collapsed: false,
    };
    appState.groups = [...appState.groups, newGroup];
    appState.selectedLines = new Set();
    if (appState.htr.stage === 'transcribing') {
      const allGroups = [...appState.groups.filter(g => g.lineIndices.length > 0)];
      const grouped = new Set(allGroups.flatMap(g => g.lineIndices));
      const order = [
        ...allGroups.flatMap(g => g.lineIndices),
        ...Array.from({ length: appState.htr.lines.length }, (_, i) => i).filter(i => !grouped.has(i)),
      ];
      appState.htr.prioritizeLines(order);
    }
  }

  function deleteSelectedLines() {
    if (appState.selectedLines.size === 0) return;
    const removed = appState.selectedLines;
    const remap = new Map<number, number>();
    let newIdx = 0;
    for (let i = 0; i < appState.htr.lines.length; i++) {
      if (!removed.has(i)) remap.set(i, newIdx++);
    }
    appState.htr.lines = appState.htr.lines.filter((_, i) => !removed.has(i));
    for (const g of appState.groups) {
      g.lineIndices = g.lineIndices.filter(i => !removed.has(i)).map(i => remap.get(i)!);
    }
    // Cancel regions for groups that are now empty
    for (const g of appState.groups) {
      if (g.lineIndices.length === 0 && g.regionId) {
        appState.htr.cancelRegion(g.regionId);
      }
    }
    appState.groups = appState.groups.filter(g => g.lineIndices.length > 0);
    appState.selectedLines = new Set();
  }

  function deleteGroup(groupId: string) {
    const group = appState.groups.find(g => g.id === groupId);
    if (!group) return;
    // Cancel in-flight transcription if region-based
    if (group.regionId) {
      appState.htr.cancelRegion(group.regionId);
    }
    // Remove the group's lines and remap indices for remaining groups
    const removed = new Set(group.lineIndices);
    if (removed.size > 0) {
      const remap = new Map<number, number>();
      let newIdx = 0;
      for (let i = 0; i < appState.htr.lines.length; i++) {
        if (!removed.has(i)) remap.set(i, newIdx++);
      }
      appState.htr.lines = appState.htr.lines.filter((_, i) => !removed.has(i));
      for (const g of appState.groups) {
        if (g.id !== groupId) {
          g.lineIndices = g.lineIndices.filter(i => !removed.has(i)).map(i => remap.get(i)!);
        }
      }
    }
    appState.groups = appState.groups.filter(g => g.id !== groupId);
  }
  function renameGroup(groupId: string, name: string) { appState.groups = appState.groups.map(g => g.id === groupId ? { ...g, name } : g); }
  function toggleGroup(groupId: string) { appState.groups = appState.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g); }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedLines.size > 0) {
      e.preventDefault();
      deleteSelectedLines();
    }
  }

  function handleNewImage() {
    appState.reset();
    goto('/');
  }

  onMount(() => {
    appState.htr.onRegionDetected = (regionId, startIndex, count) => {
      docViewer?.clearRedetecting(regionId);
      // Find the group created earlier and populate its line indices
      const lineIndices = Array.from({ length: count }, (_, i) => startIndex + i);
      appState.groups = appState.groups.map(g =>
        g.regionId === regionId ? { ...g, lineIndices } : g
      );
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
  onNewImage={handleNewImage}
/>

{#if appState.htr.error}
  <div class="bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">{appState.htr.error}</div>
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
      imageUrl={appState.imageUrl}
      lines={appState.htr.lines}
      currentLine={appState.htr.currentLine}
      hoveredLine={appState.hoveredLine}
      onHoverLine={(i) => appState.hoveredLine = i}
      stage={appState.htr.stage}
      selectedLines={appState.selectedLines}
      onSelectLine={handleSelectLine}
      onMarqueeSelect={handleMarqueeSelect}
      onRedetectRegion={(x, y, w, h) => {
        const regionId = appState.htr.redetectRegion(x, y, w, h);
        // Create group immediately — before YOLO even runs
        appState.groupCounter++;
        appState.groups = [...appState.groups, {
          id: `group-${appState.groupCounter}`,
          name: `Group ${appState.groupCounter}`,
          lineIndices: [],
          collapsed: false,
          regionId,
          rect: { x, y, w, h },
        }];
        return regionId;
      }}
      groups={appState.groups}
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
      lines={appState.htr.lines}
      currentLine={appState.htr.currentLine}
      currentText={appState.htr.currentText}
      hoveredLine={appState.hoveredLine}
      onHoverLine={(i) => appState.hoveredLine = i}
      selectedLines={appState.selectedLines}
      onSelectLine={handleSelectLine}
      groups={appState.groups}
      onToggleGroup={toggleGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={deleteGroup}
      onFocusGroup={(indices, rect) => {
        if (indices.length > 0) docViewer?.focusLines(indices);
        else if (rect) docViewer?.focusRect(rect.x, rect.y, rect.w, rect.h);
      }}
      onFocusLine={(i) => docViewer?.focusLines([i])}
      onEditLine={(i, text) => { if (appState.htr.lines[i]) appState.htr.lines[i].text = text; }}
      selectMode={appState.selectMode}
    />
  </div>
</div>

{#if appState.htr.stage !== 'idle' || appState.htr.modelsReady}
  <StatusBar
    stage={appState.htr.stage}
    currentLine={appState.htr.currentLine}
    totalLines={appState.htr.lines.length}
  />
{/if}
